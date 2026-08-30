// ─────────────────────────────────────────────
// Variantes d'exercice : « je ne peux pas le faire ici, je fais quoi ? »
// ─────────────────────────────────────────────
//
// Le cas est le plus banal de la salle : le rack est pris, la machine est occupée,
// une épaule tire. On prend autre chose qui travaille les mêmes muscles — et le
// chiffre sur la pile ne veut plus dire la même chose.
//
// Jusqu'ici l'app n'en tirait qu'une conclusion : « à partir d'ici, plus rien n'est
// comparable ». La courbe se coupait, les records repartaient de zéro, la
// suggestion de charge oubliait tout. Autrement dit, le jour où l'on a le plus
// besoin d'un repère, on le perdait.
//
// Une variante déclare donc son RAPPORT à l'exercice de référence : combien on met
// sur cette machine-là pour le même effort. La charge saisie reste celle qu'on a
// réellement mise ; c'est la comparaison qui se fait en « équivalent référence ».
//
// ─── D'où viennent les coefficients ────────────────────────────────────────────
//
// Un coefficient par RAISON, pas un par machine. C'est la raison qui se défend —
// « il n'y a plus rien à stabiliser », « les hanches sont bloquées » — et le chiffre
// n'en est que la conséquence. Ils sont approximatifs et ASSUMÉS comme tels : ce
// sont des ordres de grandeur de pratique courante, pas des mesures.
//
// Ils ne servent qu'au démarrage. Dès qu'il existe assez de séances sur les deux
// mouvements, `measuredRatio` calcule le rapport réel sur les 1RM estimés et prend
// la main — cf. `ratioFor` dans composables/useWorkout.

export const RATIO = {
  /** Variante d'exécution : la charge reste comparable telle quelle. */
  SAME: 1,
  /** Haltères au lieu d'une barre : chaque côté porte le sien, rien ne compense. */
  DUMBBELL: 0.9,
  /** Trajectoire imposée (barre guidée, machine convergente) : plus rien à stabiliser. */
  GUIDED: 1.15,
  /** Squat sur rail (hack, V-Squat) : dos soutenu, buste tenu, gainage hors jeu. */
  MACHINE_LEG: 1.35,
  /** Presse : dos plaqué, hanches fixes, il ne reste que l'extension des jambes. */
  LEG_PRESS: 2.4,
  /** Un côté à la fois : un peu plus de la moitié du bilatéral, jamais la moitié pile. */
  UNILATERAL: 0.55,
  /** Mouvement raccourci ou bras de levier réduit (fentes bulgares, pointes assises). */
  SHORTER: 0.8,
} as const

/**
 * Famille de matériel. Elle sert à DESSINER la ligne : chaque famille a son
 * pictogramme, pour qu'on reconnaisse la machine avant même d'avoir lu son nom.
 *
 * Pourquoi un dessin par famille et non une photo par machine : une photo de
 * catalogue montre le modèle d'un fabricant, et la V-Squat de ta salle ne lui
 * ressemblera pas forcément — sans compter que ces photos ne sont pas libres de
 * droits. Le pictogramme dit la SILHOUETTE, ce qui suffit à repérer l'engin dans
 * l'allée ; la vraie photo, c'est celle que tu prends sur place, et elle remplace
 * le pictogramme dès qu'elle existe.
 */
export type Gear =
  | 'barre' | 'halteres' | 'guidee' | 'poulie'
  | 'rail' | 'presse' | 'convergente' | 'assise'
  | 'banc' | 'mollets' | 'corps'

export const GEAR_LABELS: Record<Gear, string> = {
  barre: 'Barre',
  halteres: 'Haltères',
  guidee: 'Barre guidée',
  poulie: 'Poulie',
  rail: 'Chariot incliné',
  presse: 'Presse',
  convergente: 'Machine à bras',
  assise: 'Machine assise',
  banc: 'Banc',
  mollets: 'Machine à mollets',
  corps: 'Poids du corps',
}

