import type { Exercise } from '../data/sportProgram'

// ─────────────────────────────────────────────────────────────────────────────
// Deux mouvements pour une place : l'alternance d'une semaine sur l'autre.
// ─────────────────────────────────────────────────────────────────────────────
//
// Adducteurs et abducteurs : deux machines, le même créneau, et aucune envie de les
// faire toutes les deux à chaque séance. Ce qu'on veut n'est pas « un exercice
// facultatif » — un facultatif se saute par manque de temps, et on finit par le
// sauter toujours — mais un ROULEMENT : cette semaine l'un, la semaine prochaine
// l'autre, sans avoir à s'en souvenir.
//
// D'où le champ `groupe` sur l'exercice. Les membres d'un même groupe occupent UNE
// place dans la séance ; c'est le calendrier qui dit lequel s'affiche.
//
// ── Pourquoi le calendrier, et pas le nombre de séances faites ──────────────
//
// Compter les séances enregistrées serait plus juste sur le papier — sauter une
// semaine ne ferait sauter aucun exercice. Mais ce que l'application montre POUR LA
// SEMAINE PROCHAINE dépendrait alors de ce qui sera fait d'ici là : impossible de
// regarder son planning et de savoir ce qu'on aura à faire, impossible aussi de
// l'expliquer autrement qu'en ouvrant l'historique. La semaine calendaire, elle, se
// lit sur un calendrier — et c'est exactement comme ça que la phrase a été posée :
// « je veux les faire une semaine sur deux ».
//
// ── Pourquoi un numéro de semaine CONTINU, et pas le numéro ISO ─────────────
//
// Le numéro ISO repart à 1 chaque année, après une année de 52 ou de 53 semaines.
// Une alternance fondée sur sa parité se retournerait donc au Nouvel An une année
// sur deux, silencieusement : deux fois les adducteurs d'affilée, sans que rien
// n'ait changé. On compte donc les semaines depuis un lundi fixe, une fois pour
// toutes.

/** Lundi 5 janvier 1970 : le premier lundi de l'époque Unix, qui commence un jeudi. */
const LUNDI_ZERO = Date.UTC(1970, 0, 5)
const JOUR_MS = 86_400_000
const SEMAINE_MS = 7 * JOUR_MS

/**
 * Le numéro de semaine, continu depuis 1970 — négatif avant, ce qui ne gêne personne
 * tant que le modulo est ramené dans les positifs (voir `indexDeLaSemaine`).
 *
 * En UTC de bout en bout : une date ISO n'a pas d'heure, donc pas de fuseau, et la
 * lire en heure locale ferait basculer le lundi d'une semaine à l'autre selon l'heure
 * d'été de la machine qui la lit.
 */
export function semaineDe(iso: string): number {
  const t = Date.parse(`${iso}T00:00:00Z`)
  if (!Number.isFinite(t)) return 0
  const jour = (new Date(t).getUTCDay() + 6) % 7 // 0 = lundi
  return Math.floor((t - jour * JOUR_MS - LUNDI_ZERO) / SEMAINE_MS)
}

/** Le rang à servir cette semaine-là, pour un groupe de `taille` membres. */
export function indexDeLaSemaine(iso: string, taille: number): number {
  if (taille <= 0) return 0
  const n = semaineDe(iso) % taille
  return n < 0 ? n + taille : n
}

/** Le libellé de groupe tel qu'on le range : rogné, et vide vaut « pas de groupe ». */
export function normaliserGroupe(v: unknown): string | undefined {
  const s = typeof v === 'string' ? v.trim().slice(0, 32) : ''
  return s || undefined
}

/**
 * Les groupes d'une séance, dans l'ordre d'apparition — et c'est cet ordre qui
 * NUMÉROTE les semaines.
 *
 * Aucun champ « semaine A / semaine B » sur l'exercice, donc : le rang se lit dans la
 * liste. Un champ de plus serait un second endroit à tenir cohérent, et il se
 * désynchroniserait au premier réordonnancement — on aurait deux exercices « semaine
 * A » et personne pour s'en apercevoir.
 */
export function groupesDe(exs: Exercise[]): Map<string, Exercise[]> {
  const out = new Map<string, Exercise[]>()
  for (const e of exs) {
    const g = normaliserGroupe(e.groupe)
    if (!g) continue
    const liste = out.get(g)
    if (liste) liste.push(e)
    else out.set(g, [e])
  }
  return out
}

/** Le groupe d'un exercice DANS cette séance, membres compris (lui inclus). */
export function groupeDe(exs: Exercise[], exId: string): Exercise[] {
  const ex = exs.find(e => e.id === exId)
  const g = ex && normaliserGroupe(ex.groupe)
  if (!g) return []
  const membres = groupesDe(exs).get(g) ?? []
  return membres.length > 1 ? membres : []
}

/** Choix du jour : par groupe, l'exercice qu'on a décidé de faire à la place. */
export type ChoixRotation = Record<string, string>

/**
 * La séance telle qu'elle se fait CE jour-là.
 *
 * Les exercices sans groupe passent tels quels. Pour un groupe, un seul membre
 * survit, et il prend la place du PREMIER membre de la liste : sinon l'ordre des
 * exercices changerait d'une semaine à l'autre, et l'ordre d'une séance n'est pas
 * décoratif — on ne met pas les mollets avant le squat.
 *
 * `choix` l'emporte sur le calendrier : c'est « fais l'autre à la place »,
 * pour la machine occupée comme pour la semaine sautée. Un choix qui ne désigne
 * aucun membre connu est ignoré plutôt que refusé — une séance modifiée entre-temps
 * ne doit pas faire disparaître une place entière.
 */
export function exercicesDuJour(exs: Exercise[], iso: string, choix?: ChoixRotation | null): Exercise[] {
  const groupes = groupesDe(exs)
  if (!groupes.size) return exs
  const retenu = new Map<string, string>()
  for (const [g, membres] of groupes) {
    const force = choix?.[g]
    const ex = (force && membres.find(m => m.id === force)) || membres[indexDeLaSemaine(iso, membres.length)]
    retenu.set(g, ex.id)
  }
  const out: Exercise[] = []
  for (const e of exs) {
    const g = normaliserGroupe(e.groupe)
    if (!g) { out.push(e); continue }
    const membres = groupes.get(g)!
    // La place du groupe est celle de son premier membre : on la remplit là, et on
    // saute les autres où qu'ils soient.
    if (membres[0].id !== e.id) continue
    const id = retenu.get(g)
    const ex = membres.find(m => m.id === id)
    if (ex) out.push(ex)
  }
  return out
}

const EN_LETTRES = ['zéro', 'une', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf']

/**
 * La phrase qui dit l'alternance, pour la fiche du mouvement.
 *
 * « une semaine sur deux » se comprend sans rien apprendre ; « rang 0 modulo 2 » est
 * la même information et ne se comprend pas.
 */
export function phraseAlternance(membres: Exercise[], exId: string): string {
  const autres = membres.filter(e => e.id !== exId)
  if (!autres.length) return ''
  // En lettres tant qu'on sait les écrire : c'est une phrase, pas un tableau de bord.
  const n = EN_LETTRES[membres.length] ?? String(membres.length)
  return `En alternance une semaine sur ${n} avec ${autres.map(e => e.name).join(', ')}.`
}
