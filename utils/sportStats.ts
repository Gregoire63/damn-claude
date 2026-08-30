// ─────────────────────────────────────────────────────────────────────────────
// Logique de calcul du suivi d'entraînement — 100 % pure (aucun accès au DOM,
// à localStorage ou à Vue). Tout ce qui est ici est testé dans test/unit/.
// Les composables/composants se contentent de brancher les données dessus.
// ─────────────────────────────────────────────────────────────────────────────
import type { Exercise } from '../data/sportProgram'

// ─── Séries ──────────────────────────────────────────────────────────────────
// w/r : charge et reps. w2/r2 : 2e mouvement d'un superset (enchaîné sans repos).
// warm : série d'échauffement — jamais comptée dans les stats.
export interface SetLike { w: number; r: number; warm?: boolean; w2?: number; r2?: number }

export const workSets = <T extends SetLike>(sets: T[]): T[] => sets.filter(s => !s.warm)

// Charge de référence d'une série. Sur un superset, les deux mouvements ciblent le
// même muscle : on prend la plus lourde des deux, sinon le 2e mouvement serait
// totalement invisible dans les courbes et les records.
export function setTop(s: SetLike): number {
  return Math.max(s.w || 0, s.w2 || 0)
}
// Volume = tonnage soulevé, les deux mouvements d'un superset comptent.
export function setVolume(s: SetLike): number {
  return (s.w || 0) * (s.r || 0) + (s.w2 && s.r2 ? s.w2 * s.r2 : 0)
}
// 1RM estimé (Epley). Chaque mouvement est évalué séparément, on garde le meilleur.
export function setE1rm(s: SetLike): number {
  const a = s.w && s.r ? s.w * (1 + s.r / 30) : 0
  const b = s.w2 && s.r2 ? s.w2 * (1 + s.r2 / 30) : 0
  return Math.max(a, b)
}

/** Charge maximale des séries de travail (échauffement exclu). */
export function topWeight(sets: SetLike[]): number {
  const w = workSets(sets).map(setTop)
  return w.length ? Math.max(...w) : 0
}
/** Tonnage des séries de travail. */
export function volumeOf(sets: SetLike[]): number {
  return workSets(sets).reduce((a, s) => a + setVolume(s), 0)
}
/** 1RM estimé des séries de travail, arrondi. */
export function e1rmOf(sets: SetLike[]): number {
  const w = workSets(sets).map(setE1rm)
  return w.length ? Math.round(Math.max(...w)) : 0
}

// ─── Arrondis / échauffement ─────────────────────────────────────────────────
export function roundToStep(v: number, step: number): number {
  return Math.round(v / step) * step
}
/** Charge d'échauffement conseillée : ~50 % de la charge de travail la plus
 *  lourde, arrondie au pas de 2,5 kg. null si l'exercice est trop léger pour
 *  mériter un échauffement chiffré. */
export const WARMUP_RATIO = 0.5
export const WARMUP_MIN_LOAD = 20
export function warmupLoad(maxWorkLoad: number): number | null {
  if (!maxWorkLoad || maxWorkLoad <= WARMUP_MIN_LOAD) return null
  const wu = roundToStep(maxWorkLoad * WARMUP_RATIO, 2.5)
  return wu > 0 ? wu : null
}

// ─── Durée de séance ─────────────────────────────────────────────────────────
// Les séances au chrono aberrant (oubli de « Terminer », appli laissée ouverte)
// faussaient la moyenne : on les écarte.
export const DURATION_MIN = 15
export const DURATION_MAX = 120
export function plausibleDurations(mins: (number | undefined | null)[]): number[] {
  return mins.filter((x): x is number => typeof x === 'number' && x >= DURATION_MIN && x <= DURATION_MAX)
}
export function avgSessionDuration(mins: (number | undefined | null)[]): number {
  const ds = plausibleDurations(mins)
  return ds.length ? Math.round(ds.reduce((a, b) => a + b, 0) / ds.length) : 0
}

// ─── Ressenti (RPE simplifié) ────────────────────────────────────────────────
// Un tap par exercice. C'est la seule information qui permet d'auto-réguler la
// charge : « objectif de reps atteint » ne dit pas si ça a été facile ou une lutte.
export type Effort = 'easy' | 'ok' | 'hard' | 'fail'
//
// « À l'échec » et pas « Échec » : c'est l'ARRIVÉE à l'échec musculaire, la fin
// normale d'une série de travail — pas l'aveu d'avoir raté quelque chose. La
// nuance n'est pas cosmétique : tant que le libellé disait « Échec », l'app
// répondait par une décharge à chaque série poussée au bout, y compris quand les
// reps visées étaient toutes là. Voir `nextLoad`.
export const EFFORT_OPTIONS: { value: Effort; label: string; icon: string }[] = [
  { value: 'easy', label: 'Facile', icon: '😀' },
  { value: 'ok', label: 'Correct', icon: '🙂' },
  { value: 'hard', label: 'Dur', icon: '😤' },
  { value: 'fail', label: 'À l\'échec', icon: '💥' },
]
export const isEffort = (v: unknown): v is Effort =>
  v === 'easy' || v === 'ok' || v === 'hard' || v === 'fail'

