import { useFoyer } from '~/composables/useFoyer'
import { computed, ref } from 'vue'
import type { Food, Recipe } from '~/data/nutritionProgram'
import type { DayOverride, DayPlan, Extra, Library, MenuDay, MenuWeek, PrepMode, PriceMap, ShoppingList, WeekTemplate } from '~/lib/nutritionStats'
import {
  DEFAULT_WEEK, basketTotal, blankWeekDays, buildDay, builtinWeeks, cookPlan, cookSelection,
  atFatPct, dairySwapCost, isAdjustableDairy,
  dowIndex, emptyDay, mergeFoods, mergeRecipes, mondayOf, normalizeWeek, resolveDay, selectionTotals,
  shoppingFromWeek, slugify, stockOf, weekDaysOn,
} from '~/lib/nutritionStats'
import { freeMealFrom, withFreeMeals } from '~/lib/freeMeal'
import { ratioFromWeighing } from '~/lib/cooked'
import type { FreeMeal } from '~/lib/freeMeal'
import { SLOTS_GYM, SLOTS_REST } from '~/data/nutritionProgram'
import { isoOf } from '~/utils/sportStats'

// État du module nutrition, persisté en localStorage — même pattern que useWorkout :
// des refs au niveau module (donc partagées entre tous les appelants) et une
// hydratation unique gardée par un flag.
const PRICES_KEY = 'gr-nutri-prices-v1' // prix saisis, en € / kg
const CHECKED_KEY = 'gr-nutri-shopping-v1' // aliments déjà dans le caddie
const EATEN_KEY = 'gr-nutri-eaten-v1' // repas du plan validés, par date
const BASKETS_KEY = 'gr-nutri-baskets-v1' // historique des courses payées
const PREP_KEY = 'gr-nutri-prep-v1' // boîtes assemblées à l'avance, ou féculents à part
const WEEK_KEY = 'gr-nutri-week-v1' // semaine type : salle et télétravail
const OVER_KEY = 'gr-nutri-days-v1' // exceptions par date
const EXTRA_KEY = 'gr-nutri-extras-v1' // repas hors plan, par date
const FOODS_KEY = 'gr-nutri-foods-v1' // aliments créés
const FOODPATCH_KEY = 'gr-nutri-foodpatch-v1' // aliments livrés, modifiés
const RECIPES_KEY = 'gr-nutri-recipes-v1' // plats créés
const RECIPEPATCH_KEY = 'gr-nutri-recipepatch-v1' // plats livrés, modifiés
const OFF_KEY = 'gr-nutri-off-v1' // plats mis de côté
const MENUS_KEY = 'gr-nutri-menus-v1' // semaines types : les menus de sept jours
const ACTIVE_KEY = 'gr-nutri-menu-active-v1' // semaine type en cours
const ASSIGN_KEY = 'gr-nutri-menu-map-v1' // semaine appliquée, par lundi
const FREEZER_KEY = 'gr-nutri-freezer-v1' // ai-je de la place au congélateur ?
const PICKED_KEY = 'gr-nutri-picked-v1' // plat réellement pris, quand il diffère
const ADJUST_KEY = 'gr-nutri-adjust-v1' // ajustement du soir confirmé, par date
const FATPCT_KEY = 'gr-nutri-fatpct-v1' // taux de MG réellement acheté, par laitier
const FREE_KEY = 'gr-nutri-libre-v1' // repas du dehors, par date et créneau
const FREEPRESET_KEY = 'gr-nutri-libre-mes-v1' // repas du dehors gardés pour resservir
const COOKED_KEY = 'gr-nutri-cuit-v1' // ratios cru → cuit relevés à la balance
// Clé de l'ancienne sélection « plat → portions », remplacée par la semaine type.
// Les portions ne se saisissent plus à la main : elles se comptent dans la semaine.
const LEGACY_SEL_KEY = 'gr-nutri-selection-v1'
const LEGACY_START_KEY = 'gr-nutri-start-v1'
export interface Basket { date: string, total: number, days: number }
const prices = ref<PriceMap>({})
const checked = ref<Record<string, boolean>>({})
const eaten = ref<Record<string, string[]>>({})
const baskets = ref<Basket[]>([])
const prepMode = ref<PrepMode>('separate')
const week = ref<WeekTemplate>({ gym: [...DEFAULT_WEEK.gym], tt: [...DEFAULT_WEEK.tt] })
const overrides = ref<Record<string, DayOverride>>({})
/**
 * Les semaines types de menus, celle en cours, et la trace de celle appliquée à
 * chaque lundi.
 *
 * `assign` existe pour que changer de semaine ne réécrive pas le passé : sans elle,
 * relire un mardi d'il y a trois semaines afficherait les plats d'aujourd'hui. Elle
 * ne stocke qu'un identifiant par lundi — quelques octets pour un historique qui
 * reste vrai.
 */
const menus = ref<MenuWeek[]>([])
const activeMenu = ref<string | null>(null)
const menuAssign = ref<Record<string, string>>({})
/**
 * Place disponible au congélateur. `false` par défaut, et ce défaut compte : congeler
 * est la seule façon de tout cuisiner le dimanche, mais un tiroir plein est un fait,
 * pas un détail. Le supposer produirait un programme de cuisine irréalisable.
 */
const freezer = ref(false)
// Plat réellement pris quand il diffère de celui proposé — « j'ai pris autre chose ».
const picked = ref<Record<string, Record<string, string>>>({})
/**
 * Le sac de sport, coché par date. Stocké et pas seulement gardé en mémoire : la
 * liste se consulte le matin, souvent en rouvrant l'app deux ou trois fois entre
 * la cuisine et la porte. Une case qui se décoche au rechargement ne servirait à rien.
 */
