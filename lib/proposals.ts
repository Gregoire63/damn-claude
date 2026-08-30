// Import relatif et non par alias : ce module est testé dans le projet « unit »,
// qui tourne en Node pur sans la résolution de chemins de Nuxt.
import { boundedValue, getAt, isScalar } from './pointer'
import { freeMealFrom } from './freeMeal'
import type { ExercisePatch, VariantSpec } from './program'
import { restFor } from './rest'
import type { Exercise, Session } from '../data/sportProgram'
import type { FreeMeal } from './freeMeal'
import type { Scalar } from './pointer'

// ─────────────────────────────────────────────────────────────────────────────
// Ce qu'une proposition venue du connecteur a le droit de changer.
// ─────────────────────────────────────────────────────────────────────────────
//
// Le connecteur ne modifie rien : il dépose une phrase et un détail. Reste à
// décider ce que l'application accepte d'appliquer TOUTE SEULE, d'un tap.
//
// Le choix retenu est étroit, et c'est volontaire. Deux gestes sont applicables
// automatiquement — changer le plat d'un créneau, changer la séance prévue un jour
// donné — parce qu'ils ont une forme fermée, vérifiable, et un effet réversible en
// un geste. Tout le reste s'affiche mais ne s'applique pas : mieux vaut lire « à
// faire à la main » que voir une série réécrite par une interprétation approximative
// d'une phrase.
//
// La validation est ici, pure et testable, plutôt que dans le composable : c'est la
// frontière entre du texte venu de l'extérieur et les données de l'utilisateur.

export interface RawProposal {
  id: string
  at: string
  action: string
  summary: string
  patch: Record<string, unknown>
  status: 'pending' | 'applied' | 'refused'
  resolvedAt?: string
}

export type Plan =
  | { kind: 'plat', date: string, slot: string, recipeId: string | null }
  | { kind: 'seance', date: string, sessionId: string | null }
  | { kind: 'semaine', lundi: string, nom: string, jours: MenuDaySpec[] }
  | { kind: 'recette', id: string | null, recette: RecipeSpec }
  | { kind: 'semaine-type', seances?: (string | null)[], salle?: boolean[], teletravail?: boolean[] }
  | { kind: 'correction-serie', exercice: string, date: string, index: number, vers: { w: number, r: number } }
  | { kind: 'correction-pesee', date: string, vers: number | null }
  | {
    kind: 'correction-champ'
    chemin: string
    /** Quatre gestes. `remplacer` était le seul, et c'est ce qui laissait une
     *  cinquantaine d'actions hors de portée d'une conversation. */
    op: 'remplacer' | 'creer' | 'ajouter' | 'supprimer'
    /** Absent sur `supprimer`. Composé autorisé sur `creer` et `ajouter`. */
    vers?: unknown
  }
  | { kind: 'repas-libre', date: string, slot: string, repas: FreeMeal | null }
  | { kind: 'aliment', id: string | null, aliment: FoodSpec }
  | {
    kind: 'programme'
    seance: string
    /** Cinq gestes, et cinq seulement. Un « autre » ouvrirait la porte à des
     *  interprétations, et une interprétation qui écrit est une donnée perdue. */
    op: 'ajouter' | 'modifier' | 'retirer' | 'reactiver' | 'reordonner' | 'creer-seance'
    exercice: string | null
    /** La séance entière, pour `creer-seance`. */
    seanceNeuve?: Session
    patch?: ExercisePatch
    nouveau?: Exercise
    /** La liste COMPLÈTE des actifs, dans l'ordre voulu. */
    ordre?: string[]
    /** Insérer juste après cet exercice. Absent = en fin de séance (ajout) ou à la
     *  place d'origine (réactivation). */
    apres?: string
    /** Machines de remplacement, qui REMPLACENT la liste. */
    variants?: VariantSpec[]
  }

/** Un ingrédient, tel qu'une proposition a le droit de le décrire. Valeurs pour 100 g. */
export interface FoodSpec {
  name: string
  cat: string
  kcal: number
  p: number
  g: number
  l: number
  /** Ce qu'on en fait à la cuisson — c'est ce qui transforme une liste de courses
   *  en marche à suivre. Absent = rien à cuire. */
  cook?: string
  /** Repère d'achat ou de pesée : « 1 c. à café = 5 g ». */
  buy?: string
  keeps?: number
}

export interface RecipeSpec {
  name: string
  kind: 'pdj' | 'boite' | 'diner' | 'collation' | 'sauce'
  batch: boolean
  steps: string
  items: { food: string, g: number }[]
  /** Pot servi avec le plat. Ses ingrédients comptent dans les macros et les courses. */
  sauce?: string
  /** Jours de conservation au frigo. C'est ce qui décide dans QUELLE session de
   *  cuisine le plat tombe : un plat qui tient trois jours ne se cuisine pas le
   *  dimanche pour le vendredi. */
  keeps?: number
}

/**
 * Ce que le validateur doit savoir du monde réel pour trancher.
 *
 * Passer un contexte plutôt qu'une suite de prédicats n'est pas de la cosmétique :
 * les corrections ont besoin de LIRE la valeur en place pour vérifier qu'elle est
 * bien celle qu'on croit remplacer. Sans cette lecture, « corriger » redeviendrait
 * « écrire par-dessus ».
 */
export interface PlanCtx {
  recipeKnown?: (id: string) => boolean
  foodKnown?: (id: string) => boolean
  /** Les séances du programme EFFECTIF — celui qui inclut déjà les modifications. */
  sessionKnown?: (id: string) => boolean
  /** Un exercice du programme effectif, retirés compris : c'est ce qui permet de
   *  réactiver un mouvement qu'on avait mis de côté. */
  exerciseKnown?: (id: string) => boolean
  /** Les exercices ACTIFS d'une séance, DANS L'ORDRE, pour valider un réordonnancement. */
  exercisesOf?: (sessionId: string) => string[]
  /**
   * Où vit cet exercice et dans quel état — l'accesseur qui rend les refus utiles.
   *
   * Trois questions y répondent d'un coup, et aucune ne se déduit des prédicats
   * booléens : dans QUELLE séance un identifiant est déjà pris (pour le dire), s'il
   * est actif ou retiré (pour refuser un geste sans effet), et ses valeurs ACTUELLES
   * (pour confronter les « de_… »). Sans cette dernière, « corriger » redeviendrait
   * « écrire par-dessus ».
   */
  exerciseAt?: (id: string) => { seance: string, seanceNom: string, actif: boolean, ex: Exercise } | null
  setAt?: (exId: string, date: string, index: number) => { w: number, r: number } | null
  weightAt?: (date: string) => number | null
  /** L'instantané complet de la sauvegarde, pour vérifier un champ quelconque. */
  snapshot?: () => Record<string, unknown>
}

/** Un jour de menu proposé. Les créneaux absents gardent ce que la semaine prévoyait. */
export interface MenuDaySpec { off: boolean, slots: Record<string, string> }