// ─── Surcharge progressive auto-régulée ──────────────────────────────────────
/** `temps` : l'exercice se mesure en secondes, la charge ne s'auto-régule pas sur
 *  des reps. Une raison à part, et non `none`, pour que l'écran puisse le DIRE
 *  plutôt que d'afficher un conseil vide qu'on prendrait pour un bug. */
export type LoadReason = 'progress' | 'stall' | 'keep' | 'deload' | 'none' | 'temps'
export const STALL_SESSIONS = 3

/** Charge conseillée pour la prochaine séance d'un exercice.
 *
 *  Ce sont les REPS qui décident, pas le ressenti. Le ressenti ne fait que les
 *  qualifier : il dit s'il restait de la réserve à ce nombre de reps.
 *
 *  C'est l'inverse de ce que faisait cette fonction, et l'erreur a coûté cher.
 *  « À l'échec » court-circuitait tout le reste et déclenchait une décharge —
 *  y compris quand les reps visées étaient toutes là. Or arriver à l'échec est
 *  la fin NORMALE d'une série de travail en hypertrophie, pas un incident. Le
 *  résultat, sur le journal réel : `dev-mil`, 3 × 8 à 40 kg poussées au bout,
 *  soit exactement la série demandée sur du 8-10 — et l'app conseillait de
 *  redescendre à 37,5.
 *
 *  Ce qui distingue les deux cas n'est pas le ressenti, c'est OÙ tombent les
 *  reps dans la fourchette :
 *
 *    à l'échec à 10 reps sur 8-10  → la charge est mûre, on monte
 *    à l'échec à  8 reps sur 8-10  → la série voulue, on reste et on gagne une rep
 *    à l'échec à  5 reps sur 8-10  → là seulement, la charge est trop lourde
 */
export function nextLoad(opts: {
  lastSets: SetLike[]
  plannedSets: number
  topReps: number | null
  /** Borne basse de la fourchette. En dessous, la charge est vraiment trop lourde. */
  bottomReps?: number | null
  inc: number
  streak: number
  effort?: Effort | null
  stallSessions?: number
}): { weight: number; base: number; inc: number; streak: number; reason: LoadReason } {
  const { lastSets, plannedSets, topReps, bottomReps, inc, streak, effort } = opts
  const stallAt = opts.stallSessions ?? STALL_SESSIONS
  const work = workSets(lastSets)
  if (!work.length) return { weight: 0, base: 0, inc, streak, reason: 'none' }

  const base = topWeight(lastSets)
  const out = (weight: number, reason: LoadReason) => ({ weight, base, inc, streak, reason })

  // 1) Objectif de reps atteint sur toutes les séries → on monte (double progression).
  //    Y compris à l'échec : toutes les reps visées + plus de réserve, c'est
  //    précisément le moment de charger.
  const targetHit = !!topReps && work.length >= plannedSets && work.every(s => s.r >= topReps)
  if (targetHit) return out(base + inc, 'progress')
  // 2) À l'échec SOUS la fourchette → la charge est trop lourde, on redescend.
  //    Sans borne basse connue, on ne devine pas : on consolide (cas 3).
  if (effort === 'fail' && !!bottomReps && work.some(s => s.r < bottomReps)) {
    return out(Math.max(0, base - inc), 'deload')
  }
  // 3) À l'échec DANS la fourchette → on reste et on va chercher la rep suivante.
  if (effort === 'fail') return out(base, 'keep')
  // 4) C'était facile → on monte même sans avoir atteint le haut de la fourchette.
  if (effort === 'easy') return out(base + inc, 'progress')
  // 5) C'était dur → on consolide, et surtout on ne force PAS la montée de stagnation.
  if (effort === 'hard') return out(base, 'keep')
  // 6) Bloqué à la même charge depuis trop longtemps → on force la montée.
  //    Le cas 3 est passé avant : on ne force jamais la montée sur quelqu'un qui
  //    est déjà à l'échec dans sa fourchette.
  if (streak >= stallAt) return out(base + inc, 'stall')
  return out(base, 'keep')
}

// ─── Changement de matériel ──────────────────────────────────────────────────
/**
 * Une séance marquée `swap` déclare : « à partir d'ici, la charge n'est plus
 * comparable à ce qui précède ».
 *
 * Le cas est banal et le code ne pouvait pas le voir : la machine habituelle est
 * prise, on en prend une autre, et le chiffre sur la pile ne veut plus dire la
 * même chose — le bras de levier a changé. Même chose quand on baisse
 * volontairement la charge pour reprendre le mouvement en main et mieux sentir le
 * muscle. Dans les deux cas, l'app lisait une chute de charge comme une
 * régression : `crunch-cable` est passé de 72,5 à 47,5 kg alors que les reps
 * propres, elles, ont doublé.
 *
 * Ce qui est enregistré ne bouge pas — l'historique, le volume, le tonnage de la
 * semaine restent entiers. Seules les COMPARAISONS repartent de zéro : records,
 * stagnation, et détection de baisse de performance.
 */
export interface SwapLike { sets: SetLike[], swap?: boolean }

