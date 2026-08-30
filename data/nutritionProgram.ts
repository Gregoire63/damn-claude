// Données du plan nutrition : table des aliments, recettes et cycle de 14 jours.
// Générées à partir du plan calculé (valeurs Ciqual/USDA arrondies, ±5 % d'incertitude —
// sans importance tant que l'ajustement se fait sur la balance et pas sur le tableur).
// Les grammages ci-dessous sont ceux d'un JOUR AVEC SÉANCE : la modulation des féculents
// pour les jours sans séance est calculée dans lib/nutritionStats.ts, jamais stockée.

export type MicroKey = 'fib' | 'ca' | 'fe' | 'mg' | 'zn' | 'k' | 'vc' | 'vd' | 'o3' | 'b9'

export type FoodCat = 'viandes' | 'oeufs' | 'laitiers' | 'complements' | 'feculents' | 'legumes' | 'fruits' | 'grasses' | 'aromates'

// Valeurs pour 100 g. Viandes, poissons et féculents : TOUJOURS pesés crus.
export interface Food {
  id: string
  name: string
  cat: FoodCat
  kcal: number
  p: number // protéines (g)
  g: number // glucides (g)
  l: number // lipides (g)
  buy?: string // repère d'achat / de pesée affiché dans la liste de courses
  custom?: boolean // ajouté par l'utilisateur depuis l'emballage
  micro?: Partial<Record<MicroKey, number>> // micronutriments pour 100 g (voir MICRO_REFS)
  /**
   * Jours de conservation au réfrigérateur UNE FOIS CUISINÉ, à 4 °C.
   *
   * C'est ce qui décide si un plat peut être préparé le dimanche pour toute la
   * semaine ou s'il faut le refaire en milieu de semaine. Sans ce chiffre, « je
   * cuisine tout dimanche » revient à manger du poulet de six jours le samedi.
   * Absent = KEEPS_DEFAULT, le cas des féculents et des légumes cuits.
   */
  keeps?: number
  /**
   * Comment le cuire, en une phrase — temps et méthode.
   *
   * C'est ce qui transforme la session de préparation en vraie recette : « riz
   * basmati 240 g » ne dit pas quoi en faire, « 11 min à l'eau bouillante salée »
   * si. Absent = rien à cuire (fruits, poudres, pain).
   */
  cook?: string
  /**
   * Se congèle mal une fois cuisiné. Sert à savoir si une boîte peut partir au
   * congélateur le jour de la préparation plutôt que d'imposer une deuxième session
   * en milieu de semaine. Absent = se congèle sans problème.
   */
  noFreeze?: boolean
}

/** Conservation par défaut d'un aliment cuisiné, en jours au frigo. */
export const KEEPS_DEFAULT = 4

/**
 * Au-dessous de ce seuil, un aliment ne se prépare JAMAIS à l'avance : il s'ajoute
 * au moment de manger. Il ne condamne pas le plat pour autant — une salade verte
 * dans une assiette de poulet-lentilles ne doit pas empêcher de cuire le poulet et
 * les lentilles le dimanche.
 */
export const KEEPS_FRESH = 1

export const CAT_LABELS: Record<FoodCat, string> = {
  viandes: 'Viandes / poissons',
  oeufs: 'Œufs',
  laitiers: 'Produits laitiers',
  complements: 'Compléments',
  feculents: 'Féculents',
  legumes: 'Légumes',
  fruits: 'Fruits',
  grasses: 'Matières grasses',
  aromates: 'Épices, herbes et condiments',
}
// Ordre d'affichage de la liste de courses : calqué sur le parcours en magasin.
export const CAT_ORDER: FoodCat[] = ['viandes', 'oeufs', 'laitiers', 'complements', 'feculents', 'legumes', 'fruits', 'grasses', 'aromates']