/** Le matériel du mouvement de référence, celui du programme. */
export const EXERCISE_GEAR: Record<string, Gear> = {
  'squat': 'barre',
  'sdt-r': 'barre',
  'fentes': 'halteres',
  'leg-curl': 'assise',
  'mollets': 'mollets',
  'releves': 'corps',
  'dc-barre': 'barre',
  'dev-halteres': 'halteres',
  'di-halteres': 'halteres',
  'dev-mil': 'halteres',
  'elev-lat': 'halteres',
  'ecartes': 'poulie',
  'tirage-v': 'poulie',
  'rowing-m': 'assise',
  'face-pull': 'poulie',
  'oiseau': 'halteres',
  'curl-marteau': 'halteres',
  'curl-21': 'barre',
  'crunch-cable': 'poulie',
  'lombaires': 'banc',
  'dips': 'corps',
  'tractions': 'corps',
  'ss-bras': 'poulie',
}

export interface Variant {
  /** Identifiant global : il est stocké dans l'historique, il ne doit jamais bouger. */
  id: string
  name: string
  /** Ce qu'il faut savoir pour la faire correctement, ou ce qu'elle change. */
  hint: string
  /** Charge sur cette variante ÷ charge de référence, à effort égal. */
  ratio: number
  /** Famille de matériel → pictogramme de la ligne. */
  gear: Gear
  /** Pourquoi ce coefficient. Affiché : un chiffre sans raison ne se conteste pas. */
  why: string
}

/**
 * Les variantes par exercice. L'exercice programmé est la RÉFÉRENCE (coefficient 1) ;
 * il n'apparaît pas dans la liste, la feuille de choix l'ajoute en tête.
 *
 * Les exercices au poids du corps (tractions, dips) n'y sont pas : la charge
 * enregistrée y est « poids de corps + lest », et la convertir vers une pile de
 * poids donnerait un rapport qui bouge avec la sèche.
 */
