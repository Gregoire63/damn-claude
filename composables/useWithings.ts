import { computed, ref } from 'vue'
import { useNutrition } from './useNutrition'
import { useWorkout } from './useWorkout'
import type { ActivityDay, BodyEntry } from '../lib/withings'
import { carriedComp, composition, dailySeries, mergeEntries, parseActivity, parseGroup, suspectsOf, weeklySlope } from '../lib/withings'
import { defaultSteps } from '../lib/nutritionStats'

// Connexion à la balance Withings Body Smart.
//
// Même principe que le reste de /sport : état au niveau du module (pas de Pinia),
// hydratation explicite côté client, persistance localStorage. Les jetons restent
// sur l'appareil ; seul le client_secret vit sur le serveur, dans server/api/withings/.

const TOK_KEY = 'gr-withings-tok-v1'
const BODY_KEY = 'gr-withings-body-v1'
// Pas de clé pour l'activité : voir `activity` plus bas.
const SYNC_KEY = 'gr-withings-sync-v1'
/** Le nonce de la connexion en cours : le seul fil qui ne quitte jamais la PWA. */
const NONCE_KEY = 'gr-withings-nonce-v1'
// Clé de l'ancien suivi de poids du module séances, absorbée une fois pour toutes.
const LEGACY_BW_KEY = 'gr-bodyweight-v1'
const MIGRATED_KEY = 'gr-withings-migr-v1'
/** Délai minimum entre deux synchronisations d'ouverture. Une pesée par jour suffit. */
const AUTO_SYNC_MIN_S = 3600

export interface WithingsTokens {
  accessToken: string
  refreshToken: string
  expiresAt?: number
  userid?: string
}

const tokens = ref<WithingsTokens | null>(null)
const entries = ref<BodyEntry[]>([])
/**
 * Pas rapportés par la dernière synchronisation. Volontairement NON persistés et
 * NON exportés : la valeur qui fait foi est `overrides[jour].steps` côté nutrition,
 * où `pushToJournal` la reverse. Les garder aussi ici revenait à stocker le même
 * nombre sous deux clés, exporté deux fois — et à laisser les deux diverger au
 * premier import d'une sauvegarde partielle.
 */
const activity = ref<ActivityDay[]>([])
const lastSync = ref<number>(0) // epoch (s) du dernier `updatetime` Withings
const syncing = ref(false)
const syncError = ref<string | null>(null)
let hydrated = false

function safeParse<T>(raw: string | null, fb: T): T {
  if (!raw) return fb
  try { return JSON.parse(raw) as T }
  catch { return fb }
}
function write(key: string, value: unknown) {
  if (!import.meta.client) return
  try { localStorage.setItem(key, JSON.stringify(value)) }
  catch { /* quota ou navigation privée : on continue sans persister */ }
}