/** Créneaux connus : une proposition qui vise autre chose ne s'applique pas. */
export const SLOTS = ['pdj', 'creatine', 'pre', 'lunch', 'snack', 'dinner', 'night'] as const

const isIsoDate = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)

/**
 * Le premier alias PRÉSENT, et non le premier non-nul.
 *
 * `??` aurait été le réflexe, et il aurait été faux : ici `null` est une valeur
 * qui veut dire quelque chose — « reviens au plat prévu », « ce jour-là, repos ».
 * L'enchaîner avec `??` la traite comme une absence et fait tomber la proposition
 * en « non applicable » alors qu'elle est parfaitement claire.
 */
function pick(d: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (k in d) return d[k]
  return undefined
}
const isId = (v: unknown): v is string => typeof v === 'string' && /^[\w-]{1,64}$/.test(v)

/** Lundi, et lundi seulement : une semaine s'applique à partir d'un début de semaine. */
export function isMonday(iso: string): boolean {
  return isIsoDate(iso) && (new Date(`${iso}T00:00:00`).getDay() + 6) % 7 === 0
}

/**
 * Une semaine de menus proposée, ou `null`.
 *
 * C'est la proposition la plus lourde — quatorze repas d'un coup — donc celle qui
 * mérite la validation la plus stricte. Trois choses sont vérifiées, et chacune
 * ferme une façon de se tromper :
 *
 *  • sept jours, ni six ni huit, lundi en premier — sinon les jours glissent et
 *    l'on découvre le décalage en cuisinant ;
 *  • des créneaux connus, parce qu'un « brunch » inventé s'écrirait dans le menu
 *    sans jamais s'afficher nulle part ;
 *  • des identifiants de plats qui EXISTENT vraiment. C'est le vrai risque d'une
 *    semaine écrite de mémoire : un plat plausible mais inconnu, qui donne un
 *    créneau vide le jour venu. `connu` vient de la bibliothèque réelle.
 */
export function weekFor(p: RawProposal, connu: (id: string) => boolean): Extract<Plan, { kind: 'semaine' }> | null {
  if (p.action !== 'semaine') return null
  const d = p.patch ?? {}
  const lundi = pick(d, ['lundi', 'monday', 'date'])
  const jours = pick(d, ['jours', 'days'])
  if (typeof lundi !== 'string' || !isMonday(lundi)) return null
  if (!Array.isArray(jours) || jours.length !== 7) return null

  const out: MenuDaySpec[] = []
  for (const j of jours) {
    if (!j || typeof j !== 'object') return null
    const raw = j as Record<string, unknown>
    const slots: Record<string, string> = {}
    for (const [k, v] of Object.entries(raw)) {
      if (k === 'off') continue
      if (!(SLOTS as readonly string[]).includes(k)) return null
      if (typeof v !== 'string' || !isId(v) || !connu(v)) return null
      slots[k] = v
    }
    const off = raw.off === true
    // Un jour ni absent ni rempli ne veut rien dire : c'est une ligne oubliée.
    if (!off && !Object.keys(slots).length) return null
    out.push({ off, slots })
  }
  const nom = typeof d.nom === 'string' && d.nom.trim() ? d.nom.trim().slice(0, 60) : `Semaine du ${lundi}`
  return { kind: 'semaine', lundi, nom, jours: out }
}

/**
 * Le geste applicable derrière une proposition, ou `null`.
 *
 * `null` n'est pas un échec : c'est la réponse honnête pour tout ce qui n'entre pas
 * dans les deux formes fermées. L'application l'affiche alors comme une suggestion
 * à faire soi-même.
 */
export function planFor(p: RawProposal, ctx: PlanCtx = {}): Plan | null {
  const d = p.patch ?? {}
  if (p.action === 'semaine') return weekFor(p, ctx.recipeKnown ?? (() => true))
  if (p.action === 'recette') return recipeFor(p, ctx)
  if (p.action === 'aliment') return foodFor(p, ctx)
  if (p.action === 'semaine-type') return weekTemplateFor(p, ctx)
  if (p.action === 'correction') return fixFor(p, ctx)
  if (p.action === 'programme') return programFor(p, ctx)
  if (p.action === 'plat') {
    const date = pick(d, ['date', 'jour'])
    const slot = pick(d, ['slot', 'creneau'])
    const vers = pick(d, ['vers', 'recipeId', 'plat'])
    if (!isIsoDate(date) || typeof slot !== 'string') return null
    if (!(SLOTS as readonly string[]).includes(slot)) return null
    // `null` explicite = revenir au plat prévu, ce qui est un geste légitime.
    if (vers === null) return { kind: 'plat', date, slot, recipeId: null }
    if (!isId(vers)) return null
    return { kind: 'plat', date, slot, recipeId: vers }
  }
  /**
   * Le repas du dehors proposé depuis une conversation.
   *
   * C'est la seule forme où Claude apporte des CHIFFRES qu'il a estimés lui-même,
   * et non un identifiant piochéans un catalogue. Deux garde-fous en découlent :
   * la mise en forme passe par `freeMealFrom`, la même que la saisie à la main —
   * mêmes bornes, mêmes refus — et la provenance est marquée `claude`, pour qu'on
   * puisse relire dans six mois d'où sortait un chiffre.
   *
   * `repas: null` retire le repas et rend son créneau au plat prévu.
   */
  if (p.action === 'repas-libre') {
    const date = pick(d, ['date', 'jour'])
    const slot = pick(d, ['slot', 'creneau'])
    if (!isIsoDate(date) || typeof slot !== 'string') return null
    if (!(SLOTS as readonly string[]).includes(slot)) return null
    const vers = pick(d, ['vers', 'repas'])
    if (vers === null) return { kind: 'repas-libre', date, slot, repas: null }
    const source = (vers && typeof vers === 'object' ? vers : d) as Record<string, unknown>
    const base = pick(source, ['base', 'derive', 'plat_origine'])
    /**
     * `base` doit désigner un plat qui EXISTE.
     *
     * Il ne sert qu'à l'affichage — « variante de : Poulet, lentilles » — mais un
     * identifiant fantôme produirait une ligne qui promet une recette et un lien qui
     * n'ouvre rien. Mieux vaut ne rien annoncer que d'annoncer dans le vide.
     */
    if (base !== undefined && base !== null) {
      if (typeof base !== 'string' || !isId(base)) return null
      if (ctx.recipeKnown && !ctx.recipeKnown(base)) return null
    }
    const repas = freeMealFrom({
      label: pick(source, ['label', 'nom', 'plat']),
      kcal: pick(source, ['kcal', 'calories']),
      p: pick(source, ['p', 'proteines', 'prot']),
      g: pick(source, ['g', 'glucides']),
      l: pick(source, ['l', 'lipides']),
      base: base ?? undefined,
      items: pick(source, ['items', 'ingredients', 'composition']),
      steps: pick(source, ['steps', 'preparation', 'recette']),
      from: 'claude',
    // `foodKnown` transmis : un ingrédient inventé fait échouer la proposition ici,
    // exactement comme pour une recette. C'est le même garde-fou, sur le même
    // catalogue, et il vaut mieux qu'il tombe au dépôt qu'au moment de valider.
    }, { foodKnown: ctx.foodKnown })
    return repas ? { kind: 'repas-libre', date, slot, repas } : null
  }
  if (p.action === 'planning-seance') {
    const date = pick(d, ['date', 'jour'])
    const vers = pick(d, ['vers', 'sessionId', 'seance'])
    if (!isIsoDate(date)) return null
    if (vers === null || vers === 'repos' || vers === '') return { kind: 'seance', date, sessionId: null }
    if (!isId(vers)) return null
    return { kind: 'seance', date, sessionId: vers }
  }
  return null
}

