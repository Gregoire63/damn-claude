// Import relatif : testé dans le projet « unit », qui tourne en Node pur sans la
// résolution de chemins de Nuxt.
import { bottomOfRange, topOfRange } from '../data/sportProgram'

// ─────────────────────────────────────────────────────────────────────────────
// Quand la fiche dit une chose et le carnet une autre.
// ─────────────────────────────────────────────────────────────────────────────
//
// Le programme annonce une fourchette de reps ; les séances enregistrées en racontent
// une autre. Rien ne les confronte, et personne ne s'en aperçoit — parce que les deux
// chiffres ne se croisent jamais sur un même écran.
//
// Ce n'est pas théorique. Sur ses données au 19 août :
//
//   face-pull   fiche « 15 »  ·  fait 10, 10, 10, 10, 10   (cinq séances sur cinq)
//   elev-lat    fiche « 15 »  ·  fait 8 à 10
//   oiseau      fiche « 15 »  ·  fait 8
//   releves     fiche « 12 »  ·  fait 10
//
// L'auto-régulation lit la FICHE. Deux conséquences, en sens opposés, et aucune
// visible :
//
//   · elle ne conseille jamais de charger, puisque la cible n'est jamais atteinte —
//     cinq séances à 10/10/10 sur le face-pull, ce qui est le manuel de « monte de
//     2,5 kg », et l'application est restée muette ;
//   · elle conseille de DÉCHARGER dès qu'on marque « à l'échec », puisque les reps
//     sont sous le plancher annoncé. C'est arrivé à l'oiseau le 6 août : à l'échec à
//     8 reps sur une fiche qui en demande 15, l'app a suggéré de redescendre.
//
// Ni l'une ni l'autre ne se remarque. On ne voit pas un conseil qui ne s'affiche pas,
// et un conseil de décharge ressemble à de la prudence.
//
// D'où cette fonction. Elle ne corrige rien et ne devine rien : elle rend l'écart
// LISIBLE, pour que la question « qui a raison, la fiche ou le carnet ? » soit posée
// à quelqu'un qui peut y répondre. C'est une décision d'entraînement, pas de code.

export interface RepsGap {
  /** Médiane des reps réellement faites, séries d'échauffement exclues. */
  median: number
  /** Ce que la fiche demande. `haut` est nul sur un nombre fixe — cf. `topOfRange`. */
  bas: number | null
  haut: number | null
  /** De quel côté ça déborde. */
  sens: 'sous' | 'sur'
  /** Sur combien de séances la médiane est calculée. */
  seances: number
}

/** La médiane plutôt que la moyenne : une séance ratée ne doit pas déplacer le constat. */
const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * L'écart entre les reps prévues et les reps faites, ou `null` s'il n'y en a pas.
 *
 * `null` couvre trois cas, et c'est important qu'ils se taisent tous les trois :
 * pas assez de séances pour conclure, une fiche sans chiffre à confronter (« max »),
 * et le cas normal où le carnet suit la fiche.
 *
 * `minSeances` à trois : en dessous, une médiane n'en est pas une, et signaler un
 * écart sur une seule séance ferait crier au loup à chaque nouveau mouvement.
 */
export function repsGap(
  reps: string,
  sessions: { sets: { r?: number, warm?: boolean }[] }[],
  minSeances = 3,
): RepsGap | null {
  // Un protocole COMPOSÉ ne se lit pas comme une fourchette, et le prétendre produit
  // une fausse alerte. Le détecteur a signalé `curl-21` dès le premier essai sur ses
  // vraies séances : la fiche dit « 7+7+7 (21) », `bottomOfRange` en tire 7 — le
  // premier nombre —, et comme il enregistre le total, 21, l'écart avait l'air énorme.
  // Or la fiche et le carnet disent exactement la même chose.
  //
  // Se taire ici plutôt que de deviner : une alerte qui a tort une fois sur quatre
  // ne se lit plus du tout, et ce détecteur n'existe que pour être lu.
  if (/[+()/]/.test(reps)) return null

  const bas = bottomOfRange(reps)
  const haut = topOfRange(reps)
  if (bas === null && haut === null) return null // « max » : rien à confronter

  const parSeance = sessions
    .map(s => (s.sets ?? []).filter(x => !x.warm && typeof x.r === 'number' && x.r > 0).map(x => x.r as number))
    .filter(rs => rs.length)
    .map(rs => median(rs))
  if (parSeance.length < minSeances) return null

  const m = median(parSeance)
  // Le plafond d'un nombre fixe est le plancher : « 15 » veut dire 15, pas « au moins 15 ».
  const plafond = haut ?? bas
  if (bas !== null && m < bas) return { median: m, bas, haut, sens: 'sous', seances: parSeance.length }
  if (plafond !== null && m > plafond) return { median: m, bas, haut, sens: 'sur', seances: parSeance.length }
  return null
}

/** La phrase à afficher, pour que l'écart se lise sans avoir à l'interpréter. */
export function repsGapLabel(id: string, reps: string, g: RepsGap): string {
  const cible = g.haut !== null && g.bas !== null && g.haut !== g.bas ? `${g.bas}-${g.haut}` : String(g.bas ?? g.haut)
  return g.sens === 'sous'
    ? `« ${id} » : la fiche demande ${cible} reps, tu en fais ${g.median} en médiane sur ${g.seances} séances. Tant que l'écart dure, « à l'échec » déclenche une décharge à tort, et la montée de charge ne se déclenche jamais.`
    : `« ${id} » : la fiche demande ${cible} reps, tu en fais ${g.median} en médiane sur ${g.seances} séances. La charge est probablement trop légère pour la fourchette visée.`
}
