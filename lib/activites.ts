// ─────────────────────────────────────────────────────────────────────────────
// Le sport qui n'est pas une séance.
// ─────────────────────────────────────────────────────────────────────────────
//
// L'application ne connaissait que deux dépenses : les pas, et la séance de
// musculation. Un foot du samedi, une rando, deux heures de vélo n'existaient nulle
// part — la journée s'affichait donc à sa cible de repos, huit cents calories en
// dessous de ce qui avait vraiment été brûlé, et le déficit de la semaine devenait
// un chiffre qu'on ne pouvait plus lire.
//
// ── Ce que ce module calcule, et ce qu'il ne calcule pas ────────────────────
//
// Il propose une estimation ; il ne la décrète pas. Le MET d'une activité est une
// moyenne de population : deux heures de vélo, c'est une balade ou une sortie de
// club, et le même chiffre couvre les deux. L'estimation sert donc de POINT DE
// DÉPART, et le champ reste modifiable — `estime` garde la trace de qui a tranché,
// pour que corriger une fois ne se fasse pas écraser à la relecture.
//
// ── La dépense est NETTE, comme celle des séances ───────────────────────────
//
// Le corps aurait brûlé quelque chose pendant cette heure-là de toute façon, et la
// dépense de base de la journée (`baseKcal`) le compte déjà. Ajouter le coût BRUT
// compterait deux fois la même heure — c'est exactement la faute que `sessionBurn`
// documente et corrige depuis le premier jour. On soustrait donc le métabolisme de
// repos de la durée, et on applique la même formule.
//
// Faute de poids ou de profil, l'estimation rend `null` plutôt qu'un nombre calculé
// sur un corps inventé : l'écran demande alors le chiffre, ce qui est la seule
// réponse honnête.

/** Les activités dont on connaît le coût. Le reste passe par « Autre ». */
export type TypeActivite =
  | 'marche' | 'rando' | 'course' | 'velo' | 'vtt' | 'natation'
  | 'foot' | 'tennis' | 'basket' | 'corde' | 'escalade' | 'boxe'
  | 'rameur' | 'elliptique' | 'autre'

export interface FicheActivite {
  id: TypeActivite
  label: string
  icone: string
  /**
   * Coût en MET — multiples du métabolisme de repos.
   *
   * Valeurs du Compendium of Physical Activities (édition 2024), à l'intensité
   * MODÉRÉE quand plusieurs existent : c'est celle d'une séance ordinaire, et
   * surestimer une dépense gonfle la cible du jour, donc fait manger plus. Une
   * sortie vraiment dure se corrige à la main — l'inverse ne se remarquerait pas.
   */
  met: number
}

export const TYPES_ACTIVITE: FicheActivite[] = [
  { id: 'marche', label: 'Marche', icone: '🚶', met: 3.8 },
  { id: 'rando', label: 'Randonnée', icone: '🥾', met: 5.3 },
  { id: 'course', label: 'Course à pied', icone: '🏃', met: 9.3 },
  { id: 'velo', label: 'Vélo', icone: '🚴', met: 6.8 },
  { id: 'vtt', label: 'VTT', icone: '⛰️', met: 8.5 },
  { id: 'natation', label: 'Natation', icone: '🏊', met: 8 },
  { id: 'foot', label: 'Football', icone: '⚽', met: 7 },
  { id: 'tennis', label: 'Tennis / padel', icone: '🎾', met: 6.8 },
  { id: 'basket', label: 'Basket', icone: '🏀', met: 7.5 },
  { id: 'corde', label: 'Corde à sauter', icone: '🪢', met: 11.8 },
  { id: 'escalade', label: 'Escalade', icone: '🧗', met: 8 },
  { id: 'boxe', label: 'Boxe', icone: '🥊', met: 7.8 },
  { id: 'rameur', label: 'Rameur', icone: '🚣', met: 7.5 },
  { id: 'elliptique', label: 'Elliptique', icone: '🌀', met: 5 },
  // Volontairement au milieu du tableau : c'est la valeur d'un effort soutenu mais
  // pas violent. Elle ne prétend à rien, et le champ de calories reste ouvert.
  { id: 'autre', label: 'Autre', icone: '✨', met: 5 },
]

const PAR_DEFAUT = TYPES_ACTIVITE[TYPES_ACTIVITE.length - 1]!

export const ficheActivite = (type: unknown): FicheActivite =>
  TYPES_ACTIVITE.find(t => t.id === type) ?? PAR_DEFAUT

/**
 * La musculation ne figure PAS dans la liste, et c'est délibéré.
 *
 * Elle a déjà sa dépense, calculée sur ce qui a vraiment été fait — séries, durée,
 * densité, sprints (`sessionBurn`). L'ajouter ici donnerait deux dépenses pour la
 * même heure, et la seconde, forfaitaire, écraserait la première en la doublant.
 */