/**
 * Le catalogue livré est VIDE, et c'est délibéré.
 *
 * Il portait cent cinquante-deux aliments pesés pour une personne. Sur une
 * installation neuve, la liste de courses parlait donc de ses marques, de ses
 * quantités et de ses habitudes — et il fallait tout retirer avant de commencer.
 *
 * L'ancien catalogue est devenu l'exemple qu'on importe si on le veut :
 * `data/exemple/nutrition.ts` → `public/exemple.json`.
 *
 * Le tableau reste exporté parce que toute la chaîne part de lui :
 * `mergeFoods(userFoods, patches)` empile le personnel sur le livré. Vide, il rend
 * exactement le catalogue personnel — même code, aucun cas particulier.
 */
export const FOODS: Food[] = []

export const FOOD_BY_ID: Record<string, Food> = Object.fromEntries(FOODS.map(f => [f.id, f]))

export type RecipeKind = 'pdj' | 'boite' | 'diner' | 'collation' | 'sauce'

export interface RecipeItem { food: string, g: number }
export interface Recipe {
  id: string
  name: string
  kind: RecipeKind
  batch: boolean // préparable à l'avance en session de batch cooking
  steps: string
  items: RecipeItem[]
  custom?: boolean // créée par l'utilisateur, pas livrée avec le plan
  disabled?: boolean // mise de côté : consultable, mais ne tombe plus dans le planning
  /**
   * Sauce servie avec ce plat. Ses ingrédients entrent dans les macros et dans les
   * courses, mais PAS dans la boîte : elle se prépare à part, dans un petit pot, et
   * s'ajoute au moment de manger.
   *
   * C'est ce qui la rend possible. Mélangée à la préparation, une sauce blanche
   * tranche au réchauffage et une vinaigrette détrempe tout ; à côté, elle tient
   * cinq jours et sauve un plat qu'on a déjà mangé trois fois.
   */
  sauce?: string
  /**
   * Conservation du plat PRÉPARÉ, quand elle ne se déduit pas des ingrédients.
   *
   * Des flocons d'avoine tiennent des mois et du fromage blanc cinq jours ; mélangés
   * dans un bocal depuis la veille, l'ensemble tient trois jours. C'est la
   * préparation qui limite, pas un ingrédient — d'où cette valeur, qui l'emporte sur
   * le calcul quand elle est renseignée.
   */
  keeps?: number
}

/** Vide pour la même raison que `FOODS` — voir plus haut. Les recettes se créent
 *  dans l'application ou par le connecteur, et l'ancien livre de recettes est dans
 *  `data/exemple/nutrition.ts`. */
export const RECIPES: Recipe[] = []

export const RECIPE_BY_ID: Record<string, Recipe> = Object.fromEntries(RECIPES.map(r => [r.id, r]))

// Féculents dont la portion se module selon que la séance a eu lieu ou non.
// Protéines, légumes et matières grasses ne bougent JAMAIS : c'est ce qui protège
// la masse maigre en déficit et garde la satiété constante.
export const STARCHY_IDS: string[] = [
  'lentilles-vertes',
  'pain-complet',
  'patate-douce',
  'pates-completes',
  'pommes-de-terre',
  'riz-basmati',
]

