// Import relatif : testé dans le projet « unit », qui tourne en Node pur sans la
// résolution de chemins de Nuxt.
import { macrosOf } from './nutritionStats'
import type { DayMeal, DayPlan, Macros } from './nutritionStats'
import type { Food, RecipeItem } from '../data/nutritionProgram'

// ─────────────────────────────────────────────────────────────────────────────
// Le repas du dehors : remplacer un plat prévu par ce qu'on a vraiment mangé.
// ─────────────────────────────────────────────────────────────────────────────
//
// L'application savait faire deux choses, et il en manquait une troisième au milieu.
//
//   • `picked` REMPLACE le plat d'un créneau — mais seulement par un plat de la
//     bibliothèque, parce qu'il ne stocke qu'un identifiant ;
//   • `extras` AJOUTE quelque chose qui porte ses propres calories — mais toujours
//     en plus du plan, jamais à la place.
//
// Or le cas réel est « à midi je ne mange pas ma boîte, je mange un kebab ». Le faire
// passer par un extra oblige à ne pas cocher le déjeuner puis à ajouter le kebab à
// côté : le compte des calories tombe juste, mais l'écran continue d'annoncer une
// boîte de bœuf qu'on n'a pas mangée, et le total « prévu » aussi.
//
// D'où cette troisième forme : un repas qui occupe le créneau ET porte ses macros.
//
// Pourquoi il ne passe PAS par la bibliothèque de plats. Un `Recipe` ne peut pas
// porter de calories — les siennes sont toujours recalculées depuis ses ingrédients
// et leurs grammes. Un kebab de restaurant n'a ni ingrédients pesés ni grammages
// connus ; l'y forcer demanderait d'inventer un aliment fantôme, qui remonterait
// ensuite dans les courses, dans le stock du frigo et dans les sessions de cuisine.
// Un plat qu'on n'a jamais acheté ni cuisiné n'a rien à y faire.
//
// Ce module ne contient que la partie calculable, donc testable : fabriquer un repas
// valide à partir d'une saisie, et l'insérer dans la journée.

/** Un repas saisi à la main, qui occupe un créneau et porte ses propres macros. */
export interface FreeMeal {
  label: string
  kcal: number
  p: number
  g: number
  l: number
  /** Repère de saisie, pour distinguer « tapé » de « proposé par Claude ». */
  from?: 'saisie' | 'catalogue' | 'claude'
  /**
   * Le plat du catalogue dont CE repas dérive. Purement indicatif : il sert à écrire
   * « variante de : Saumon, patate douce, épinards » et à ouvrir la recette d'origine
   * en regard. Il n'est JAMAIS lu comme une source de macros ni de grammages — sinon
   * une variante afficherait les quantités du catalogue, c'est-à-dire précisément
   * celles qu'on n'a pas mangées.
   */
  base?: string
  /**
   * Ce qu'il y avait vraiment dans l'assiette, pour ce repas et ce jour-là.
   *
   * C'est la réponse au cas qui manquait : je mange une variante d'un plat que je
   * connais — 211 g de saumon au lieu de 150, du steak haché à la place de la dinde,
   * sans la vinaigrette. Sans ces items, l'écran affichait « repas du dehors » et je
   * perdais l'accès aux quantités au moment précis où j'en avais besoin, devant la
   * balance.
   *
   * Le catalogue n'est PAS touché : le plat d'origine reste bon pour les autres
   * jours. C'est bien la raison d'être de ce champ plutôt que d'un patch de recette.
   *
   * La liste peut être PARTIELLE. Un gigot d'agneau ou un burger n'ont pas
   * d'identifiant dans le catalogue ; pouvoir décrire les trois ingrédients qu'on
   * connaît vaut mieux que de ne rien décrire. Ce sont alors les macros saisies qui
   * font foi — voir `checkFreeMeal`.
   */
  items?: RecipeItem[]
  /** Préparation adaptée, quand elle diffère de celle du catalogue. */
  steps?: string
}

const num = (v: unknown, max: number): number | null => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : v
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > max) return null
  return Math.round(n * 10) / 10
}