const num = (v: unknown, min: number, max: number): number | null => {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) && n >= min && n <= max ? n : null
}

const KINDS = ['pdj', 'boite', 'diner', 'collation', 'sauce'] as const

/**
 * Une recette proposée : ajout, ou modification d'une existante.
 *
 * Le point de vigilance est le même que pour une semaine, en plus serré : chaque
 * ingrédient doit être un ALIMENT connu. Une recette qui référence « saumon-fume »
 * quand la base dit « saumon-fumé » ne fait pas planter l'app — elle produit un
 * plat dont les macros sont fausses de moitié, ce qui est bien pire : c'est une
 * erreur silencieuse qui se propage dans les calories, les courses et le déficit.
 */
/** Les catégories du catalogue. En inventer une ferait disparaître l'aliment de
 *  la liste de courses, qui est groupée par catégorie. */
/**
 * Les catégories RÉELLES, celles de `FoodCat`.
 *
 * Cette liste en contenait deux de plus — « poissons » et « boissons » — qui
 * n'existent nulle part ailleurs. Un aliment déposé avec l'une d'elles passait la
 * validation, puis se rangeait dans une catégorie que `CAT_LABELS` ne sait pas
 * nommer et que `CAT_ORDER` ne parcourt pas : il disparaissait de la liste de
 * courses. Accepté, enregistré, invisible — le pire des trois états.
 *
 * Les poissons vivent dans « viandes », dont l'intitulé affiché est d'ailleurs
 * « Viandes / poissons ».
 */
const CATS = ['viandes', 'oeufs', 'laitiers', 'feculents', 'legumes', 'fruits', 'grasses', 'aromates', 'complements'] as const

/**
 * Créer ou corriger un ingrédient.
 *
 * C'est la brique qui manquait sous les recettes : proposer un plat exige des
 * identifiants d'aliments qui EXISTENT, donc sans cette forme il était impossible
 * d'ajouter une recette contenant quoi que ce soit de nouveau.
 *
 * Le contrôle de cohérence est ici et pas seulement dans l'écran d'édition. Des
 * macros qui n'expliquent pas les calories, c'est une étiquette mal recopiée — et
 * l'erreur ne se voit jamais, elle se propage dans les calories, les courses et le
 * déficit. On tolère 25 % d'écart, parce que fibres, polyols et arrondis du
 * fabricant en produisent légitimement quelques-uns.
 */
export function foodFor(p: RawProposal, ctx: PlanCtx): Extract<Plan, { kind: 'aliment' }> | null {
  if (p.action !== 'aliment') return null
  const d = p.patch ?? {}
  const name = typeof (pick(d, ['nom', 'name'])) === 'string' ? String(pick(d, ['nom', 'name'])).trim() : ''
  if (!name || name.length > 60) return null

  const cat = String(pick(d, ['cat', 'categorie']) ?? '')
  if (!(CATS as readonly string[]).includes(cat)) return null

  const kcal = num(pick(d, ['kcal', 'calories']), 0, 950) // 900 = huile pure, la borne haute physique
  const prot = num(pick(d, ['p', 'proteines', 'prot']), 0, 100)
  const gluc = num(pick(d, ['g', 'glucides']), 0, 100)
  const lip = num(pick(d, ['l', 'lipides']), 0, 100)
  if (kcal === null || prot === null || gluc === null || lip === null) return null
  if (prot + gluc + lip > 100) return null // pour 100 g, la somme ne peut pas déborder

  const calcule = prot * 4 + gluc * 4 + lip * 9
  if (kcal > 0 && Math.abs(calcule - kcal) > kcal * 0.25 + 20) return null

  const id = typeof d.id === 'string' && isId(d.id) ? d.id : null
  if (id && ctx.foodKnown && !ctx.foodKnown(id)) return null

  const texte = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined)
  const keeps = num(pick(d, ['keeps', 'conservation', 'conservation_jours']), 1, 365)

  return {
    kind: 'aliment',
    id,
    aliment: {
      name,
      cat,
      kcal: Math.round(kcal),
      p: Math.round(prot * 10) / 10,
      g: Math.round(gluc * 10) / 10,
      l: Math.round(lip * 10) / 10,
      ...(texte(pick(d, ['cook', 'cuisson']), 300) ? { cook: texte(pick(d, ['cook', 'cuisson']), 300) } : {}),
      ...(texte(pick(d, ['buy', 'achat', 'repere']), 120) ? { buy: texte(pick(d, ['buy', 'achat', 'repere']), 120) } : {}),
      ...(keeps !== null ? { keeps: Math.round(keeps) } : {}),
    },
  }
}

export function recipeFor(p: RawProposal, ctx: PlanCtx): Extract<Plan, { kind: 'recette' }> | null {
  if (p.action !== 'recette') return null
  const d = p.patch ?? {}
  const known = ctx.foodKnown ?? (() => false)
  const name = typeof d.nom === 'string' ? d.nom.trim() : (typeof d.name === 'string' ? d.name.trim() : '')
  const kind = String(pick(d, ['kind', 'type']) ?? '')
  const items = pick(d, ['items', 'ingredients'])
  if (!name || name.length > 80) return null
  if (!(KINDS as readonly string[]).includes(kind)) return null
  if (!Array.isArray(items) || !items.length || items.length > 30) return null

  const out: { food: string, g: number }[] = []
  for (const it of items) {
    if (!it || typeof it !== 'object') return null
    const raw = it as Record<string, unknown>
    const food = pick(raw, ['food', 'aliment', 'id'])
    const g = num(pick(raw, ['g', 'grammes', 'quantite']), 0.1, 2000)
    if (typeof food !== 'string' || !isId(food) || !known(food) || g === null) return null
    out.push({ food, g: Math.round(g * 10) / 10 })
  }

  const id = typeof d.id === 'string' && isId(d.id) ? d.id : null
  // Modifier une recette existante suppose qu'elle existe : sinon on croit patcher
  // et on crée un doublon silencieux sous un identifiant imposé.
  if (id && ctx.recipeKnown && !ctx.recipeKnown(id)) return null

  /**
   * La sauce et la conservation, qui se perdaient silencieusement.
   *
   * `patchRecipe` fusionne le patch dans la recette, donc une clé absente était
   * conservée — mais l'écran d'édition, lui, envoie toujours les cinq champs, et
   * une modification proposée d'ici repartait sans `sauce` ni `keeps`. Le plat
   * gardait son nom et ses ingrédients, et perdait son pot de sauce blanche ainsi
   * que sa durée de conservation. Cette dernière décide dans QUELLE session de
   * cuisine il tombe : sans elle, un plat qui ne tient pas trois jours se retrouve
   * planifié le dimanche pour le vendredi.
   *
   * On ne les transmet donc que si elles sont explicitement fournies — absentes,
   * la fusion garde celles d'origine.
   */
  const sauce = pick(d, ['sauce', 'pot'])
  const keeps = num(pick(d, ['keeps', 'conservation', 'conservation_jours']), 1, 30)
  if (sauce !== undefined && sauce !== null) {
    if (typeof sauce !== 'string' || !isId(sauce)) return null
    if (ctx.recipeKnown && !ctx.recipeKnown(sauce)) return null
  }

  return {
    kind: 'recette',
    id,
    recette: {
      name,
      kind: kind as RecipeSpec['kind'],
      batch: d.batch !== false,
      steps: typeof d.steps === 'string' ? d.steps.slice(0, 2000) : '',
      items: out,
      ...(typeof sauce === 'string' ? { sauce } : {}),
      ...(keeps !== null ? { keeps: Math.round(keeps) } : {}),
    },
  }
}

