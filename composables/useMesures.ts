import { computed, ref } from 'vue'
import { useNutrition } from './useNutrition'
import { useWorkout } from './useWorkout'
import type { BodyEntry } from '../lib/mesures'
import { carriedComp, composition, dailySeries, mergeEntries, suspectsOf, weeklySlope } from '../lib/mesures'
import { defaultSteps } from '../lib/nutritionStats'

// ─────────────────────────────────────────────────────────────────────────────
// Le journal des mesures : un poids est un poids, quelle que soit la balance.
// ─────────────────────────────────────────────────────────────────────────────
//
// Ce fichier s'appelait useWithings, et c'est tout ce qu'il avait de Withings : le
// nom. Il gardait déjà les pesées de n'importe quelle source — la fusion dédoublonne
// par horodatage, la quarantaine écarte les mesures aberrantes, le miroir alimente le
// module séances — mais son nom disait le contraire, et la deuxième marque a failli
// se construire son propre historique à côté.
//
// Deux séries du même poids, c'est la courbe qui prend l'une et le métabolisme de
// base qui prend l'autre, avec un écart qu'on découvre des semaines plus tard sur un
// chiffre qui ne colle pas. Le seul endroit où une source est particulière, c'est son
// OAuth : il vit dans useConnecteur et dans server/connecteurs/.
//
// État au niveau du module (pas de Pinia), hydratation explicite côté client,
// persistance localStorage.

const BODY_KEY = 'gr-withings-body-v1'
// Clé de l'ancien suivi de poids du module séances, absorbée une fois pour toutes.
const LEGACY_BW_KEY = 'gr-bodyweight-v1'
const MIGRATED_KEY = 'gr-withings-migr-v1'

const entries = ref<BodyEntry[]>([])
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

export function useMesures() {
  function hydrate() {
    if (hydrated || !import.meta.client) return
    entries.value = safeParse<BodyEntry[]>(localStorage.getItem(BODY_KEY), [])
    absorbLegacy()
    hydrated = true
  }

  /**
   * Le poids se saisissait autrefois dans l'onglet Profil, dans son propre stockage.
   * Deux historiques du même chiffre, c'était une pesée notée à un endroit et absente
   * de l'autre. On absorbe l'ancien une seule fois, en saisie manuelle, sans écraser
   * ce qui existe déjà ici — une balance reste prioritaire sur une saisie à la main.
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
   * Ce qu'une synchronisation rapporte, versé là où le reste de l'application
   * l'attend : le poids dans le journal des séances (il sert au métabolisme de base),
   * les pas dans la nutrition (ils entrent dans la dépense du jour, donc dans la
   * cible calorique).
   *
   * Vivait dans le composant Rapport, ce qui voulait dire : pas de pas tant qu'on
   * n'ouvrait pas cet onglet. La cible du jour tournait donc sur une estimation
   * forfaitaire chez quelqu'un qui n'y allait jamais.
   *
   * Une seule fonction pour toutes les marques : c'est ici que se joue la promesse
   * du dossier server/connecteurs/. Un adaptateur rend des pesées et des pas ; il
   * n'a aucun moyen d'inventer un chemin d'écriture à lui.
   */
  function absorber(releve: { pesees: BodyEntry[], pas: { date: string, steps: number }[] }, todayIso: string): number {
    const ajoutees = adopt(releve.pesees ?? [])
    const { setSteps, dayFor, hydrate: hydrateNutrition } = useNutrition()
    hydrateNutrition()
    for (const a of releve.pas ?? []) {
      if (a.steps <= 0) continue
      // Le compteur du jour est PARTIEL : à 9 h il affiche 800 pas, et l'écrire tel
      // quel ferait tomber la cible sous l'estimation — l'appli conseillerait de
      // moins manger au petit-déjeuner parce qu'on n'a pas encore marché. Pour la
      // journée en cours, on ne révise donc que vers le haut. Les jours passés, eux,
      // sont complets et s'écrivent tels quels.
      if (a.date === todayIso && a.steps <= defaultSteps(dayFor(todayIso).tt)) continue
      setSteps(a.date, a.steps)
    }
    const { addBodyWeight } = useWorkout()
    if (latest.value && latest.value.date === todayIso) addBodyWeight(latest.value.kg)
    return ajoutees
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
    return kept[0]?.kg ?? null
  }

  /**
   * Sauvegarde et restauration, branchées sur l'export JSON existant.
   *
   * La clé s'appelle toujours `withingsBody`, et elle ne changera pas : elle est dans
   * tous les exports déjà faits et dans le miroir poussé au coffre. La renommer pour
   * faire joli rendrait illisibles des sauvegardes qu'on ne peut pas reconstituer —
   * un nom de champ ne vaut pas ça.
   */
  function snapshot() {
    // Les pas ne sont pas ici : ils partent déjà dans la sauvegarde nutrition, sous
    // `overrides`. Une donnée, un endroit.
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
    hydrate, entries, adopt, absorber, addManual, removeEntry, confirmEntry, mirror,
    latest, bodyComp, suspects, suspectAts, weightSeries, slope, comp, weightAt,
    snapshot, restore,
  }
}
