import { computed, ref } from 'vue'
import { bottomOfRange, topOfRange, suggestedIncrement } from '~/data/sportProgram'
import type { Exercise } from '~/data/sportProgram'
import {
  workSets, topWeight, volumeOf, e1rmOf, setTop, detectPRs, sameWeightStreak, nextLoad,
  muscleSetCounts, withProgramMuscles, isEffort, assessFatigue, perfRegressed, startOfWeek, shiftIso, STALL_SESSIONS,
  nextMilestone, sprintGoal, sprintSessionOf, measuredRatio, rescaleSets, roundToStep,
} from '~/utils/sportStats'
import { defaultRatio } from '~/data/exerciseVariants'
import { latestWeight, weightOn } from '~/lib/weight'
import { useProgram } from '~/composables/useProgram'
import { isTimed } from '~/lib/program'
import type { Effort, PrKind, SetLike, SprintSession, WeekStats } from '~/utils/sportStats'

// warm : série d'échauffement — enregistrée mais exclue des stats (charge, PR, progression)
// w2/r2 : 2e mouvement d'un superset (charge/reps propres)
export type SetLog = SetLike
const working = <T extends SetLike>(sets: T[]) => workSets(sets)
// effort : ressenti de l'exercice sur cette séance (sert à auto-réguler la charge)
// swap : « matériel différent de la fois d'avant ». La séance compte normalement
// dans le volume et l'historique, mais les COMPARAISONS de charge repartent d'ici.
// note : commentaire propre à CET exercice ce jour-là. La note de séance dit
// comment allait la journée ; celle-ci dit pourquoi ce mouvement-là a bougé — banc
// occupé, épaule qui tire, prise changée. C'est ce qu'on veut relire au moment de
// refaire l'exercice, pas trois semaines plus tard en bas d'une séance.
// variant : identifiant de la machine réellement utilisée (cf. data/exerciseVariants).
// Absent = l'exercice de référence, celui du programme.
export interface SessionLog { date: string; sets: SetLog[]; durationMin?: number; effort?: Effort; swap?: boolean; note?: string; variant?: string }
export type Logs = Record<string, SessionLog[]>
export interface BodyWeightEntry { date: string; kg: number }
// Effort de sprint (course) : ex. « 3 × 20 s @ 16 km/h »
export interface SprintEffort { kind: 'echauffement' | 'sprint'; count: number; duration: string; intensity: string }
export interface SessionEntry { exId: string; sets: SetLog[]; effort?: Effort; swap?: boolean; note?: string; variant?: string }
// Enregistrement au niveau séance : garde l'ordre, la date ET l'heure
export interface SessionRecord {
  at: string // ISO complet (date + heure)
  sessionId: string | null
  name: string
  durationMin?: number
  entries: SessionEntry[]
  sprint?: SprintEffort[]
  note?: string // note libre : douleur, sommeil, matériel occupé…
}

const LOGS_KEY = 'gr-workout-logs-v1'
const BW_KEY = 'gr-bodyweight-v1'
const SESS_KEY = 'gr-sessions-v1'
// Version du format stocké. Toute évolution incompatible s'ajoute dans migrate().
const SCHEMA_KEY = 'gr-schema-version'
export const SCHEMA_VERSION = 2
// Filet de sécurité : instantané complet réécrit au maximum une fois par jour, pour
// pouvoir récupérer les données après une écriture corrompue ou une fausse manip.
const BACKUP_KEY = 'gr-backup-v1'
const EXPORT_KEY = 'gr-last-export'

const logs = ref<Logs>({})
const bodyWeight = ref<BodyWeightEntry[]>([])
const sessionHistory = ref<SessionRecord[]>([])
let hydrated = false

function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback
  try { return JSON.parse(raw) as T } catch { return fallback }
}

/** `{ note }` si la note a du contenu, `{}` sinon — pour ne jamais écrire une clé
 *  vide dans le stockage (elle repartirait dans l'export et dans les comparaisons). */
const trimmed = (note?: string): { note?: string } => {
  const t = note?.trim()
  return t ? { note: t } : {}
}