/**
 * Les quatre séances livrées à l'origine.
 *
 * C'est un REPLI, pas la vérité : dès que `ctx.sessionKnown` est fourni — et il
 * l'est partout où une proposition est réellement validée — c'est le programme
 * effectif qui décide, séances créées comprises. La constante ne sert plus qu'aux
 * appels sans contexte (des tests, essentiellement). La laisser décider seule
 * refuserait une séance que l'utilisateur vient de créer, sans expliquer pourquoi.
 */
const SESSIONS = ['s1', 's2', 's3', 's4'] as const
const sessionOk = (id: string, ctx: PlanCtx): boolean =>
  (ctx.sessionKnown ? ctx.sessionKnown(id) : (SESSIONS as readonly string[]).includes(id))
const sevenBools = (v: unknown): boolean[] | null =>
  (Array.isArray(v) && v.length === 7 && v.every(x => typeof x === 'boolean') ? v as boolean[] : null)

/** La semaine TYPE : celle qui vaut pour toutes les semaines à venir, par opposition
 *  à une exception datée. On accepte les trois axes séparément — changer les jours
 *  de salle ne doit pas obliger à réécrire le télétravail. */
export function weekTemplateFor(p: RawProposal, ctx: PlanCtx = {}): Extract<Plan, { kind: 'semaine-type' }> | null {
  if (p.action !== 'semaine-type') return null
  const d = p.patch ?? {}
  const out: Extract<Plan, { kind: 'semaine-type' }> = { kind: 'semaine-type' }
  const seances = pick(d, ['seances', 'sessions'])
  if (seances !== undefined) {
    if (!Array.isArray(seances) || seances.length !== 7) return null
    const clean: (string | null)[] = []
    for (const v of seances) {
      if (v === null || v === 'repos' || v === '') { clean.push(null); continue }
      if (typeof v !== 'string' || !sessionOk(v, ctx)) return null
      clean.push(v)
    }
    out.seances = clean
  }
  const salle = pick(d, ['salle', 'gym'])
  if (salle !== undefined) {
    const b = sevenBools(salle)
    if (!b) return null
    out.salle = b
  }
  const tt = pick(d, ['teletravail', 'tt'])
  if (tt !== undefined) {
    const b = sevenBools(tt)
    if (!b) return null
    out.teletravail = b
  }
  if (!out.seances && !out.salle && !out.teletravail) return null
  return out
}

/**
 * Les gestes d'un coach. Une liste fermée : un « autre » ouvrirait la porte à des
 * interprétations, et une interprétation qui écrit est une donnée perdue.
 *
 * `creer-seance` est arrivé en dernier, et il change la nature de l'outil : les cinq
 * autres ne savent que MODIFIER un programme existant. Sans lui, une installation
 * neuve au programme vide restait vide pour toujours — il n'y avait aucune séance à
 * laquelle rattacher un exercice.
 */
const PROGRAM_OPS = ['ajouter', 'modifier', 'retirer', 'reactiver', 'reordonner', 'creer-seance'] as const
/** `ordre` était le nom de la première version livrée. Une session Claude garde sa
 *  liste d'outils en cache pendant des heures : refuser l'ancien nom ferait échouer
 *  des propositions parfaitement claires, sans que personne comprenne pourquoi. */
const OP_ALIAS: Record<string, string> = { ordre: 'reordonner', reorganiser: 'reordonner' }

/** Un identifiant lisible tiré d'un nom : « Développé incliné » → « developpe-incline ». */
export function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
}

const strOf = (v: unknown, max: number): string | null =>
  (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null)

const listOf = (v: unknown, max: number, len: number): string[] | null => {
  if (!Array.isArray(v)) return null
  const out = v.map(x => strOf(x, len)).filter((x): x is string => !!x)
  return out.slice(0, max)
}

/**
 * Les machines de remplacement proposées. La liste REMPLACE, elle ne fusionne pas.
 *
 * Trois champs seulement — identifiant, nom, coefficient — parce que ce sont les
 * trois qu'on peut décrire de l'extérieur. Le catalogue en porte trois autres
 * (`gear`, `hint`, `why`) qui pilotent l'icône de matériel et la phrase
 * d'explication : ils sont RENDUS à la fusion quand l'identifiant s'y trouve encore,
 * et c'est pour ça qu'un remplacement n'efface rien qu'on ne puisse reconstruire.
 *
 * Les bornes du coefficient sont celles de `measuredRatio` : en dehors, ce n'est plus
 * une conversion de charge, c'est une faute de frappe.
 */
function variantsOf(v: unknown): VariantSpec[] | null {
  if (!Array.isArray(v) || v.length > 12) return null
  const out: VariantSpec[] = []
  const vus = new Set<string>()
  for (const raw of v) {
    if (!raw || typeof raw !== 'object') return null
    const o = raw as Record<string, unknown>
    const id = pick(o, ['id'])
    const name = strOf(pick(o, ['nom', 'name']), 60)
    const ratio = num(pick(o, ['coefficient', 'ratio']), 0.2, 5)
    if (!isId(id) || !name || ratio === null || vus.has(id)) return null
    vus.add(id)
    out.push({ id, name, ratio: Math.round(ratio * 100) / 100 })
  }
  return out
}

/**
 * Les champs d'un exercice, lus depuis un objet quelconque.
 *
 * Rien n'est obligatoire ici : c'est un PATCH, et un patch ne touche que ce qu'il
 * mentionne. Les bornes ne sont pas décoratives — 40 séries ou 2 secondes de repos
 * passeraient la vérification de type et donneraient un écran de séance inutilisable,
 * qu'il faudrait corriger à la main sans savoir d'où ça vient.
 */
