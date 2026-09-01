import { avecRelances } from '~/lib/relance'
import { computed, ref } from 'vue'
import type { Ref } from 'vue'
import { useMesures } from './useMesures'

// ─────────────────────────────────────────────────────────────────────────────
// La plomberie d'une marque connectée. La même pour toutes.
// ─────────────────────────────────────────────────────────────────────────────
//
// Il y avait un fichier par marque, et le second était une copie du premier moins les
// leçons apprises. C'est la façon la plus sûre de faire diverger deux connexions qui
// devraient se comporter pareil : celle qu'on utilise reçoit les corrections, l'autre
// garde les bogues.
//
// Ici, une seule implémentation, paramétrée par un identifiant. Ce qu'une marque a de
// particulier — où l'on autorise, comment on échange, à quoi ressemblent ses données —
// vit côté serveur dans server/connecteurs/<marque>.ts et n'atteint jamais ce fichier.
//
// Ce qui NE sort pas d'ici : les mesures. Elles vont dans useMesures, en commun. Une
// marque qui garderait son propre historique donnerait deux séries du même poids.

/** Le tour d'autorisation dépose ses jetons pour dix minutes, pas plus. */
const NONCE_TTL_MS = 10 * 60 * 1000
/** Délai minimum entre deux synchronisations d'ouverture. Une pesée par jour suffit. */
const AUTO_SYNC_MIN_S = 3600
/** Marge avant expiration : on rafraîchit sans attendre le refus. */
const MARGE_S = 120

export interface Jetons { acces: string, rafraichissement: string, expireA: number }

interface Etat {
  jetons: Jetons | null
  /** epoch (s) rendu par la marque : où reprendre la prochaine fois. */
  curseur: number
  occupe: boolean
  erreur: string | null
  /** L'autorisation a été révoquée : seul un nouveau tour peut réparer. */
  reconnecter: boolean
}

const etats = new Map<string, Ref<Etat>>()
const hydratees = new Set<string>()

const cleJetons = (id: string) => `gr-conn-${id}-tok-v1`
const cleNonce = (id: string) => `gr-conn-${id}-nonce-v1`
const cleCurseur = (id: string) => `gr-conn-${id}-curseur-v1`

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
function oublie(key: string) {
  if (!import.meta.client) return
  try { localStorage.removeItem(key) }
  catch { /* ignore */ }
}

/**
 * Les jetons posés par l'ancienne organisation, une clé par marque écrite à la main.
 *
 * Sans cette reprise, la mise à jour DÉCONNECTERAIT une balance qui marche — et il
 * faudrait repasser par l'autorisation sans que rien n'explique pourquoi. Une
 * migration silencieuse est le minimum qu'on doive à quelqu'un dont l'application
 * fonctionnait hier.
 */
const ANCIENNES: Record<string, { tok: string, sync?: string }> = {
  withings: { tok: 'gr-withings-tok-v1', sync: 'gr-withings-sync-v1' },
  fitbit: { tok: 'gr-fitbit-tok-v1' },
}

function reprendreAnciennesCles(id: string): { jetons: Jetons | null, curseur: number } {
  const ancien = ANCIENNES[id]
  if (!ancien) return { jetons: null, curseur: 0 }
  const t = safeParse<{ accessToken?: string, refreshToken?: string, expiresAt?: number } | null>(
    localStorage.getItem(ancien.tok), null)
  if (!t?.accessToken) return { jetons: null, curseur: 0 }
  const jetons: Jetons = {
    acces: t.accessToken,
    rafraichissement: t.refreshToken ?? '',
    expireA: Number(t.expiresAt) || 0,
  }
  // Le curseur de Withings était un `updatetime` en secondes ; celui de Fitbit un
  // horodatage en millisecondes, qui ne veut rien dire ici. On ne reprend que le
  // premier — au pire, la première synchro refait quatre-vingt-dix jours.
  const brut = ancien.sync ? safeParse<number>(localStorage.getItem(ancien.sync), 0) : 0
  return { jetons, curseur: brut > 0 && brut < 4e9 ? brut : 0 }
}

function etatDe(id: string): Ref<Etat> {
  let e = etats.get(id)
  if (!e) {
    e = ref<Etat>({ jetons: null, curseur: 0, occupe: false, erreur: null, reconnecter: false })
    etats.set(id, e)
  }
  return e
}

/** 32 caractères du générateur cryptographique : c'est un mot de passe à usage unique. */
function nouveauNonce(): string {
  const b = new Uint8Array(24)
  crypto.getRandomValues(b)
  return Array.from(b, x => x.toString(36).padStart(2, '0')).join('').slice(0, 32)
}