/**
 * Baisse minimale de tonnage pour qu'on parle de baisse : 5 %.
 *
 * Sans ce plancher, la mesure ramassait du bruit. Sur les vraies données : `ecartes`
 * -0,9 %, `face-pull` -2,5 %, `ss-bras` -3,1 % — soit une rep en moins sur une série,
 * ce qui arrive un jour sur deux sans rien vouloir dire. Ils faisaient passer le
 * compteur de 1 à 4 exercices « en baisse » et gonflaient le score d'autant.
 *
 * 5 %, c'est l'ordre de grandeur de DEUX reps perdues sur un exercice de 3 × 8 :
 * au-delà, ce n'est plus la variation d'un jour. `dev-mil` (-12,5 %) reste seul.
 */
export const PERF_DROP_MIN = 0.05

// ─── Variantes : ramener deux machines à la même échelle ─────────────────────
/**
 * Une séance sur une autre machine, ramenée à l'échelle de l'exercice de référence.
 *
 * C'est l'opération centrale du système de variantes : la charge SAISIE reste celle
 * qu'on a réellement mise sur la machine — c'est celle qu'on remettra la prochaine
 * fois —, mais tout ce qui COMPARE dans le temps (courbe, stagnation, baisse de
 * performance, prochain palier) travaille sur la charge convertie. Sans quoi passer
 * au squat guidé ferait bondir la courbe de 35 % sans avoir gagné un gramme de
 * muscle, et y revenir la ferait plonger d'autant.
 */
export function rescaleSets<T extends SetLike>(sets: T[], factor: number): T[] {
  if (!(factor > 0) || factor === 1) return sets
  return sets.map(s => ({
    ...s,
    w: s.w ? s.w * factor : s.w,
    ...(s.w2 ? { w2: s.w2 * factor } : {}),
  }))
}

/** Un rapport en dehors de cette fourchette est une erreur de saisie, pas une machine. */
export const RATIO_MIN = 0.2
export const RATIO_MAX = 5
/** En dessous, un rapport « mesuré » ne mesure qu'une bonne journée. */
export const RATIO_MIN_SESSIONS = 2
/** Au-delà, on compare deux niveaux différents plutôt que deux machines. */
export const RATIO_WINDOW_DAYS = 120

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export interface RatioSample { date: string, sets: SetLike[], variant?: string }
export interface MeasuredRatio { ratio: number, sessions: number, refSessions: number }

/**
 * Le rapport réel entre une variante et la référence, mesuré sur SES séances.
 *
 * Le coefficient du catalogue est un ordre de grandeur ; celui-ci est un fait. On
 * compare les 1RM estimés médians des deux mouvements — le 1RM plutôt que la charge
 * affichée parce qu'il tient compte des reps, la médiane plutôt que la moyenne parce
 * qu'une séance ratée ne doit pas déplacer le rapport.
 *
 * Deux garde-fous, et ils comptent autant que le calcul :
 *   • une fenêtre glissante, sinon on compare le squat d'il y a un an à la machine
 *     d'aujourd'hui et le « rapport » ne mesure que la progression ;
 *   • une fourchette de plausibilité, pour qu'un 425 kg tapé de travers ne réécrive
 *     pas toute la courbe (le cas s'est déjà produit sur `oiseau`).
 *
 * Rend `null` tant qu'il n'y a pas de quoi conclure : le catalogue reprend la main,
 * et l'écran le dit.
 */
export function measuredRatio(
  history: RatioSample[],
  variantId: string,
  todayIso: string,
  windowDays = RATIO_WINDOW_DAYS,
): MeasuredRatio | null {
  const from = shiftIso(todayIso, -windowDays)
  const recent = history.filter(h => h.date >= from && workSets(h.sets).length)
  const ref = recent.filter(h => !h.variant).map(h => e1rmOf(h.sets)).filter(v => v > 0)
  const alt = recent.filter(h => h.variant === variantId).map(h => e1rmOf(h.sets)).filter(v => v > 0)
  if (ref.length < RATIO_MIN_SESSIONS || alt.length < RATIO_MIN_SESSIONS) return null

  const ratio = median(alt) / median(ref)
  if (!Number.isFinite(ratio) || ratio < RATIO_MIN || ratio > RATIO_MAX) return null
  return { ratio: Math.round(ratio * 100) / 100, sessions: alt.length, refSessions: ref.length }
}

/** L'historique depuis le dernier changement de matériel (celui-ci inclus). */
export function sinceSwap<T extends SwapLike>(history: T[]): T[] {
  for (let i = history.length - 1; i >= 0; i--) if (history[i].swap) return history.slice(i)
  return history
}

/** Nb de séances récentes consécutives à la même charge max (stagnation). */
export function sameWeightStreak(history: SwapLike[]): number {
  const h = sinceSwap(history)
  if (!h.length) return 0
  const target = topWeight(h[h.length - 1].sets)
  if (!target) return 0
  let n = 0
  for (let i = h.length - 1; i >= 0; i--) {
    if (topWeight(h[i].sets) === target) n++
    else break
  }
  return n
}