export const MOTIF_SANS_MUSCU = 'La musculation a déjà sa dépense : enregistre la séance.'

export const MINUTES_MIN = 1
export const MINUTES_MAX = 720

export interface Activite {
  id: string
  type: TypeActivite
  /** Ce qu'on lit dans la liste. Vide → le libellé du type. */
  nom: string
  /** Jour de l'activité, en ISO court. C'est par lui que la dépense la retrouve. */
  date: string
  /** Heure de début, `HH:MM`. Sert à ranger la journée, jamais à calculer. */
  heure: string
  minutes: number
  kcal: number
  /** Le chiffre vient-il de l'estimation, ou d'une correction à la main ? */
  estime: boolean
}

const ISO_JOUR = /^\d{4}-\d{2}-\d{2}$/
const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/

export const bornerMinutes = (n: unknown): number => {
  const v = Math.round(Number(n))
  return Number.isFinite(v) ? Math.min(MINUTES_MAX, Math.max(MINUTES_MIN, v)) : 30
}

/**
 * L'estimation, en kilocalories NETTES. `null` quand on ne sait pas.
 *
 * Même formule que `sessionBurn` : coût brut moins ce que le repos aurait coûté
 * pendant le même temps. Sans poids ni métabolisme, on ne rend pas un nombre
 * approximatif — on rend rien, et l'écran demande.
 */
export function estimerKcal(
  type: TypeActivite,
  minutes: number,
  kg: number | null | undefined,
  bmr: number | null | undefined,
): number | null {
  const min = Number(minutes)
  if (!kg || !bmr || !(kg > 0) || !(bmr > 0) || !(min > 0)) return null
  const brut = ficheActivite(type).met * kg * (min / 60)
  const auRepos = (bmr / 1440) * min
  return Math.max(0, Math.round(brut - auRepos))
}

/** Un identifiant local, sans crypto.randomUUID — le reste du dépôt fait pareil. */
let seq = 0
export const idActivite = (): string => `act-${Date.now().toString(36)}-${(seq++).toString(36)}`

/**
 * Relit une activité en se méfiant de tout : stockage bricolé, sauvegarde d'une
 * autre version, proposition venue du connecteur. Rend `null` plutôt qu'un objet à
 * moitié rempli — une activité sans date ne se rattache à aucune journée, donc à
 * aucune dépense, et traînerait invisible.
 */
export function normaliserActivite(brut: unknown): Activite | null {
  if (!brut || typeof brut !== 'object') return null
  const o = brut as Record<string, unknown>
  const date = String(o.date ?? '').slice(0, 10)
  if (!ISO_JOUR.test(date)) return null
  const type = (TYPES_ACTIVITE.some(t => t.id === o.type) ? o.type : 'autre') as TypeActivite
  const heureBrute = String(o.heure ?? '').slice(0, 5)
  const kcal = Math.round(Number(o.kcal))
  return {
    id: String(o.id ?? '').trim().slice(0, 40) || idActivite(),
    type,
    nom: String(o.nom ?? '').trim().slice(0, 40),
    date,
    // Une heure illisible ne doit pas jeter l'activité : c'est un détail de tri,
    // pas une donnée de calcul. Midi par défaut, au milieu de la journée.
    heure: HEURE.test(heureBrute) ? heureBrute : '12:00',
    minutes: bornerMinutes(o.minutes),
    kcal: Number.isFinite(kcal) ? Math.min(10000, Math.max(0, kcal)) : 0,
    estime: o.estime !== false,
  }
}

/** Le nom affiché : celui qu'on a tapé, sinon le libellé du type. */
export const nomActivite = (a: Activite): string => a.nom || ficheActivite(a.type).label

/** Les activités d'une journée, dans l'ordre où elles ont eu lieu. */
export const activitesDe = (liste: Activite[], iso: string): Activite[] =>
  liste.filter(a => a.date === iso).sort((x, y) => x.heure.localeCompare(y.heure))

/** Ce que les activités d'une journée ont coûté. Zéro s'il n'y en a aucune. */
export const kcalActivites = (liste: Activite[], iso: string): number =>
  activitesDe(liste, iso).reduce((n, a) => n + a.kcal, 0)

/** « 1 h 30 », « 45 min ». Lu dans une liste, pas dans un tableau. */
export function fmtDureeActivite(minutes: number): string {
  const m = bornerMinutes(minutes)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const reste = m % 60
  return reste ? `${h} h ${String(reste).padStart(2, '0')}` : `${h} h`
}