export const VARIANTS: Record<string, Variant[]> = {
  // ── Jambes ────────────────────────────────────────────────────────────────
  squat: [
    {
      id: 'squat-vsquat',
      name: 'V-Squat (squat guidé ~45°)',
      hint: 'Épaules sous les coussins, dos contre le dossier, pieds à plat sur la plaque. Descends jusqu\'à la cuisse parallèle, genoux dans l\'axe.',
      ratio: RATIO.MACHINE_LEG,
      gear: 'rail',
      why: 'Le dossier tient le buste : le gainage et l\'équilibre sortent de l\'équation, il ne reste que les jambes.',
    },
    {
      id: 'squat-hack',
      name: 'Hack squat',
      hint: 'Même idée que la V-Squat, dos plaqué au chariot. Pieds un peu hauts sur la plaque pour ménager les genoux.',
      ratio: RATIO.MACHINE_LEG,
      gear: 'rail',
      why: 'Même raison que la V-Squat : trajectoire imposée et dos soutenu.',
    },
    {
      id: 'squat-presse',
      name: 'Presse à cuisses inclinée',
      hint: 'Ne verrouille jamais les genoux en haut. Amplitude complète : les fessiers ne travaillent que si tu descends.',
      ratio: RATIO.LEG_PRESS,
      gear: 'presse',
      why: 'Hanches bloquées et dos plaqué : c\'est l\'exercice du programme le plus éloigné du squat, donc celui où le rapport est le plus grossier.',
    },
    {
      id: 'squat-smith',
      name: 'Squat à la barre guidée (Smith)',
      hint: 'Pieds légèrement avancés. Rien à stabiliser latéralement, donc concentre-toi sur la profondeur.',
      ratio: RATIO.GUIDED,
      gear: 'guidee',
      why: 'Même mouvement, mais la barre tient sa trajectoire toute seule.',
    },
  ],
  'sdt-r': [
    {
      id: 'sdtr-halteres',
      name: 'Soulevé de terre roumain haltères',
      hint: 'Haltères le long des cuisses, hanches en arrière, genoux quasi fixes. Amplitude souvent plus grande qu\'à la barre.',
      ratio: RATIO.DUMBBELL,
      gear: 'halteres',
      why: 'Deux charges indépendantes : chaque côté tient la sienne.',
    },
    {
      id: 'sdtr-smith',
      name: 'Soulevé roumain à la barre guidée',
      hint: 'Barre contre les cuisses tout du long. Recule légèrement les pieds pour retrouver l\'angle de hanche.',
      ratio: RATIO.GUIDED,
      gear: 'guidee',
      why: 'Trajectoire imposée : plus de barre à contrôler devant soi.',
    },
  ],
  fentes: [
    {
      id: 'fentes-bulgares',
      name: 'Fentes bulgares (pied arrière surélevé)',
      hint: 'Pied arrière sur un banc, buste légèrement penché pour le fessier, droit pour le quadriceps.',
      ratio: RATIO.SHORTER,
      gear: 'halteres',
      why: 'Une jambe porte presque tout, sur une amplitude plus courte que la fente marchée.',
    },
    {
      id: 'fentes-presse-uni',
      name: 'Presse à cuisses unilatérale',
      hint: 'Un pied au centre de la plaque, l\'autre au sol. Contrôle la descente, ne rebondis pas.',
      ratio: RATIO.LEG_PRESS * RATIO.UNILATERAL,
      gear: 'presse',
      why: 'Le rapport de la presse, appliqué à une seule jambe.',
    },
  ],
  'leg-curl': [
    {
      id: 'legcurl-assis',
      name: 'Leg curl assis',
      hint: 'Bassin bien calé, coussin juste au-dessus des genoux. Hanche fléchie : les ischios travaillent en position raccourcie.',
      ratio: RATIO.SAME,
      gear: 'assise',
      why: 'Même muscle, même geste : les deux machines se chargent pareil, à quelques kilos près.',
    },
    {
      id: 'legcurl-uni',
      name: 'Leg curl unilatéral',
      hint: 'Une jambe à la fois — utile si tu sens un déséquilibre entre les deux.',
      ratio: RATIO.UNILATERAL,
      gear: 'assise',
      why: 'Un côté à la fois.',
    },
  ],
  mollets: [
    {
      id: 'mollets-presse',
      name: 'Mollets à la presse',
      hint: 'Pointes sur le bord de la plaque, genoux presque tendus. Amplitude complète, pause en bas.',
      ratio: RATIO.LEG_PRESS,
      gear: 'presse',
      why: 'Le rapport de la presse : c\'est la même mécanique d\'appui.',
    },
    {
      id: 'mollets-assis',
      name: 'Mollets assis',
      hint: 'Genoux fléchis : ça déplace le travail sur le soléaire, sous le jumeau.',
      ratio: RATIO.SHORTER,
      gear: 'mollets',
      why: 'Genou plié, le jumeau perd son levier : on met forcément moins.',
    },
  ],
  releves: [
    {
      id: 'releves-banc',
      name: 'Relevés de jambes sur banc incliné',
      hint: 'Mains sous les fessiers ou aux poignées. Enroule le bassin en fin de mouvement.',
      ratio: RATIO.SAME,
      gear: 'banc',
      why: 'Même geste, appui différent — la charge notée reste le lest.',
    },
    {
      id: 'releves-crunch-machine',
      name: 'Machine à crunch (abdos)',
      hint: 'Enroule la colonne, ne tire pas avec les bras. Charge progressive.',
      ratio: RATIO.SAME,
      gear: 'assise',
      why: 'Charge lue sur une pile : sans repère commun, on part de l\'égalité et on laisse tes séances corriger.',
    },
  ],

  // ── Haut du corps : poussée ───────────────────────────────────────────────
  'dc-barre': [
    {
      id: 'dc-halteres',
      name: 'Développé couché haltères',
      hint: 'Amplitude plus grande qu\'à la barre. Note le poids TOTAL des deux haltères.',
      ratio: RATIO.DUMBBELL,
      gear: 'halteres',
      why: 'Chaque bras porte le sien, sans compensation possible.',
    },
    {
      id: 'dc-convergente',
      name: 'Machine convergente (développé)',
      hint: 'Poignées au niveau des mamelons, omoplates serrées contre le dossier.',
      ratio: RATIO.GUIDED,
      gear: 'convergente',
      why: 'Trajectoire imposée et dos soutenu : plus rien à stabiliser.',
    },
    {
      id: 'dc-smith',
      name: 'Développé à la barre guidée (Smith)',
      hint: 'Règle la hauteur des crochets avant de t\'allonger. Barre au niveau des mamelons.',
      ratio: RATIO.GUIDED,
      gear: 'guidee',
      why: 'Même mouvement, la barre tient sa ligne toute seule.',
    },
  ],
  'dev-halteres': [
    {
      id: 'devh-barre',
      name: 'Développé couché barre',
      hint: 'Omoplates serrées, pieds ancrés. Barre au niveau des mamelons, coudes ~45°.',
      ratio: 1 / RATIO.DUMBBELL,
      gear: 'barre',
      why: 'L\'inverse du rapport haltères → barre : la barre laisse les deux bras s\'entraider.',
    },
    {
      id: 'devh-convergente',
      name: 'Machine convergente (développé)',
      hint: 'Poignées au niveau des mamelons, dos plaqué.',
      ratio: RATIO.GUIDED / RATIO.DUMBBELL,
      gear: 'convergente',
      why: 'Machine guidée, rapportée à une référence aux haltères.',
    },
  ],
  'di-halteres': [
    {
      id: 'di-barre',
      name: 'Développé incliné barre',
      hint: 'Banc à 30° maximum. Barre en haut des pecs, pas sur la clavicule.',
      ratio: 1 / RATIO.DUMBBELL,
      gear: 'barre',
      why: 'La barre laisse les deux bras s\'entraider, contrairement aux haltères.',
    },
    {
      id: 'di-machine',
      name: 'Machine développé incliné',
      hint: 'Règle le siège pour que les poignées tombent en haut des pecs.',
      ratio: RATIO.GUIDED / RATIO.DUMBBELL,
      gear: 'convergente',
      why: 'Machine guidée, rapportée à une référence aux haltères.',
    },
  ],
  'dev-mil': [
    {
      id: 'devmil-machine',
      name: 'Machine développé épaules',
      hint: 'Dossier bien vertical, poignées à hauteur d\'oreilles au départ.',
      ratio: RATIO.GUIDED / RATIO.DUMBBELL,
      gear: 'convergente',
      why: 'Machine guidée, rapportée à une référence aux haltères.',
    },
    {
      id: 'devmil-barre',
      name: 'Développé militaire barre',
      hint: 'Debout ou assis dossier haut. Gainage serré, pas de cambrure lombaire.',
      ratio: 1 / RATIO.DUMBBELL,
      gear: 'barre',
      why: 'La barre laisse les deux bras s\'entraider.',
    },
  ],
  'elev-lat': [
    {
      id: 'elevlat-poulie',
      name: 'Élévations latérales à la poulie basse',
      hint: 'Un bras à la fois, câble qui passe devant le corps. Tension continue, y compris en bas.',
      ratio: RATIO.UNILATERAL,
      gear: 'poulie',
      why: 'Un côté à la fois — mais la tension continue de la poulie rend la série plus dure qu\'elle n\'en a l\'air.',
    },
    {
      id: 'elevlat-machine',
      name: 'Machine à élévations latérales',
      hint: 'Coudes contre les coussins, monte jusqu\'à l\'horizontale, pas plus.',
      ratio: RATIO.GUIDED,
      gear: 'assise',
      why: 'Trajectoire imposée : plus d\'élan possible, mais plus rien à tenir non plus.',
    },
  ],
  ecartes: [
    {
      id: 'ecartes-pecdeck',
      name: 'Pec deck (butterfly)',
      hint: 'Dos plaqué, coudes légèrement fléchis et fixes. Serre une seconde devant.',
      ratio: RATIO.GUIDED,
      gear: 'assise',
      why: 'Trajectoire imposée et dos soutenu.',
    },
    {
      id: 'ecartes-halteres',
      name: 'Écartés haltères',
      hint: 'Léger arrondi des coudes, fixe. Descends jusqu\'à l\'étirement, pas au-delà.',
      ratio: RATIO.DUMBBELL,
      gear: 'halteres',
      why: 'Deux charges indépendantes, et aucune tension en haut du mouvement.',
    },
  ],

  // ── Haut du corps : tirage ────────────────────────────────────────────────
  'tirage-v': [
    {
      id: 'tiragev-neutre',
      name: 'Tirage vertical prise neutre',
      hint: 'Poignées parallèles : moins d\'épaule, plus de dos épais.',
      ratio: RATIO.SAME,
      gear: 'poulie',
      why: 'Même machine, même pile : seule la prise change.',
    },
    {
      id: 'tiragev-convergente',
      name: 'Machine de tirage convergente',
      hint: 'Poitrine contre le support, tire les coudes vers le bas et l\'arrière.',
      ratio: RATIO.GUIDED,
      gear: 'convergente',
      why: 'Buste calé : plus rien à retenir avec le tronc.',
    },
  ],
  'rowing-m': [
    {
      id: 'rowing-barre',
      name: 'Rowing barre buste penché',
      hint: 'Dos plat, buste à ~45°. Tire vers le nombril, pas vers la poitrine.',
      ratio: RATIO.SHORTER,
      gear: 'barre',
      why: 'Sans appui poitrine, ce sont les lombaires qui limitent avant le dos.',
    },
    {
      id: 'rowing-poulie',
      name: 'Tirage horizontal à la poulie',
      hint: 'Assis, genoux légèrement fléchis. Ne recule pas le buste pour tricher.',
      ratio: RATIO.SAME,
      gear: 'poulie',
      why: 'Même geste, même ordre de charge.',
    },
    {
      id: 'rowing-haltere',
      name: 'Rowing haltère unilatéral',
      hint: 'Genou et main sur le banc, dos plat. Tire le coude vers la hanche.',
      ratio: RATIO.UNILATERAL * RATIO.DUMBBELL,
      gear: 'halteres',
      why: 'Un bras à la fois, avec un haltère.',
    },
  ],
  'face-pull': [
    {
      id: 'facepull-oiseau-poulie',
      name: 'Oiseau à la poulie haute (croisé)',
      hint: 'Bras tendus, écarte en serrant les omoplates. Léger et strict.',
      ratio: RATIO.SAME,
      gear: 'poulie',
      why: 'Même famille de mouvement sur la même pile.',
    },
    {
      id: 'facepull-pecdeck-inv',
      name: 'Pec deck inversé',
      hint: 'Poitrine contre le dossier, écarte jusqu\'à l\'alignement des épaules.',
      ratio: RATIO.GUIDED,
      gear: 'assise',
      why: 'Buste calé, trajectoire imposée.',
    },
  ],
  oiseau: [
    {
      id: 'oiseau-pecdeck-inv',
      name: 'Pec deck inversé',
      hint: 'Poitrine contre le dossier : impossible de tricher avec le dos.',
      ratio: RATIO.GUIDED / RATIO.DUMBBELL,
      gear: 'assise',
      why: 'Machine guidée, rapportée à une référence aux haltères.',
    },
    {
      id: 'oiseau-poulies',
      name: 'Oiseau aux poulies croisées',
      hint: 'Poulies hautes croisées devant, bras quasi tendus.',
      ratio: RATIO.SAME,
      gear: 'poulie',
      why: 'Tension continue au lieu d\'un pic en haut : on charge dans le même ordre.',
    },
  ],

  // ── Bras & tronc ──────────────────────────────────────────────────────────
  'curl-marteau': [
    {
      id: 'curlm-corde',
      name: 'Curl marteau à la corde (poulie basse)',
      hint: 'Prise neutre, coudes collés au corps, tension continue.',
      ratio: RATIO.SAME,
      gear: 'poulie',
      why: 'Même geste : la corde remplace les haltères sans changer le levier.',
    },
    {
      id: 'curlm-machine',
      name: 'Machine à curl',
      hint: 'Coudes bien calés sur le pupitre, amplitude complète.',
      ratio: RATIO.GUIDED / RATIO.DUMBBELL,
      gear: 'assise',
      why: 'Bras soutenus : plus rien à stabiliser à l\'épaule.',
    },
  ],
  'curl-21': [
    {
      id: 'curl21-poulie',
      name: 'Curl 21 à la poulie basse',
      hint: 'Même découpage 7 + 7 + 7, avec une tension qui ne retombe jamais.',
      ratio: RATIO.SAME,
      gear: 'poulie',
      why: 'Même charge affichée, même découpage.',
    },
    {
      id: 'curl21-halteres',
      name: 'Curl 21 haltères',
      hint: 'Un haltère par main, aucun élan. Note le poids total des deux.',
      ratio: RATIO.DUMBBELL,
      gear: 'halteres',
      why: 'Chaque bras porte le sien.',
    },
  ],
  'crunch-cable': [
    {
      id: 'crunch-machine',
      name: 'Machine à crunch',
      hint: 'Dos contre le dossier, enroule la colonne. Ne tire pas avec les bras.',
      ratio: RATIO.GUIDED,
      gear: 'assise',
      why: 'Buste calé et trajectoire imposée.',
    },
    {
      id: 'crunch-releves',
      name: 'Relevés de jambes suspendu',
      hint: 'Enroule le bassin, pas juste les jambes. Lest aux chevilles quand c\'est facile.',
      ratio: RATIO.SAME,
      gear: 'corps',
      why: 'Charge = lest seul : aucun repère commun avec une pile, on part de l\'égalité et tes séances corrigent.',
    },
  ],
  lombaires: [
    {
      id: 'lombaires-machine',
      name: 'Machine à extensions lombaires',
      hint: 'Dos neutre, remonte jusqu\'à l\'alignement sans cambrer à l\'excès.',
      ratio: RATIO.GUIDED,
      gear: 'assise',
      why: 'Bassin bloqué par la machine, charge lue sur une pile.',
    },
    {
      id: 'lombaires-goodmorning',
      name: 'Good morning',
      hint: 'Barre sur les trapèzes, hanches en arrière, genoux souples. Charge légère.',
      ratio: RATIO.SHORTER,
      gear: 'barre',
      why: 'Le levier est bien plus long qu\'au banc : on met beaucoup moins.',
    },
  ],
}