export function useConnecteur(id: string) {
  const etat = etatDe(id)

  function hydrate() {
    if (hydratees.has(id) || !import.meta.client) return
    hydratees.add(id)
    const jetons = safeParse<Jetons | null>(localStorage.getItem(cleJetons(id)), null)
    if (jetons?.acces) {
      etat.value.jetons = jetons
      etat.value.curseur = safeParse<number>(localStorage.getItem(cleCurseur(id)), 0)
      return
    }
    const repris = reprendreAnciennesCles(id)
    if (repris.jetons) {
      etat.value.jetons = repris.jetons
      etat.value.curseur = repris.curseur
      write(cleJetons(id), repris.jetons)
      write(cleCurseur(id), repris.curseur)
    }
  }
  hydrate()

  const connecte = computed(() => !!etat.value.jetons?.acces)

  /** Point de passage UNIQUE pour écrire les jetons. Exprès : c'est le geste qu'il ne
   *  faut jamais rater, une marque enterrant l'ancien dès qu'elle en émet un neuf. */
  function garder(j: Jetons) {
    etat.value.jetons = j
    write(cleJetons(id), j)
  }

  /**
   * Part autoriser chez la marque — en gardant sous le coude de quoi récupérer le
   * résultat.
   *
   * Le tour passe forcément par un navigateur externe : une PWA qui navigue vers le
   * site de la marque sort de son contexte, et sur iOS elle n'y revient pas. Le retour
   * atterrit donc dans Safari, avec son propre stockage.
   *
   * Ce nonce est tiré ICI et rangé ICI. Le serveur le signe dans le `state`, le retour
   * dépose les jetons sous ce nonce, et c'est l'application qui viendra les chercher à
   * sa prochaine ouverture. Rien à taper, rien à recopier.
   */
  function connecter() {
    if (!import.meta.client) return
    const nonce = nouveauNonce()
    write(cleNonce(id), { nonce, at: Date.now() })
    window.location.href = `/api/connect/${id}/authorize?nonce=${encodeURIComponent(nonce)}`
  }

  /**
   * Récupère les jetons déposés par le retour d'autorisation, s'il y en a.
   *
   * Le silence est le cas NORMAL — on ne connecte pas une balance tous les jours —
   * donc cette fonction ne dit rien et ne montre rien tant qu'il n'y a pas de nonce en
   * attente. Le nonce est effacé dès qu'on a tenté le retrait, réussi ou non : le
   * laisser ferait retenter à chaque ouverture un dépôt qui n'existera jamais.
   */
  async function reprendre(): Promise<boolean> {
    if (!import.meta.client) return false
    const attente = safeParse<{ nonce?: string, at?: number } | null>(localStorage.getItem(cleNonce(id)), null)
    if (!attente?.nonce) return false
    if (!attente.at || Date.now() - attente.at > NONCE_TTL_MS) {
      oublie(cleNonce(id))
      return false
    }
    try {
      const res = await $fetch<{ tokens: Record<string, unknown> }>(`/api/connect/${id}/claim`, {
        method: 'POST',
        body: { nonce: attente.nonce },
      })
      oublie(cleNonce(id))
      const t = res.tokens ?? {}
      if (!t.access_token) return false
      garder({
        acces: String(t.access_token),
        rafraichissement: String(t.refresh_token ?? ''),
        expireA: Number(t.expires_at) || 0,
      })
      etat.value.reconnecter = false
      return true
    }
    catch {
      // 404 : l'autorisation n'est pas encore terminée dans l'autre navigateur. On
      // GARDE le nonce et on retentera à la prochaine ouverture — c'est exactement le
      // cas « j'ai autorisé, je reviens dans l'app ».
      return false
    }
  }

  function deconnecter() {
    etat.value.jetons = null
    etat.value.reconnecter = false
    oublie(cleJetons(id))
    oublie(cleNonce(id))
    const ancien = ANCIENNES[id]
    // Sans ça, l'ancienne clé serait reprise à la prochaine hydratation et la marque
    // se reconnecterait toute seule après qu'on l'a débranchée.
    if (ancien) { oublie(ancien.tok); if (ancien.sync) oublie(ancien.sync) }
    // Les mesures déjà récupérées restent : elles sont à toi, pas à la marque.
  }

  /**
   * Rafraîchit AVANT d'aller chercher les données, et enregistre immédiatement.
   *
   * L'ordre est tout l'intérêt. Beaucoup de marques invalident l'ancien jeton de
   * rafraîchissement à la seconde où elles en émettent un nouveau : rafraîchir au
   * milieu d'une synchro et échouer ensuite perd le jeton neuf alors que l'ancien est
   * déjà mort. Le compte est cassé pour de bon, à chaque tentative, sans rien pour
   * l'expliquer. En rafraîchissant d'abord, il ne reste plus rien entre l'émission du
   * jeton et son enregistrement.
   */
  async function assurerJeton(): Promise<boolean> {
    const j = etat.value.jetons
    if (!j?.rafraichissement) return false
    if (j.expireA && j.expireA - MARGE_S > Math.floor(Date.now() / 1000)) return true
    try {
      const res = await $fetch<{ jetons: Jetons | null, reconnecter: boolean, erreur: string | null }>(
        `/api/connect/${id}/refresh`, { method: 'POST', body: { rafraichissement: j.rafraichissement } })
      if (res.reconnecter) {
        etat.value.reconnecter = true
        etat.value.erreur = res.erreur
        return false // le seul cas qui bloque vraiment : plus aucun jeton ne passera
      }
      if (res.jetons) { garder(res.jetons); etat.value.reconnecter = false }
      return true
    }
    catch {
      // Panne réseau, ou réponse inattendue : on tente quand même la synchro avec le
      // jeton en main, il est peut-être encore bon. Renoncer ici transformerait une
      // coupure de métro en « balance en panne ». Ce qu'on ne fait PAS, c'est brûler
      // le jeton de rafraîchissement pour rien.
      return true
    }
  }

  /** La synchro complète : jetons, données, versement. Jamais l'une sans l'autre. */
  async function synchroniser(todayIso: string, opts: { complet?: boolean } = {}): Promise<boolean> {
    if (!etat.value.jetons || etat.value.occupe) return false
    etat.value.occupe = true
    etat.value.erreur = null
    try {
      if (!(await assurerJeton())) return false
      const res = await $fetch<{
        pesees: { date: string, at: string, kg: number, source: string }[]
        pas: { date: string, steps: number }[]
        curseur: number
        jetons: Jetons | null
        reconnecter?: boolean
        erreur?: string | null
      }>(`/api/connect/${id}/sync`, {
        method: 'POST',
        body: {
          acces: etat.value.jetons.acces,
          rafraichissement: etat.value.jetons.rafraichissement,
          depuis: opts.complet ? 0 : etat.value.curseur || 0,
        },
      })

      // TOUJOURS en premier, avant toute autre lecture de la réponse : le serveur rend
      // les jetons neufs même quand la suite a échoué, et les perdre ici reviendrait
      // exactement au bogue qu'on répare.
      if (res.jetons) garder(res.jetons)
      if (res.reconnecter) {
        etat.value.reconnecter = true
        etat.value.erreur = res.erreur ?? 'Reconnecte le compte.'
        return false
      }
      etat.value.reconnecter = false
      if (res.erreur) { etat.value.erreur = res.erreur; return false }

      useMesures().absorber({ pesees: res.pesees ?? [], pas: res.pas ?? [] }, todayIso)
      etat.value.curseur = res.curseur || Math.floor(Date.now() / 1000)
      write(cleCurseur(id), etat.value.curseur)
      return true
    }
    catch (e) {
      const m = e as { data?: { statusMessage?: string }, statusMessage?: string, message?: string }
      etat.value.erreur = m?.data?.statusMessage || m?.statusMessage || m?.message || 'Synchronisation impossible.'
      return false
    }
    finally {
      etat.value.occupe = false
    }
  }

  /**
   * Synchronisation d'ouverture. Le pas de temps d'une heure n'est pas une
   * optimisation réseau : c'est ce qui évite de repartir en requête à chaque
   * navigation entre onglets. Les pas de la matinée ne changent pas la cible du dîner
   * à la minute près.
   */
  async function autoSync(todayIso: string): Promise<boolean> {
    hydrate()
    if (!connecte.value) return false
    if (Date.now() / 1000 - etat.value.curseur < AUTO_SYNC_MIN_S) return false
    return synchroniser(todayIso)
  }

  return {
    id,
    hydrate,
    connecte,
    occupe: computed(() => etat.value.occupe),
    erreur: computed(() => etat.value.erreur),
    reconnecter: computed(() => etat.value.reconnecter),
    derniere: computed(() => etat.value.curseur),
    connecter,
    reprendre,
    deconnecter,
    synchroniser,
    autoSync,
  }
}