function exerciseFields(raw: Record<string, unknown>): ExercisePatch {
  const out: ExercisePatch = {}
  const name = strOf(pick(raw, ['nom', 'name', 'libelle']), 60)
  if (name) out.name = name
  const sets = num(pick(raw, ['series', 'sets']), 1, 12)
  if (sets !== null) out.sets = Math.round(sets)
  const reps = strOf(pick(raw, ['reps', 'repetitions', 'rep']), 30)
  if (reps) out.reps = reps
  // 20 s = le temps de reprendre son souffle ; 900 s = un quart d'heure, au-delà ce
  // n'est plus une série suivante, c'est une autre séance.
  const rest = num(pick(raw, ['repos_s', 'rest', 'repos', 'pause']), 20, 900)
  if (rest !== null) out.rest = Math.round(rest)
  // `machine` est du texte LIBRE et peut légitimement être vidé — « Haltères » qui
  // devient « ». D'où le test sur le type et non sur la troncature, contrairement
  // aux autres : ici la chaîne vide est une valeur, pas une absence.
  const machine = pick(raw, ['machine', 'materiel'])
  if (typeof machine === 'string') out.machine = machine.trim().slice(0, 120)
  const muscles = listOf(pick(raw, ['muscles', 'groupes']), 6, 30)
  if (muscles?.length) out.muscles = muscles
  const cues = listOf(pick(raw, ['cues', 'consignes', 'conseils']), 8, 240)
  if (cues?.length) out.cues = cues
  const bw = pick(raw, ['bodyweight', 'poids_de_corps'])
  if (typeof bw === 'boolean') out.bodyweight = bw
  const opt = pick(raw, ['optionnel', 'optional'])
  if (typeof opt === 'boolean') out.optionnel = opt
  const mes = pick(raw, ['mesure'])
  if (mes === 'reps' || mes === 'temps') out.mesure = mes
  const ss = pick(raw, ['superset'])
  if (Array.isArray(ss) && ss.length === 2) {
    const a = strOf(ss[0], 40), b = strOf(ss[1], 40)
    if (a && b) out.superset = [a, b]
  }
  return out
}

/**
 * Les trois champs dont une modification doit prouver qu'elle sait ce qu'elle remplace.
 *
 * Même garde que les corrections de données, et pour la même raison : le miroir peut
 * avoir des heures de retard. Une proposition construite sur un programme lu ce matin
 * écraserait sans le savoir un réglage changé depuis sur le téléphone — et « 3 séries
 * au lieu de 4 » ne se remarque pas en salle, on le fait, c'est tout.
 *
 * `repos_s` se compare à ce que l'outil `programme` ANNONCE, c'est-à-dire au repos
 * effectif : ni la valeur brute ni un défaut deviné, mais le chiffre qu'on a lu.
 */
const GARDES = [
  { champ: ['series', 'sets'], de: ['de_series', 'de_sets'], cle: 'sets' as const, lire: (e: Exercise) => e.sets },
  { champ: ['reps', 'repetitions'], de: ['de_reps'], cle: 'reps' as const, lire: (e: Exercise) => e.reps },
  { champ: ['repos_s', 'rest', 'repos'], de: ['de_repos_s', 'de_rest', 'de_repos'], cle: 'rest' as const, lire: (e: Exercise) => restFor(e) },
]

/**
 * La modification proposée est-elle bâtie sur les valeurs réelles ?
 *
 * Tolérance nombre/texte, comme pour les corrections de champ : le connecteur relit
 * souvent « 120 » là où le programme porte 120. C'est la même valeur, et refuser
 * là-dessus n'apprend rien à personne.
 */
export function gardesOk(d: Record<string, unknown>, src: Record<string, unknown>, actuel: Exercise): boolean {
  for (const g of GARDES) {
    const envoye = pick(src, g.champ) ?? pick(d, g.champ)
    if (envoye === undefined) continue
    const annonce = pick(src, g.de) ?? pick(d, g.de)
    if (annonce === undefined) return false
    if (String(annonce) !== String(g.lire(actuel))) return false
  }
  return true
}

/**
 * Le programme d'entraînement modifié depuis une conversation.
 *
 * C'était le dernier pan de l'application sans aucune prise à distance, alors que
 * c'est précisément celui sur lequel un coach intervient : allonger un repos, passer
 * de 4×8 à 5×5, retirer un mouvement qui fait mal à l'épaule, en glisser un autre,
 * changer l'ordre — parce que l'ordre a un sens physiologique, et qu'un exercice de
 * poigne placé avant un soulevé ruine le soulevé.
 *
 * Quatre refus valent d'être expliqués, parce qu'ils ne sautent pas aux yeux :
 *
 *  • un identifiant d'ajout DÉJÀ PRIS, même dans une autre séance et même retiré.
 *    L'historique de charges est indexé sur l'identifiant seul : le réutiliser ne
 *    créerait pas un doublon visible, il rangerait des séries réellement soulevées
 *    sous un mouvement qu'on n'a jamais fait ;
 *  • une modification de séries, reps ou repos SANS son « de_… ». Le miroir peut
 *    avoir des heures de retard ;
 *  • un « reordonner » qui n'est pas exactement l'ensemble des actifs. Une liste
 *    partielle donnerait un ordre silencieusement différent de celui demandé ;
 *  • un geste SANS EFFET — retirer ce qui est déjà retiré, réactiver ce qui est
 *    déjà actif. Il s'archiverait en « appliquée » et raconterait un changement
 *    qui n'a pas eu lieu.
 */