const pad2 = (n: number) => String(n).padStart(2, '0')
function localDate(d = new Date()) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}` }
function localDateTime(d = new Date()) { return `${localDate(d)}T${pad2(d.getHours())}:${pad2(d.getMinutes())}` }

const lastExportAt = ref<string | null>(null)

export function useWorkout() {
  /**
   * Le programme EFFECTIF, et non la liste figée dans le code.
   *
   * Trois usages en dépendent, et chacun se serait trompé silencieusement : le nom
   * affiché sur un record, les muscles comptés dans le volume, et le filtre « cet
   * exercice, je le fais encore ». Ce dernier surtout — un mouvement retiré doit
   * cesser de peser dans la fatigue, sinon il stagne pour l'éternité et tire le
   * verdict vers le bas des mois après qu'on a arrêté de le faire.
   */
  const { exercises: exos, program: prog, exerciseById } = useProgram()

  if (!hydrated && import.meta.client) {
    logs.value = safeParse(localStorage.getItem(LOGS_KEY), {})
    bodyWeight.value = safeParse(localStorage.getItem(BW_KEY), [])
    sessionHistory.value = safeParse(localStorage.getItem(SESS_KEY), [])
    lastExportAt.value = localStorage.getItem(EXPORT_KEY)
    migrate()
    backupOncePerDay()
    hydrated = true
  }

  // Migration de format. Les évolutions actuelles sont additives (effort, note) donc
  // rien à transformer : on note simplement la version pour qu'un futur changement
  // incompatible sache d'où il part.
  function migrate() {
    const from = parseInt(localStorage.getItem(SCHEMA_KEY) || '1', 10)
    if (from === SCHEMA_VERSION) return
    try { localStorage.setItem(SCHEMA_KEY, String(SCHEMA_VERSION)) } catch { /* stockage indispo */ }
  }

  /** Instantané de secours (1×/jour max) : si une écriture corrompt les données,
   *  on garde de quoi revenir en arrière sans dépendre d'un export manuel. */
  function backupOncePerDay() {
    try {
      const today = localDate()
      const cur = safeParse<{ date?: string }>(localStorage.getItem(BACKUP_KEY), {})
      if (cur.date === today) return
      if (!Object.keys(logs.value).length && !sessionHistory.value.length) return
      localStorage.setItem(BACKUP_KEY, JSON.stringify({
        date: today, version: SCHEMA_VERSION,
        logs: logs.value, bodyWeight: bodyWeight.value, sessions: sessionHistory.value,
      }))
    } catch { /* stockage plein : la sauvegarde de secours est optionnelle */ }
  }

  function persistLogs() { if (import.meta.client) localStorage.setItem(LOGS_KEY, JSON.stringify(logs.value)) }
  function persistBW() { if (import.meta.client) localStorage.setItem(BW_KEY, JSON.stringify(bodyWeight.value)) }
  function persistSessions() { if (import.meta.client) localStorage.setItem(SESS_KEY, JSON.stringify(sessionHistory.value)) }

  function lastPerf(exId: string): SessionLog | null {
    const h = logs.value[exId]
    return h && h.length ? h[h.length - 1] : null
  }

  // ─── Variantes ─────────────────────────────────────────────────────────────
  // « Le rack est pris, j'ai fait autre chose. » Ce qui suit sert à ce que cette
  // phrase ne coûte plus l'historique de l'exercice. Trois briques :
  //   onVariant()  — l'historique d'UNE machine, pour les records (à machine égale) ;
  //   ratioFor()   — le rapport entre une machine et la référence ;
  //   comparable() — l'historique entier, ramené à l'échelle de la référence.

  /** L'historique d'un exercice sur une machine donnée (absent = la référence). */
  function onVariant(exId: string, variant?: string): SessionLog[] {
    return (logs.value[exId] || []).filter(s => (s.variant ?? undefined) === (variant || undefined))
  }

  /** La dernière séance faite sur cette machine-là. */
  function lastOn(exId: string, variant?: string): SessionLog | null {
    const h = onVariant(exId, variant)
    return h.length ? h[h.length - 1] : null
  }

  /**
   * Le rapport de charge entre une machine et l'exercice de référence.
   *
   * Le catalogue donne un ordre de grandeur, ses propres séances donnent un fait :
   * dès qu'il y a de quoi mesurer, la mesure gagne. La SOURCE est rendue avec le
   * chiffre parce qu'elle change ce qu'on a le droit d'en conclure — et parce qu'un
   * coefficient sans provenance ne se conteste pas.
   */
  function ratioFor(exId: string, variant?: string, todayIso = localDate()): {
    ratio: number
    source: 'reference' | 'measured' | 'default'
    sessions: number
  } {
    if (!variant) return { ratio: 1, source: 'reference', sessions: 0 }
    const m = measuredRatio(logs.value[exId] || [], variant, todayIso)
    if (m) return { ratio: m.ratio, source: 'measured', sessions: m.sessions }
    return { ratio: defaultRatio(exId, variant), source: 'default', sessions: onVariant(exId, variant).length }
  }

  /**
   * L'historique complet d'un exercice, toutes machines confondues, ramené à
   * l'échelle de la référence.
   *
   * C'est ce que lisent la courbe, la stagnation, la baisse de performance et le
   * prochain palier — tout ce qui compare des dates entre elles. Ce qui s'AFFICHE
   * et ce qui se SAISIT reste en kilos réellement mis sur la machine.
   */
  function comparable(exId: string): SessionLog[] {
    const h = logs.value[exId] || []
    if (!h.some(s => s.variant)) return h // cas courant : rien à convertir
    return h.map((s) => {
      if (!s.variant) return s
      const { ratio } = ratioFor(exId, s.variant, s.date)
      return ratio === 1 ? s : { ...s, sets: rescaleSets(s.sets, 1 / ratio) }
    })
  }

  /** Les machines sur lesquelles cet exercice a déjà été fait, la référence comprise. */
  function variantsUsed(exId: string): (string | undefined)[] {
    const seen: (string | undefined)[] = []
    for (const s of logs.value[exId] || []) {
      const v = s.variant ?? undefined
      if (!seen.includes(v)) seen.push(v)
    }
    return seen
  }

  // Charge max jamais réalisée. Compte le 2e mouvement des supersets (setTop), qui
  // était auparavant ignoré : l'exercice n'avait donc ni record ni courbe.
  // Sans machine précisée, toutes confondues — c'est un maximum brut, pas un record.
  function bestCharge(exId: string, variant?: string | null): number {
    const h = variant === undefined ? (logs.value[exId] || []) : onVariant(exId, variant ?? undefined)
    const all = h.map(s => topWeight(s.sets)).filter(w => w > 0)
    return all.length ? Math.max(...all) : 0
  }

  /** Ressenti déclaré la dernière fois sur cet exercice (auto-régulation). */
  function lastEffort(exId: string): Effort | null {
    const l = lastPerf(exId)
    return l && isEffort(l.effort) ? l.effort : null
  }

  /** Poids de corps connu le plus proche (≤) d'une date — sert à retrouver le LEST
   *  réellement ajouté sur les exercices au poids du corps (tractions, dips). */
  function bodyWeightAt(dateIso: string): number | null {
    return weightOn(bodyWeight.value, dateIso)?.kg ?? null
  }

  /**
   * LA pesée courante, celle du matin. Un seul chemin pour tout le monde.
   *
   * Cinq écrans la recalculaient chacun de son côté, et deux d'entre eux lisaient le
   * dernier élément du tableau au lieu de la date la plus récente. Tant que le
   * tableau est trié — ce que `setWeight` garantit — les deux coïncident. Un import
   * de sauvegarde, lui, écrit le tableau tel quel : le jour où il arrive dans le
   * désordre, les réglages et l'écran du jour affichent deux poids différents, donc
   * deux métabolismes, donc deux cibles caloriques. Voir lib/weight.ts.
   */
  const currentWeight = computed(() => latestWeight(bodyWeight.value))

  /** Records d'un exercice SUR UNE MACHINE donnée (par défaut : celle du programme).
   *  Un record est un poids qu'on a réellement soulevé, jamais une conversion. */
  function recordsOf(exId: string, variant?: string): { charge: number; chargeDate: string; e1rm: number; e1rmDate: string; reps: number; repsDate: string } | null {
    const h = onVariant(exId, variant).filter(s => working(s.sets).length)
    if (!h.length) return null
    // Le 1RM estimé part d'une formule charge × reps : sur des secondes elle rend un
    // nombre, et ce nombre ne veut rien dire. On laisse la charge record, qui elle
    // est réelle — on a bien porté ces kilos — et on n'estime pas de maximum.
    const temps = isTimed(exerciseById(exId))
    let charge = 0, chargeDate = '', e1rm = 0, e1rmDate = '', reps = 0, repsDate = ''
    for (const s of h) {
      const c = topWeight(s.sets)
      if (c > charge) { charge = c; chargeDate = s.date }
      const r = temps ? 0 : e1rmOf(s.sets)
      if (r > e1rm) { e1rm = r; e1rmDate = s.date }
    }
    // Meilleur nombre de reps réalisé à la charge record (la perf « qualité »)
    for (const s of h) {
      for (const st of working(s.sets)) {
        if (setTop(st) < charge) continue
        const n = st.w >= charge ? st.r : (st.r2 ?? 0)
        if (n > reps) { reps = n; repsDate = s.date }
      }
    }
    return { charge, chargeDate, e1rm, e1rmDate, reps, repsDate }
  }

  /** Enregistre une séance. Renvoie les records battus — charge max, mais aussi
   *  reps à charge égale et 1RM estimé, qui étaient auparavant ignorés. */
  function recordSession(
    entries: SessionEntry[],
    durationMin?: number,
    meta?: { sessionId: string | null; name: string; note?: string },
    sprint?: SprintEffort[],
  ): { name: string; kinds: PrKind[] }[] {
    const now = new Date()
    const at = localDateTime(now) // heure locale
    const date = localDate(now)
    const prs: { name: string; kinds: PrKind[] }[] = []
    for (const { exId, sets, effort, swap, note: exNote, variant } of entries) {
      if (!sets.length) continue
      // Les records se comparent À MACHINE ÉGALE : 140 kg au squat guidé ne battent
      // pas 100 kg au squat barre, ils ne se soulèvent simplement pas de la même façon.
      // Pas de record sur un exercice au temps : comparer des secondes à des reps
      // produirait un « nouveau record » à chaque série un peu plus longue.
      const kinds = isTimed(exerciseById(exId)) ? [] : detectPRs(onVariant(exId, variant), sets)
      if (kinds.length) {
        const ex = exos.value.find(e => e.id === exId)
        prs.push({ name: ex ? ex.name : exId, kinds })
      }
      if (!logs.value[exId]) logs.value[exId] = []
      logs.value[exId].push({ date, sets, durationMin, ...(effort ? { effort } : {}), ...(swap ? { swap } : {}), ...trimmed(exNote), ...(variant ? { variant } : {}) })
    }
    persistLogs()

    // Enregistrement niveau séance (mémorise tout : ordre, date, heure)
    const recorded = entries.filter(e => e.sets.length)
    const sprintClean = (sprint ?? []).filter(s => s.duration.trim() || s.intensity.trim())
    const note = meta?.note?.trim()
    if (recorded.length || sprintClean.length) {
      sessionHistory.value.push({
        at,
        sessionId: meta?.sessionId ?? null,
        name: meta?.name ?? 'Séance',
        durationMin,
        entries: recorded.map(e => ({ exId: e.exId, sets: e.sets, ...(e.effort ? { effort: e.effort } : {}), ...(e.swap ? { swap: e.swap } : {}), ...trimmed(e.note), ...(e.variant ? { variant: e.variant } : {}) })),
        ...(sprintClean.length ? { sprint: sprintClean } : {}),
        ...(note ? { note } : {}),
      })
      persistSessions()
    }
    return prs
  }

  // Met à jour une séance déjà enregistrée (édition depuis l'accueil ou le journal).
  // Touche les deux stockages : le journal (sessionHistory) ET les logs par exercice
  // (utilisés pour progression/charts). On retrouve les anciennes entrées de logs par
  // date + égalité des séries, on les remplace par les nouvelles.
  function updateSession(
    rec: SessionRecord,
    entries: SessionEntry[],
    durationMin?: number,
    sprint?: SprintEffort[],
    note?: string,
  ) {
    const idx = sessionHistory.value.indexOf(rec)
    if (idx < 0) return
    const date = rec.at.slice(0, 10)
    // 1) retire des logs les anciennes entrées de cette séance
    for (const oldE of rec.entries) {
      const arr = logs.value[oldE.exId]
      if (!arr) continue
      const j = arr.findIndex(l => l.date === date && JSON.stringify(l.sets) === JSON.stringify(oldE.sets))
      if (j >= 0) { arr.splice(j, 1); if (!arr.length) delete logs.value[oldE.exId] }
    }
    // 2) ajoute les nouvelles entrées (séries de travail + échauffement conservés)
    const recorded = entries.filter(e => e.sets.length)
    for (const e of recorded) {
      if (!logs.value[e.exId]) logs.value[e.exId] = []
      logs.value[e.exId].push({ date, sets: e.sets, durationMin, ...(e.effort ? { effort: e.effort } : {}), ...(e.swap ? { swap: e.swap } : {}), ...trimmed(e.note), ...(e.variant ? { variant: e.variant } : {}) })
    }
    // 3) met à jour l'enregistrement séance en place
    const sprintClean = (sprint ?? []).filter(s => s.duration.trim() || s.intensity.trim())
    rec.durationMin = durationMin
    rec.entries = recorded.map(e => ({ exId: e.exId, sets: e.sets, ...(e.effort ? { effort: e.effort } : {}), ...(e.swap ? { swap: e.swap } : {}), ...trimmed(e.note), ...(e.variant ? { variant: e.variant } : {}) }))
    if (sprintClean.length) rec.sprint = sprintClean
    else delete rec.sprint
    const cleanNote = note?.trim()
    if (cleanNote) rec.note = cleanNote
    else delete rec.note
    persistLogs(); persistSessions()
  }

  function progressionHint(ex: Exercise): string | null {
    const s = suggestWeight(ex)
    return s.reason === 'progress' ? `Objectif atteint la dernière fois → passe à ${s.weight} kg` : null
  }

  // ─── Surcharge progressive auto-régulée ────────────────────────────────
  // Ce sont les reps qui décident ; le ressenti dit seulement s'il restait de la
  // réserve. La borne BASSE de la fourchette est ce qui sépare « à l'échec à 8
  // reps sur du 8-10 » — la série voulue — de « à l'échec à 5 » — trop lourd.
  // Cf. nextLoad() dans utils/sportStats.
  /**
   * `variant` = la machine sur laquelle on s'apprête à travailler.
   *
   * Le conseil se calcule en équivalent référence — c'est là que l'historique est
   * continu — puis se reconvertit dans les kilos de CETTE machine, arrondis au
   * demi-disque. Sans quoi on lirait « passe à 82,5 kg » devant une V-Squat où l'on
   * met 110.
   */
  function suggestWeight(ex: Exercise, variant?: string) {
    /**
     * Un exercice au TEMPS n'a pas de charge conseillée par les reps.
     *
     * « 30-40 s » se lit 40 répétitions pour `topOfRange` : toutes les séries
     * « atteignent la cible », et l'app conseille de charger — sur du farmer's walk
     * où l'on a tenu trente secondes. Le conseil serait faux et rien ne le dirait.
     */
    if (isTimed(ex)) return { weight: 0, base: 0, inc: 0, streak: 0, reason: 'temps' as const, ratio: 1 }
    const hist = comparable(ex.id)
    const last = hist.length ? hist[hist.length - 1] : null
    const inc = suggestedIncrement(ex)
    if (!last) return { weight: 0, base: 0, inc, streak: 0, reason: 'none' as const, ratio: 1 }
    const advice = nextLoad({
      lastSets: last.sets,
      plannedSets: ex.sets,
      topReps: topOfRange(ex.reps),
      bottomReps: bottomOfRange(ex.reps),
      inc,
      streak: sameWeightStreak(hist),
      effort: lastEffort(ex.id),
    })
    const { ratio } = ratioFor(ex.id, variant)
    if (ratio === 1) return { ...advice, ratio }
    return {
      ...advice,
      weight: roundToStep(advice.weight * ratio, 2.5),
      base: roundToStep(advice.base * ratio, 2.5),
      inc: roundToStep(advice.inc * ratio, 2.5) || advice.inc,
      ratio,
    }
  }

  const e1rm = (sets: SetLog[]) => e1rmOf(sets)

  /** La courbe de progression : en équivalent référence, donc continue d'un bout à
   *  l'autre même si la machine a changé en route. Chaque point garde le nom de la
   *  machine où il a été fait — une remontée expliquée par un changement de matériel
   *  ne doit pas se lire comme un gain. */
  function chartData(exId: string) {
    const raw = logs.value[exId] || []
    const temps = isTimed(exerciseById(exId))
    return comparable(exId).map((sess, i) => ({
      date: sess.date.slice(5),
      charge: Math.round(topWeight(sess.sets) * 10) / 10,
      volume: volumeOf(sess.sets),
      e1rm: temps ? 0 : e1rmOf(sess.sets),
      variant: raw[i]?.variant,
      realCharge: topWeight(raw[i]?.sets ?? sess.sets),
    })).filter(d => d.charge > 0)
  }

  // ─── Volume par muscle ─────────────────────────────────────────────────
  /** Séries pondérées par muscle depuis une date (incluse). `from = null` → tout
   *  l'historique. Le muscle principal de chaque exercice compte 1, les muscles
   *  assistants 0,5 : une série de développé couché n'est pas une série de triceps. */
  function muscleSets(from: string | null): Record<string, number> {
    const entries: { muscles: string[]; sets: number }[] = []
    for (const [exId, ss] of Object.entries(logs.value)) {
      const ex = exos.value.find(e => e.id === exId)
      if (!ex) continue
      let sets = 0
      for (const s of ss) if (!from || s.date >= from) sets += working(s.sets).length
      if (sets) entries.push({ muscles: ex.muscles, sets })
    }
    return muscleSetCounts(entries)
  }
  /** Idem, complété par les muscles du programme jamais travaillés (à 0) — ce sont
   *  eux qu'il faut voir. */
  function muscleSetsWithGaps(from: string | null): [string, number][] {
    const counts = withProgramMuscles(muscleSets(from), exos.value)
    return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }

  // ─── Fatigue & récupération ────────────────────────────────────────────
  /** Agrégats d'une semaine : [start, endExcl[. */
  function weekStatsBetween(start: string, endExcl: string): WeekStats {
    let sets = 0, volume = 0, rated = 0, hard = 0
    for (const ss of Object.values(logs.value)) {
      for (const s of ss) {
        if (s.date < start || s.date >= endExcl) continue
        sets += working(s.sets).length
        volume += volumeOf(s.sets)
        if (isEffort(s.effort)) { rated++; if (s.effort === 'hard' || s.effort === 'fail') hard++ }
      }
    }
    const sessions = sessionHistory.value.filter((r) => {
      const d = r.at.slice(0, 10)
      return d >= start && d < endExcl
    }).length
    return { start, sessions, workSets: sets, volume, rated, hard }
  }

  /** `weeks` = semaines TERMINÉES (ancienne → récente), `current` = semaine en cours.
   *  Les semaines antérieures à la 1re séance sont retirées : sinon le passage de
   *  « rien » à « je m'entraîne » compterait comme une montée en charge. */
  function weeklyStats(todayIso: string, todayDow: number, nWeeks = 8) {
    const curStart = startOfWeek(todayIso, todayDow)
    const weeks: WeekStats[] = []
    for (let i = nWeeks; i >= 1; i--) {
      const s = shiftIso(curStart, -7 * i)
      weeks.push(weekStatsBetween(s, shiftIso(s, 7)))
    }
    const firstActive = weeks.findIndex(w => w.sessions > 0 || w.workSets > 0)
    return {
      weeks: firstActive === -1 ? [] : weeks.slice(firstActive),
      current: weekStatsBetween(curStart, shiftIso(curStart, 7)),
    }
  }

  /** Exercices actuellement bloqués à la même charge (stagnation généralisée = fatigue).
   *  On ignore ceux qu'on ne fait plus, sinon un vieil exercice compterait pour toujours. */
  function stalledCount(sinceIso: string): number {
    let n = 0
    for (const [exId, ss] of Object.entries(logs.value)) {
      if (!ss.length || !exos.value.some(e => e.id === exId)) continue
      if (ss[ss.length - 1].date < sinceIso) continue
      if (sameWeightStreak(comparable(exId)) >= STALL_SESSIONS) n++
    }
    return n
  }

  /** Exercices dont la performance a baissé À CHARGE IDENTIQUE, sur ceux qui sont
   *  comparables. C'est ce couple qui pilote le score de fatigue depuis qu'on ne
   *  compte plus le ressenti — cf. `assessFatigue`. Même filtre que `stalledCount` :
   *  un exercice qu'on ne fait plus ne doit pas peser éternellement. */
  function perfDrops(sinceIso: string): { dropped: number, tracked: number } {
    let dropped = 0, tracked = 0
    for (const [exId, ss] of Object.entries(logs.value)) {
      if (!ss.length || !exos.value.some(e => e.id === exId)) continue
      if (ss[ss.length - 1].date < sinceIso) continue
      if (ss.length < 2) continue // rien à comparer
      tracked++
      if (perfRegressed(comparable(exId))) dropped++
    }
    return { dropped, tracked }
  }

  /** Verdict de fatigue + les semaines qui ont servi à le calculer (pour l'affichage). */
  function fatigue(todayIso: string, todayDow: number) {
    const { weeks, current } = weeklyStats(todayIso, todayDow)
    const since = shiftIso(todayIso, -21)
    const verdict = assessFatigue({ weeks, current, stalled: stalledCount(since), ...perfDrops(since) })
    return { ...verdict, weeks, current }
  }

  // ─── Objectifs atteignables ────────────────────────────────────────────
  /** Prochain palier de charge d'un exercice et sa date estimée. */
  function milestoneOf(ex: Exercise, todayIso: string) {
    // Un palier est un 1RM estimé à franchir. Sans 1RM, pas de palier.
    if (isTimed(ex)) return null
    return nextMilestone(comparable(ex.id), suggestedIncrement(ex), todayIso)
  }

  /** Les séances de sprint réduites à ce qui se suit : vitesse max et temps d'effort.
   *  Elles dormaient dans `sessionHistory` sans qu'aucun écran ne les relise. */
  function sprintSessions(): SprintSession[] {
    const out: SprintSession[] = []
    for (const rec of sessionHistory.value) {
      if (!rec.sprint?.length) continue
      const s = sprintSessionOf(rec.at.slice(0, 10), rec.sprint)
      if (s) out.push(s)
    }
    return out.sort((a, b) => a.date.localeCompare(b.date))
  }

  /** Objectif de sprint : vitesse, ou volume quand l'effort est retombé sous le plan. */
  function sprintObjective(todayIso: string) {
    return sprintGoal(sprintSessions(), todayIso)
  }

  // Historique groupé par jour (charges à plat) — conservé pour compat
  function history() {
    const byDate: Record<string, { exId: string; sets: SetLog[] }[]> = {}
    for (const [exId, sessions] of Object.entries(logs.value)) {
      for (const s of sessions) {
        if (!byDate[s.date]) byDate[s.date] = []
        byDate[s.date].push({ exId, sets: s.sets })
      }
    }
    return Object.entries(byDate)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, entries]) => ({ date, entries }))
  }

  // Journal des séances (le plus récent d'abord), avec heure
  /**
   * Historique trié, du plus récent au plus ancien.
   *
   * Mémorisé : c'était une fonction qui reconstruisait et retriait le tableau à
   * CHAQUE appel. Les vues qui l'interrogent en boucle — une case de calendrier,
   * un jour de la semaine — payaient donc un tri complet par itération. Le
   * `computed` ne retrie que lorsque l'historique change réellement.
   */
  const sortedLog = computed(() => [...sessionHistory.value].sort((a, b) => b.at.localeCompare(a.at)))
  function sessionLog() {
    return sortedLog.value
  }

  // ─── Données de démo (pour tester rapidement l'app) ───────────────────────
  // Génère un historique réaliste : ~10 séances sur ~3 semaines (charges qui
  // progressent), + un suivi de poids. Écrase les données existantes.
  function seedDemo() {
    // Sans programme, il n'y a rien à simuler : `prog.value[k % 0]` vaut `undefined`,
    // et la ligne suivante lit ses exercices. C'est le cas NORMAL depuis que
    // l'application ne livre plus de séances — la démo attend qu'il y en ait.
    if (!prog.value.length) return
    const idHash = (s: string) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h }
    const round25 = (w: number) => Math.max(0, Math.round(w / 2.5) * 2.5)
    const baseWeight = (ex: Exercise) => (ex.bodyweight ? 70 : 20 + (idHash(ex.id) % 9) * 5)
    const repTop = (reps: string) => { const m = String(reps).match(/\d+/g); return m ? parseInt(m[m.length - 1], 10) : 10 }

    const newLogs: Logs = {}
    const newSessions: SessionRecord[] = []
    const N = 10
    for (let k = 0; k < N; k++) {
      const s = prog.value[k % prog.value.length]
      const d = new Date()
      d.setDate(d.getDate() - (N - 1 - k) * 2 - 1) // une séance tous les ~2 jours
      d.setHours(18, 30, 0, 0)
      const date = localDate(d)
      const at = localDateTime(d)
      const bump = Math.floor(k / 2) * 2.5 // la charge monte au fil des séances
      const entries: { exId: string; sets: SetLog[] }[] = []
      for (const e of s.exercises) {
        const base = round25(baseWeight(e) + (e.bodyweight ? 0 : bump))
        const reps = Math.max(5, repTop(e.reps) - 1)
        const sets: SetLog[] = []
        if (!e.bodyweight && !e.superset && base > 20) sets.push({ w: round25(base * 0.5), r: 10, warm: true })
        for (let i = 0; i < (e.sets || 3); i++) {
          const row: SetLog = { w: base, r: reps }
          if (e.superset) { row.w2 = round25(base * 0.6); row.r2 = reps }
          sets.push(row)
        }
        if (!newLogs[e.id]) newLogs[e.id] = []
        newLogs[e.id].push({ date, sets, durationMin: 55 })
        entries.push({ exId: e.id, sets })
      }
      newSessions.push({ at, sessionId: s.id, name: s.name, durationMin: 55, entries })
    }
    logs.value = newLogs
    sessionHistory.value = newSessions
    const bw: BodyWeightEntry[] = []
    for (let k = 0; k < 6; k++) { const d = new Date(); d.setDate(d.getDate() - (5 - k) * 4); bw.push({ date: localDate(d), kg: Math.round((78 - k * 0.4) * 10) / 10 }) }
    bodyWeight.value = bw
    persistLogs(); persistSessions(); persistBW()
  }

  // Efface toutes les données (séances + poids) et pose le drapeau « déjà semé »
  // pour repartir vraiment de zéro (pas de rechargement auto des données de démo).
  function clearAll() {
    logs.value = {}
    bodyWeight.value = []
    sessionHistory.value = []
    persistLogs(); persistBW(); persistSessions()
    if (import.meta.client) { try { localStorage.setItem('gr-seeded-v1', '1') } catch { /* ignore */ } }
  }

  // ─── Corrections ───────────────────────────────────────────────────────────
  // Une donnée fausse ne se contourne pas, elle se corrige. Mais corriger, c'est
  // écrire par-dessus quelque chose qu'on ne pourra pas reconstituer — d'où la
  // vérification préalable : on ne remplace QUE si la valeur en place est bien
  // celle qu'on croyait remplacer.

  /** La série `index` d'un exercice à une date, ou `null` si la cible est ambiguë.
   *  Deux séances du même exercice le même jour arrivent (une reprise l'après-midi) :
   *  dans ce cas on préfère ne rien désigner plutôt que de tirer au sort. */
  function setAt(exId: string, date: string, index: number): SetLog | null {
    const days = (logs.value[exId] || []).filter(l => l.date === date)
    if (days.length !== 1) return null
    return days[0].sets[index] ?? null
  }

  /**
   * Remplace une série. Touche les DEUX stockages — le log de l'exercice (courbes,
   * records) et le journal de séance —, sinon la progression et l'historique
   * raconteraient deux choses différentes du même jour.
   */
  function fixSet(exId: string, date: string, index: number, next: { w: number, r: number }): boolean {
    const days = (logs.value[exId] || []).filter(l => l.date === date)
    if (days.length !== 1) return false
    const log = days[0]
    const before = log.sets[index]
    if (!before) return false
    const after = { ...before, w: next.w, r: next.r }
    const oldSets = [...log.sets]
    log.sets = log.sets.map((s, i) => (i === index ? after : s))

    for (const rec of sessionHistory.value) {
      if (rec.at.slice(0, 10) !== date) continue
      const entry = rec.entries.find(e => e.exId === exId && JSON.stringify(e.sets) === JSON.stringify(oldSets))
      if (entry) entry.sets = log.sets
    }
    persistLogs(); persistSessions()
    return true
  }

  /** Supprime une pesée — le cas d'une saisie manuelle en double, ou d'un chiffre
   *  aberrant qui tire toutes les moyennes. */
  function removeBodyWeight(date: string): boolean {
    const before = bodyWeight.value.length
    bodyWeight.value = bodyWeight.value.filter(e => e.date !== date)
    if (bodyWeight.value.length === before) return false
    persistBW()
    return true
  }

  const weightAt = (date: string): number | null => bodyWeight.value.find(e => e.date === date)?.kg ?? null

  function addBodyWeight(kg: number) {
    setBodyWeightAt(localDate(), kg)
  }

  /**
   * Pose ou remplace le poids d'une date donnée.
   *
   * Le suivi corporel complet (balance, composition) vit dans useWithings ; cette
   * série-ci n'en est que le reflet simplifié « une date, un poids », parce que
   * c'est ce dont ont besoin le métabolisme de base, les records au poids du corps
   * et l'export. Le miroir est alimenté par useWithings, jamais saisi en double.
   */
  function setBodyWeightAt(date: string, kg: number) {
    if (!(kg > 0) || !date) return
    const existing = bodyWeight.value.find(e => e.date === date)
    if (existing) {
      if (existing.kg === kg) return // rien à réécrire : évite une persistance à chaque synchro
      existing.kg = kg
    }
    else { bodyWeight.value.push({ date, kg }) }
    bodyWeight.value.sort((a, b) => a.date.localeCompare(b.date))
    persistBW()
  }

  // extra : données supplémentaires à inclure dans la sauvegarde (profil, planning…)
  function exportJSON(extra: Record<string, unknown> = {}) {
    const payload = JSON.stringify({ version: SCHEMA_VERSION, logs: logs.value, bodyWeight: bodyWeight.value, sessions: sessionHistory.value, ...extra }, null, 1)
    const blob = new Blob([payload], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `van-claude-${localDate()}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    // Mémorise la date de sauvegarde pour pouvoir alerter quand elle vieillit
    const today = localDate()
    lastExportAt.value = today
    try { localStorage.setItem(EXPORT_KEY, today) } catch { /* stockage indispo */ }
  }

  /** Nb de jours depuis la dernière sauvegarde (null = jamais exporté). */
  function daysSinceExport(todayIso: string): number | null {
    if (!lastExportAt.value) return null
    const ms = new Date(todayIso + 'T00:00:00').getTime() - new Date(lastExportAt.value + 'T00:00:00').getTime()
    return Math.max(0, Math.round(ms / 86400000))
  }

  /** Restaure l'instantané de secours écrit automatiquement (1×/jour). */
  function restoreBackup(): boolean {
    const bak = safeParse<{ logs?: Logs; bodyWeight?: BodyWeightEntry[]; sessions?: SessionRecord[] }>(localStorage.getItem(BACKUP_KEY), {})
    if (!bak.logs && !bak.sessions) return false
    logs.value = bak.logs || {}
    bodyWeight.value = bak.bodyWeight || []
    sessionHistory.value = bak.sessions || []
    persistLogs(); persistBW(); persistSessions()
    return true
  }
  /** Date de l'instantané de secours disponible (null si aucun). */
  function backupDate(): string | null {
    return safeParse<{ date?: string }>(localStorage.getItem(BACKUP_KEY), {}).date ?? null
  }

  /**
   * Restaure depuis un OBJET déjà en mémoire, sans passer par un fichier.
   *
   * C'était le corps de `importJSON`, coincé dans un `FileReader`. Il en sort parce
   * qu'une correction de champ suit exactement le même chemin qu'un import : on
   * reconstruit l'instantané, on y change une valeur, et on le réinjecte. Passer
   * par le mécanisme d'import déjà éprouvé vaut mieux qu'écrire dans localStorage
   * derrière le dos des composables — qui, eux, ne verraient rien changer.
   */
  /**
   * Un fichier sans clé `logs` est-il l'ANCIEN format, où l'export ne contenait que
   * les charges ?
   *
   * La question n'était pas posée : tout fichier sans `logs` était pris pour un
   * journal de charges. Ça marchait tant que le seul import possible était une
   * sauvegarde complète — puis le pack d'exemple est arrivé, qui ne porte que le
   * programme et la nutrition. Il devenait le journal : la première lecture de
   * charges tombait sur `{ _apropos: "…", programme: {…} }` et l'accueil disparaissait
   * derrière un « Cannot read properties of undefined ».
   *
   * Le format d'origine est reconnaissable sans ambiguïté : un dictionnaire dont
   * CHAQUE valeur est un tableau de séries, indexé par identifiant d'exercice. Un
   * export partiel a des objets et des chaînes en valeur, jamais que des tableaux.
   */
  const ressembleAuVieuxJournal = (d: Record<string, unknown>): boolean => {
    const v = Object.values(d)
    return v.length > 0 && v.every(x => Array.isArray(x))
  }

  function restoreData(data: Record<string, unknown>) {
    if (data.logs) {
      logs.value = data.logs as Logs
      bodyWeight.value = (data.bodyWeight as BodyWeightEntry[]) || []
      sessionHistory.value = (data.sessions as SessionRecord[]) || []
    }
    else if (ressembleAuVieuxJournal(data)) {
      logs.value = data as unknown as Logs
    }
    // Sinon : sauvegarde PARTIELLE — le pack d'exemple, ou l'export d'un seul module.
    // On ne touche pas au journal. L'écraser avec un objet qui n'en est pas un
    // effacerait des mois de charges pour importer des recettes.
    persistLogs(); persistBW(); persistSessions()
  }

  // onExtra : reçoit les données brutes pour restaurer profil/planning côté appelant
  function importJSON(file: File, onExtra?: (data: Record<string, unknown>) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => {
        try {
          const data = JSON.parse(r.result as string)
          restoreData(data)
          if (onExtra) onExtra(data)
          resolve()
        } catch { reject(new Error('Fichier invalide')) }
      }
      r.onerror = () => reject(new Error('Lecture impossible'))
      r.readAsText(file)
    })
  }

  return {
    logs, bodyWeight, sessionHistory, lastExportAt,
    lastPerf, lastOn, lastEffort, bestCharge, recordsOf, bodyWeightAt, currentWeight,
    onVariant, ratioFor, comparable, variantsUsed,
    recordSession, updateSession, progressionHint, suggestWeight, chartData, history, sessionLog,
    muscleSets, muscleSetsWithGaps, weeklyStats, fatigue, stalledCount,
    milestoneOf, sprintSessions, sprintObjective,
    addBodyWeight, setBodyWeightAt, removeBodyWeight, weightAt, setAt, fixSet, exportJSON, importJSON, restoreData, seedDemo, clearAll,
    daysSinceExport, restoreBackup, backupDate,
  }
}