/**
 * Met une saisie en forme, ou rend `null` si elle ne veut rien dire.
 *
 * Les bornes ne sont pas décoratives. Un zéro passé en calories produirait un repas
 * qui occupe le créneau sans rien y mettre — l'écran afficherait « kebab » et le
 * compteur ne bougerait pas, ce qui est la pire des deux erreurs possibles. Et un
 * chiffre à quatre zéros vient d'une faute de frappe, jamais d'un déjeuner.
 *
 * Les macros absentes valent zéro plutôt que de faire échouer la saisie : mieux vaut
 * un repas compté en calories seules qu'un repas non enregistré. La cohérence entre
 * macros et calories n'est PAS vérifiée — 4/4/9 est une approximation, les étiquettes
 * s'en écartent légitimement, et refuser une étiquette parce qu'elle ne tombe pas
 * juste serait refuser la réalité au nom du modèle.
 */
export interface FreeMealOpts {
  /**
   * Les aliments du catalogue, quand l'appelant les a sous la main.
   *
   * FOURNI, un ingrédient inconnu fait échouer la mise en forme : c'est ce qui
   * permet au connecteur de refuser un dépôt et de dire lesquels, plutôt que de
   * laisser une composition à moitié muette arriver dans la boîte de réception.
   *
   * ABSENT, les items passent tels quels. Ce n'est pas un relâchement : la saisie à
   * la main dans l'application ne produit pas d'items, et un repas déjà enregistré
   * qu'on relit ne doit pas devenir invalide parce qu'un aliment a été renommé
   * depuis. On ne réécrit pas le passé pour lui faire respecter les règles d'après.
   */
  foodKnown?: (id: string) => boolean
}

/** Un identifiant d'aliment : même forme que partout ailleurs dans la sauvegarde. */
const isFoodId = (v: unknown): v is string => typeof v === 'string' && /^[a-z0-9][a-z0-9-]{0,39}$/.test(v)

/**
 * La composition d'un repas, ou `undefined` si elle n'en a pas.
 *
 * Rend `false` — et non une liste vide — quand un ingrédient est refusé : l'appelant
 * doit pouvoir distinguer « pas de composition » de « composition invalide ». Sans
 * cette distinction, un dépôt fautif serait silencieusement transformé en repas sans
 * items, c'est-à-dire accepté à moitié.
 */
function itemsFrom(raw: unknown, known?: (id: string) => boolean): RecipeItem[] | undefined | false {
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw) || raw.length > 30) return false
  const out: RecipeItem[] = []
  for (const it of raw) {
    if (!it || typeof it !== 'object') return false
    const r = it as Record<string, unknown>
    const food = r.food ?? r.aliment ?? r.id
    const g = num(r.g ?? r.grammes ?? r.quantite, 2000)
    if (!isFoodId(food) || g === null || g <= 0) return false
    if (known && !known(food)) return false
    out.push({ food, g })
  }
  return out.length ? out : undefined
}

export function freeMealFrom(
  raw: Partial<Record<keyof FreeMeal, unknown>>,
  opts: FreeMealOpts = {},
): FreeMeal | null {
  const label = typeof raw.label === 'string' ? raw.label.trim().slice(0, 60) : ''
  if (!label) return null
  const kcal = num(raw.kcal, 5000)
  if (kcal === null || kcal < 1) return null
  const from = raw.from === 'catalogue' || raw.from === 'claude' ? raw.from : 'saisie'

  const items = itemsFrom(raw.items, opts.foodKnown)
  if (items === false) return null

  const base = isFoodId(raw.base) ? raw.base : undefined
  const steps = typeof raw.steps === 'string' && raw.steps.trim() ? raw.steps.trim().slice(0, 2000) : undefined

  return {
    label,
    kcal: Math.round(kcal),
    p: num(raw.p, 400) ?? 0,
    g: num(raw.g, 800) ?? 0,
    l: num(raw.l, 400) ?? 0,
    from,
    // Les champs facultatifs ne sont posés QUE s'ils existent. Écrire « items:
    // undefined » suffirait à faire grossir chaque repas déjà enregistré d'une clé
    // vide au premier réenregistrement, et à faire diverger la sauvegarde de son
    // miroir sans qu'aucune donnée n'ait changé.
    ...(base ? { base } : {}),
    ...(items ? { items } : {}),
    ...(steps ? { steps } : {}),
  }
}