/**
 * La performance a-t-elle baissé À CHARGE IDENTIQUE entre les deux dernières
 * séances ? C'est le marqueur objectif du surmenage — le seul que le ressenti ne
 * peut pas fabriquer.
 *
 * Deux garde-fous portent tout le sens de cette fonction :
 *
 * 1. **Charge identique obligatoire.** Une charge qui baisse est presque toujours
 *    un choix (matériel occupé, technique reprise) ; ce n'est pas un symptôme.
 * 2. **On compare le TONNAGE, pas les reps de la série la plus lourde.** Sur
 *    `dc-barre`, les reps à 70 kg sont passées de 4+4 à 4 — ça ressemble à une
 *    chute. Mais la série retirée a été remplacée par un 65 × 8, et le tonnage est
 *    monté de 1 760 à 2 000. Ce n'est pas une baisse, c'est un meilleur choix de
 *    charges. Seul `dev-mil` baisse vraiment : 40 kg les deux fois, 960 → 840.
 * 3. **Il faut dépasser le bruit** (cf. `PERF_DROP_MIN`).
 */
export function perfRegressed(history: SwapLike[]): boolean {
  const h = sinceSwap(history).filter(s => workSets(s.sets).length)
  if (h.length < 2) return false
  const prev = h[h.length - 2], last = h[h.length - 1]
  if (topWeight(prev.sets) !== topWeight(last.sets)) return false
  const before = volumeOf(prev.sets)
  if (!before) return false
  return volumeOf(last.sets) < before * (1 - PERF_DROP_MIN)
}

// ─── Records ─────────────────────────────────────────────────────────────────
// Un PR n'est pas seulement une charge max : faire plus de reps à charge égale,
// ou améliorer son 1RM estimé, sont de vraies progressions.
export type PrKind = 'charge' | 'reps' | 'e1rm'

/** Compare une nouvelle séance à l'historique de l'exercice et renvoie les
 *  records battus. Historique vide → aucun PR (pas de « record » au 1er passage). */
export function detectPRs(history: SwapLike[], newSets: SetLike[]): PrKind[] {
  // Depuis le dernier changement de matériel seulement : un record établi sur une
  // autre machine n'est pas un record qu'on peut battre sur celle-ci.
  const prev = sinceSwap(history).filter(h => workSets(h.sets).length)
  if (!prev.length) return []
  const out: PrKind[] = []

  const prevCharge = Math.max(...prev.map(h => topWeight(h.sets)))
  const newCharge = topWeight(newSets)
  if (newCharge > prevCharge) out.push('charge')

  // Reps à charge égale ou supérieure : on compare le meilleur nombre de reps
  // réalisé à la charge du jour (uniquement si cette charge a déjà été touchée).
  const repsAt = (sets: SetLike[], load: number) => {
    const r = workSets(sets).filter(s => setTop(s) >= load).map(s => (s.w >= load ? s.r : s.r2 ?? 0))
    return r.length ? Math.max(...r) : 0
  }
  const prevRepsAtLoad = Math.max(...prev.map(h => repsAt(h.sets, newCharge)))
  const newRepsAtLoad = repsAt(newSets, newCharge)
  if (prevRepsAtLoad > 0 && newRepsAtLoad > prevRepsAtLoad) out.push('reps')

  const prevE1rm = Math.max(...prev.map(h => e1rmOf(h.sets)))
  const newE1rm = e1rmOf(newSets)
  if (prevE1rm > 0 && newE1rm > prevE1rm) out.push('e1rm')

  return out
}

// ─── Volume par muscle ───────────────────────────────────────────────────────
// Les 3 faisceaux de l'épaule sont distingués : les fondre en « Épaules » masquait
// un déficit d'arrière d'épaule (le point faible le plus courant).
export const MUSCLE_LABELS: Record<string, string> = {
  pecs: 'Pecs',
  'epaules-av': 'Épaules avant',
  'epaules-lat': 'Épaules latérales',
  'epaules-ar': 'Épaules arrière',
  triceps: 'Triceps',
  biceps: 'Biceps',
  'avant-bras': 'Avant-bras',
  abdos: 'Abdos',
  dos: 'Dos',
  lombaires: 'Lombaires',
  quadris: 'Quadris',
  ischios: 'Ischios',
  fessiers: 'Fessiers',
  mollets: 'Mollets',
}
export const muscleLabel = (m: string) => MUSCLE_LABELS[m] || m

// Une série de développé couché n'est pas une série de triceps : le muscle
// principal (1er de la liste) compte 1, les muscles assistants comptent 0,5.
export const PRIMARY_WEIGHT = 1
export const SECONDARY_WEIGHT = 0.5
// Cible hebdomadaire par muscle communément admise pour l'hypertrophie.
export const WEEKLY_TARGET_MIN = 10
export const WEEKLY_TARGET_MAX = 20

/** Séries pondérées par muscle. `entries` = une ligne par exercice réalisé,
 *  avec son nombre de séries de travail. */
export function muscleSetCounts(entries: { muscles: string[]; sets: number }[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const { muscles, sets } of entries) {
    if (!sets) continue
    muscles.forEach((m, i) => {
      const label = muscleLabel(m)
      const w = i === 0 ? PRIMARY_WEIGHT : SECONDARY_WEIGHT
      out[label] = (out[label] || 0) + sets * w
    })
  }
  // Arrondi à 0,5 près pour éviter les 7.000000001
  for (const k of Object.keys(out)) out[k] = Math.round(out[k] * 2) / 2
  return out
}