export function programFor(p: RawProposal, ctx: PlanCtx): Extract<Plan, { kind: 'programme' }> | null {
  if (p.action !== 'programme') return null
  const d = p.patch ?? {}
  const brut = String(pick(d, ['op', 'action', 'geste']) ?? '')
  const op = (OP_ALIAS[brut] ?? brut) as typeof PROGRAM_OPS[number]
  if (!(PROGRAM_OPS as readonly string[]).includes(op)) return null

  const seance = String(pick(d, ['seance', 'session', 'sessionId']) ?? '')
  if (!isId(seance)) return null

  /**
   * Créer une séance entière.
   *
   * C'est le SEUL geste qui exige un identifiant encore LIBRE — tous les autres
   * exigent l'inverse. Deux séances de même identifiant afficheraient la même chose
   * deux fois, et l'historique, indexé par exercice, ne saurait plus à laquelle
   * rattacher une performance.
   *
   * On exige aussi au moins un exercice complet. Une séance vide s'ouvre sur un
   * écran sans rien à saisir : elle a l'air cassée, et rien ne dit à l'utilisateur
   * qu'il doit la remplir lui-même.
   */
  if (op === 'creer-seance') {
    if (sessionOk(seance, ctx)) return null

    const source = pick(d, ['nouvelle', 'seance_neuve', 'contenu']) ?? d
    const src = (source && typeof source === 'object' ? source : d) as Record<string, unknown>
    const name = strOf(pick(src, ['nom', 'name']), 60)
    if (!name) return null

    const brutEx = pick(src, ['exercices', 'exercises'])
    if (!Array.isArray(brutEx) || !brutEx.length || brutEx.length > 30) return null

    const exercices: Exercise[] = []
    const vus = new Set<string>()
    for (const brut of brutEx) {
      if (!brut || typeof brut !== 'object') return null
      const e = brut as Record<string, unknown>
      const f = exerciseFields(e)
      // Mêmes exigences que pour un ajout isolé : sans nom, séries, reps et repos,
      // la fiche s'affiche vide et la saisie n'a plus de lignes.
      if (!f.name || !f.sets || !f.reps || f.rest === undefined) return null
      const donne = pick(e, ['id'])
      const id = typeof donne === 'string' && isId(donne) ? donne : slugify(f.name)
      if (!id || !isId(id) || vus.has(id)) return null
      // Un identifiant déjà utilisé AILLEURS rattacherait le nouvel exercice à
      // l'historique d'un autre mouvement.
      if (ctx.exerciseAt ? !!ctx.exerciseAt(id) : ctx.exerciseKnown?.(id)) return null
      vus.add(id)
      exercices.push({ id, ...f } as Exercise)
    }

    const couleur = strOf(pick(src, ['couleur', 'color']), 24) ?? '#8b6f5c'
    /**
     * `tag` est l'étiquette affichée au-dessus du nom : « Lundi · Push ». Pas de
     * défaut inventé — écrire « Séance » sur toutes les cartes ne dirait rien, et
     * une chaîne vide se rend proprement. Les muscles, eux, ne se déclarent pas :
     * ils sont déduits des exercices, et une liste saisie à la main dériverait du
     * contenu réel dès le premier exercice retiré.
     */
    const jour = strOf(pick(src, ['jour', 'tag', 'day']), 40) ?? ''

    return {
      kind: 'programme',
      seance,
      op: 'creer-seance',
      exercice: null,
      seanceNeuve: { id: seance, name, tag: jour, color: couleur, sprint: null, exercises: exercices },
    }
  }

  // Tous les autres gestes portent sur une séance QUI EXISTE.
  if (!sessionOk(seance, ctx)) return null

  const actifs = ctx.exercisesOf?.(seance)
  /** Où « apres » demande d'insérer. `undefined` = pas demandé ; `null` = invalide. */
  const apresDe = (src: Record<string, unknown>): string | null | undefined => {
    const a = pick(src, ['apres', 'after']) ?? pick(d, ['apres', 'after'])
    if (a === undefined || a === null || a === '') return undefined
    if (!isId(a)) return null
    // Pas de repli silencieux sur « en fin de séance » : une position demandée et
    // non tenue, c'est un exercice de poigne qui atterrit avant un soulevé.
    if (actifs && !actifs.includes(a)) return null
    return a
  }

  if (op === 'reordonner') {
    const ordre = pick(d, ['ordre', 'order', 'exercices'])
    if (!Array.isArray(ordre) || !ordre.length || ordre.length > 40) return null
    const vus = new Set<string>()
    const out: string[] = []
    for (const v of ordre) {
      if (!isId(v) || vus.has(v)) return null
      if (actifs && !actifs.includes(v)) return null
      vus.add(v)
      out.push(v)
    }
    // La liste COMPLÈTE, pas un extrait : un actif oublié garderait sa place et
    // l'ordre obtenu ne serait pas celui qu'on croit avoir demandé.
    if (actifs && (out.length !== actifs.length || actifs.some(id => !vus.has(id)))) return null
    return { kind: 'programme', seance, op: 'reordonner', exercice: null, ordre: out }
  }

  if (op === 'ajouter') {
    const source = pick(d, ['nouveau', 'exercice', 'ex'])
    const src = (source && typeof source === 'object' ? source : d) as Record<string, unknown>
    const f = exerciseFields(src)
    // Un exercice NEUF a besoin du minimum vital : sans nom, séries et reps, la fiche
    // s'affiche vide et la saisie n'a plus de lignes.
    if (!f.name || !f.sets || !f.reps) return null
    // Le repos est OBLIGATOIRE et n'a pas de défaut. Le déduire des reps donnerait
    // 40 secondes sur « 30-40 s » — un repos calculé sur une durée d'effort.
    if (f.rest === undefined) return null
    const donne = pick(src, ['id'])
    const id = typeof donne === 'string' && isId(donne) ? donne : slugify(f.name)
    if (!id || !isId(id)) return null
    if (ctx.exerciseAt ? !!ctx.exerciseAt(id) : ctx.exerciseKnown?.(id)) return null

    const variants = pick(src, ['machines_de_remplacement', 'variants'])
    let vs: VariantSpec[] | undefined
    if (variants !== undefined) {
      const v = variantsOf(variants)
      if (!v) return null
      vs = v
    }
    const apres = apresDe(src)
    if (apres === null) return null

    const nouveau: Exercise = {
      id,
      name: f.name,
      sets: f.sets,
      reps: f.reps,
      rest: f.rest,
      muscles: f.muscles ?? [],
      cues: f.cues ?? [],
      machine: f.machine ?? '',
      ...(f.mesure ? { mesure: f.mesure } : {}),
      ...(f.optionnel ? { optionnel: true } : {}),
      ...(f.bodyweight ? { bodyweight: true } : {}),
      ...(f.superset ? { superset: f.superset } : {}),
    }
    return {
      kind: 'programme', seance, op: 'ajouter', exercice: id, nouveau,
      ...(apres ? { apres } : {}),
      ...(vs ? { variants: vs } : {}),
    }
  }

  const exId = pick(d, ['exercice', 'exercise', 'exerciceId', 'id'])
  if (!isId(exId)) return null
  const place = ctx.exerciseAt?.(exId) ?? null
  if (ctx.exerciseAt ? !place : (ctx.exerciseKnown && !ctx.exerciseKnown(exId))) return null

  if (op === 'modifier') {
    const source = pick(d, ['patch', 'vers', 'modifications'])
    const src = (source && typeof source === 'object' ? source : d) as Record<string, unknown>
    const patch = exerciseFields(src)

    const variants = pick(src, ['machines_de_remplacement', 'variants']) ?? pick(d, ['machines_de_remplacement'])
    let vs: VariantSpec[] | undefined
    if (variants !== undefined) {
      const v = variantsOf(variants)
      if (!v) return null
      vs = v
    }
    if (!Object.keys(patch).length && !vs) return null
    // La garde : on ne change une valeur qu'en prouvant qu'on connaît la précédente.
    if (place && !gardesOk(d, src, place.ex)) return null
    return {
      kind: 'programme', seance, op: 'modifier', exercice: exId, patch,
      ...(vs ? { variants: vs } : {}),
    }
  }

  if (op === 'retirer') {
    if (place ? !place.actif : (actifs && !actifs.includes(exId))) return null
    return { kind: 'programme', seance, op: 'retirer', exercice: exId }
  }

  // reactiver
  if (place ? place.actif : actifs?.includes(exId)) return null
  const apres = apresDe(d)
  if (apres === null) return null
  return { kind: 'programme', seance, op: 'reactiver', exercice: exId, ...(apres ? { apres } : {}) }
}