/**
 * Les marques que CE navigateur a déjà branchées.
 *
 * Lues dans le stockage plutôt que demandées au serveur, et c'est délibéré : à
 * l'ouverture, la coque doit reprendre une connexion en attente et synchroniser sans
 * attendre un aller-retour réseau qui peut échouer. Le stockage sait déjà tout ce
 * qu'il faut, et la liste des marques connues n'a donc à exister nulle part côté
 * navigateur — ajouter un connecteur ne touche pas ce fichier.
 */
export function marquesLocales(): string[] {
  if (!import.meta.client) return []
  const vues = new Set<string>()
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) ?? ''
      const m = /^gr-conn-([a-z0-9-]+)-(?:tok|nonce)-v1$/.exec(k)
      if (m) vues.add(m[1]!)
    }
  }
  catch { /* stockage refusé : rien à reprendre, l'application marche quand même */ }
  // Les marques d'avant la refonte, tant que leurs anciennes clés traînent.
  for (const [id, cles] of Object.entries(ANCIENNES)) {
    try { if (localStorage.getItem(cles.tok)) vues.add(id) }
    catch { /* ignore */ }
  }
  return [...vues]
}

/**
 * Toutes les marques branchées, vues comme une seule.
 *
 * C'est ce dont les écrans ont besoin : le Rapport veut dire « connecté » ou non et
 * offrir UN bouton de synchronisation, pas une ligne par marque — quelqu'un qui a une
 * balance et une montre n'a pas envie de les synchroniser à tour de rôle.
 *
 * La liste est un `ref` au niveau du module, rafraîchi à la demande : `marquesLocales`
 * lit le stockage, ce qui n'est pas réactif, et une connexion qui vient de se terminer
 * doit apparaître sans recharger la page.
 */
