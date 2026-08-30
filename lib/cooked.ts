// Import relatif : testé dans le projet « unit », qui tourne en Node pur sans la
// résolution de chemins de Nuxt.
import type { Food } from '../data/nutritionProgram'

// ─────────────────────────────────────────────────────────────────────────────
// Du cru au cuit : le pont qui manquait entre la fiche et l'assiette.
// ─────────────────────────────────────────────────────────────────────────────
//
// Les fiches donnent tout en CRU, et c'est le bon choix : les tables de composition
// mesurent le cru, et c'est la seule référence qui ne dépende ni de la casserole ni
// du temps de cuisson. Changer ça fausserait les macros.
//
// Mais entre la fiche et la boîte, il manquait une étape. On cuit 750 g de riz pour
// cinq boîtes, on se retrouve devant deux kilos de riz cuit, et il faut deviner
// combien en mettre dans chacune. À l'œil, l'erreur est de l'ordre de 20 % — soit
// 80 kcal par boîte, tous les midis, dans un déficit calibré à 500.
//
// Deux décisions gouvernent ce module.
//
// **Les féculents seulement.** Ce sont les seuls qui posent le problème : ils
// gonflent et deviennent une masse indistincte. Cinq filets de poulet pour cinq
// boîtes se répartissent en les comptant, et les brocolis vapeur perdent 5 % — un
// chiffre affiché là n'aiderait personne et donnerait à croire que tout le reste
// doit se peser aussi.
//
// **Une valeur de référence, corrigée par une pesée.** Le riz al dente et le riz
// bien cuit n'absorbent pas la même chose, et l'écart atteint 15 %. On part donc de
// ratios publiés, utilisables le premier jour, et on garde LA pesée quand elle
// existe — même principe que les coefficients de machine, où le catalogue donne un
// ordre de grandeur et où ses propres séances donnent un fait.

/**
 * Poids cuit d'un aliment, pour 1 g cru.
 *
 * Ce sont des ordres de grandeur pour une cuisson courante, pas des constantes
 * physiques. Les féculents secs absorbent (ratio > 1), ce qui passe au four perd
 * de l'eau (ratio < 1).
 */
export const COOKED_RATIO: Record<string, number> = {
  // Absorbent — le poids cuit dépend surtout du temps et de l'eau disponible.
  'riz-basmati': 2.6, // 11 min à l'eau, égoutté
  'pates-completes': 2.4, // al dente ; les complètes gonflent un peu moins que les blanches
  'lentilles-vertes': 2.5,
  // PAS les flocons d'avoine, bien qu'ils absorbent énormément en porridge : aucune
  // de ses recettes ne les cuit. Overnight oats, granola sur le yaourt, smoothie,
  // bol cheesecake — ils sont crus partout. Un « 540 g cuits » sur un bol de yaourt
  // n'est pas une approximation, c'est une information fausse. La table ne contient
  // que ce que SES recettes cuisent réellement.
  // Perdent de l'eau — le four en retire nettement plus que la vapeur.
  'pommes-de-terre': 0.85, // en cubes au four ; à la vapeur c'est plutôt 0,95
  'patate-douce': 0.75, // en frites au four, elle rend beaucoup
}

/** Ce qui mérite d'être dit en plus du chiffre, quand il varie fortement. */
export const COOKED_NOTE: Record<string, string> = {
  'pommes-de-terre': 'au four ; à la vapeur, compte plutôt ×0,95',
  'pates-completes': 'al dente ; bien cuites, elles montent vers ×2,7',
}

export interface CookedOpts {
  /** Ratios mesurés par l'utilisateur, qui l'emportent sur les valeurs de référence. */
  mesures?: Record<string, number>
}

/**
 * Le ratio retenu pour un aliment, et d'où il vient.
 *
 * `null` quand l'aliment n'en a pas — c'est le cas normal, pas une erreur : la
 * plupart des aliments ne se pèsent pas cuits.
 */
export function ratioFor(foodId: string, opts: CookedOpts = {}): { ratio: number, mesure: boolean } | null {
  const mien = opts.mesures?.[foodId]
  if (typeof mien === 'number' && mien > 0.2 && mien < 6) return { ratio: mien, mesure: true }
  const ref = COOKED_RATIO[foodId]
  return ref ? { ratio: ref, mesure: false } : null
}

/**
 * Poids cuit correspondant à un poids cru. `null` si l'aliment n'a pas de ratio.
 *
 * Arrondi à 5 g : afficher « 389 g » sur une valeur à ±10 % promettrait une
 * précision qui n'existe pas, et personne ne pèse au gramme une louche de riz.
 */
export function cookedWeight(foodId: string, rawG: number, opts: CookedOpts = {}): number | null {
  const r = ratioFor(foodId, opts)
  if (!r || !(rawG > 0)) return null
  return Math.round((rawG * r.ratio) / 5) * 5
}

/**
 * Ce qu'on affiche au moment de répartir un batch.
 *
 * `parBoite` est le seul chiffre qui compte devant la casserole ; `totalCuit` sert
 * à vérifier qu'on est bien tombé sur la bonne masse avant de commencer à servir.
 */
export interface Portioning {
  foodId: string
  /** Poids cru pour UNE portion, tel qu'il est sur la fiche. */
  cruParBoite: number
  /** Poids cru de tout le batch. */
  cruTotal: number
  totalCuit: number
  parBoite: number
  mesure: boolean
  note?: string
}

export function portioningFor(
  items: { food: string, g: number }[],
  boites: number,
  opts: CookedOpts = {},
): Portioning[] {
  if (!(boites > 0)) return []
  const out: Portioning[] = []
  for (const it of items) {
    const r = ratioFor(it.food, opts)
    if (!r || !(it.g > 0)) continue
    const cruTotal = Math.round(it.g * boites * 10) / 10
    out.push({
      foodId: it.food,
      cruParBoite: it.g,
      cruTotal,
      totalCuit: Math.round((cruTotal * r.ratio) / 5) * 5,
      parBoite: Math.round((it.g * r.ratio) / 5) * 5,
      mesure: r.mesure,
      note: COOKED_NOTE[it.food],
    })
  }
  return out
}

/**
 * Déduit le ratio d'une pesée : « j'ai cuit 750 g cru, la casserole en fait 1 950 ».
 *
 * Rendu `null` hors des bornes plausibles. Un ratio de 12 vient d'une pesée faite
 * casserole comprise, et l'accepter figerait une erreur qu'on ne remarquerait qu'en
 * voyant ses calories se tromper de cinq cents.
 */
export function ratioFromWeighing(cruG: number, cuitG: number): number | null {
  if (!(cruG > 0) || !(cuitG > 0)) return null
  const r = cuitG / cruG
  if (r < 0.3 || r > 5) return null
  return Math.round(r * 100) / 100
}

/** Les féculents d'une bibliothèque qui savent se convertir — pour l'écran de réglage. */
export const convertibles = (foods: Record<string, Food>): Food[] =>
  Object.keys(COOKED_RATIO).map(id => foods[id]).filter((f): f is Food => !!f)
