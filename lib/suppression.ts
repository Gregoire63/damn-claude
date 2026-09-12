// ─────────────────────────────────────────────────────────────────────────────
// Ce qu'une suppression emporte avec elle.
// ─────────────────────────────────────────────────────────────────────────────
//
// Supprimer un plat n'est jamais un geste isolé. Le même identifiant est posé dans
// quatre endroits qui ne se voient pas les uns les autres :
//
//  · les semaines types, où il occupe un créneau d'un jour ;
//  · les exceptions de planning, quand on a imposé ce plat à une date précise ;
//  · les jours où on l'a pris À LA PLACE de ce qui était prévu ;
//  · les autres plats, qui peuvent le servir comme sauce.
//
// Aucun de ces liens n'est vérifié au moment d'écrire. Supprimer sans les regarder
// donnait un écran de journée avec un repas en moins — pas une erreur, pas un trou
// visible : le créneau disparaissait, simplement, et le total du jour baissait
// d'autant. On cherche l'explication dans les calories, jamais dans un plat effacé
// trois semaines plus tôt.
//
// ── Et la réparation évidente était pire ────────────────────────────────────
//
// Le réflexe est de NETTOYER : vider les créneaux, couper les liens. Il produit
// exactement le défaut qu'il prétend corriger, en pire, parce qu'une semaine type
// n'est pas une intention pour la semaine prochaine — c'est la SEULE mémoire de ce
// qui a été mangé. Aucun total de journée n'est stocké : ils se recalculent depuis
// la semaine à chaque affichage. Vider un créneau retire donc le repas de tous les
// jeudis déjà vécus. Mesuré : un jeudi passait de 2 022 à 1 464 kcal, et rien à
// l'écran ne reliait cette perte au ménage fait dix minutes plus tôt.
//
// Même piège pour la sauce : la retirer des plats qui la servent allège leurs macros
// dans le passé aussi. D'où la règle, la même que pour un aliment — une sauce encore
// servie ne se supprime pas, on nomme les plats à corriger d'abord.
//
// Ce qui reste vrai : un plat supprimé cesse d'être CHOISISSABLE. Les jours à venir
// le sautent (`buildDay(..., sansSupprimes)`), les listes ne le proposent plus, et
// ce qui porte une date dans le futur — exception de planning, plat pris à la place —
// se coupe. Le passé, lui, ne bouge pas d'un gramme.
//
// Ce module ne supprime rien. Il répond à une seule question — « qu'est-ce qui
// pointe vers ça ? » — pour que l'écran puisse le dire avant.

import type { Recipe } from '../data/nutritionProgram'
import type { DayOverride, MenuWeek } from './nutritionStats'

export interface Reference { id: string, nom: string }

export interface UsagesPlat {
  /** Semaines types qui le programment, et sur combien de jours chacune. */
  menus: { id: string, nom: string, jours: number }[]
  /**
   * Plats qui le servent comme sauce. C'est un REFUS, pas une information : ses
   * ingrédients entrent dans leurs macros, y compris dans les journées passées.
   */
  sauceDe: Reference[]
  /** Dates À VENIR où il est imposé par une exception de planning. */
  exceptions: string[]
  /** Dates À VENIR où il a été choisi à la place du plat prévu. */
  choisi: string[]
  /** Rien ne pointe vers lui : la confirmation peut être brève. */
  aucun: boolean
}

export interface SourceUsages {
  menus: MenuWeek[]
  recipes: Record<string, Recipe>
  overrides: Record<string, DayOverride>
  picked: Record<string, Record<string, string>>
  /**
   * La date du jour, en ISO. Ce qui la précède est de l'histoire : on ne la compte
   * pas, parce qu'on n'y touchera pas.
   */
  aujourdhui: string
}

/**
 * Tout ce qui pointe vers un plat.
 *
 * Les semaines LIVRÉES comptent comme les autres : elles viennent du code et se
 * recalculent à chaque chargement, donc on ne pourra pas les nettoyer — raison de
 * plus pour les montrer.
 */
