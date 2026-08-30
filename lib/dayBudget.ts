// Import relatif : testé dans le projet « unit », qui tourne en Node pur sans la
// résolution de chemins de Nuxt.
import type { Macros } from './nutritionStats'

// ─────────────────────────────────────────────────────────────────────────────
// Ce qui reste à manger aujourd'hui.
// ─────────────────────────────────────────────────────────────────────────────
//
// L'écran du jour sait tout ça depuis le début. Le connecteur, non : il voyait le
// menu prévu — « déjeuner : boîte A » — et rien d'autre. Impossible, depuis une
// conversation, de composer un dîner qui tombe juste : ni la cible du jour, ni ce
// qui avait déjà été avalé, ni ce qu'il restait de protéines. On composait donc à
// l'estime, et l'estime se trompe toujours dans le même sens — vers le bas sur les
// protéines, vers le haut sur les calories.
//
// Ce module ne fait qu'une chose : soustraire. Toute la difficulté est ailleurs —
// rassembler les pièces depuis le miroir — et c'est justement pour ça qu'elle est
// séparée : l'arithmétique se teste, l'assemblage se relit.
//
// Le point important est ce qu'on ne fait PAS : on ne redistribue rien. Le reste de
// la journée n'est pas divisé entre les créneaux restants, parce que la répartition
// n'appartient pas au calcul — un dîner à 1200 kcal et deux collations à 200 est un
// choix, pas un résultat. On donne les bornes, la décision reste dehors.

/** Un créneau du jour, une fois qu'on sait ce qu'il contient et s'il a été pris. */
export interface SlotState {
  slot: string
  time: string
  label: string
  /** Nom du plat, ou du repas hors plan. `null` si le créneau est vide. */
  plat: string | null
  macros: Macros
  /** Coché : ce qui est là-dedans est déjà dans le corps. */
  mange: boolean
  /** Repas hors plan : ses macros sont saisies, pas calculées depuis des ingrédients. */
  libre: boolean
}

export interface DayBudget {
  /** Cible calorique du jour, déficit compris. */
  cible: number
  /** Cible protéique, calculée sur la masse maigre quand la balance la donne. */
  cibleProteines: number | null
  /** Déjà avalé : créneaux cochés + extras notés. */
  mange: Macros
  /** Ce que la journée prévoit en tout, extras compris. */
  prevu: Macros
  /**
   * Ce qui reste avant d'atteindre la cible. Peut être NÉGATIF, et c'est une
   * information : dépasser de 300 kcal se corrige le lendemain, l'ignorer non.
   */
  reste: { kcal: number, proteines: number | null }
  /**
   * Ce que les créneaux non cochés apportent s'ils sont mangés tels que prévus.
   *
   * C'est la pièce qui manquait pour composer : la différence entre `reste` et
   * `restePrevu` dit s'il faut ajouter ou retirer, et de combien. Un dîner prévu à
   * 800 kcal quand il reste 500 demande un plat plus léger, pas un plat de plus.
   */
  restePrevu: Macros
  /** Les créneaux non cochés, dans l'ordre de la journée. */
  aVenir: SlotState[]
}

const ZERO: Macros = { kcal: 0, p: 0, g: 0, l: 0 }

const somme = (list: Macros[]): Macros => list.reduce((a, m) => ({
  kcal: a.kcal + m.kcal, p: a.p + m.p, g: a.g + m.g, l: a.l + m.l,
}), { ...ZERO })

const arrondi = (m: Macros): Macros => ({
  kcal: Math.round(m.kcal),
  p: Math.round(m.p * 10) / 10,
  g: Math.round(m.g * 10) / 10,
  l: Math.round(m.l * 10) / 10,
})

/**
 * Le budget du jour, à partir des créneaux déjà résolus.
 *
 * @param cible Cible calorique — celle que l'écran affiche, pas une autre. Deux
 *   calculs de cible qui divergent, c'est un conseil qui contredit l'application.
 * @param cibleProteines `null` tant qu'aucune pesée ne permet de la calculer : mieux
 *   vaut ne rien annoncer qu'annoncer une cible tirée d'un poids inventé.
 */
export function dayBudget(input: {
  cible: number
  cibleProteines: number | null
  slots: SlotState[]
  extras: Macros[]
}): DayBudget {
  const { cible, cibleProteines, slots, extras } = input
  const pris = slots.filter(s => s.mange).map(s => s.macros)
  const aVenir = slots.filter(s => !s.mange)
  // Les extras sont notés APRÈS coup — on n'écrit pas un carré de chocolat qu'on
  // n'a pas encore mangé. Ils comptent donc toujours dans l'avalé.
  const mange = somme([...pris, ...extras])
  const restePrevu = somme(aVenir.map(s => s.macros))

  return {
    cible: Math.round(cible),
    cibleProteines,
    mange: arrondi(mange),
    prevu: arrondi(somme([...slots.map(s => s.macros), ...extras])),
    reste: {
      kcal: Math.round(cible - mange.kcal),
      proteines: cibleProteines === null ? null : Math.round((cibleProteines - mange.p) * 10) / 10,
    },
    restePrevu: arrondi(restePrevu),
    aVenir,
  }
}

/**
 * Ce qu'une composition apporte, confrontée à ce qui reste.
 *
 * Sert à vérifier AVANT de déposer, plutôt qu'à s'excuser après. L'écart est rendu
 * signé : « +180 kcal » et « −180 kcal » ne se corrigent pas du tout de la même
 * façon, et un écart en valeur absolue efface justement la seule chose utile.
 */
export interface Fit {
  apporte: Macros
  /** Ce qu'il resterait après ce repas. Négatif = dépassement. */
  apres: { kcal: number, proteines: number | null }
  /** Vrai si le repas rentre dans l'enveloppe calorique restante. */
  tient: boolean
}

export function fitInto(apporte: Macros, budget: DayBudget): Fit {
  const kcal = Math.round(budget.reste.kcal - apporte.kcal)
  return {
    apporte: arrondi(apporte),
    apres: {
      kcal,
      proteines: budget.reste.proteines === null
        ? null
        : Math.round((budget.reste.proteines - apporte.p) * 10) / 10,
    },
    tient: kcal >= 0,
  }
}