// Jour sans séance : féculents du midi ET du soir réduits de moitié.
//
// La coupe est plus franche qu'avant (elle était de 30 %) pour une raison précise :
// depuis que les plats portent leur vraie dose de lipides, l'huile et les oléagineux
// pèsent dans l'assiette et ne sont PAS touchés par ce ratio — il ne s'applique qu'aux
// féculents. À 30 %, les jours sans séance dépassaient leur cible de 120 kcal.
export const RATIO_REST = 0.48
// Jour AVEC séance : la boîte d'après-séance porte 60 % de féculents en plus, et le
// dîner n'est plus réduit du tout.
//
// Avant, c'était l'inverse : le déjeuner servait la recette telle quelle et le dîner
// était coupé de 27 %. Résultat mesuré sur les quatorze jours du cycle, cible calculée
// comme l'app la calcule (dayEnergy) : les jours de séance tombaient 80 à 190 kcal SOUS
// leur cible pendant que les jours de repos collaient à la leur. La moyenne du cycle
// était bonne — +11 kcal — et masquait une répartition fausse. Le déficit tombait donc
// les jours où il fallait manger : début de séance lourd, sprint écourté, séries en
// échec.
//
// Le levier est au déjeuner et pas ailleurs pour une raison simple : c'est le repas
// qui suit la séance de vingt minutes. Les glucides y sont mieux placés qu'à 20 h 30,
// et c'est le seul repas de la journée dont la portion peut vraiment bouger — 40 g de
// riz sec deviennent 65, 175 g de pommes de terre deviennent 280.
//
// Ce sens de variation arrange aussi la préparation à l'avance (voir PREP_ON_HIGH_SIDE) :
// on cuisine toujours la version « jour avec séance ». On peut laisser du riz dans une
// boîte, on ne peut pas y ajouter celui qu'on n'a pas cuit.
//
// 1.6 n'est pas un chiffre rond choisi à vue : c'est la valeur qui ramène l'écart moyen
// à +7 kcal les jours de séance et -8 les jours de repos. Trois tests la gardent, dont
// un qui mesure les deux types de jours SÉPARÉMENT — c'est ce qui manquait.
export const RATIO_LUNCH_GYM = 1.6

export interface DayTemplate { lunch: string, dinner: string }
/**
 * Le cycle livré est VIDE — plus de menu imposé.
 *
 * C'était l'enchaînement de quatorze jours d'une personne, jusque dans l'ordre des
 * dîners. Il servait de menu par défaut à qui n'avait rien planifié, ce qui revenait
 * à afficher les courses de quelqu'un d'autre le premier jour.
 *
 * Vide, `buildDay` ne trouve simplement aucune recette pour les créneaux « lunch »
 * et « dinner » et les saute : la journée montre les créneaux fixes, et rien tant
 * qu'une semaine n'a pas été choisie. `builtinWeeks()` rend `[]` plutôt que deux
 * semaines fabriquées à partir de rien.
 */
export const CYCLE: DayTemplate[] = []
export const CYCLE_LENGTH = CYCLE.length

export interface Slot {
  id: string
  time: string
  label: string
  recipe?: string // recette fixe (collations) ; sinon fournie par le CYCLE
  from?: 'lunch' | 'dinner'
  ratio?: 'rest' | 'lunchGym' // modulation à appliquer aux féculents
}