export function usagesPlat(id: string, src: SourceUsages): UsagesPlat {
  const menus = src.menus
    .map((m) => {
      const jours = m.days.filter(d => Object.values(d.slots ?? {}).includes(id)).length
      return { id: m.id, nom: m.name, jours }
    })
    .filter(m => m.jours > 0)

  const sauceDe = Object.values(src.recipes)
    .filter(r => r.sauce === id && r.id !== id && !r.deleted)
    .map(r => ({ id: r.id, nom: r.name }))
    .sort((a, b) => a.nom.localeCompare(b.nom))

  const exceptions = Object.entries(src.overrides)
    .filter(([iso, o]) => iso >= src.aujourdhui && (o.lunch === id || o.dinner === id))
    .map(([iso]) => iso)
    .sort()

  const choisi = Object.entries(src.picked)
    .filter(([iso, slots]) => iso >= src.aujourdhui && Object.values(slots).includes(id))
    .map(([iso]) => iso)
    .sort()

  return {
    menus,
    sauceDe,
    exceptions,
    choisi,
    aucun: !menus.length && !sauceDe.length && !exceptions.length && !choisi.length,
  }
}

/** Les plats qui utilisent cet aliment. Un plat supprimé ne compte pas : il ne se choisit plus. */
export function usagesAliment(id: string, recipes: Record<string, Recipe>): Reference[] {
  return Object.values(recipes)
    .filter(r => !r.deleted && r.items.some(i => i.food === id))
    .map(r => ({ id: r.id, nom: r.name }))
    .sort((a, b) => a.nom.localeCompare(b.nom))
}

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`

/**
 * La phrase de la confirmation.
 *
 * Elle nomme ce qui va bouger plutôt que de demander « êtes-vous sûr ? ». Une
 * question à laquelle on répond oui sans lire ne protège de rien ; « sauce de
 * 3 plats » arrête la main toute seule.
 */
export function phraseUsages(u: UsagesPlat): string {
  if (u.aucun) return 'Rien ne l’utilise.'
  const bouts: string[] = []
  if (u.menus.length) {
    bouts.push(`programmé dans ${pluriel(u.menus.length, 'semaine type', 'semaines types')} (${u.menus.map(m => m.nom).join(', ')})`)
  }
  if (u.exceptions.length) bouts.push(`imposé ${pluriel(u.exceptions.length, 'jour à venir', 'jours à venir')} par une exception`)
  if (u.choisi.length) bouts.push(`déjà choisi pour ${pluriel(u.choisi.length, 'jour à venir', 'jours à venir')}`)
  return `Il est ${bouts.join(', ')}.`
}

/**
 * Ce que le nettoyage va faire, dit à la première personne du futur.
 *
 * Séparé de `phraseUsages` parce que ce n'est pas la même information : l'une décrit
 * l'état, l'autre annonce l'acte. Les fondre donnerait « il est programmé dans deux
 * semaines qui seront vidées », une phrase qu'on relit deux fois.
 */
export function phraseNettoyage(u: UsagesPlat): string {
  const bouts: string[] = []
  if (u.menus.length) {
    // On ne vide PAS les créneaux : ils sont la mémoire du passé (voir l'en-tête).
    // On dit donc ce qui va se voir, et ce qu'il restera à faire.
    bouts.push(`${pluriel(u.menus.reduce((n, m) => n + m.jours, 0), 'repas à venir sautera', 'repas à venir sauteront')} — remets un plat dans ces créneaux quand tu veux`)
  }
  if (u.exceptions.length || u.choisi.length) bouts.push('les jours à venir repasseront au plat prévu')
  if (!bouts.length) return ''
  const p = bouts.join(', ')
  return `${p.charAt(0).toUpperCase()}${p.slice(1)}.`
}

/**
 * Ce que la suppression NE touche pas, et qu'il faut dire.
 *
 * Les journées déjà passées gardent leurs repas et leurs calories : le plat reste
 * calculable, il cesse seulement d'être choisissable (voir `Recipe.deleted`). Sans
 * cette ligne, on hésite à faire le ménage de peur de fausser trois mois de suivi.
 */
export const PHRASE_HISTORIQUE = 'Les journées déjà passées gardent leurs repas et leurs calories.'

/**
 * Le refus, quand d'autres plats servent celui-ci en sauce.
 *
 * Même règle que pour un aliment, et pour la même raison : une sauce entre dans les
 * macros des plats qui la servent, y compris dans les journées passées. La retirer
 * de force les allégerait rétroactivement, sans qu'aucune ligne ne bouge à l'écran.
 */
export const phraseSauceServie = (plats: Reference[]): string =>
  `${plats.length > 1 ? 'Ces plats le servent' : 'Ce plat le sert'} en sauce. Retire-le de leur fiche d’abord.`