export type MuscleStatus = 'low' | 'ok' | 'high'
export function weeklyStatus(sets: number): MuscleStatus {
  if (sets < WEEKLY_TARGET_MIN) return 'low'
  if (sets > WEEKLY_TARGET_MAX) return 'high'
  return 'ok'
}

/** Muscles du programme jamais touchés sur la période — le vrai angle mort.
 *  On les renvoie à 0 pour qu'ils apparaissent dans la liste. */
export function withProgramMuscles(
  counts: Record<string, number>,
  allExercises: Pick<Exercise, 'muscles'>[],
): Record<string, number> {
  const out = { ...counts }
  for (const e of allExercises) for (const m of e.muscles) {
    const l = muscleLabel(m)
    if (!(l in out)) out[l] = 0
  }
  return out
}

// ─── Fatigue & récupération ──────────────────────────────────────────────────
// Trois signaux, tous déjà dans les données : la tendance du volume hebdo,
// la part d'exercices vécus comme durs, et la stagnation simultanée.
// IMPORTANT : la tendance ne se calcule QUE sur des semaines TERMINÉES. Comparer
// la semaine en cours (partielle) à des semaines pleines afficherait une chute
// systématique et donnerait des conseils faux.
export interface WeekStats {
  start: string // lundi de la semaine (ISO)
  sessions: number
  workSets: number
  volume: number
  rated: number // exercices avec un ressenti déclaré
  hard: number // …dont « dur » ou « à l'échec » : les séries menées au bout
}

// Sous ce nombre de ressentis, le ratio n'est pas fiable. Il n'entre plus dans le
// score (voir assessFatigue), il reste affiché comme description.
export const HARD_SAMPLE_MIN = 5
// Sous ce nombre d'exercices suivis, la part de baisses n'est pas fiable.
export const DROP_SAMPLE_MIN = 4
export const DROP_RATIO_ALERT = 0.3
export const RAMP_ALERT = 3 // semaines de hausse consécutives avant alerte
export const RECOVERY_COOLDOWN = 6 // on ne redemande pas une décharge avant N semaines
export const RECOVERY_VOLUME_RATIO = 0.7 // semaine allégée = ≤ 70 % du volume habituel
export const MIN_WEEKS_FOR_TREND = 3

/** Semaines de hausse de volume consécutives à la fin de la série (semaines terminées,
 *  de la plus ancienne à la plus récente). */
export function rampWeeks(weeks: WeekStats[]): number {
  let n = 0
  for (let i = weeks.length - 1; i > 0; i--) {
    if (weeks[i].volume > weeks[i - 1].volume && weeks[i].volume > 0) n++
    else break
  }
  return n
}

/** Semaines allégées : volume ≤ 70 % de la moyenne des 4 semaines précédentes.
 *  Une semaine sans séance compte aussi comme une récupération (coupure). */
export function recoveryWeeks(weeks: WeekStats[]): number[] {
  const out: number[] = []
  for (let i = 1; i < weeks.length; i++) {
    const prev = weeks.slice(Math.max(0, i - 4), i)
    const base = prev.reduce((a, w) => a + w.volume, 0) / prev.length
    if (base > 0 && weeks[i].volume <= base * RECOVERY_VOLUME_RATIO) out.push(i)
  }
  return out
}
/** Nb de semaines écoulées depuis la dernière semaine allégée (null = jamais). */
export function weeksSinceRecovery(weeks: WeekStats[]): number | null {
  const idx = recoveryWeeks(weeks)
  return idx.length ? weeks.length - 1 - idx[idx.length - 1] : null
}

export type FatigueLevel = 'unknown' | 'fresh' | 'building' | 'high' | 'deload'
export interface FatigueVerdict {
  level: FatigueLevel
  score: number // 0–100, indicateur composite (pas une mesure physiologique)
  reasons: string[]
  advice: string
  ramp: number
  hardRatio: number | null // affiché seulement : plus compté dans le score, voir assessFatigue
  dropRatio: number | null // part des exercices en baisse à charge identique
  dropped: number
  tracked: number // exercices comparables (au moins deux séances)
  stalled: number
  sinceRecovery: number | null
}

const LEVEL_ADVICE: Record<FatigueLevel, string> = {
  unknown: 'Continue à enregistrer tes séances et à noter le ressenti : il faut environ 3 semaines pour que la tendance soit lisible.',
  fresh: 'Charge bien absorbée. Tu peux continuer à monter les charges normalement.',
  building: 'Accumulation normale. Garde le cap, mais surveille le ressenti sur les gros exercices.',
  high: 'Fatigue marquée. Cette semaine : ne monte pas les charges, garde une rep en réserve sur les gros exercices, et allège les sprints.',
  deload: 'Semaine de décharge conseillée : garde les mêmes charges mais coupe ~40 % des séries de travail (4 → 2), stoppe 3 reps avant l\'échec, et remplace les sprints par du footing léger. Tu reprendras plus fort la semaine suivante.',
}

