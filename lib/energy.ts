// Import relatif : testé dans le projet « unit », qui tourne en Node pur sans la
// résolution de chemins de Nuxt.
import type { TrainingLike } from './nutritionStats'
import { dayBurn } from './nutritionStats'

// ─────────────────────────────────────────────────────────────────────────────
// La dépense d'une journée. Une seule règle, écrite une seule fois.
// ─────────────────────────────────────────────────────────────────────────────
//
// Il y en avait SIX, réparties dans six écrans, et elles ne disaient pas la même
// chose. Le forfait de séance était déclaré cinq fois. L'âge était recalculé sept
// fois, de trois façons différentes. Le métabolisme de base, six fois.
//
// Rien de tout cela n'est grave pris isolément — jusqu'au jour où deux écrans
// répondent différemment à la même question. C'est arrivé, et deux fois :
//
//   • sur une séance PRÉVUE MAIS JAMAIS FAITE, le calendrier et la feuille du jour
//     créditaient quand même le forfait. La cible de ce jour-là était donc gonflée
//     de plusieurs centaines de calories, et l'historique donnait l'impression
//     d'avoir sous-mangé un jour où l'on avait visé juste ;
//   • le calendrier calculait le métabolisme sur le poids d'AUJOURD'HUI, alors que
//     la feuille qu'il ouvre le calculait sur le poids DE CE JOUR-LÀ. Deux chiffres
//     pour la même case, selon qu'on la regarde de loin ou de près.
//
// Aucune des deux ne plante. Elles se lisent, et on en tire des conclusions.

/**
 * Dépense d'une séance moyenne, tant que la vraie n'est pas connue.
 *
 * Une hypothèse, et elle doit rester UNE hypothèse : déclarée cinq fois, elle
 * n'aurait été corrigée qu'à quatre endroits le jour où on la révise.
 */
export const SESSION_FORFAIT = 440

/**
 * L'âge à une date donnée.
 *
 * Différence d'années, sans tenir compte du jour anniversaire — c'est ce que faisait
 * déjà chacun des sept exemplaires, et l'affiner changerait le métabolisme de cinq
 * kilocalories une fois par an. On garde la définition, on supprime les copies.
 */
export function ageOn(iso: string, birthYear?: number | null): number | null {
  if (!birthYear || !/^\d{4}/.test(iso)) return null
  const age = Number(iso.slice(0, 4)) - birthYear
  return age > 0 && age < 130 ? age : null
}

/**
 * Ce que la séance de la journée a coûté, en kilocalories.
 *
 * Trois cas, dans cet ordre, et le troisième est celui qu'on oubliait :
 *
 *   1. une séance est ENREGISTRÉE → on l'estime sur ce qui a vraiment été fait.
 *      Une séance de 40 minutes expédiée ne coûte pas ce que coûte une heure dix
 *      avec des sprints ;
 *   2. une séance est prévue et la journée n'est PAS FINIE → le forfait. On ne peut
 *      pas encore savoir, et supposer zéro ferait afficher au petit-déjeuner une
 *      cible qui bondirait le soir venu ;
 *   3. une séance était prévue et la journée est finie sans rien d'enregistré →
 *      ZÉRO. Elle n'a pas eu lieu. Lui créditer le forfait revient à autoriser
 *      quatre cents calories pour un entraînement qu'on n'a pas fait, et à relire
 *      plus tard une journée « sous la cible » qui était en réalité juste.
 */
export function sessionBurn(opts: {
  records: TrainingLike[]
  kg: number | null
  bmr: number | null
  /** Une séance est-elle prévue ce jour-là (semaine type ou exception) ? */
  gymPlanned: boolean
  /** La journée est-elle derrière nous ? Voir `isDayPlayed`. */
  played: boolean
}): number {
  const { records, kg, bmr, gymPlanned, played } = opts
  if (records.length && kg && bmr !== null) return dayBurn(records, kg, bmr)
  if (records.length) return 0
  return gymPlanned && !played ? SESSION_FORFAIT : 0
}