/** Les quatre gestes possibles sur un champ. Fermé, comme partout ailleurs. */
export const FIELD_OPS = ['remplacer', 'creer', 'ajouter', 'supprimer'] as const

/** Le pointeur du parent, ou `null` si le chemin est déjà à la racine. */
export function parentPointer(chemin: string): string | null {
  const i = chemin.lastIndexOf('/')
  return i <= 0 ? null : chemin.slice(0, i)
}

/**
 * La valeur en place est-elle bien celle qu'on croit ?
 *
 * Tolérance nombre/texte pour les scalaires — le connecteur relit souvent « 50 » là
 * où la sauvegarde porte 50, et refuser là-dessus n'apprend rien à personne. Pour un
 * objet ou un tableau, on compare la forme sérialisée : c'est plus strict, et c'est
 * voulu. Supprimer une entrée d'un tableau sur la foi d'une description approximative
 * effacerait la voisine.
 */
export function sameValue(actuel: unknown, de: unknown): boolean {
  if (de === undefined) return false
  if (isScalar(actuel) && isScalar(de)) return actuel === de || String(actuel) === String(de)
  try { return JSON.stringify(actuel) === JSON.stringify(de) }
  catch { return false }
}

/**
 * Une correction de donnée — et la garde qui la rend acceptable.
 *
 * Corriger, c'est écrire par-dessus quelque chose qu'on ne pourra pas reconstituer.
 * La proposition doit donc porter la valeur qu'elle CROIT remplacer (`de`), et on
 * refuse si elle ne correspond pas à ce qui est réellement stocké. C'est ce qui
 * transforme « réécris cette charge » — que j'avais refusé de livrer — en « échange
 * cette valeur précise, que j'ai vérifiée ». Le miroir peut avoir des heures de
 * retard : sans ce contrôle, une correction juste au moment où elle a été écrite
 * pourrait en écraser une autre, faite entre-temps sur le téléphone.
 */
export function fixFor(p: RawProposal, ctx: PlanCtx): Plan | null {
  if (p.action !== 'correction') return null
  const d = p.patch ?? {}
  const quoi = String(pick(d, ['quoi', 'cible']) ?? '')

  if (quoi === 'serie') {
    const exercice = pick(d, ['exercice', 'exId'])
    const date = pick(d, ['date'])
    const index = num(pick(d, ['serie', 'index']), 0, 49)
    const de = pick(d, ['de', 'avant']) as Record<string, unknown> | undefined
    const vers = pick(d, ['vers', 'apres']) as Record<string, unknown> | undefined
    if (typeof exercice !== 'string' || !isId(exercice) || !isIsoDate(date) || index === null) return null
    if (!de || !vers) return null
    const w = num(pick(vers, ['w', 'poids', 'charge']), 0, 500)
    const r = num(pick(vers, ['r', 'reps']), 0, 100)
    const wOld = num(pick(de, ['w', 'poids', 'charge']), 0, 1000)
    const rOld = num(pick(de, ['r', 'reps']), 0, 200)
    if (w === null || r === null || wOld === null || rOld === null) return null
    const current = ctx.setAt?.(exercice, date, Math.trunc(index)) ?? null
    if (!current || current.w !== wOld || current.r !== rOld) return null
    return { kind: 'correction-serie', exercice, date, index: Math.trunc(index), vers: { w, r } }
  }

  if (quoi === 'champ') {
    /**
     * Le passe-partout : n'importe quel endroit de la sauvegarde, désigné par un
     * pointeur JSON, et QUATRE gestes.
     *
     * Il n'en avait qu'un — remplacer une valeur simple déjà présente — et cette
     * limite condamnait une cinquantaine d'actions que l'application sait faire :
     * ajouter une pesée oubliée, retirer un extra saisi deux fois, effacer une
     * exception de planning, rendre sa fiche d'origine à un exercice. Chacune
     * s'affichait « à faire à la main », c'est-à-dire renvoyait le travail à
     * quelqu'un pendant qu'une machine regardait.
     *
     * Ce qui NE change pas, et qui portait déjà toute la sécurité : on ne crée
     * jamais un chemin, seulement une feuille ; on ne remplace jamais un objet ou un
     * tableau existant ; et remplacer ou supprimer exige de citer la valeur en place.
     */
    const chemin = pick(d, ['chemin', 'path'])
    if (typeof chemin !== 'string') return null
    const snap = ctx.snapshot?.()
    if (!snap) return null

    const brut = String(pick(d, ['op', 'geste']) ?? 'remplacer')
    const op = (FIELD_OPS as readonly string[]).includes(brut) ? brut as 'remplacer' | 'creer' | 'ajouter' | 'supprimer' : null
    if (!op) return null

    const de = pick(d, ['de', 'avant'])
    const vers = pick(d, ['vers', 'apres'])
    const current = getAt(snap, chemin)

    if (op === 'creer') {
      // Créer là où il y a déjà quelque chose, ce serait écraser en croyant ajouter.
      if (current !== undefined) return null
      if (vers === undefined || !boundedValue(vers)) return null
      // Le PARENT doit exister : une faute de frappe dans un nom de section ne doit
      // pas fabriquer une branche fantôme que rien ne lit.
      if (getAt(snap, parentPointer(chemin) ?? '') === undefined && parentPointer(chemin) !== null) return null
      return { kind: 'correction-champ', chemin, op, vers }
    }

    if (op === 'ajouter') {
      if (!Array.isArray(current)) return null
      if (vers === undefined || !boundedValue(vers)) return null
      return { kind: 'correction-champ', chemin, op, vers }
    }

    // Remplacer et supprimer touchent à quelque chose qui existe : il faut prouver
    // qu'on sait quoi. Le miroir peut avoir des heures de retard.
    if (current === undefined) return null
    if (!sameValue(current, de)) return null

    if (op === 'supprimer') return { kind: 'correction-champ', chemin, op }
    // Remplacer reste réservé aux valeurs simples, des deux côtés : réécrire d'un
    // coup une section dont on ne saurait pas dire ce qu'elle contenait, non.
    if (!isScalar(current) || !isScalar(vers)) return null
    return { kind: 'correction-champ', chemin, op, vers }
  }

  if (quoi === 'pesee') {
    const date = pick(d, ['date'])
    const de = num(pick(d, ['de', 'avant']), 0, 500)
    const versRaw = pick(d, ['vers', 'apres'])
    if (!isIsoDate(date) || de === null) return null
    const current = ctx.weightAt?.(date) ?? null
    if (current === null || Math.abs(current - de) > 0.001) return null
    if (versRaw === null) return { kind: 'correction-pesee', date, vers: null }
    const vers = num(versRaw, 20, 400)
    if (vers === null) return null
    return { kind: 'correction-pesee', date, vers }
  }

  return null
}