/**
 * Évalue la fatigue accumulée. `weeks` = semaines TERMINÉES (ancienne → récente),
 * `current` = semaine en cours.
 *
 * `dropped` / `tracked` = exercices dont la performance a BAISSÉ à charge identique
 * (cf. `perfRegressed`), sur le nombre d'exercices comparables.
 *
 * Ce couple a remplacé le ressenti dans le calcul du score, et c'est le cœur du
 * changement. L'ancienne version comptait la part d'exercices notés « dur » ou
 * « à l'échec ». Pour quelqu'un qui mène ses séries au bout par principe — ce qui
 * est le but de l'entraînement, pas un accident — ce ratio vaut 100 % en
 * permanence : il contribuait 40 points fixes au score et ne distinguait plus rien.
 * Un indicateur toujours au maximum n'indique rien, et son conseil (« arrête
 * chaque série 2 reps avant l'échec ») contredisait la façon de s'entraîner qu'il
 * était censé surveiller.
 *
 * La baisse de performance à charge identique, elle, ne se fabrique pas : soit le
 * tonnage est là, soit il n'y est pas. `hardRatio` reste calculé et affiché — il
 * décrit la façon de s'entraîner, ce qui a son intérêt — mais ne pèse plus.
 */
export function assessFatigue(opts: {
  weeks: WeekStats[]
  current: WeekStats
  stalled: number
  dropped?: number
  tracked?: number
}): FatigueVerdict {
  const { weeks, current, stalled } = opts
  const dropped = opts.dropped ?? 0
  const tracked = opts.tracked ?? 0
  const dropRatio = tracked >= DROP_SAMPLE_MIN ? Math.round((dropped / tracked) * 100) / 100 : null
  const ramp = rampWeeks(weeks)
  const sinceRecovery = weeksSinceRecovery(weeks)

  // Ressenti récent : semaine en cours + dernière semaine terminée (~14 jours),
  // pour avoir un échantillon suffisant sans diluer le signal.
  const last = weeks[weeks.length - 1]
  const rated = current.rated + (last?.rated ?? 0)
  const hard = current.hard + (last?.hard ?? 0)
  const hardRatio = rated >= HARD_SAMPLE_MIN ? Math.round((hard / rated) * 100) / 100 : null

  const trained = weeks.filter(w => w.sessions > 0).length
  if (trained < MIN_WEEKS_FOR_TREND) {
    return { level: 'unknown', score: 0, reasons: [], advice: LEVEL_ADVICE.unknown, ramp, hardRatio, dropRatio, dropped, tracked, stalled, sinceRecovery }
  }

  const reasons: string[] = []
  let score = 0

  const rampPts = Math.min(50, Math.max(0, ramp - 1) * 25)
  if (rampPts) { score += rampPts; reasons.push(`Volume en hausse depuis ${ramp} semaines d'affilée`) }

  // Baisse de performance à charge identique : le seul signal objectif du lot, donc
  // le mieux payé (50 points au maximum, à égalité avec la rampe de volume). Le
  // ressenti qu'il remplace plafonnait à 40 alors qu'il ne mesurait qu'une façon de
  // s'entraîner.
  if (dropRatio !== null && dropRatio > 0) {
    score += Math.round(dropRatio * 50)
    if (dropRatio >= DROP_RATIO_ALERT) {
      reasons.push(dropped === 1
        ? '1 exercice en baisse à charge identique'
        : `${dropped} exercices en baisse à charge identique`)
    }
  }

  const stallPts = Math.min(30, stalled * 10)
  if (stalled >= 2) { score += stallPts; reasons.push(`${stalled} exercices bloqués à la même charge`) }
  else if (stalled === 1) score += stallPts

  if (sinceRecovery !== null && sinceRecovery >= RECOVERY_COOLDOWN) reasons.push(`Aucune semaine allégée depuis ${sinceRecovery} semaines`)
  if (sinceRecovery === null && weeks.length >= RECOVERY_COOLDOWN) reasons.push('Aucune semaine allégée sur la période observée')

  score = Math.min(100, score)

  let level: FatigueLevel = score >= 75 ? 'deload' : score >= 50 ? 'high' : score >= 25 ? 'building' : 'fresh'
  // Accumulation longue sans décharge → on la conseille même si le score reste sous le seuil.
  if (ramp >= RAMP_ALERT && (sinceRecovery === null || sinceRecovery >= RECOVERY_COOLDOWN)) level = 'deload'
  // Une décharge vient d'avoir lieu : inutile d'en redemander une tout de suite.
  if (sinceRecovery !== null && sinceRecovery <= 1 && (level === 'deload' || level === 'high')) {
    level = 'building'
    reasons.push('Semaine allégée récente prise en compte')
  }

  return { level, score, reasons, advice: LEVEL_ADVICE[level], ramp, hardRatio, dropRatio, dropped, tracked, stalled, sinceRecovery }
}

export const FATIGUE_LABELS: Record<FatigueLevel, string> = {
  unknown: 'Pas assez de recul',
  fresh: 'Frais',
  building: 'Accumulation',
  high: 'Fatigue marquée',
  deload: 'Décharge conseillée',
}