// Journée AVEC séance entre midi et deux, calée sur le déroulé réel :
//
//   12 h 00 - 12 h 25   départ du bureau (l'heure varie)
//   ~12 h 25 - 13 h 20  séance
//   13 h 30 - 13 h 50   retour au bureau, la boîte se mange dans la foulée
//
// Petit-déjeuner à 9 h, en arrivant au bureau.
//
// Il était à 10 h, ce qui ne laissait que 2 h 25 avant la séance. Trop court : le
// petit-déjeuner pèse 412 g et porte 15 g de fibres, et fibres comme lipides
// ralentissent la vidange gastrique — c'est leur qualité le reste du temps, c'est
// exactement ce qu'il ne faut pas avant un effort. Résultat, des débuts de séance
// lourds et un sprint écourté pour ne pas être malade en reprenant le travail.
//
// 9 h donne 3 h 25, ce qui est l'écart normalement demandé pour un repas complet.
// Et pas plus tôt : lever à 8 h, manger un quart d'heure après le réveil, c'est
// remplacer un problème de digestion par un problème d'appétit.
//
// La banane reste à 11 h 45, soit 15 min avant le départ le plus tôt : elle est là
// pour le sucre disponible pendant l'effort, donc elle doit rester proche de la
// séance sans être avalée sur le pas de la porte.
//
// Elle ne pose pas le problème du petit-déjeuner : 120 g, 3 g de fibres, aucun
// lipide. C'est le VOLUME cumulé qui gênait — 532 g dans l'estomac au départ, dont
// la moitié avalée quarante minutes plus tôt. Le petit-déjeuner reculé d'une heure,
// elle arrive sur un estomac qui a fini son travail.
//
// PAS de shaker d'après-séance. Il était calé à 13 h 20 — une heure où tu es au
// vestiaire ou dans la rue — puis suivi 25 minutes plus tard d'un déjeuner à 45 g de
// protéines. Deux prises saturées collées l'une à l'autre, et un objet de plus à
// transporter : c'est celui qui se faisait oublier. Sa whey est passée sur
// la collation de 17 h, la seule prise de la journée qui était sous le seuil utile
// (0,4 g/kg ≈ 38 g). Le total calorique et protéique de la journée est INCHANGÉ,
// c'est la même whey déplacée de quatre heures.
export const SLOTS_GYM: Slot[] = [
  { id: 'pdj', time: '9 h', label: 'Petit-déjeuner', recipe: 'pdj-croquant' },
  { id: 'creatine', time: '9 h 05', label: 'Créatine (dans le petit-déjeuner)', recipe: 'creatine' },
  { id: 'pre', time: '11 h 45', label: 'Banane (avant la séance)', recipe: 'col-pre' },
  { id: 'lunch', time: '13 h 45', label: 'Déjeuner (boîte, au retour de la salle)', from: 'lunch', ratio: 'lunchGym' },
  { id: 'snack', time: '17 h', label: 'Collation + shaker', recipe: 'col-aprem-salle' },
  { id: 'dinner', time: '20 h 30', label: 'Dîner', from: 'dinner' },
  { id: 'night', time: '22 h 30', label: 'Avant de dormir', recipe: 'col-soir-salle' },
]

// Journée SANS séance : pas de banane, pas de whey dans la collation de l'après-midi
// (c'est `col-aprem-repos`, avec une pomme à la place), féculents réduits sur les deux
// repas.
//
// **Déjeuner à 12 h 30**, et non plus à 13 h 45.
//
// Le plan gardait le même horaire les deux types de jours, en se disant qu'un créneau
// stable évite d'avoir faim à contretemps le lendemain d'un changement. L'argument se
// tenait sur le papier ; dans les faits, 13 h 45 n'est pas un choix mais une
// CONSÉQUENCE — celle d'une séance entre midi et deux, d'un retour au bureau vers
// 13 h 30-50 et d'une boîte mangée dans la foulée. Sans séance, cette contrainte
// n'existe pas, et l'heure devenait juste une heure tardive imposée sans raison.
//
// Le déclencheur est le bon : Grégoire mangeait plus tôt les jours sans salle, quoi
// qu'affiche l'app. Un plan que la réalité contredit tous les mercredis n'est pas un
// plan stable, c'est un plan faux — et il finit par décrédibiliser les créneaux qui,
// eux, comptent vraiment (la banane avant l'effort, le shaker de 17 h).
//
// Les écarts d'un jour de repos deviennent 3 h 30 / 4 h 30 / 3 h 30 / 2 h. Le trou du
// milieu est le plus long de la journée, mais il tombe l'après-midi et la collation de
// 17 h le coupe bien. Rien d'autre ne bouge.
export const SLOTS_REST: Slot[] = [
  { id: 'pdj', time: '9 h', label: 'Petit-déjeuner', recipe: 'pdj-croquant' },
  { id: 'creatine', time: '9 h 05', label: 'Créatine (dans le petit-déjeuner)', recipe: 'creatine' },
  { id: 'lunch', time: '12 h 30', label: 'Déjeuner (boîte)', from: 'lunch', ratio: 'rest' },
  { id: 'snack', time: '17 h', label: 'Collation', recipe: 'col-aprem-repos' },
  { id: 'dinner', time: '20 h 30', label: 'Dîner', from: 'dinner', ratio: 'rest' },
  { id: 'night', time: '22 h 30', label: 'Avant de dormir', recipe: 'col-soir-repos' },
]