/**
 * La durée d'une séance est écrite à deux endroits ; un seul est lu.
 *
 * `recordSession` l'inscrit sur la séance ET sur chaque exercice de cette séance.
 * L'application n'affiche jamais la seconde — ni le rapport, ni la fiche du jour,
 * ni le calendrier ne la regardent. Elle reste pourtant dans la sauvegarde, donc
 * visible d'ici, et c'est un piège exact : corriger `/logs/dev-couche/3/durationMin`
 * réussit, l'application confirme, et l'écran continue d'afficher l'ancienne durée.
 *
 * On ne la masque pas et on ne la répare pas en douce — un outil qui écrit ailleurs
 * que là où on pointe ne serait plus vérifiable. On dit simplement, à la lecture,
 * laquelle des deux compte.
 */
export function twinPath(chemin: string, d: Record<string, unknown>): string | null {
  const m = /^\/logs\/(.+)\/(\d+)\/durationMin$/.exec(chemin)
  if (!m) return null
  const entry = getAt(d, `/logs/${m[1]}/${m[2]}`) as { date?: string } | undefined
  const jour = entry?.date
  if (!jour) return null
  const sessions = Array.isArray(d.sessions) ? d.sessions : []
  const i = sessions.findIndex(s => String((s as { at?: string }).at ?? '').slice(0, 10) === jour)
  return i < 0 ? null : `/sessions/${i}/durationMin`
}

/**
 * Une correction de champ vérifiée AVANT le dépôt, pas seulement à l'application.
 *
 * L'application refusera de toute façon un chemin qui n'existe pas ou un « de » qui
 * ne correspond pas — c'est la garantie de fond, et elle reste. Mais si le serveur
 * se tait ici, la proposition part quand même : Grégoire la découvre dans sa boîte,
 * lit « l'app ne sait pas appliquer ça », et c'est LUI qui paie une erreur que le
 * serveur pouvait voir tout de suite, miroir en main.
 *
 * Rendre l'erreur au connecteur la met au bon endroit : je la lis, je relis le champ,
 * je repropose. Rien n'atteint la boîte de réception tant que ce n'est pas cohérent.
 */
export function checkFieldFix(detail: Record<string, unknown>, data: Record<string, unknown>): void {
  const chemin = typeof detail.chemin === 'string' ? detail.chemin : ''
  if (!chemin) throw new Error('« chemin » est obligatoire (ex. « /sessions/12/durationMin »). Appelle l\'outil « champ » sans argument pour la carte de la sauvegarde.')

  const brut = String(detail.op ?? detail.geste ?? 'remplacer')
  if (!(FIELD_OPS as readonly string[]).includes(brut)) {
    throw new Error(`« op » doit valoir remplacer, creer, ajouter ou supprimer — pas ${JSON.stringify(brut)}.`)
  }
  const op = brut as typeof FIELD_OPS[number]
  const actuel = getAt(data, chemin)

  if (op === 'creer') {
    if (actuel !== undefined) {
      throw new Error(`Il y a déjà quelque chose à « ${chemin} » : ${JSON.stringify(actuel)}. Créer écraserait — utilise op: "remplacer" avec « de ».`)
    }
    const parent = parentPointer(chemin)
    if (parent !== null && getAt(data, parent) === undefined) {
      throw new Error(`Le parent « ${parent} » n'existe pas. On ne crée qu'une feuille, jamais une branche entière : une faute de frappe dans un nom de section fabriquerait un champ que rien ne lit.`)
    }
    if (detail.vers === undefined) throw new Error('« vers » est obligatoire pour créer.')
    if (!boundedValue(detail.vers)) throw new Error('« vers » est trop gros ou trop imbriqué : au maximum 400 valeurs et 6 niveaux. C\'est la taille d\'une séance complète — au-delà, personne ne relit avant de valider.')
    return
  }

  if (op === 'ajouter') {
    if (!Array.isArray(actuel)) {
      throw new Error(`« ${chemin} » n'est pas une liste${actuel === undefined ? ' (rien à cet endroit)' : ''} : « ajouter » ajoute à la fin d'un tableau. Vérifie le chemin avec « champ ».`)
    }
    if (detail.vers === undefined) throw new Error('« vers » est obligatoire pour ajouter.')
    if (!boundedValue(detail.vers)) throw new Error('« vers » est trop gros ou trop imbriqué : au maximum 400 valeurs et 6 niveaux.')
    return
  }

  // Remplacer et supprimer : il faut prouver qu'on sait ce qu'on touche.
  if (actuel === undefined) throw new Error(`Aucune valeur à « ${chemin} ». Vérifie le chemin avec l'outil « champ » — ou utilise op: "creer" si tu veux l'ajouter.`)
  const double = twinPath(chemin, data)
  if (double) throw new Error(`« ${chemin} » est une copie que l'application n'affiche pas : la corriger ne changerait rien à l'écran. Corrige ${double}.`)

  // Le refus STRUCTUREL passe avant la confrontation de « de » : sur un objet, il
  // vaut quelle que soit la valeur annoncée, et « de ne correspond pas » enverrait
  // chercher au mauvais endroit.
  if (op === 'remplacer' && actuel !== null && typeof actuel === 'object') {
    throw new Error(`« ${chemin} » désigne ${Array.isArray(actuel) ? 'une liste' : 'un objet'} : on ne REMPLACE que des valeurs simples — réécrire d'un coup une section dont on ne saurait pas dire ce qu'elle contenait, non. Descends d'un cran, ou supprime puis crée.`)
  }

  const de = detail.de
  if (de === undefined) throw new Error(`« de » est obligatoire : la valeur actuellement enregistrée est ${JSON.stringify(actuel)}.`)
  if (!sameValue(actuel, de)) {
    throw new Error(`« de » ne correspond pas : ${JSON.stringify(chemin)} vaut ${JSON.stringify(actuel)}, pas ${JSON.stringify(de)}. Relis-le avec « champ », puis repropose.`)
  }
  if (op === 'supprimer') return

  const vers = detail.vers
  if (vers !== null && ['object', 'undefined', 'function'].includes(typeof vers)) {
    throw new Error('« vers » doit être une valeur simple : nombre, texte, booléen ou null.')
  }
}

/** Les lignes affichées sous la phrase : ce qui change, en clair. */
export function detailLines(p: RawProposal): { label: string, value: string }[] {
  const out: { label: string, value: string }[] = []
  for (const [k, v] of Object.entries(p.patch ?? {})) {
    if (v === null || v === undefined) { out.push({ label: k, value: '—' }); continue }
    out.push({ label: k, value: typeof v === 'object' ? JSON.stringify(v) : String(v) })
  }
  return out.slice(0, 8)
}