// ─── Dates ───────────────────────────────────────────────────────────────────
const p2 = (n: number) => String(n).padStart(2, '0')
export const isoOf = (d: Date) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`
/** Lundi de la semaine contenant `iso` (dow : 0 = dimanche, comme Date.getDay()). */
export function startOfWeek(iso: string, dow: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() - ((dow + 6) % 7))
  return isoOf(d)
}
/** Décale un ISO de n jours (n négatif = dans le passé). */
export function shiftIso(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00')
  d.setDate(d.getDate() + days)
  return isoOf(d)
}

// ─── Objectifs atteignables ──────────────────────────────────────────────────
//
// « Combien dans un mois ? » est la question qu'on se pose vraiment, et rien dans
// l'app n'y répondait : elle savait dire d'où on venait, jamais où on allait.
//
// Le parti pris est de projeter sur la progression RÉELLEMENT MESURÉE, pas sur un
// barème. Un barème donne le même chiffre à tout le monde ; or la vitesse de
// progression dépend du niveau, du nombre de séances par semaine, du sommeil et du
// déficit calorique en cours — et tout ça est déjà contenu dans les points qu'on a
// enregistrés. Le barème ne sert que de PLAFOND de bon sens, pour ne pas
// extrapoler à l'infini une poussée de début de cycle.
//
// Références publiées pour la borne haute (Fittux, synthèse des taux usuels) :
// débutant +2,5 à 5 kg par semaine au développé couché, intermédiaire +2,5 kg
// toutes les 2 à 4 semaines. On retient l'intermédiaire comme référence — la
// progression de débutant ne tient que quelques semaines, et elle ne tient pas du
// tout en déficit calorique.

/** Progression de référence : un incrément toutes les 3 semaines. */
export const GAIN_REF_WEEKS = 3
/** On ne projette jamais plus de 2× la référence, même si les données le disent. */
export const GAIN_CAP_FACTOR = 2
/** En dessous de ce nombre de séances, on n'a pas de pente exploitable. */
export const GAIN_MIN_POINTS = 3
/** Au-delà, une projection n'a plus de sens : trop loin pour rester honnête. */
export const GAIN_MAX_WEEKS = 26

export type GainPace = 'ahead' | 'ontrack' | 'slow' | 'stalled' | 'unknown'

export interface Milestone {
  from: number // charge de travail actuelle
  to: number // prochain palier
  perWeek: number // progression mesurée sur le 1RM estimé, kg/semaine
  weeks: number | null // délai estimé, null si non projetable
  etaIso: string | null
  pace: GainPace
  points: number // séances qui ont servi à la mesure
  skipped: number // séances écartées comme non comparables (voir COMPARABLE_BAND)
}

/**
 * Bande de charges considérées comparables à la charge actuelle, pour la tendance.
 *
 * Sans elle, une saisie aberrante ruine la projection : un `oiseau` noté 425 kg au
 * lieu de 42,5 donnait une pente de −253 kg par semaine. Une charge deux fois
 * supérieure ou inférieure à celle du jour n'est de toute façon pas le même
 * exercice — c'est une faute de frappe, un autre réglage, ou une reprise. Les
 * séances écartées sont COMPTÉES et affichées : le but est que la faute se voie,
 * pas qu'elle disparaisse.
 */
export const COMPARABLE_BAND = 2

/** Jours entre deux dates ISO (positif si `b` est après `a`). */
export const daysBetween = (a: string, b: string) =>
  Math.round((new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000)

/**
 * Pente d'une série de points (date ISO, valeur), en unités par semaine.
 * Régression linéaire des moindres carrés : une simple différence premier/dernier
 * se ferait piéger par une séance basse un jour de fatigue, qui est justement le
 * genre de séance qu'on enregistre.
 */
export function weeklySlopeOf(points: { date: string, value: number }[]): number | null {
  const pts = points.filter(p => p.value > 0)
  if (pts.length < 2) return null
  const t0 = pts[0].date
  const xs = pts.map(p => daysBetween(t0, p.date) / 7)
  const ys = pts.map(p => p.value)
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0, den = 0
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2 }
  return den === 0 ? null : num / den
}

/**
 * Prochain palier de charge et date à laquelle il devient atteignable.
 *
 * `history` est l'historique d'UN exercice ; il est tronqué au dernier changement
 * de matériel, sans quoi la pente mélangerait deux machines (cf. `sinceSwap`).
 *
 * La pente porte sur le 1RM ESTIMÉ et non sur la charge affichée : la charge
 * avance par marches de 2,5 kg et resterait plate des semaines entières, alors que
 * gagner une rep à charge égale est déjà de la progression — c'est même la forme
 * qu'elle prend le plus souvent.
 */
export function nextMilestone(
  history: SwapLike[],
  inc: number,
  todayIso: string,
): Milestone | null {
  const h = sinceSwap(history).filter(s => workSets(s.sets).length) as (SwapLike & { date?: string })[]
  if (!h.length) return null
  const from = topWeight(h[h.length - 1].sets)
  if (!from) return null
  // Palier arrondi au demi-kilo : « 31,3 kg » ne se met pas sur une machine.
  const to = Math.round((from + inc) * 2) / 2

  const all = h.filter((s): s is SwapLike & { date: string } => typeof s.date === 'string')
  const dated = all.filter((s) => {
    const w = topWeight(s.sets)
    return w > 0 && w <= from * COMPARABLE_BAND && w >= from / COMPARABLE_BAND
  })
  const skipped = all.length - dated.length
  const none: Milestone = { from, to, perWeek: 0, weeks: null, etaIso: null, pace: 'unknown', points: dated.length, skipped }
  if (dated.length < GAIN_MIN_POINTS) return none

  const slope = weeklySlopeOf(dated.map(s => ({ date: s.date, value: e1rmOf(s.sets) })))
  if (slope === null) return none

  const ref = inc / GAIN_REF_WEEKS
  const perWeek = Math.min(slope, ref * GAIN_CAP_FACTOR)
  if (perWeek <= 0) return { ...none, perWeek: Math.round(slope * 100) / 100, pace: 'stalled' }

  const weeks = Math.ceil((to - from) / perWeek)
  const pace: GainPace = perWeek >= ref * 1.2 ? 'ahead' : perWeek >= ref * 0.5 ? 'ontrack' : 'slow'
  if (weeks > GAIN_MAX_WEEKS) return { ...none, perWeek: Math.round(perWeek * 100) / 100, pace }

  return {
    from, to,
    perWeek: Math.round(perWeek * 100) / 100,
    weeks,
    etaIso: shiftIso(todayIso, weeks * 7),
    pace,
    points: dated.length,
    skipped,
  }
}

// ─── Sprint ──────────────────────────────────────────────────────────────────
// Les efforts de sprint étaient enregistrés et jamais relus : ni vitesse, ni
// volume, ni tendance. Trois séances de sprint dans le journal, et aucun écran
// n'en montrait quoi que ce soit.

/** Palier de vitesse sur tapis : 0,5 km/h, la graduation de la plupart des tapis. */
export const SPEED_STEP = 0.5
/** Plafond du plan (« vitesse cible ≈ 15–18 km/h »). Au-delà, l'objectif change. */
export const SPEED_PLAN_MAX = 18
/** Volume d'effort visé par séance : 5 à 6 sprints de 10 à 15 s. */
export const SPRINT_SECONDS_MIN = 50
export const SPRINT_SECONDS_MAX = 90

export interface SprintLike { kind: string, count: number, duration: string | number, intensity: string | number }
export interface SprintSession { date: string, topSpeed: number, seconds: number, reps: number }

const num = (v: string | number) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.'))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Réduit les efforts d'une séance à ce qui se suit dans le temps : vitesse et volume.
 *  L'échauffement est exclu — c'est du footing, il tirerait la vitesse vers le bas. */
export function sprintSessionOf(date: string, efforts: SprintLike[]): SprintSession | null {
  const runs = efforts.filter(e => e.kind === 'sprint')
  if (!runs.length) return null
  let topSpeed = 0, seconds = 0, reps = 0
  for (const r of runs) {
    const count = Math.max(1, Math.round(num(r.count) || 1))
    const dur = num(r.duration)
    topSpeed = Math.max(topSpeed, num(r.intensity))
    seconds += count * dur
    reps += count
  }
  return topSpeed || seconds ? { date, topSpeed, seconds, reps } : null
}

export type SprintGoalKind = 'speed' | 'volume' | 'none'
export interface SprintGoal {
  kind: SprintGoalKind
  topSpeed: number
  seconds: number
  reps: number
  target: number // vitesse visée (kind 'speed') ou secondes visées (kind 'volume')
  perWeek: number // km/h par semaine
  weeks: number | null
  etaIso: string | null
  points: number
}

/**
 * Objectif de sprint. La vitesse n'est PAS toujours la bonne cible : au-dessus du
 * plafond du plan, ou quand le volume est tombé sous le protocole, courir plus vite
 * sur deux efforts de 20 s n'est plus une progression — c'est un raccourci.
 *
 * Cas réel : 3 × 30 s à 16 km/h le 28/07, puis 2 × 20 s à 17 km/h le 11/08. La
 * vitesse monte, le temps d'effort tombe de 90 à 40 secondes. L'objectif suivant
 * est le volume, pas le chrono.
 */
export function sprintGoal(sessions: SprintSession[], todayIso: string): SprintGoal | null {
  const h = sessions.filter(s => s.topSpeed > 0)
  if (!h.length) return null
  const last = h[h.length - 1]
  const base: SprintGoal = {
    kind: 'none', topSpeed: last.topSpeed, seconds: last.seconds, reps: last.reps,
    target: 0, perWeek: 0, weeks: null, etaIso: null, points: h.length,
  }

  // Volume d'abord : la vitesse ne compte que si l'effort dure.
  if (last.seconds < SPRINT_SECONDS_MIN) return { ...base, kind: 'volume', target: SPRINT_SECONDS_MIN }
  if (last.topSpeed >= SPEED_PLAN_MAX) return { ...base, kind: 'volume', target: SPRINT_SECONDS_MAX }

  const target = Math.min(SPEED_PLAN_MAX, Math.round((last.topSpeed + SPEED_STEP) * 10) / 10)
  const slope = h.length >= GAIN_MIN_POINTS ? weeklySlopeOf(h.map(s => ({ date: s.date, value: s.topSpeed }))) : null
  if (slope === null || slope <= 0) return { ...base, kind: 'speed', target }

  const weeks = Math.ceil((target - last.topSpeed) / slope)
  if (weeks > GAIN_MAX_WEEKS) return { ...base, kind: 'speed', target, perWeek: Math.round(slope * 100) / 100 }
  return {
    ...base, kind: 'speed', target,
    perWeek: Math.round(slope * 100) / 100,
    weeks,
    etaIso: shiftIso(todayIso, weeks * 7),
  }
}