/**
 * L'ajustement du soir réellement appliqué, par date : on stocke la SIGNATURE de
 * l'ajustement confirmé, pas un simple booléen.
 *
 * La différence compte. Un booléen dirait « j'ai ajusté ce soir » et resterait vrai
 * même après qu'un extra de 300 kcal a changé le conseil : l'app afficherait alors
 * des chiffres corrigés que personne n'a validés. La signature fait expirer la
 * confirmation dès que l'action proposée change vraiment.
 */
const adjustOk = ref<Record<string, string>>({})
const extras = ref<Record<string, Extra[]>>({})
const userFoods = ref<Food[]>([])
const foodPatches = ref<Record<string, Partial<Food>>>({})
const userRecipes = ref<Recipe[]>([])
const recipePatches = ref<Record<string, Partial<Recipe>>>({})
const disabledRecipes = ref<string[]>([])
/**
 * Taux de matière grasse RÉELLEMENT ACHETÉ, par laitier.
 *
 * Stocké à part des `foodPatches` et pas dedans, alors qu'il finit par produire un
 * patch : un patch fige des macros, ce taux est une intention. Tant qu'on garde le
 * pourcentage, on peut redériver les macros si la fiche de base change, revenir au
 * 0 % en un tap, et surtout afficher « tu as déclaré du 3 % » plutôt qu'une colonne
 * de nombres que personne ne reconnaît.
 */
const fatPct = ref<Record<string, number>>({})
/**
 * Repas du dehors : ce qu'on a vraiment mangé à la place du plat prévu.
 *
 * Séparé de `picked`, qui ne stocke qu'un identifiant de la bibliothèque, et séparé
 * des `extras`, qui s'ajoutent au plan au lieu de s'y substituer. Voir lib/freeMeal.ts
 * pour le raisonnement complet.
 */
const freeMeals = ref<Record<string, Record<string, FreeMeal>>>({})
/** Ceux qu'on a demandé à garder : le kebab du coin revient plus d'une fois. */
const freePresets = ref<FreeMeal[]>([])
/**
 * Ratios cru → cuit relevés à la balance, par aliment.
 *
 * Stockés à part des `foodPatches`, pour la même raison que le taux de matière
 * grasse : un patch fige des macros, ceci est une MESURE de cuisson. Les macros du
 * riz ne changent pas parce qu'on l'a fait cuire deux minutes de plus — seule sa
 * masse change, et c'est exactement ce qu'on garde ici.
 */
const cookedRatios = ref<Record<string, number>>({})
let hydrated = false
let seq = 0
function safeParse<T>(raw: string | null, fb: T): T {
  if (!raw) return fb
  try { return JSON.parse(raw) as T } catch { return fb }
}
function write(key: string, value: unknown) {
  if (!import.meta.client) return
  try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* stockage plein ou indispo */ }
}
// La date de démarrage et le mode de préparation sont stockés en clair, pas en JSON.
function writeRaw(key: string, value: string) {
  if (!import.meta.client) return
  try { localStorage.setItem(key, value) } catch { /* stockage plein ou indispo */ }
}
/** Identifiant local unique — sans crypto.randomUUID, pour rester testable partout. */
const nextId = (prefix: string) => `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}`
const isWeek = (w: unknown): w is WeekTemplate =>
  !!w && Array.isArray((w as WeekTemplate).gym) && (w as WeekTemplate).gym.length === 7
  && Array.isArray((w as WeekTemplate).tt) && (w as WeekTemplate).tt.length === 7