/** Les variantes proposées pour un exercice (liste vide s\'il n\'en a pas). */
export const variantsOf = (exId: string): Variant[] => VARIANTS[exId] ?? []

/** Une variante par son identifiant, dans un exercice donné. */
export function variantOf(exId: string, variantId: string | undefined | null): Variant | null {
  if (!variantId) return null
  return variantsOf(exId).find(v => v.id === variantId) ?? null
}

/**
 * Le coefficient CATALOGUE d'une variante. `null` (référence) vaut 1.
 *
 * Une variante inconnue — supprimée du catalogue après avoir été enregistrée —
 * rend 1 plutôt que rien : mieux vaut une charge non convertie qu'un trou dans
 * l'historique.
 */
export function defaultRatio(exId: string, variantId: string | undefined | null): number {
  return variantOf(exId, variantId)?.ratio ?? 1
}

/** Le matériel d'une ligne : celui de la variante, ou celui du mouvement de référence. */
export function gearFor(exId: string, variantId: string | undefined | null): Gear {
  return variantOf(exId, variantId)?.gear ?? EXERCISE_GEAR[exId] ?? 'barre'
}

/** Le nom affichable d'une variante, référence comprise. */
export function variantName(exId: string, variantId: string | undefined | null, refName: string): string {
  return variantOf(exId, variantId)?.name ?? refName
}