export function useWithings() {
  function hydrate() {
    if (hydrated || !import.meta.client) return
    tokens.value = safeParse<WithingsTokens | null>(localStorage.getItem(TOK_KEY), null)
    entries.value = safeParse<BodyEntry[]>(localStorage.getItem(BODY_KEY), [])
    lastSync.value = safeParse<number>(localStorage.getItem(SYNC_KEY), 0)
    absorbLegacy()
    hydrated = true
  }

  /**
   * Le poids se saisissait autrefois dans l'onglet Profil, dans son propre stockage.
   * Deux historiques du même chiffre, c'était une pesée notée à un endroit et absente
   * de l'autre. On absorbe l'ancien une seule fois, en saisie manuelle, sans écraser
   * ce qui existe déjà ici — la balance reste prioritaire sur une saisie à la main.
   */
  function absorbLegacy() {
    if (localStorage.getItem(MIGRATED_KEY)) return
    const old = safeParse<{ date: string, kg: number }[]>(localStorage.getItem(LEGACY_BW_KEY), [])
    const known = new Set(entries.value.map(e => e.date))
    const add = old
      .filter(e => e && e.date && e.kg > 0 && !known.has(e.date))
      .map(e => ({ date: e.date, at: `${e.date}T07:00`, kg: e.kg, source: 'manual' as const }))
    if (add.length) {
      entries.value = mergeEntries(entries.value, add)
      write(BODY_KEY, entries.value)
    }
    mirror()
    try { localStorage.setItem(MIGRATED_KEY, '1') }
    catch { /* stockage indisponible : on retentera au prochain démarrage */ }
  }

  /**
   * Recopie les pesées retenues dans la série simple du module séances.
   *
   * Import à sens unique : useWorkout n'a aucune connaissance d'ici, donc pas de
   * cycle. Le miroir existe parce que le métabolisme de base, le lest des exercices
   * au poids du corps et l'export lisent tous cette série-là — les faire pointer
   * ici un par un multiplierait les endroits à ne pas oublier.
   *
   * Les pesées en quarantaine sont exclues : c'est tout l'intérêt de les filtrer.
   */
  function mirror() {
    const { setBodyWeightAt } = useWorkout()
    const bad = new Set(suspectsOf(entries.value).map(e => e.at))
    // Une pesée par jour : la dernière du jour l'emporte, comme dans les courbes.
    const byDay = new Map<string, number>()
    for (const e of entries.value) {
      if (!bad.has(e.at)) byDay.set(e.date, e.kg)
    }
    for (const [date, kg] of byDay) setBodyWeightAt(date, kg)
  }

  /**
   * Adopter des pesées venues d'AILLEURS — une autre marque, un import.
   *
   * Le stockage des pesées n'a jamais rien eu de propre à Withings : `BodyEntry`
   * porte sa provenance, la fusion dédoublonne par horodatage, la quarantaine écarte
   * les pesées aberrantes, et le miroir alimente le module séances. Tout cela vaut
   * pour n'importe quelle source.
   *
   * Une deuxième marque écrit donc ICI plutôt que de se construire son propre
   * historique à côté — sans quoi on aurait deux séries du même poids, la courbe
   * choisirait l'une, le métabolisme de base l'autre, et l'écart se découvrirait des
   * semaines plus tard. C'est exactement le bug qu'`absorbLegacy` répare juste
   * au-dessus, et il ne faut pas le refaire une marque à la fois.
   */
  function adopt(nouvelles: BodyEntry[]): number {
    if (!nouvelles?.length) return 0
    const avant = entries.value.length
    entries.value = mergeEntries(entries.value, nouvelles)
    write(BODY_KEY, entries.value)
    mirror()
    return entries.value.length - avant
  }

  const connected = computed(() => !!tokens.value?.accessToken)
  /**
   * Withings a refusé le refresh_token : plus rien ne passera tant qu'on n'aura pas
   * réautorisé. C'est un état à part entière et pas un message d'erreur, parce qu'il
   * appelle UNE action précise — le bouton « Reconnecter » — et qu'un texte rouge de
   * plus au milieu des autres ne l'aurait jamais fait comprendre.
   */
  const needsReconnect = ref(false)

  /** Marge avant expiration : on rafraîchit sans attendre le refus. */
  const TOKEN_SKEW = 120

  /** Enregistre les jetons renvoyés par /api/withings/callback (query string). */
  function adoptFromQuery(q: Record<string, unknown>): boolean {
    const access = typeof q.access_token === 'string' ? q.access_token : ''
    const refresh = typeof q.refresh_token === 'string' ? q.refresh_token : ''
    if (!access || !refresh) return false
    tokens.value = {
      accessToken: access,
      refreshToken: refresh,
      expiresAt: Number(q.expires_at) || undefined,
      userid: typeof q.userid === 'string' ? q.userid : undefined,
    }
    write(TOK_KEY, tokens.value)
    return true
  }

  /**
   * Lance l'autorisation — en gardant sous le coude de quoi récupérer le résultat.
   *
   * Le tour passe forcément par un navigateur externe : une PWA qui navigue vers
   * `account.withings.com` sort de son contexte, et sur iOS elle n'y revient pas.
   * Le retour atterrit donc dans Safari, avec son propre stockage.
   *
   * Ce nonce est tiré ICI et rangé ICI. Le serveur le signe dans le `state`, le
   * retour dépose les jetons sous ce nonce, et c'est l'application qui viendra les
   * chercher à sa prochaine ouverture. Rien à taper, rien à recopier.
   */
  function connect() {
    if (!import.meta.client) return
    const nonce = newNonce()
    try { localStorage.setItem(NONCE_KEY, JSON.stringify({ nonce, at: Date.now() })) }
    catch { /* stockage indisponible : la connexion échouera proprement au retour */ }
    window.location.href = `/api/withings/authorize?nonce=${encodeURIComponent(nonce)}`
  }

  /** 32 caractères tirés du générateur cryptographique : c'est un mot de passe à usage unique. */
  function newNonce(): string {
    const b = new Uint8Array(24)
    crypto.getRandomValues(b)
    return Array.from(b, x => x.toString(36).padStart(2, '0')).join('').slice(0, 32)
  }

  /**
   * Récupère les jetons déposés par le retour d'autorisation, s'il y en a.
   *
   * Appelée à l'ouverture de l'application. Le silence est le cas NORMAL — on n'est
   * pas en train de connecter une balance la plupart du temps — donc elle ne dit
   * rien et ne montre rien tant qu'il n'y a pas de nonce en attente.
   *
   * Le nonce est effacé dès qu'on a tenté le retrait, réussi ou non. Le laisser
   * ferait retenter à chaque ouverture un dépôt qui n'existera jamais.
   */
  async function claimPending(): Promise<boolean> {
    if (!import.meta.client) return false
    const raw = safeParse<{ nonce?: string, at?: number } | null>(localStorage.getItem(NONCE_KEY), null)
    if (!raw?.nonce) return false
    // Passé dix minutes, le dépôt a expiré côté serveur de toute façon.
    if (!raw.at || Date.now() - raw.at > 10 * 60 * 1000) {
      try { localStorage.removeItem(NONCE_KEY) } catch { /* ignore */ }
      return false
    }
    try {
      const res = await $fetch<{ tokens: Record<string, unknown> }>('/api/withings/claim', {
        method: 'POST',
        body: { nonce: raw.nonce },
      })
      try { localStorage.removeItem(NONCE_KEY) } catch { /* ignore */ }
      if (!adoptFromQuery(res.tokens)) return false
      needsReconnect.value = false
      return true
    }
    catch {
      // 404 : l'autorisation n'est pas encore terminée dans l'autre navigateur. On
      // GARDE le nonce, et on retentera à la prochaine ouverture — c'est exactement
      // le cas « j'ai autorisé, je reviens dans l'app ».
      return false
    }
  }

  function disconnect() {
    tokens.value = null
    needsReconnect.value = false
    if (import.meta.client) {
      try { localStorage.removeItem(NONCE_KEY) } catch { /* ignore */ }
      try { localStorage.removeItem(TOK_KEY) }
      catch { /* ignore */ }
    }
    // Les mesures déjà récupérées restent : elles sont à toi, pas à Withings.
  }

  /**
   * Saisie manuelle, pour les jours sans balance ou avant de l'avoir reçue.
   *
   * Le taux de masse grasse est optionnel mais compte : sans
   * lui, la cible protéique retombe sur le poids de corps, ce qui la surestime tant
   * qu'il reste du gras à perdre. La masse grasse en kg et la masse maigre sont
   * déduites, jamais demandées — trois champs à remplir pour une seule information.
   */
  function addManual(kg: number, date: string, at?: string, fatRatio?: number | null) {
    if (!(kg > 0)) return
    const stamp = at || `${date}T07:00`
    const entry: BodyEntry = { date, at: stamp, kg: Math.round(kg * 100) / 100, source: 'manual' }
    if (typeof fatRatio === 'number' && fatRatio >= 3 && fatRatio <= 70) {
      entry.fatRatio = Math.round(fatRatio * 10) / 10
      entry.fatMass = Math.round(entry.kg * entry.fatRatio) / 100
      entry.leanMass = Math.round((entry.kg - entry.fatMass) * 100) / 100
    }
    entries.value = mergeEntries(entries.value, [entry])
    write(BODY_KEY, entries.value)
    mirror()
  }

  /**
   * Reverse les données là où le reste de l'appli les attend : le poids dans le
   * journal des séances (il sert au métabolisme de base), les pas dans la nutrition
   * (ils entrent dans la dépense du jour, donc dans la cible calorique).
   *
   * Vivait dans le composant Body, ce qui voulait dire : pas de pas tant qu'on
   * n'ouvrait pas l'onglet Rapport. La cible du jour tournait donc sur une estimation
   * forfaitaire chez quelqu'un qui n'allait jamais sur cet écran.
   */
  function pushToJournal(todayIso: string) {
    const { setSteps, dayFor, hydrate: hydrateNutrition } = useNutrition()
    hydrateNutrition()
    const { addBodyWeight } = useWorkout()
    for (const a of activity.value) {
      if (a.steps <= 0) continue
      // Le compteur du jour est PARTIEL : à 9 h il affiche 800 pas, et l'écrire tel
      // quel ferait tomber la cible sous l'estimation — l'appli conseillerait de
      // moins manger au petit-déjeuner parce qu'on n'a pas encore marché. Pour la
      // journée en cours, on ne révise donc que vers le haut, quand le réel dépasse
      // l'estimation. Les jours passés, eux, sont complets et s'écrivent tels quels.
      if (a.date === todayIso && a.steps <= defaultSteps(dayFor(todayIso).tt)) continue
      setSteps(a.date, a.steps)
    }
    if (latest.value && latest.value.date === todayIso) addBodyWeight(latest.value.kg)
  }

  /** Synchronisation suivie du reversement. C'est le geste complet, jamais l'un sans l'autre. */
  async function syncAndPush(todayIso: string, opts: { full?: boolean } = {}) {
    const ok = await sync(opts)
    if (ok) pushToJournal(todayIso)
    return ok
  }

  /**
   * Synchronisation d'ouverture. Appelée au démarrage de l'application, pas seulement
   * quand on visite le Rapport.
   *
   * Le pas de temps d'une heure n'est pas une optimisation réseau : c'est ce qui
   * évite de repartir en requête à chaque navigation entre onglets. Les pas de la
   * matinée ne changent pas la cible du dîner à la minute près.
   */
  async function autoSync(todayIso: string) {
    hydrate()
    if (!connected.value) return false
    if (Date.now() / 1000 - lastSync.value < AUTO_SYNC_MIN_S) return false
    return syncAndPush(todayIso)
  }

  function removeEntry(at: string) {
    entries.value = entries.value.filter(e => e.at !== at)
    write(BODY_KEY, entries.value)
    mirror()
  }

  /**
   * « C'est bien moi » : lève la quarantaine. Le drapeau est persisté, sinon la
   * pesée serait remise en doute à chaque ouverture — et une vraie perte de poids
   * rapide deviendrait insupportable à valider tous les jours.
   */
  function confirmEntry(at: string) {
    entries.value = entries.value.map(e => (e.at === at ? { ...e, confirmed: true, suspect: false } : e))
    write(BODY_KEY, entries.value)
    mirror()
  }

  /**
   * Rapatrie les nouvelles mesures. `full` refait les 90 jours (utile après un
   * import ou si la balance a corrigé une pesée) ; sinon on repart du dernier
   * `updatetime`, ce que Withings attend pour ne renvoyer que le delta.
   */
  /** Écrit les jetons rendus par le serveur. Point de passage unique, exprès. */
  function keepTokens(t: { accessToken: string, refreshToken: string, expiresIn: number }) {
    tokens.value = {
      ...tokens.value!,
      accessToken: t.accessToken,
      refreshToken: t.refreshToken,
      expiresAt: Math.floor(Date.now() / 1000) + t.expiresIn,
    }
    write(TOK_KEY, tokens.value)
  }

  /**
   * Rafraîchit les jetons AVANT d'aller chercher les données, et les enregistre
   * immédiatement.
   *
   * L'ordre est tout l'intérêt. Withings invalide l'ancien refresh_token à la
   * seconde où il en émet un nouveau : si on rafraîchit au milieu d'une synchro et
   * que la suite échoue, le jeton neuf est perdu et l'ancien est déjà mort. Le compte
   * est alors cassé pour de bon — `status 503 : invalid params: refresh_token`, à
   * chaque tentative, sans rien pour l'expliquer. En rafraîchissant d'abord, il ne
   * reste plus rien entre l'émission du jeton et son enregistrement.
   */
  async function ensureFresh(): Promise<boolean> {
    const t = tokens.value
    if (!t?.refreshToken) return false
    const exp = t.expiresAt ?? 0
    if (exp && exp - TOKEN_SKEW > Math.floor(Date.now() / 1000)) return true
    try {
      const res = await $fetch<{
        tokens: { accessToken: string, refreshToken: string, expiresIn: number } | null
        needsReconnect: boolean
        error: string | null
      }>('/api/withings/refresh', { method: 'POST', body: { refreshToken: t.refreshToken } })
      if (res.needsReconnect) {
        needsReconnect.value = true
        syncError.value = res.error
        return false // le seul cas qui bloque vraiment : plus aucun jeton ne passera
      }
      if (res.tokens) { keepTokens(res.tokens); needsReconnect.value = false }
      return true
    }
    catch {
      // Panne réseau, ou réponse inattendue : on tente quand même la synchro avec le
      // jeton en main, il est peut-être encore bon. Renoncer ici transformerait une
      // coupure de métro en « balance en panne ». Ce qu'on ne fait PAS, c'est brûler
      // le refresh_token pour rien.
      return true
    }
  }

  async function sync(opts: { full?: boolean } = {}): Promise<boolean> {
    if (!tokens.value || syncing.value) return false
    syncing.value = true
    syncError.value = null
    try {
      if (!(await ensureFresh())) return false
      const res = await $fetch<{
        groups: { date: number, measures: { value: number, type: number, unit: number }[] }[]
        activity: { date: string, steps?: number, distance?: number, calories?: number }[]
        updatetime: number
        tokens: { accessToken: string, refreshToken: string, expiresIn: number } | null
        needsReconnect?: boolean
        error?: string | null
      }>('/api/withings/sync', {
        method: 'POST',
        body: {
          accessToken: tokens.value.accessToken,
          refreshToken: tokens.value.refreshToken,
          since: opts.full ? 0 : lastSync.value || 0,
        },
      })

      // TOUJOURS en premier, avant toute autre lecture de la réponse : le serveur
      // rend les jetons neufs même quand la suite a échoué, et les perdre ici
      // reviendrait exactement au bug qu'on répare.
      if (res.tokens) keepTokens(res.tokens)
      if (res.needsReconnect) {
        needsReconnect.value = true
        syncError.value = res.error ?? 'Reconnecte le compte Withings.'
        return false
      }
      needsReconnect.value = false
      if (res.error) { syncError.value = res.error; return false }

      const fresh = (res.groups || []).map(g => parseGroup(g)).filter((e): e is BodyEntry => !!e)
      if (fresh.length) {
        entries.value = mergeEntries(entries.value, fresh)
        write(BODY_KEY, entries.value)
        mirror()
      }

      const acts = parseActivity(res.activity || [])
      if (acts.length) {
        const byDate = new Map(activity.value.map(a => [a.date, a]))
        for (const a of acts) byDate.set(a.date, a)
        activity.value = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
      }

      lastSync.value = res.updatetime || Math.floor(Date.now() / 1000)
      write(SYNC_KEY, lastSync.value)
      return true
    }
    catch (e) {
      const msg = (e as { data?: { statusMessage?: string }, message?: string })
      syncError.value = msg?.data?.statusMessage || msg?.message || 'Synchronisation impossible.'
      return false
    }
    finally {
      syncing.value = false
    }
  }

  // ─── Lectures dérivées ──────────────────────────────────────────────────
  /** Pesées mises de côté parce qu'elles ne collent pas à la tendance. */
  const suspects = computed(() => suspectsOf(entries.value))
  const suspectAts = computed(() => new Set(suspects.value.map(e => e.at)))
  // La dernière pesée RETENUE : afficher un poids en quarantaine en gros chiffre
  // reviendrait à mettre en avant celui de quelqu'un d'autre.
  const latest = computed<BodyEntry | null>(
    () => [...entries.value].reverse().find(e => !suspectAts.value.has(e.at)) ?? null,
  )
  /**
   * De quoi calculer une cible protéique sur la masse maigre : le poids le plus
   * récent, et le taux de masse grasse le plus récent qui existe. Voir `carriedComp`
   * pour le détail du report — les pesées en quarantaine en sont exclues, comme
   * partout ailleurs.
   */
  const bodyComp = computed(() => carriedComp(entries.value.filter(e => !suspectAts.value.has(e.at))))
  const weightSeries = computed(() => dailySeries(entries.value, 'kg'))
  const slope = computed(() => weeklySlope(weightSeries.value))
  const comp = computed(() => composition(entries.value))
  /**
   * Poids connu le plus proche (avant ou égal) d'une date : sert aux calculs d'énergie.
   * Les pesées en quarantaine sont ignorées — elles fausseraient le métabolisme de base,
   * donc la cible calorique de la journée.
   */
  function weightAt(iso: string): number | null {
    const kept = entries.value.filter(e => !suspectAts.value.has(e.at))
    const before = kept.filter(e => e.date <= iso)
    if (before.length) return before.at(-1)!.kg
    return kept.length ? kept[0].kg : null
  }

  /** Sauvegarde/restauration, branchées sur l'export JSON existant. */
  function snapshot() {
    // Les pas ne sont pas ici : ils partent déjà dans la sauvegarde nutrition,
    // sous `overrides`. Une donnée, un endroit.
    return { withingsBody: entries.value }
  }
  function restore(data: Record<string, unknown>) {
    if (Array.isArray(data.withingsBody)) {
      entries.value = mergeEntries([], data.withingsBody as BodyEntry[])
      write(BODY_KEY, entries.value)
      mirror()
    }
  }

  return {
    hydrate, connected, tokens, connect, disconnect, adoptFromQuery, claimPending, needsReconnect,
    entries, activity, latest, bodyComp, syncing, syncError, lastSync,
    sync, syncAndPush, autoSync, pushToJournal, addManual, adopt, removeEntry, confirmEntry,
    suspects, suspectAts, mirror,
    weightSeries, slope, comp, weightAt,
    snapshot, restore,
  }
}