/**
 * Ce que les ingrédients listés expliquent, comparé à ce qui a été saisi.
 *
 * Le calcul ne REMPLACE pas la saisie, et c'est délibéré. Les macros saisies restent
 * la source de vérité : elles couvrent le cas où l'on recopie une étiquette de
 * restaurant, et le cas — fréquent — où la composition est partielle parce qu'un
 * ingrédient n'a pas d'identifiant dans le catalogue. Un calcul qui prendrait la
 * main effacerait alors le gigot d'agneau du total.
 *
 * Ce que le calcul apporte, c'est un CONTRÔLE : quand les deux divergent nettement,
 * ou bien un grammage est faux, ou bien il manque un ingrédient. Les deux méritent
 * d'être vus avant validation, aucun ne mérite un refus.
 *
 * Rend `null` sans composition : il n'y a alors rien à confronter.
 */
export interface FreeMealCheck {
  /** Ce que les ingrédients listés donnent, d'après le catalogue. */
  calcule: Macros
  /** Ce qui a été saisi, et qui fait foi. */
  saisi: Macros
  /** Écart sur les calories, en pourcentage du saisi. Négatif = le calcul est en dessous. */
  ecartPct: number
  /** Au-delà de dix pour cent : à montrer, jamais à refuser. */
  notable: boolean
}

export const FREE_MEAL_TOLERANCE = 10

export function checkFreeMeal(meal: FreeMeal, foods: Record<string, Food>): FreeMealCheck | null {
  if (!meal.items?.length) return null
  const calcule = macrosOf(meal.items, foods)
  const saisi = { kcal: meal.kcal, p: meal.p, g: meal.g, l: meal.l }
  // Le repas ne peut pas avoir zéro calorie — `freeMealFrom` l'interdit — donc la
  // division est sûre. La garde reste, parce qu'une donnée relue d'un vieux miroir
  // n'a pas traversé `freeMealFrom`.
  const ecartPct = saisi.kcal > 0 ? ((calcule.kcal - saisi.kcal) / saisi.kcal) * 100 : 0
  return {
    calcule,
    saisi,
    ecartPct: Math.round(ecartPct),
    notable: Math.abs(ecartPct) > FREE_MEAL_TOLERANCE,
  }
}

const macrosOfFree = (m: FreeMeal): Macros => ({ kcal: m.kcal, p: m.p, g: m.g, l: m.l })

/**
 * Insère les repas du dehors dans une journée déjà construite.
 *
 * Deux cas, et le second compte autant que le premier :
 *
 *   • le créneau existe dans le plan → on le REMPLACE. Le repas garde sa place et son
 *     heure, parce que c'est bien à midi qu'on a mangé, quoi qu'on ait mangé ;
 *   • le créneau n'existe pas — jour sans menu, journée marquée absente, semaine
 *     vierge → on l'AJOUTE quand même. Sans ça, saisir son restaurant du samedi ne
 *     produirait rien du tout, et c'est précisément le jour où l'on en a besoin.
 *
 * Le total est recalculé, jamais rapiécé : additionner la différence laisserait les
 * arrondis diverger repas après repas.
 */
export function withFreeMeals(
  day: DayPlan,
  free: Record<string, FreeMeal>,
  slotInfo: (slot: string) => { time: string, label: string } | null,
): DayPlan {
  const ids = Object.keys(free)
  if (!ids.length) return day

  const meals: DayMeal[] = day.meals.map((m) => {
    const f = free[m.slot]
    return f ? { ...m, recipeId: '', name: f.label, steps: '', items: [], macros: macrosOfFree(f), free: true } : m
  })
  for (const slot of ids) {
    if (meals.some(m => m.slot === slot)) continue
    const info = slotInfo(slot)
    if (!info) continue
    meals.push({
      slot,
      time: info.time,
      label: info.label,
      recipeId: '',
      name: free[slot].label,
      steps: '',
      items: [],
      macros: macrosOfFree(free[slot]),
      free: true,
    })
  }
  // On retrie par heure : un créneau ajouté après coup arriverait sinon en fin de
  // journée, un dîner affiché après la collation du soir.
  meals.sort((a, b) => a.time.localeCompare(b.time, 'fr', { numeric: true }))

  const total = meals.reduce<Macros>((acc, m) => ({
    kcal: acc.kcal + m.macros.kcal,
    p: acc.p + m.macros.p,
    g: acc.g + m.macros.g,
    l: acc.l + m.macros.l,
  }), { kcal: 0, p: 0, g: 0, l: 0 })

  // Une journée marquée absente qui reçoit un repas ne l'est plus : on a mangé.
  return { ...day, meals, total, off: day.off && !ids.length }
}