// Les sessions de cuisine ne sont plus une liste écrite à la main : elles sont
// CALCULÉES d'après la semaine choisie et la conservation de chaque plat (voir
// `cookPlan` dans lib/nutritionStats.ts). Deux textes figés ne pouvaient pas dire
// ce qu'il faut cuisiner quand la semaine change — et c'est précisément ce qui
// change toutes les semaines.


// Références nutritionnelles pour un homme adulte (ANSES 2016-2021 / VNR européennes).
// Ce sont des repères de population, pas des cibles individuelles : seule une prise de
// sang dit où on en est vraiment.
export const MICRO_REFS: Record<MicroKey, { label: string, unit: string, ref: number }> = {
  fib: { label: 'Fibres', unit: 'g', ref: 30 },
  ca: { label: 'Calcium', unit: 'mg', ref: 950 },
  fe: { label: 'Fer', unit: 'mg', ref: 11 },
  mg: { label: 'Magnésium', unit: 'mg', ref: 380 },
  zn: { label: 'Zinc', unit: 'mg', ref: 11 },
  k: { label: 'Potassium', unit: 'mg', ref: 3500 },
  vc: { label: 'Vitamine C', unit: 'mg', ref: 110 },
  vd: { label: 'Vitamine D', unit: 'µg', ref: 15 },
  o3: { label: 'Oméga-3 EPA+DHA', unit: 'mg', ref: 500 },
  b9: { label: 'Folates (B9)', unit: 'µg', ref: 330 },
}

// La vitamine C des légumes est dégradée d'environ 35 % à la cuisson.
export const COOK_C_LOSS = 0.65

export interface Supplement {
  id: string
  name: string
  dose: string
  when: string
  why: string
  caution?: string
}

// Compléments retenus : uniquement ceux que le plan ne peut pas couvrir par l'assiette,
// plus la créatine qui est un choix de performance, pas une correction de carence.
export const SUPPLEMENTS: Supplement[] = [
  {
    id: 'creatine',
    name: 'Créatine monohydrate',
    dose: '5 g par jour',
    when: 'Dans le shaker d\'après-séance les jours de salle, dans le porridge les autres jours',
    why: 'Le complément le plus documenté en musculation : elle augmente la force et le volume de travail, et en déficit calorique elle aide à limiter la perte de masse maigre. Le monohydrate suffit — les formes « avancées » coûtent plus cher sans faire mieux.',
    caution: 'Pas de phase de charge nécessaire : 5 g par jour saturent le muscle en 3 à 4 semaines, jours de repos compris. Attends-toi à +1 à 2 kg sur la balance les premières semaines — c\'est de l\'eau intramusculaire, pas du gras. Raison de plus pour ne juger la tendance que sur des moyennes sur 7 jours.',
  },
  {
    id: 'vitd',
    name: 'Vitamine D3',
    dose: '1 000 à 2 000 UI par jour (25 à 50 µg)',
    when: 'Au repas le plus gras de la journée — c\'est une vitamine liposoluble',
    why: 'C\'est le seul nutriment que ce plan ne couvre pas : environ 4 µg par jour pour une référence de 15 µg. Aucun aménagement réaliste de l\'assiette ne comble l\'écart, et sous nos latitudes le soleil ne suffit pas d\'octobre à avril.',
    caution: 'Fais doser ta 25(OH)D par une prise de sang avant de fixer la dose : c\'est le seul moyen de savoir d\'où tu pars. La vitamine D se stocke, donc les très fortes doses ponctuelles ne sont pas anodines — le sujet se tranche avec un médecin, pas avec un tableur.',
  },
]