const marques = ref<string[]>([])

export function useConnecteurs() {
  const rafraichir = () => { marques.value = marquesLocales() }
  if (import.meta.client && !marques.value.length) rafraichir()

  const tous = computed(() => marques.value.map(id => useConnecteur(id)))
  const branchees = computed(() => tous.value.filter(c => c.connecte.value))
  const occupe = computed(() => tous.value.some(c => c.occupe.value))
  /** La première erreur rencontrée : deux pannes simultanées sont assez rares pour
   *  qu'un empilement de textes rouges coûte plus qu'il ne rapporte. */
  const erreur = computed(() => tous.value.map(c => c.erreur.value).find(Boolean) ?? null)
  const aReconnecter = computed(() => branchees.value.filter(c => c.reconnecter.value))
  /** La synchro la plus RÉCENTE : c'est celle qui répond à « est-ce à jour ? ». */
  const derniere = computed(() => branchees.value.reduce((n, c) => Math.max(n, c.derniere.value), 0))

  async function reprendreTout(): Promise<string | null> {
    let repris: string | null = null
    for (const id of marquesLocales()) {
      if (await useConnecteur(id).reprendre()) repris = id
    }
    rafraichir()
    return repris
  }

  /**
   * La reprise, avec des relances — parce qu'un retour rapide n'est pas un échec.
   *
   * L'autorisation se termine dans l'autre navigateur : il range les jetons côté
   * serveur, et l'application vient ensuite les réclamer avec son nonce. Entre les
   * deux il y a un aller-retour réseau, et on revient à l'application avant qu'il
   * soit fini — c'est même le cas NORMAL, puisque revenir est le premier réflexe une
   * fois « Autoriser » tapé.
   *
   * `reprendre()` rendait alors faux et gardait le nonce « pour la prochaine
   * ouverture ». Sauf qu'il n'y en a pas : l'application est déjà au premier plan, et
   * plus rien ne se déclenche. Il fallait la recharger à la main pour voir sa balance
   * apparaître — c'est-à-dire deviner qu'il faut le faire.
   *
   * La boucle elle-même est dans `lib/relance.ts`, où elle se vérifie sans
   * navigateur ni minuteur.
   */
  const reprendreAvecRelances = (attentes: number[] = [0, 1500, 4000]) =>
    avecRelances(attentes, reprendreTout)

  async function synchroniserTout(todayIso: string, opts: { complet?: boolean } = {}): Promise<boolean> {
    let une = false
    for (const c of branchees.value) {
      if (await c.synchroniser(todayIso, opts)) une = true
    }
    return une
  }

  async function autoSyncTout(todayIso: string): Promise<void> {
    for (const id of marquesLocales()) {
      await useConnecteur(id).autoSync(todayIso).catch(() => false)
    }
  }

  return {
    marques, rafraichir, branchees, occupe, erreur, aReconnecter, derniere,
    reprendreTout, reprendreAvecRelances, synchroniserTout, autoSyncTout, marquesLocales,
  }
}