export function useNutrition() {
  function hydrate() {
    if (hydrated || !import.meta.client) return
    prices.value = safeParse(localStorage.getItem(PRICES_KEY), {})
    checked.value = safeParse(localStorage.getItem(CHECKED_KEY), {})
    eaten.value = safeParse(localStorage.getItem(EATEN_KEY), {})
    baskets.value = safeParse(localStorage.getItem(BASKETS_KEY), [])
    overrides.value = safeParse(localStorage.getItem(OVER_KEY), {})
    loadMenus()
    picked.value = safeParse(localStorage.getItem(PICKED_KEY), {})
    adjustOk.value = safeParse(localStorage.getItem(ADJUST_KEY), {})
    extras.value = safeParse(localStorage.getItem(EXTRA_KEY), {})
    userFoods.value = safeParse(localStorage.getItem(FOODS_KEY), [])
    foodPatches.value = safeParse(localStorage.getItem(FOODPATCH_KEY), {})
    fatPct.value = safeParse(localStorage.getItem(FATPCT_KEY), {})
    userRecipes.value = safeParse(localStorage.getItem(RECIPES_KEY), [])
    recipePatches.value = safeParse(localStorage.getItem(RECIPEPATCH_KEY), {})
    disabledRecipes.value = safeParse(localStorage.getItem(OFF_KEY), [])
    freeMeals.value = safeParse(localStorage.getItem(FREE_KEY), {})
    freePresets.value = safeParse(localStorage.getItem(FREEPRESET_KEY), [])
    cookedRatios.value = safeParse(localStorage.getItem(COOKED_KEY), {})
    const w = safeParse<unknown>(localStorage.getItem(WEEK_KEY), null)
    if (isWeek(w)) week.value = w
    const pm = localStorage.getItem(PREP_KEY)
    if (pm === 'assembled' || pm === 'separate') prepMode.value = pm
    freezer.value = localStorage.getItem(FREEZER_KEY) === '1'
    hydrated = true
  }

  /**
   * Charge les semaines types, en garantissant que les deux semaines livrées sont
   * toujours présentes. Elles sont recalculées depuis le plan, jamais lues du
   * stockage : c'est ce qui permet de les corriger dans le code sans laisser une
   * version périmée coincée dans un navigateur.
   */
  function loadMenus() {
    const saved = safeParse<unknown[]>(localStorage.getItem(MENUS_KEY), [])
    const mine = (Array.isArray(saved) ? saved : [])
      .map(normalizeWeek)
      .filter((w): w is MenuWeek => !!w && !w.builtin)
    menus.value = [...builtinWeeks(), ...mine]
    const act = localStorage.getItem(ACTIVE_KEY)
    activeMenu.value = act && menus.value.some(m => m.id === act) ? act : menus.value[0]?.id ?? null
    menuAssign.value = safeParse(localStorage.getItem(ASSIGN_KEY), {})
    // Ménage : la sélection manuelle et la date de démarrage n'ont plus de sens.
    // Les laisser traîner ferait réapparaître de vieilles portions à la première
    // restauration de sauvegarde.
    try {
      localStorage.removeItem(LEGACY_SEL_KEY)
      localStorage.removeItem(LEGACY_START_KEY)
    }
    catch { /* stockage indisponible */ }
  }
  /** N'écrit QUE les semaines perso : les livrées viennent du code. */
  const saveMenus = () => write(MENUS_KEY, menus.value.filter(m => !m.builtin))
  // ─── Bibliothèque ─────────────────────────────────────────────────────────
  /** Aliments et plats effectivement disponibles : livrés + créés + modifiés. */
  const library = computed<Library>(() => {
    const foods = mergeFoods(userFoods.value, foodPatches.value)
    // Le taux déclaré s'applique EN DERNIER : il redérive les macros depuis la fiche
    // telle qu'elle est après patch, et pas depuis la fiche d'origine. Sinon corriger
    // les protéines d'un fromage blanc effacerait la correction dès qu'on touche au
    // taux, sans que rien ne le dise.
    for (const [id, pct] of Object.entries(fatPct.value)) {
      const f = foods[id]
      if (f && isAdjustableDairy(f)) foods[id] = atFatPct(f, pct)
    }
    return {
      foods,
      recipes: mergeRecipes(userRecipes.value, recipePatches.value, disabledRecipes.value),
    }
  })

  // ─── Taux de matière grasse des laitiers ──────────────────────────────────
  /**
   * Les laitiers dont le taux se règle. `food` porte les macros DÉRIVÉES du taux
   * déclaré, pas celles de la fiche : c'est le seul moyen de vérifier d'un coup d'œil
   * que ce qui est coché correspond à l'étiquette du pot qu'on a dans la main.
   */
  const dairyFoods = computed(() => {
    const base = mergeFoods(userFoods.value, foodPatches.value)
    return Object.values(base)
      .filter(isAdjustableDairy)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((f) => {
        const pct = fatPct.value[f.id] ?? 0
        return { food: atFatPct(f, pct), base: f, pct }
      })
  })

  function setFatPct(id: string, pct: number) {
    const next = { ...fatPct.value }
    if (!pct) delete next[id] // 0 % = le produit du plan : on ne stocke rien
    else next[id] = pct
    fatPct.value = next
    write(FATPCT_KEY, fatPct.value)
  }

  /** Ce que les taux déclarés coûtent sur une journée moyenne, rééquilibrage compris. */
  const dairyCost = computed(() => {
    if (!Object.keys(fatPct.value).length) return null
    const gym = week.value.gym
    return dairySwapCost(library.value, i => !!gym[i % 7])
  })
  const isCustomFood = (id: string) => userFoods.value.some(f => f.id === id)
  const isCustomRecipe = (id: string) => userRecipes.value.some(r => r.id === id)
  /** Ajoute un aliment saisi depuis un emballage. Renvoie son id. */
  function addFood(food: Omit<Food, 'id'> & { id?: string }): string {
    const id = food.id || slugify(food.name, Object.keys(library.value.foods))
    userFoods.value = [...userFoods.value.filter(f => f.id !== id), { ...food, id, custom: true } as Food]
    write(FOODS_KEY, userFoods.value)
    return id
  }
  /** Modifie un aliment. Un aliment livré est patché, un aliment perso est réécrit. */
  function patchFood(id: string, patch: Partial<Food>) {
    if (isCustomFood(id)) {
      userFoods.value = userFoods.value.map(f => (f.id === id ? { ...f, ...patch, id } : f))
      write(FOODS_KEY, userFoods.value)
      return
    }
    foodPatches.value = { ...foodPatches.value, [id]: { ...foodPatches.value[id], ...patch } }
    write(FOODPATCH_KEY, foodPatches.value)
  }
  function removeFood(id: string) {
    userFoods.value = userFoods.value.filter(f => f.id !== id)
    write(FOODS_KEY, userFoods.value)
  }
  /** Annule les modifications faites sur un aliment livré. */
  function resetFood(id: string) {
    const next = { ...foodPatches.value }
    delete next[id]
    foodPatches.value = next
    write(FOODPATCH_KEY, foodPatches.value)
  }
  function addRecipe(recipe: Omit<Recipe, 'id'> & { id?: string }): string {
    const id = recipe.id || slugify(recipe.name, Object.keys(library.value.recipes))
    userRecipes.value = [...userRecipes.value.filter(r => r.id !== id), { ...recipe, id, custom: true } as Recipe]
    write(RECIPES_KEY, userRecipes.value)
    return id
  }
  function patchRecipe(id: string, patch: Partial<Recipe>) {
    if (isCustomRecipe(id)) {
      userRecipes.value = userRecipes.value.map(r => (r.id === id ? { ...r, ...patch, id } : r))
      write(RECIPES_KEY, userRecipes.value)
      return
    }
    recipePatches.value = { ...recipePatches.value, [id]: { ...recipePatches.value[id], ...patch } }
    write(RECIPEPATCH_KEY, recipePatches.value)
  }
  function removeRecipe(id: string) {
    userRecipes.value = userRecipes.value.filter(r => r.id !== id)
    write(RECIPES_KEY, userRecipes.value)
  }
  /**
   * Ce plat porte-t-il une modification locale ?
   *
   * La question n'est pas cosmétique : un patch écrase les champs livrés (voir
   * `mergeRecipes`). Un plat modifié un jour dans l'app garde donc SES grammages
   * même après une mise à jour du programme — et rien ne le signalait, puisque le
   * bouton « revenir à la version d'origine » s'affichait sur tous les plats.
   */
  const isRecipePatched = (id: string) =>
    !!recipePatches.value[id] && Object.keys(recipePatches.value[id]).length > 0
  const isFoodPatched = (id: string) =>
    !!foodPatches.value[id] && Object.keys(foodPatches.value[id]).length > 0
  /** Les plats livrés qui ne suivent plus le programme, pour pouvoir les signaler. */
  const patchedRecipes = computed(() => Object.keys(recipePatches.value).filter(isRecipePatched))

  function resetRecipe(id: string) {
    const next = { ...recipePatches.value }
    delete next[id]
    recipePatches.value = next
    write(RECIPEPATCH_KEY, recipePatches.value)
  }
  /** Met un plat de côté : il reste consultable mais ne tombe plus dans le planning. */
  function toggleRecipeActive(id: string) {
    disabledRecipes.value = disabledRecipes.value.includes(id)
      ? disabledRecipes.value.filter(x => x !== id)
      : [...disabledRecipes.value, id]
    write(OFF_KEY, disabledRecipes.value)
  }
  const isRecipeActive = (id: string) => !disabledRecipes.value.includes(id)
  // ─── Planning ─────────────────────────────────────────────────────────────
  /** Semaine type : deux axes indépendants, la salle et le télétravail. */
  function setWeekDay(dow: number, field: 'gym' | 'tt', value: boolean) {
    const next: WeekTemplate = { gym: [...week.value.gym], tt: [...week.value.tt] }
    next[field][dow] = value
    week.value = next
    write(WEEK_KEY, week.value)
  }
  function resetWeek() {
    week.value = { gym: [...DEFAULT_WEEK.gym], tt: [...DEFAULT_WEEK.tt] }
    write(WEEK_KEY, week.value)
  }
  const dayFor = (iso: string) => resolveDay(iso, week.value, overrides.value[iso])
  /** Exception ponctuelle. Une valeur `undefined` revient à la semaine type. */
  function setOverride(iso: string, patch: DayOverride) {
    const cur: DayOverride = { ...overrides.value[iso], ...patch }
    for (const k of Object.keys(cur) as (keyof DayOverride)[]) {
      if (cur[k] === undefined || cur[k] === null) delete cur[k]
    }
    const next = { ...overrides.value }
    if (Object.keys(cur).length) next[iso] = cur
    else delete next[iso]
    overrides.value = next
    write(OVER_KEY, overrides.value)
  }
  function clearOverride(iso: string) {
    const next = { ...overrides.value }
    delete next[iso]
    overrides.value = next
    write(OVER_KEY, overrides.value)
  }
  const hasOverride = (iso: string) => !!overrides.value[iso]
  /**
   * Télétravail CONFIRMÉ ce jour-là, par opposition à celui que la semaine type
   * suppose. Le calendrier ne montre que du réel : un mardi de télétravail par
   * défaut mais passé au bureau ne doit pas rester marqué comme tel dans
   * l'historique.
   */
  const ttConfirmed = (iso: string) => overrides.value[iso]?.tt === true

  // ─── Semaines types de menus ──────────────────────────────────────────────
  const menuById = (id: string | null) => (id ? menus.value.find(m => m.id === id) ?? null : null)
  /** La semaine en cours d'édition et de préparation. */
  const activeWeek = computed<MenuWeek | null>(() => menuById(activeMenu.value) ?? menus.value[0] ?? null)

  function setActiveMenu(id: string) {
    if (!menus.value.some(m => m.id === id)) return
    activeMenu.value = id
    writeRaw(ACTIVE_KEY, id)
  }
  /**
   * Applique une semaine à partir d'un lundi donné. C'est ce geste-là qui « démarre »
   * un plan : il n'y a plus de date de démarrage à régler à part, puisque choisir sa
   * semaine et la lancer sont la même décision.
   */
  function applyMenuFrom(iso: string, id = activeMenu.value) {
    if (!id || !menus.value.some(m => m.id === id)) return
    menuAssign.value = { ...menuAssign.value, [mondayOf(iso)]: id }
    write(ASSIGN_KEY, menuAssign.value)
    setActiveMenu(id)
  }
  /** Semaine appliquée à une date : la dernière assignée avant elle, sinon celle en cours. */
  function menuFor(iso: string): MenuWeek | null {
    const monday = mondayOf(iso)
    const past = Object.keys(menuAssign.value).filter(m => m <= monday).sort()
    const id = past.length ? menuAssign.value[past.at(-1)!] : null
    return menuById(id) ?? activeWeek.value
  }
  const appliedFrom = computed(() => Object.keys(menuAssign.value).sort().at(-1) ?? null)

  function patchMenu(id: string, fn: (w: MenuWeek) => MenuWeek) {
    menus.value = menus.value.map(m => (m.id === id ? fn(m) : m))
    saveMenus()
  }
  /**
   * Change la recette d'un créneau. Une semaine LIVRÉE est d'abord recopiée : les
   * deux semaines du plan doivent rester ce qu'elles sont, sinon on ne peut plus
   * revenir au point de départ après avoir bricolé.
   */
  function setMenuSlot(dow: number, slotId: string, recipeId: string) {
    const id = forkIfBuiltin()
    if (!id) return
    patchMenu(id, (w) => {
      const days = w.days.map((d, i) => (i === dow ? { ...d, slots: { ...d.slots, [slotId]: recipeId } } : d))
      return { ...w, days }
    })
  }
  /** « Je ne suis pas là ce jour-là » : plus de repas prévus, ni de courses, ni de cuisine. */
  function toggleMenuDayOff(dow: number) {
    const id = forkIfBuiltin()
    if (!id) return
    patchMenu(id, w => ({ ...w, days: w.days.map((d, i) => (i === dow ? { ...d, off: !d.off } : d)) }))
  }
  /** Duplique la semaine active sous un nouveau nom et bascule dessus. */
  /**
   * Crée une semaine complète d'un coup, et la nomme.
   *
   * Il n'existait que `duplicateMenu` + `setMenuSlot` créneau par créneau : quatorze
   * écritures et autant d'occasions de laisser une semaine à moitié écrite si l'une
   * d'elles échouait. Une semaine proposée par le connecteur arrive entière ou pas
   * du tout — elle s'écrit donc entière ou pas du tout.
   */
  function createMenu(name: string, days: MenuDay[]): string | null {
    if (!Array.isArray(days) || days.length !== 7) return null
    const id = `w-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`
    const week: MenuWeek = {
      id,
      name: name.trim() || 'Semaine',
      days: days.map(d => ({ off: !!d.off, slots: { ...d.slots } })),
    }
    menus.value = [...menus.value, week]
    saveMenus()
    return id
  }

  function duplicateMenu(name?: string): string | null {
    const src = activeWeek.value
    if (!src) return null
    const id = nextId('week')
    const copy: MenuWeek = {
      id,
      name: name || `${src.name.replace(/ \(copie.*\)$/, '')} (copie)`,
      days: src.days.map(d => ({ off: d.off, slots: { ...d.slots } })),
    }
    menus.value = [...menus.value, copy]
    saveMenus()
    setActiveMenu(id)
    return id
  }
  /** Une semaine livrée n'est pas modifiable : la première retouche en fait une copie. */
  function forkIfBuiltin(): string | null {
    return activeWeek.value?.builtin ? duplicateMenu(`${activeWeek.value.name} modifiée`) : activeWeek.value?.id ?? null
  }
  function renameMenu(id: string, name: string) {
    if (name.trim()) patchMenu(id, w => ({ ...w, name: name.trim() }))
  }
  function removeMenu(id: string) {
    const target = menuById(id)
    if (!target || target.builtin) return
    menus.value = menus.value.filter(m => m.id !== id)
    saveMenus()
    if (activeMenu.value === id) setActiveMenu(menus.value[0]!.id)
  }
  /** Semaine vierge : sept jours sans rien, à remplir de zéro. */
  function blankMenu(name = 'Ma semaine'): string {
    const id = nextId('week')
    menus.value = [...menus.value, { id, name, days: blankWeekDays() }]
    saveMenus()
    setActiveMenu(id)
    return id
  }

  // ─── Ce qui découle de la semaine ─────────────────────────────────────────
  // Une donnée, un endroit : portions, courses et cuisine ne sont plus saisies ni
  // stockées séparément, elles se COMPTENT dans la semaine choisie. Une portion
  // saisie à la main à côté du menu finissait toujours par le contredire.
  const gymDays = computed(() => week.value.gym)
  const selection = computed(() => (activeWeek.value ? cookSelection(activeWeek.value, gymDays.value, library.value) : {}))
  const selectionSummary = computed(() => selectionTotals(selection.value, library.value))
  const daysCovered = computed(() => (activeWeek.value ? weekDaysOn(activeWeek.value) : 0))
  // Les quantités suivent le foyer : cuisiner à deux toute une semaine change la
  // liste de fond en comble, et la refaire de tête est ce qu'une liste de courses
  // doit éviter. Le facteur vaut 1 quand on cuisine seul — rien ne change alors.
  const foyer = useFoyer()
  const selectionShopping = computed(() =>
    (activeWeek.value ? shoppingFromWeek(activeWeek.value, gymDays.value, library.value, foyer.facteur.value) : []))
  /** Les sessions de cuisine : dimanche, mercredi si besoin, et le soir même. */
  const cookSessions = computed(() =>
    (activeWeek.value ? cookPlan(activeWeek.value, gymDays.value, library.value, { freezer: freezer.value, facteur: foyer.facteur.value }) : []))
  function setFreezer(has: boolean) {
    freezer.value = has
    writeRaw(FREEZER_KEY, has ? '1' : '0')
  }

  /** Portions déjà consommées, par plat : sert à savoir ce qu'il reste au frigo. */
  const consumed = computed(() => {
    const out: Record<string, number> = {}
    for (const bySlot of Object.values(picked.value)) {
      for (const id of Object.values(bySlot)) out[id] = (out[id] ?? 0) + 1
    }
    return out
  })
  const stock = computed(() => stockOf(selection.value, consumed.value))

  // ─── Plat réellement pris ─────────────────────────────────────────────────
  const pickedFor = (iso: string, slot: string) => picked.value[iso]?.[slot] ?? null
  function setPicked(iso: string, slot: string, recipeId: string | null) {
    const day = { ...(picked.value[iso] ?? {}) }
    if (recipeId) day[slot] = recipeId
    else delete day[slot]
    const next = { ...picked.value }
    if (Object.keys(day).length) next[iso] = day
    else delete next[iso]
    picked.value = next
    write(PICKED_KEY, picked.value)
  }
  /** Pas du jour. `null` = non saisis, on retombe sur l'estimation télétravail / sur site. */
  const stepsFor = (iso: string) => overrides.value[iso]?.steps ?? null
  const setSteps = (iso: string, steps: number | null) =>
    setOverride(iso, { steps: steps === null || !Number.isFinite(steps as number) ? undefined : Math.max(0, Math.round(steps as number)) })
  // ─── Le menu d'une journée ────────────────────────────────────────────────
  /**
   * Le plan d'une journée, où qu'on soit dans le temps.
   *
   * La semaine type se répète : un jeudi ressemble au jeudi de la semaine choisie,
   * indéfiniment. C'est tout l'intérêt d'un modèle de sept jours — il n'y a plus de
   * date de démarrage à surveiller ni de fenêtre de quatorze jours au-delà de
   * laquelle l'appli ne propose plus rien.
   *
   * Trois couches, de la plus générale à la plus précise :
   *   1. la semaine appliquée à ce lundi-là (l'historique reste vrai) ;
   *   2. l'exception de planning posée sur cette date ;
   *   3. le plat réellement pris — « j'ai mangé autre chose » —, qui l'emporte
   *      toujours, parce que ce qui a été mangé prime sur ce qui était proposé.
   *
   * Un jour marqué absent ne propose rien — mais renvoie quand même une journée,
   * vide et signalée comme telle : la date existe toujours, et un `null` obligerait
   * chaque écran à se protéger d'un cas rare.
   */
  function dayPlanFor(iso: string, trained: boolean): DayPlan {
    const dow = dowIndex(iso)
    const mw = menuFor(iso)
    const day = mw?.days[dow]
    const over = dayFor(iso).menu
    const pick = picked.value[iso] ?? {}
    if (day?.off && !Object.keys(pick).length) return withFree(emptyDay(dow, trained), iso, trained)

    const slots = { ...day?.slots, ...pick }
    // Semaine vierge : on ne propose PAS le menu du cycle en douce. Un repas affiché
    // mais jamais acheté ni cuisiné est pire que pas de repas du tout — on le coche
    // sans y penser et le compteur du jour devient faux.
    if (day) {
      slots.lunch ??= ''
      slots.dinner ??= ''
    }
    // Une exception de planning ne porte que sur les deux repas principaux.
    if (over.lunch && !pick.lunch) slots.lunch = over.lunch
    if (over.dinner && !pick.dinner) slots.dinner = over.dinner
    return withFree(buildDay(dow, trained, library.value, { slots }), iso, trained)
  }

  /**
   * Un repas du dehors l'emporte sur tout le reste, y compris sur `picked`.
   *
   * L'ordre n'est pas arbitraire : c'est la couche la plus proche de ce qui a
   * réellement été mangé, et c'est la règle que suit déjà tout le fichier.
   *
   * Le cas du jour marqué absent est traité plus haut par un retour anticipé sur
   * `emptyDay`, ce qui l'aurait privé de ses repas du dehors — d'où la reprise ici
   * aussi : c'est justement le samedi au restaurant qu'on veut compter.
   */
  function withFree(day: DayPlan, iso: string, trained: boolean): DayPlan {
    const free = freeMeals.value[iso]
    if (!free || !Object.keys(free).length) return day
    const slots = trained ? SLOTS_GYM : SLOTS_REST
    return withFreeMeals(day, free, (id) => {
      const s = slots.find(x => x.id === id)
      return s ? { time: s.time, label: s.label } : null
    })
  }
  // ─── Repas du dehors ──────────────────────────────────────────────────────
  const freeMealFor = (iso: string, slot: string): FreeMeal | null => freeMeals.value[iso]?.[slot] ?? null

  /**
   * Pose ou retire le repas du dehors d'un créneau. Rend `false` si la saisie ne
   * veut rien dire — l'écran doit pouvoir le dire plutôt que d'enregistrer un repas
   * vide qui occuperait le créneau sans rien compter.
   *
   * Le ménage est le même que pour `picked` : on efface la clé du créneau, puis
   * celle de la date si elle se vide. Des objets vides s'accumuleraient sinon dans
   * la sauvegarde, un par jour où l'on a changé d'avis.
   */
  function setFreeMeal(iso: string, slot: string, raw: Partial<FreeMeal> | null): boolean {
    const jour = { ...(freeMeals.value[iso] ?? {}) }
    if (raw === null) delete jour[slot]
    else {
      const meal = freeMealFrom(raw)
      if (!meal) return false
      jour[slot] = meal
    }
    const next = { ...freeMeals.value }
    if (Object.keys(jour).length) next[iso] = jour
    else delete next[iso]
    freeMeals.value = next
    write(FREE_KEY, freeMeals.value)
    return true
  }

  /** Garde un repas pour le resservir. Même libellé = même entrée, on remplace. */
  function addFreePreset(raw: Partial<FreeMeal>): boolean {
    const meal = freeMealFrom(raw)
    if (!meal) return false
    const clef = meal.label.toLowerCase()
    freePresets.value = [...freePresets.value.filter(m => m.label.toLowerCase() !== clef), meal].slice(-30)
    write(FREEPRESET_KEY, freePresets.value)
    return true
  }
  function removeFreePreset(label: string) {
    freePresets.value = freePresets.value.filter(m => m.label !== label)
    write(FREEPRESET_KEY, freePresets.value)
  }

  // ─── Cuisson : ce que pèse un féculent une fois cuit ───────────────────────
  /**
   * Enregistre une pesée, ou l'efface pour revenir à la valeur de référence.
   *
   * On stocke le RATIO et non les deux poids : c'est lui qui resservira sur une
   * casserole d'une autre taille, et garder « 750 g → 1 950 g » obligerait à
   * refaire la division à chaque affichage.
   */
  function setCookedRatio(foodId: string, cruG: number, cuitG: number): boolean {
    const r = ratioFromWeighing(cruG, cuitG)
    if (!r) return false
    cookedRatios.value = { ...cookedRatios.value, [foodId]: r }
    write(COOKED_KEY, cookedRatios.value)
    return true
  }
  function clearCookedRatio(foodId: string) {
    const next = { ...cookedRatios.value }
    delete next[foodId]
    cookedRatios.value = next
    write(COOKED_KEY, cookedRatios.value)
  }

  // ─── Repas mangés ─────────────────────────────────────────────────────────
  const isEaten = (iso: string, slot: string) => (eaten.value[iso] ?? []).includes(slot)
  function toggleEaten(iso: string, slot: string) {
    const cur = eaten.value[iso] ?? []
    const next = cur.includes(slot) ? cur.filter(s => s !== slot) : [...cur, slot]
    eaten.value = { ...eaten.value, [iso]: next }
    write(EATEN_KEY, eaten.value)
  }
  const eatenSlots = (iso: string) => eaten.value[iso] ?? []
  const eatenCount = (iso: string) => eatenSlots(iso).length
  // ─── Sac de sport ─────────────────────────────────────────────────────────
  // ─── Ajustement du soir ───────────────────────────────────────────────────
  /** L'ajustement proposé aujourd'hui a-t-il été confirmé, dans cette forme-là ? */
  const isAdjustApplied = (iso: string, signature: string) =>
    !!signature && adjustOk.value[iso] === signature
  function setAdjustApplied(iso: string, signature: string) {
    if (!signature) return
    adjustOk.value = { ...adjustOk.value, [iso]: signature }
    write(ADJUST_KEY, adjustOk.value)
  }
  function clearAdjustApplied(iso: string) {
    const next = { ...adjustOk.value }
    delete next[iso]
    adjustOk.value = next
    write(ADJUST_KEY, adjustOk.value)
  }
  const extrasFor = (iso: string) => extras.value[iso] ?? []
  function addExtra(iso: string, extra: Omit<Extra, 'id'>) {
    const e: Extra = { ...extra, id: nextId('x') }
    extras.value = { ...extras.value, [iso]: [...extrasFor(iso), e] }
    write(EXTRA_KEY, extras.value)
    return e.id
  }
  function removeExtra(iso: string, id: string) {
    extras.value = { ...extras.value, [iso]: extrasFor(iso).filter(e => e.id !== id) }
    write(EXTRA_KEY, extras.value)
  }
  // ─── Prix et liste de courses ─────────────────────────────────────────────
  function setPrice(foodId: string, pricePerKg: number | null) {
    const next = { ...prices.value }
    if (pricePerKg && pricePerKg > 0) next[foodId] = Math.round(pricePerKg * 100) / 100
    else delete next[foodId]
    prices.value = next
    write(PRICES_KEY, prices.value)
  }
  const isChecked = (foodId: string) => !!checked.value[foodId]
  function toggleChecked(foodId: string) {
    checked.value = { ...checked.value, [foodId]: !checked.value[foodId] }
    write(CHECKED_KEY, checked.value)
  }
  function clearChecked() {
    checked.value = {}
    write(CHECKED_KEY, checked.value)
  }
  function setPrepMode(mode: PrepMode) {
    prepMode.value = mode
    writeRaw(PREP_KEY, mode)
  }
  // La liste de courses ne se déduit plus d'une fenêtre de jours du cycle : elle
  // sort de la SÉLECTION (voir `selectionShopping`). Il fallait sinon accepter le
  // menu livré tel quel pour obtenir une liste juste.
  const cost = (list: ShoppingList) => basketTotal(list, prices.value)
  function addBasket(total: number, days: number, iso = isoOf(new Date())) {
    if (!(total > 0)) return
    baskets.value = [{ date: iso, total: Math.round(total * 100) / 100, days }, ...baskets.value].slice(0, 24)
    write(BASKETS_KEY, baskets.value)
  }
  function removeBasket(index: number) {
    baskets.value = baskets.value.filter((_, i) => i !== index)
    write(BASKETS_KEY, baskets.value)
  }
  const pricedCount = computed(() => Object.keys(prices.value).length)
  // ─── Sauvegarde ───────────────────────────────────────────────────────────
  function exportData() {
    return {
      prices: prices.value, checked: checked.value,
      eaten: eaten.value, baskets: baskets.value,
      // Les portions ne sont plus sauvegardées : elles se recomptent dans les
      // semaines. Sauvegarder les deux, c'était exporter deux fois le même chiffre
      // et laisser une restauration partielle les faire diverger.
      menus: menus.value.filter(m => !m.builtin), activeMenu: activeMenu.value, menuAssign: menuAssign.value,
      picked: picked.value, adjustOk: adjustOk.value,
      prepMode: prepMode.value, freezer: freezer.value, week: week.value, overrides: overrides.value,
      extras: extras.value, userFoods: userFoods.value, foodPatches: foodPatches.value, fatPct: fatPct.value,
      userRecipes: userRecipes.value, recipePatches: recipePatches.value,
      disabledRecipes: disabledRecipes.value,
      freeMeals: freeMeals.value, freePresets: freePresets.value, cookedRatios: cookedRatios.value,
    }
  }
  /** Restauration depuis une sauvegarde. Tout est optionnel : un ancien fichier passe sans erreur. */
  function restore(data: { nutrition?: Partial<ReturnType<typeof exportData>> & { skipped?: string[] } }) {
    const n = data?.nutrition
    if (!n || typeof n !== 'object') return
    if (n.prices) { prices.value = n.prices; write(PRICES_KEY, prices.value) }
    if (n.checked) { checked.value = n.checked; write(CHECKED_KEY, checked.value) }
    if (Array.isArray(n.menus)) {
      const mine = n.menus.map(normalizeWeek).filter((w): w is MenuWeek => !!w && !w.builtin)
      menus.value = [...builtinWeeks(), ...mine]
      saveMenus()
    }
    if (typeof n.activeMenu === 'string' && menus.value.some(m => m.id === n.activeMenu)) setActiveMenu(n.activeMenu)
    if (n.menuAssign) { menuAssign.value = n.menuAssign; write(ASSIGN_KEY, menuAssign.value) }
    if (n.picked) { picked.value = n.picked; write(PICKED_KEY, picked.value) }
    if (n.adjustOk) { adjustOk.value = n.adjustOk; write(ADJUST_KEY, adjustOk.value) }
    if (n.eaten) { eaten.value = n.eaten; write(EATEN_KEY, eaten.value) }
    if (Array.isArray(n.baskets)) { baskets.value = n.baskets; write(BASKETS_KEY, baskets.value) }
    if (n.prepMode === 'assembled' || n.prepMode === 'separate') setPrepMode(n.prepMode)
    if (typeof n.freezer === 'boolean') setFreezer(n.freezer)
    if (isWeek(n.week)) { week.value = n.week; write(WEEK_KEY, week.value) }
    if (n.overrides) { overrides.value = n.overrides; write(OVER_KEY, overrides.value) }
    if (n.extras) { extras.value = n.extras; write(EXTRA_KEY, extras.value) }
    if (Array.isArray(n.userFoods)) { userFoods.value = n.userFoods; write(FOODS_KEY, userFoods.value) }
    if (n.foodPatches) { foodPatches.value = n.foodPatches; write(FOODPATCH_KEY, foodPatches.value) }
    if (n.fatPct) { fatPct.value = n.fatPct as Record<string, number>; write(FATPCT_KEY, fatPct.value) }
    if (Array.isArray(n.userRecipes)) { userRecipes.value = n.userRecipes; write(RECIPES_KEY, userRecipes.value) }
    if (n.recipePatches) { recipePatches.value = n.recipePatches; write(RECIPEPATCH_KEY, recipePatches.value) }
    if (Array.isArray(n.disabledRecipes)) { disabledRecipes.value = n.disabledRecipes; write(OFF_KEY, disabledRecipes.value) }
    if (n.freeMeals) { freeMeals.value = n.freeMeals; write(FREE_KEY, freeMeals.value) }
    if (Array.isArray(n.freePresets)) { freePresets.value = n.freePresets; write(FREEPRESET_KEY, freePresets.value) }
    if (n.cookedRatios) { cookedRatios.value = n.cookedRatios as Record<string, number>; write(COOKED_KEY, cookedRatios.value) }
    // Sauvegardes de la version précédente : les séances annulées étaient une liste à part.
    if (Array.isArray(n.skipped)) {
      for (const iso of n.skipped) setOverride(iso, { gym: false })
    }
  }
  return {
    prices, checked, eaten, baskets, pricedCount, prepMode, picked,
    week, overrides, extras, userFoods, userRecipes, disabledRecipes, library,
    freeMeals, freePresets, freeMealFor, setFreeMeal, addFreePreset, removeFreePreset,
    cookedRatios, setCookedRatio, clearCookedRatio,
    hydrate, dayPlanFor,
    setWeekDay, resetWeek, dayFor, setOverride, clearOverride, hasOverride, ttConfirmed, stepsFor, setSteps,
    menus, activeMenu, activeWeek, menuFor, appliedFrom, gymDays,
    setActiveMenu, applyMenuFrom, setMenuSlot, toggleMenuDayOff, createMenu,
    duplicateMenu, renameMenu, removeMenu, blankMenu,
    selection, selectionSummary, selectionShopping, cookSessions, daysCovered, stock, pickedFor, setPicked,
    freezer, setFreezer,
    isEaten, toggleEaten, eatenSlots, eatenCount,
    isAdjustApplied, setAdjustApplied, clearAdjustApplied,
    isRecipePatched, isFoodPatched, patchedRecipes,
    extrasFor, addExtra, removeExtra,
    addFood, patchFood, removeFood, resetFood, isCustomFood,
    dairyFoods, setFatPct, dairyCost, fatPct,
    addRecipe, patchRecipe, removeRecipe, resetRecipe, isCustomRecipe,
    toggleRecipeActive, isRecipeActive,
    setPrice, isChecked, toggleChecked, clearChecked, setPrepMode,
    cost, addBasket, removeBasket,
    exportData, restore,
  }
}
