import { describe, expect, it, vi } from 'vitest'
import {
  CAT_ORDER, CYCLE, CYCLE_LENGTH, FOOD_BY_ID, KEEPS_DEFAULT, MICRO_REFS,
  RATIO_LUNCH_GYM, RATIO_REST,
  KEEPS_FRESH, RECIPE_BY_ID, STARCHY_IDS, SLOTS_GYM, SLOTS_REST,
} from '../../data/nutritionProgram'
import {
  ADJUST_THRESHOLD, CARRY_MAX_PER_DAY, DEFICIT_MAX, DEFICIT_MIN, STEPS_TT,
  activeRecipes, applyAdjustment, assessTrend, basketTotal, bmrMifflin, buildDay,
  carryAdjustedTarget, dayEnergy, dayIntake, mergeFoods, mergeRecipes, nextMeal,
  resolveDay, slugify, timelineOf, validateFood, validateRecipe, weekBalance,
  CYCLE_EPOCH, cycleIndexOf, dayBurn, dayStatus, DEFAULT_TRAINED, dinnerAdjustment, fmtQty, isDayPlayed,
  adjustSignature, ingredientLines,
  atFatPct, isAdjustableDairy, rebalanceDairy, splitIngredients, choicesForSlot, slotKind, slotKinds, dairySwapCost, FAT_PCT_MAX, DAIRY_KEEP_MIN,
  macroSplit, macrosOf, microCoverage, mondayOf, proteinTarget, roundMacros, scaleItems,
  fatRatioOf, leanMassOf, proteinPerKgLean, proteinPlan,
  PROTEIN_FAT_HIGH, PROTEIN_FAT_LOW, PROTEIN_LEAN_MAX, PROTEIN_LEAN_MIN,
  adjustPlanFor, applySteps, LEAVE_MAX, removalSteps, adjustRemaining, upcomingPlan, ADJUST_MAX,
  FAT_PER_KG, KCAL_G, KCAL_L, KCAL_P, MACRO_BAND, donutArcs, macroGaps, macroTargets,
  builtinWeeks, cookPlaceFor, cookPlan, cookSelection, cookSlotFor, cookSteps, freezableOf, freshItemsOf,
  cookIngredients, expandItems, isStarchy, keepsOf, listDays,
  FIBER_HIGH, FIBER_MIN, fiberIntake, fiberOf, fiberVerdict,
  normalizeWeek,
  selectionTotals, shoppingFrom, shoppingFromWeek, stockOf, weekDayPlans, weekDaysOn, weekGrams,
  sessionBurn, sessionsOn, usableDuration,
  workSetCount,
} from '../../lib/nutritionStats'
import type { TrainingLike } from '../../lib/nutritionStats'
import { shiftIso } from '../../utils/sportStats'

// Ces tests tournent sur le PACK D'EXEMPLE : l'application ne livre plus de données.
// Voir test/exemple.ts pour le pourquoi.
vi.mock('../../data/nutritionProgram', () => (import('../exemple')).then(m => m.catalogueExemple()))

// Calculs purs du module nutrition. Le câblage localStorage est testé dans
// test/nuxt/nutritionData.test.ts.

// ─── Macros ──────────────────────────────────────────────────────────────────
describe('macros', () => {
  it('calcule au prorata des grammes', () => {
    // 100 g de filet de poulet = 110 kcal / 23 g de protéines
    const m = macrosOf([{ food: 'filet-de-poulet', g: 200 }])
    expect(Math.round(m.kcal)).toBe(220)
    expect(Math.round(m.p)).toBe(46)
  })

  it('ignore un aliment inconnu au lieu de planter la vue', () => {
    const m = macrosOf([{ food: 'inexistant', g: 500 }, { food: 'pomme', g: 100 }])
    expect(Math.round(m.kcal)).toBe(52)
  })

  it('répartit les calories en pourcentages qui font 100', () => {
    const s = macroSplit({ kcal: 2000, p: 200, g: 200, l: 44 })
    expect(s.p + s.g + s.l).toBeGreaterThanOrEqual(99)
    expect(s.p + s.g + s.l).toBeLessThanOrEqual(101)
  })
})

// ─── Modulation des féculents ────────────────────────────────────────────────
// Régression : la réduction ne doit JAMAIS toucher aux protéines ni aux légumes.
// C'est ce qui protège la masse maigre et la satiété quand les calories baissent.
describe('modulation des féculents', () => {
  const items = [
    { food: 'filet-de-poulet', g: 180 },
    { food: 'riz-basmati', g: 80 },
    { food: 'brocolis', g: 200 },
  ]

  it('ne réduit que les féculents', () => {
    const out = scaleItems(items, RATIO_REST)
    expect(out.find(i => i.food === 'filet-de-poulet')!.g).toBe(180)
    expect(out.find(i => i.food === 'brocolis')!.g).toBe(200)
    expect(out.find(i => i.food === 'riz-basmati')!.g).toBe(40) // 80 × 0,48 arrondi à 5 g
  })

  it('arrondit au multiple de 5 g, pesable à la balance de cuisine', () => {
    for (const it of scaleItems(items, RATIO_LUNCH_GYM)) expect(it.g % 5).toBe(0)
  })

  it('laisse les portions intactes avec un ratio de 1', () => {
    expect(scaleItems(items, 1)).toEqual(items)
  })

  it('ne déclare comme modulable aucune source de protéines', () => {
    for (const id of STARCHY_IDS) expect(FOOD_BY_ID[id].cat).toBe('feculents')
  })
})

// ─── Construction d'une journée ──────────────────────────────────────────────
describe('journée', () => {
  it('sert plus de calories un jour avec séance qu\'un jour sans', () => {
    const gym = buildDay(0, true).total.kcal
    const rest = buildDay(0, false).total.kcal
    expect(gym).toBeGreaterThan(rest)
  })

    // Régression : la séance annulée doit retirer la banane, sinon on garde les
  // calories d'un effort qui n'a pas eu lieu.
  //
  // Ce test surveillait aussi l'absence de whey dans la collation d'un jour sans
  // séance. Ce n'est plus le bon invariant, et c'était même l'erreur : la cible
  // protéique ne baisse pas les jours de repos — le muscle s'y répare — donc la
  // whey est désormais dans les DEUX collations. Ce qui distingue un jour sans
  // séance, c'est la banane et les féculents, pas les protéines.
  it('retire la banane et allège les féculents quand la séance saute', () => {
    const off = buildDay(0, false)
    const on = buildDay(0, true)
    expect(off.meals.map(m => m.slot)).not.toContain('pre')
    expect(off.total.kcal).toBeLessThan(on.total.kcal)
    expect(off.total.g).toBeLessThan(on.total.g)
  })

  it('garde les protéines les jours sans séance : le muscle se répare surtout là', () => {
    const off = buildDay(0, false)
    const snack = off.meals.find(m => m.slot === 'snack')!
    expect(snack.items.map(i => i.food)).toContain('whey-poudre')
    // Et le total protéique de la journée reste dans la même fourchette.
    expect(off.total.p).toBeGreaterThan(buildDay(0, true).total.p * 0.85)
  })


  it('garde la créatine les jours sans séance', () => {
    // La saturation du muscle dépend de la régularité, pas de l'entraînement du jour.
    const rest = buildDay(2, false).meals.flatMap(m => m.items).map(i => i.food)
    const gym = buildDay(0, true).meals.flatMap(m => m.items).map(i => i.food)
    expect(rest).toContain('creatine-monohydrate')
    expect(gym).toContain('creatine-monohydrate')
  })

  // ─── Le plan doit tenir SA PROPRE cible ─────────────────────────────────
  //
  // Ces trois tests sont le contrôle qui manquait. Sans eux, le plan a livré pendant
  // des semaines 236 g de protéines pour une cible de 176 — 34 % au-dessus — et
  // 37 g de lipides pour un plancher de 74, sans que rien ne le signale. Un écart de
  // cette taille ne se voit pas à l'œil : chaque plat pris isolément semblait normal.
  //
  // Les valeurs ne sont plus écrites en dur mais DÉRIVÉES du profil. C'est ce qui
  // fait qu'elles restent vraies quand le poids bouge — et le poids bouge, c'est
  // même l'objectif.
  const BMR = bmrMifflin(92.4, 179, 29, 'h')!
  const COMP = { fatRatio: 26.41, fatMass: 24.4, leanMass: 67.99 }

  // Coût moyen d'une séance, calculé par `sessionBurn` sur les neuf séances
  // réellement enregistrées entre le 21/07 et le 11/08 : 419 kcal.
  const SEANCE = 420
  // Télétravail le mardi et le vendredi.
  const TT = (i: number) => [1, 4].includes(i % 7)

  /**
   * La cible d'un jour du cycle, calculée EXACTEMENT comme l'app la calcule.
   *
   * Ce détour par `dayEnergy` n'est pas une coquetterie, c'est la leçon d'une
   * régression coûteuse. Ces tests s'appuyaient sur `targetOf`, un forfait
   * métabolisme × facteur d'activité qu'AUCUN écran n'utilisait — Hero, Day,
   * DaySheet et History appellent tous `dayEnergy`. Le plan était donc calibré
   * sur un modèle mort : il collait à 2 150 kcal pendant que l'app affichait
   * 2 300, et les jours de séance sont restés 80 à 190 kcal sous leur cible sans
   * qu'un seul test bronche. `targetOf`, `tdeeOf` et `targetFor` ont été
   * supprimés pour qu'on ne puisse plus recalibrer sur eux par mégarde.
   */
  const cibleDu = (i: number) =>
    dayEnergy({ bmr: BMR, kg: 92.4, tt: TT(i), steps: null, sessionKcal: DEFAULT_TRAINED(i) ? SEANCE : 0 }).target

  it('tient la cible calorique du profil, jour par jour', () => {
    for (let i = 0; i < CYCLE_LENGTH; i++) {
      expect(Math.abs(buildDay(i, DEFAULT_TRAINED(i)).total.kcal - cibleDu(i))).toBeLessThan(100)
    }
  })

  it('ne dérive pas de la cible calorique en moyenne sur le cycle', () => {
    // Le jour par jour tolère 100 kcal ; la MOYENNE, elle, ne doit pas dériver —
    // c'est elle qui décide de la vitesse de perte réelle.
    let ecart = 0
    for (let i = 0; i < CYCLE_LENGTH; i++) ecart += buildDay(i, DEFAULT_TRAINED(i)).total.kcal - cibleDu(i)
    expect(Math.abs(ecart / CYCLE_LENGTH)).toBeLessThan(30)
  })

  it('ne sous-sert pas les jours de séance au profit des jours de repos', () => {
    // LA régression du 11/08. La moyenne sur le cycle était bonne (+11 kcal) et
    // masquait une répartition fausse : -134 kcal les jours de séance, -8 les
    // jours de repos. Autrement dit le déficit tombait les jours où il fallait
    // manger — début de séance lourd, sprint écourté, séries en échec.
    // Une moyenne juste ne prouve rien si les deux types de jours dérivent en
    // sens opposés : il faut les mesurer SÉPARÉMENT.
    let salle = 0, nSalle = 0, repos = 0, nRepos = 0
    for (let i = 0; i < CYCLE_LENGTH; i++) {
      const w = buildDay(i, DEFAULT_TRAINED(i)).total.kcal - cibleDu(i)
      if (DEFAULT_TRAINED(i)) { salle += w; nSalle++ } else { repos += w; nRepos++ }
    }
    expect(Math.abs(salle / nSalle)).toBeLessThan(40)
    expect(Math.abs(repos / nRepos)).toBeLessThan(40)
  })

  it('couvre la cible protéique sans la dépasser largement', () => {
    // Les deux bornes comptent. En dessous, on perd du muscle en déficit ; très
    // au-dessus, ce sont des calories qui iraient mieux en lipides ou en légumes,
    // puisque la synthèse musculaire plafonne.
    const cible = proteinTarget(92.4, COMP)
    for (let i = 0; i < CYCLE_LENGTH; i++) {
      const p = roundMacros(buildDay(i, DEFAULT_TRAINED(i)).total).p
      expect(p).toBeGreaterThanOrEqual(cible * 0.92)
      expect(p).toBeLessThanOrEqual(cible * 1.12)
    }
  })

  it('atteint le plancher lipidique, qui ne se négocie pas', () => {
    // Régression réelle : le plan livrait 37 g de lipides pour un plancher de 74.
    // 0,4 g/kg, c'est la moitié du seuil sous lequel la production hormonale et
    // l'absorption des vitamines A, D, E et K finissent par en pâtir. Personne ne
    // l'avait vu parce qu'aucun écran n'affichait les lipides face à leur cible.
    for (let i = 0; i < CYCLE_LENGTH; i++) {
      const trained = DEFAULT_TRAINED(i)
      const cibles = macroTargets(92.4, cibleDu(i), COMP)
      const l = roundMacros(buildDay(i, trained).total).l
      expect(l).toBeGreaterThanOrEqual(cibles.l * 0.82)
    }
  })

  it('boucle sur le cycle pour un index hors bornes', () => {
    expect(buildDay(CYCLE_LENGTH + 3, true).index).toBe(3)
    expect(buildDay(-1, true).index).toBe(CYCLE_LENGTH - 1)
  })
})

// ─── Dépense et cibles ───────────────────────────────────────────────────────
describe('dépense énergétique', () => {
  it('applique Mifflin-St Jeor', () => {
    // 179 cm, 94 kg, 29 ans, homme → 1 919 kcal
    expect(bmrMifflin(94, 179, 29, 'h')).toBe(1919)
  })

  it('renvoie null tant que le profil est incomplet', () => {
    expect(bmrMifflin(94, null, 29, 'h')).toBeNull()
    expect(bmrMifflin(null, 179, 29, 'h')).toBeNull()
  })

  it('vise 2,1 g de protéines par kilo', () => {
    expect(proteinTarget(94)).toBe(197)
  })
})

describe('verdict de tendance', () => {
  it('ne conclut rien sans données', () => {
    expect(assessTrend(null).verdict).toBe('unknown')
  })
  it('valide une perte dans la fourchette', () => {
    expect(assessTrend(-0.5).verdict).toBe('ok')
  })
  it('alerte quand ça descend trop vite — c\'est du muscle qui part', () => {
    expect(assessTrend(-1.4).verdict).toBe('fast')
  })
  it('alerte quand ça ne bouge pas', () => {
    expect(assessTrend(-0.05).verdict).toBe('slow')
  })
})

// ─── Cycle et dates ──────────────────────────────────────────────────────────
describe('position dans le cycle', () => {
  // Le cycle se déduit de la date : aucun « démarrage » à déclencher, donc rien à
  // oublier de lancer et rien à resynchroniser après une pause.
  it('déroule 14 jours puis recommence', () => {
    const monday = CYCLE_EPOCH
    expect(cycleIndexOf(monday)).toBe(0)
    expect(cycleIndexOf(shiftIso(monday, 6))).toBe(6)
    expect(cycleIndexOf(shiftIso(monday, 7))).toBe(7)
    expect(cycleIndexOf(shiftIso(monday, 13))).toBe(13)
    expect(cycleIndexOf(shiftIso(monday, 14))).toBe(0)
  })

  it('donne toujours le même menu pour une date donnée', () => {
    expect(cycleIndexOf('2026-08-06')).toBe(cycleIndexOf('2026-08-06'))
    // Deux semaines d'écart : même position dans le cycle.
    expect(cycleIndexOf('2026-08-06')).toBe(cycleIndexOf('2026-08-20'))
    // Une seule semaine d'écart : l'autre semaine du cycle.
    expect(Math.abs(cycleIndexOf('2026-08-06') - cycleIndexOf('2026-08-13'))).toBe(7)
  })

  it('aligne le lundi du plan sur un vrai lundi', () => {
    // 2026-08-03 est un lundi : sa position doit être un début de semaine du cycle.
    expect([0, 7]).toContain(cycleIndexOf('2026-08-03'))
  })
  it('ancre le démarrage sur un lundi', () => {
    expect(mondayOf('2026-08-06')).toBe('2026-08-03') // jeudi → lundi de la même semaine
    expect(mondayOf('2026-08-03')).toBe('2026-08-03')
    expect(mondayOf('2026-08-09')).toBe('2026-08-03') // dimanche appartient à la semaine qui précède
  })
})

// ─── Liste de courses et budget ──────────────────────────────────────────────
/**
 * Les courses d'une suite de jours du cycle. `shoppingFrom` ne prend que des
 * grammes : agréger les jours est le travail de l'appelant, et ce petit helper
 * évite de garder dans la bibliothèque une deuxième façon de bâtir une liste.
 */
function shoppingFor(indices: number[], trainedFor: (i: number) => boolean) {
  const grams: Record<string, number> = {}
  for (const i of indices) {
    for (const meal of buildDay(i, trainedFor(i)).meals) {
      for (const it of meal.items) grams[it.food] = (grams[it.food] ?? 0) + it.g
    }
  }
  return shoppingFrom(grams)
}
describe('liste de courses', () => {
  const all = Array.from({ length: CYCLE_LENGTH }, (_, i) => i)

  it('agrège toutes les quantités du cycle', () => {
    const list = shoppingFor(all, DEFAULT_TRAINED)
    const lines = list.flatMap(s => s.lines)
    expect(lines.length).toBeGreaterThan(20)
    // 5 g de créatine par jour, 14 jours
    expect(lines.find(l => l.food.id === 'creatine-monohydrate')!.grams).toBe(70)
  })

  it('trie chaque rayon du plus lourd au plus léger', () => {
    for (const { lines } of shoppingFor(all, DEFAULT_TRAINED)) {
      for (let i = 1; i < lines.length; i++) expect(lines[i - 1].grams).toBeGreaterThanOrEqual(lines[i].grams)
    }
  })

  it('achète moins de féculents si les séances sautent', () => {
    const normal = shoppingFor(all, DEFAULT_TRAINED).flatMap(s => s.lines)
    const skipped = shoppingFor(all, () => false).flatMap(s => s.lines)
    const riz = (l: typeof normal) => l.find(x => x.food.id === 'riz-basmati')!.grams
    expect(riz(skipped)).toBeLessThan(riz(normal))
  })

  it('formate les quantités en kg au-delà du kilo', () => {
    expect(fmtQty(850)).toBe('850 g')
    expect(fmtQty(1500)).toBe('1,5 kg')
  })
})

describe('budget', () => {
  const list = shoppingFor([0], DEFAULT_TRAINED)

  it('signale les prix manquants plutôt que de les compter à zéro', () => {
    const { total, missing } = basketTotal(list, {})
    expect(total).toBe(0)
    expect(missing.length).toBeGreaterThan(0)
  })

  it('facture au prorata du poids', () => {
    // 1 kg à 10 €/kg quel que soit le rayon : le total suit le poids total
    const prices = Object.fromEntries(list.flatMap(s => s.lines).map(l => [l.food.id, 10]))
    const grams = list.flatMap(s => s.lines).reduce((n, l) => n + l.grams, 0)
    const { total, missing } = basketTotal(list, prices)
    expect(missing).toHaveLength(0)
    expect(total).toBeCloseTo(grams / 100, 1)
  })

  it('ignore un prix nul ou négatif', () => {
    const { missing } = basketTotal(list, { 'filet-de-poulet': 0 })
    expect(missing).toContain('filet-de-poulet')
  })
})

// ─── Micronutriments ─────────────────────────────────────────────────────────
// Le but de cette vue est de dire ce qui manque VRAIMENT, pas de justifier des gélules :
// ces tests verrouillent le constat (seule la vitamine D est sous la référence).
describe('micronutriments', () => {
  // La couverture se lit désormais sur des journées construites, et non sur des
  // index de cycle : c'est ce qui lui permet de suivre la semaine réellement choisie.
  const cov = microCoverage(Array.from({ length: CYCLE_LENGTH }, (_, i) => buildDay(i, DEFAULT_TRAINED(i))))

  it('couvre chaque nutriment de la table de référence', () => {
    expect(cov.map(c => c.key).sort()).toEqual(Object.keys(MICRO_REFS).sort())
  })

  it('classe du moins couvert au mieux couvert', () => {
    for (let i = 1; i < cov.length; i++) expect(cov[i - 1].pct).toBeLessThanOrEqual(cov[i].pct)
  })

  it('ne trouve que la vitamine D sous la référence', () => {
    expect(cov.filter(c => c.status !== 'ok').map(c => c.key)).toEqual(['vd'])
  })

  it('couvre largement les oméga-3 grâce au poisson gras', () => {
    expect(cov.find(c => c.key === 'o3')!.pct).toBeGreaterThan(100)
  })
})

// ─── Intégrité des données ───────────────────────────────────────────────────
describe('données du plan', () => {
  it('ne référence aucun aliment absent de la table', () => {
    for (const r of Object.values(RECIPE_BY_ID)) {
      for (const it of r.items) expect(FOOD_BY_ID[it.food], `${r.id} → ${it.food}`).toBeDefined()
    }
  })

  it('ne compte aucune calorie pour la créatine', () => {
    expect(FOOD_BY_ID['creatine-monohydrate'].kcal).toBe(0)
  })
})

// ─── Dépense réelle d'une séance ─────────────────────────────────────────────
// Le cœur du recalage dynamique : une séance expédiée ne vaut pas une séance dense.
const KG = 94
const BMR = 1919

const session = (over: Partial<TrainingLike> & { sets?: number } = {}): TrainingLike => ({
  at: '2026-08-06T13:00',
  durationMin: 55,
  entries: Array.from({ length: over.sets ?? 18 }, () => ({ sets: [{}] })),
  ...over,
})

describe('dépense d\'une séance', () => {
  it('compte les séries de travail sans l\'échauffement', () => {
    const s: TrainingLike = { at: '2026-08-06T13:00', entries: [{ sets: [{ warm: true }, {}, {}] }, { sets: [{}] }] }
    expect(workSetCount(s)).toBe(3)
  })

  it('écarte les durées aberrantes du journal', () => {
    // Le journal contient une séance saisie à 9 min pour 6 exercices : inexploitable.
    expect(usableDuration(session({ durationMin: 9 }))).toBe(55)
    expect(usableDuration(session({ durationMin: 400 }))).toBe(55)
    expect(usableDuration(session({ durationMin: 70 }))).toBe(70)
  })

  it('coûte plus cher quand la séance est plus dense', () => {
    const lente = sessionBurn(session({ durationMin: 70, sets: 14 }), KG, BMR)
    const dense = sessionBurn(session({ durationMin: 70, sets: 32 }), KG, BMR)
    expect(dense).toBeGreaterThan(lente)
  })

  it('coûte plus cher quand la séance est plus longue, à densité égale', () => {
    const courte = sessionBurn(session({ durationMin: 40, sets: 18 }), KG, BMR)
    const longue = sessionBurn(session({ durationMin: 80, sets: 36 }), KG, BMR)
    expect(longue).toBeGreaterThan(courte)
  })

  it('ajoute le coût des sprints', () => {
    const sans = sessionBurn(session(), KG, BMR)
    const avec = sessionBurn(session({ sprint: [{ kind: 'sprint', count: 4, duration: '30' }] }), KG, BMR)
    expect(avec).toBeGreaterThan(sans)
  })

  // Régression : sans soustraire le métabolisme de base sur la durée de la séance,
  // on compte deux fois la même heure et on surestime d'environ 80 kcal.
  it('renvoie une dépense NETTE, pas brute', () => {
    const burn = sessionBurn(session({ durationMin: 60, sets: 27 }), KG, BMR)
    const brut = 6 * KG // 6 METs × 94 kg × 1 h
    expect(burn).toBeLessThan(brut)
    expect(burn).toBeGreaterThan(brut - 150)
  })

  it('reste dans une fourchette plausible pour une vraie séance', () => {
    expect(sessionBurn(session({ durationMin: 54, sets: 18 }), KG, BMR)).toBeGreaterThan(250)
    expect(sessionBurn(session({ durationMin: 54, sets: 18 }), KG, BMR)).toBeLessThan(600)
  })

  it('cumule plusieurs séances dans la même journée', () => {
    const one = sessionBurn(session(), KG, BMR)
    expect(dayBurn([session(), session()], KG, BMR)).toBe(one * 2)
    expect(dayBurn([], KG, BMR)).toBe(0)
  })

  it('ne retient que les séances de la date demandée', () => {
    const all = [{ at: '2026-08-06T13:00' }, { at: '2026-08-06T19:00' }, { at: '2026-08-07T13:00' }]
    expect(sessionsOn(all, '2026-08-06')).toHaveLength(2)
  })
})

// ─── Cible dynamique ─────────────────────────────────────────────────────────
describe('cible calorique dynamique', () => {
  // Il n'existe plus qu'UN modèle d'énergie, `dayEnergy`. Les forfaits statiques
  // (`targetOf`, `tdeeOf`, `targetFor`, PAL_GYM/PAL_REST, GYM_DEFICIT/REST_DEFICIT)
  // ont été supprimés : ils n'étaient utilisés par aucun écran et servaient de
  // référence à la calibration du plan, qui a donc dérivé de 150 kcal sans alerte.
  it('monte avec la dépense mesurée', () => {
    const base = { bmr: BMR, kg: 94, tt: false, steps: 8000 }
    expect(dayEnergy({ ...base, sessionKcal: 550 }).target)
      .toBeGreaterThan(dayEnergy({ ...base, sessionKcal: 350 }).target)
  })

  it('retombe sur un jour sans séance quand la séance est annulée', () => {
    const base = { bmr: BMR, kg: 94, tt: false, steps: 8000 }
    expect(dayEnergy({ ...base, sessionKcal: 0 }).target).toBe(dayEnergy(base).target)
  })
})

// ─── Dépense décomposée ──────────────────────────────────────────────────────
// Trois postes explicites plutôt qu'un facteur d'activité opaque. C'est ce qui donne
// un sens au bouton « télétravail » : une journée où l'on marche moins, pas un
// coefficient magique.
describe('dépense décomposée', () => {
  const base = { bmr: BMR, kg: KG }

  it('sépare métabolisme, pas et séance', () => {
    const e = dayEnergy({ ...base, tt: true, steps: 4000, sessionKcal: 400 })
    expect(e.baseKcal + e.stepsKcal + e.sessionKcal).toBe(e.need)
    expect(e.target).toBe(Math.round((e.need - e.deficit) / 10) * 10)
  })

  it('fait baisser la cible en télétravail, à séance égale', () => {
    const tt = dayEnergy({ ...base, tt: true, sessionKcal: 440 })
    const site = dayEnergy({ ...base, tt: false, sessionKcal: 440 })
    expect(tt.target).toBeLessThan(site.target)
  })

  it('estime les pas tant qu\'ils ne sont pas saisis, et le signale', () => {
    const est = dayEnergy({ ...base, tt: true })
    expect(est.stepsEstimated).toBe(true)
    expect(est.steps).toBe(STEPS_TT)
    const saisi = dayEnergy({ ...base, tt: true, steps: 11000 })
    expect(saisi.stepsEstimated).toBe(false)
    expect(saisi.stepsKcal).toBeGreaterThan(est.stepsKcal)
  })

  it('borne le déficit pour qu\'il reste tenable', () => {
    const petit = dayEnergy({ ...base, tt: true, steps: 0, sessionKcal: 0 })
    const gros = dayEnergy({ ...base, tt: false, steps: 25000, sessionKcal: 900 })
    expect(petit.deficit).toBeGreaterThanOrEqual(DEFICIT_MIN)
    expect(gros.deficit).toBeLessThanOrEqual(DEFICIT_MAX)
  })

  it('garde le déficit hebdomadaire dans la fourchette de perte visée', () => {
    // Semaine type : salle lun/mar/jeu/ven, télétravail mar/ven.
    const week = [
      { tt: false, s: 440 }, { tt: true, s: 440 }, { tt: false, s: 0 },
      { tt: false, s: 440 }, { tt: true, s: 440 }, { tt: false, s: 0 }, { tt: false, s: 0 },
    ]
    const total = week.reduce((n, d) => n + dayEnergy({ ...base, tt: d.tt, sessionKcal: d.s }).deficit, 0)
    const kgWeek = total / 7700
    expect(kgWeek).toBeGreaterThan(0.4)
    expect(kgWeek).toBeLessThan(0.8)
  })
})

// ─── Planning ────────────────────────────────────────────────────────────────
// La semaine du programme d'exemple : salle lundi, mardi, jeudi, vendredi ;
// télétravail mardi et vendredi. C'était le défaut de l'application, ce n'en est
// plus un — une installation neuve ne crédite aucune séance qu'on n'a pas planifiée.
const SEMAINE_EXEMPLE = {
  gym: [true, true, false, true, true, false, false],
  tt: [false, true, false, false, true, false, false],
}

describe('semaine type et exceptions', () => {
  it('sépare la salle et le télétravail — un jour peut être les deux', () => {
    // Mardi : télétravail ET séance.
    const mardi = resolveDay('2026-08-04', SEMAINE_EXEMPLE)
    expect(mardi.gym).toBe(true)
    expect(mardi.tt).toBe(true)
  })

  it('applique la semaine type par défaut', () => {
    const mercredi = resolveDay('2026-08-05', SEMAINE_EXEMPLE)
    expect(mercredi.gym).toBe(false)
    expect(mercredi.tt).toBe(false)
  })

  it('laisse une exception écraser la semaine type', () => {
    const d = resolveDay('2026-08-05', SEMAINE_EXEMPLE, { gym: true, steps: 12000 })
    expect(d.gym).toBe(true)
    expect(d.steps).toBe(12000)
    expect(d.overridden).toBe(true)
  })

  it('permet d\'imposer un plat sur un jour donné', () => {
    const d = resolveDay('2026-08-05', SEMAINE_EXEMPLE, { dinner: 'din-saumon' })
    expect(d.menu.dinner).toBe('din-saumon')
    expect(d.menu.lunch).toBeUndefined()
  })
})

// ─── Bibliothèque ────────────────────────────────────────────────────────────
describe('bibliothèque', () => {
  it('ajoute un aliment perso sans toucher aux livrés', () => {
    const foods = mergeFoods([{ id: 'skyr', name: 'Skyr', cat: 'laitiers', kcal: 64, p: 11, g: 4, l: 0.2 }])
    expect(foods.skyr.name).toBe('Skyr')
    expect(foods['filet-de-poulet']).toBeDefined()
  })

  it('applique une modification sur un aliment livré', () => {
    const foods = mergeFoods([], { 'filet-de-poulet': { kcal: 120 } })
    expect(foods['filet-de-poulet'].kcal).toBe(120)
    expect(foods['filet-de-poulet'].name).toBe('Filet de poulet')
  })

  it('marque un plat mis de côté sans le supprimer', () => {
    const recipes = mergeRecipes([], {}, ['din-saumon'])
    expect(recipes['din-saumon'].disabled).toBe(true)
    expect(recipes['din-saumon'].name).toBeTruthy()
    expect(activeRecipes({ foods: FOOD_BY_ID, recipes }, 'diner').map(r => r.id)).not.toContain('din-saumon')
  })

  it('construit la journée avec la bibliothèque fournie', () => {
    const recipes = mergeRecipes([], { 'din-poisson': { name: 'Mon poisson', items: [{ food: 'saumon', g: 200 }] } })
    const day = buildDay(0, true, { foods: FOOD_BY_ID, recipes })
    expect(day.meals.find(m => m.slot === 'dinner')!.name).toBe('Mon poisson')
  })

  it('permet d\'imposer un plat sur une journée', () => {
    const day = buildDay(0, true, undefined, { dinner: 'din-saumon' })
    expect(day.meals.find(m => m.slot === 'dinner')!.recipeId).toBe('din-saumon')
  })

  it('génère des identifiants uniques et lisibles', () => {
    expect(slugify('Poulet rôti & riz')).toBe('poulet-roti-riz')
    expect(slugify('Poulet', ['poulet'])).toBe('poulet-2')
  })

  // Régression : une faute de frappe sur une étiquette passait sans broncher et
  // faussait ensuite tous les totaux du plat.
  it('refuse un aliment dont les macros ne collent pas aux calories', () => {
    expect(validateFood({ name: 'X', kcal: 100, p: 50, g: 50, l: 50 })).not.toHaveLength(0)
    expect(validateFood({ name: 'X', kcal: 110, p: 23, g: 0, l: 1.8 })).toHaveLength(0)
  })

  it('refuse un plat vide ou avec un ingrédient inconnu', () => {
    const lib = { foods: FOOD_BY_ID, recipes: RECIPE_BY_ID }
    expect(validateRecipe({ name: 'X', items: [] }, lib)).not.toHaveLength(0)
    expect(validateRecipe({ name: 'X', items: [{ food: 'inexistant', g: 100 }] }, lib)).not.toHaveLength(0)
    expect(validateRecipe({ name: 'X', items: [{ food: 'saumon', g: 150 }] }, lib)).toHaveLength(0)
  })
})

// ─── Écarts et rattrapage ────────────────────────────────────────────────────
// La question est revenue plusieurs fois : oui, un écart se rattrape — mais lissé
// sur les jours restants, jamais en coupant brutalement le lendemain.
describe('rattrapage d\'un écart', () => {
  const d = (target: number, eaten: number, closed: boolean) => ({ iso: 'x', target, eaten, closed })

  it('ne dit rien quand la semaine est dans les clous', () => {
    const b = weekBalance([d(2000, 2010, true), d(2000, 0, false)])
    expect(b.perDay).toBe(0)
  })

  it('étale l\'écart sur les jours restants au lieu de tout couper le lendemain', () => {
    const b = weekBalance([d(2000, 2600, true), d(2000, 0, false), d(2000, 0, false), d(2000, 0, false)])
    expect(b.surplus).toBe(600)
    expect(b.perDay).toBe(-200)
    expect(Math.abs(b.perDay)).toBeLessThan(b.surplus)
  })

  it('plafonne le report pour qu\'une journée reste vivable', () => {
    const b = weekBalance([d(2000, 3200, true), d(2000, 0, false)])
    expect(Math.abs(b.perDay)).toBeLessThanOrEqual(CARRY_MAX_PER_DAY)
    expect(b.capped).toBe(true)
  })

  it('renonce au rattrapage au-delà d\'un écart déraisonnable', () => {
    const b = weekBalance([d(2000, 3800, true), d(2000, 0, false), d(2000, 0, false)])
    expect(b.giveUp).toBe(true)
    expect(b.perDay).toBe(0)
  })

  it('propose de remonter quand la semaine est trop basse', () => {
    const b = weekBalance([d(2200, 1700, true), d(2200, 0, false), d(2200, 0, false)])
    expect(b.surplus).toBeLessThan(0)
    expect(b.perDay).toBeGreaterThan(0)
  })

  it('ne descend jamais la cible sous le plancher, quel que soit le report', () => {
    expect(carryAdjustedTarget(2000, -900)).toBeGreaterThanOrEqual(Math.round(2000 * 0.85) - 10)
  })
})

// ─── Frise de la journée ─────────────────────────────────────────────────────
describe('frise de la journée', () => {
  it('mélange repas du plan et extras dans l\'ordre des heures', () => {
    const day = buildDay(0, true)
    const line = timelineOf(day, ['pdj'], [
      { id: 'e1', label: 'Café gourmand', kcal: 250, p: 0, g: 0, l: 0, time: '15:00' },
    ])
    const times = line.map(e => e.time)
    expect(line.length).toBe(day.meals.length + 1)
    expect(times.indexOf('15:00')).toBeGreaterThan(0)
    expect(line.find(e => e.slot === 'pdj')!.done).toBe(true)
  })

  it('désigne le prochain repas non validé', () => {
    const day = buildDay(0, true)
    const line = timelineOf(day, ['pdj'], [])
    expect(nextMeal(line)!.slot).not.toBe('pdj')
  })
})

// ─── Consommation du jour ────────────────────────────────────────────────────
describe('ce qui a été mangé', () => {
  const day = buildDay(0, true)

  it('ne compte que les repas validés', () => {
    const vide = dayIntake(day, [], [], 2200)
    expect(vide.eaten.kcal).toBe(0)
    expect(vide.remaining).toBe(2200)
    const partiel = dayIntake(day, ['pdj'], [], 2200)
    expect(partiel.eaten.kcal).toBeGreaterThan(0)
    expect(partiel.remaining).toBeLessThan(2200)
  })

  it('ajoute les extras au compteur', () => {
    const avec = dayIntake(day, [], [{ id: 'e', label: 'Resto', kcal: 800, p: 30, g: 60, l: 40 }], 2200)
    expect(avec.eaten.kcal).toBe(800)
    expect(avec.eaten.p).toBe(30)
    expect(avec.remaining).toBe(1400)
  })

  it('signale le dépassement sans casser la barre', () => {
    const trop = dayIntake(day, [], [{ id: 'e', label: 'x', kcal: 4000, p: 0, g: 0, l: 0 }], 2000)
    expect(trop.remaining).toBeLessThan(0)
    expect(trop.progress).toBeLessThanOrEqual(1.5)
  })
})

describe('statut de la journée', () => {
  it('ne déclare pas une séance ratée avant qu\'elle ait eu lieu', () => {
    expect(dayStatus({ planned: true, recorded: 0, skipped: false, isPast: false })).toBe('pending')
    expect(dayStatus({ planned: true, recorded: 0, skipped: false, isPast: true })).toBe('missed')
  })
  it('reconnaît une séance enregistrée hors planning', () => {
    expect(dayStatus({ planned: false, recorded: 1, skipped: false, isPast: true })).toBe('bonus')
  })
  it('laisse la séance enregistrée primer sur le marquage manuel', () => {
    expect(dayStatus({ planned: true, recorded: 1, skipped: true, isPast: true })).toBe('done')
  })
  it('bascule la journée après l\'heure de la séance de midi', () => {
    expect(isDayPlayed('2026-08-06', '2026-08-06', 10)).toBe(false)
    expect(isDayPlayed('2026-08-06', '2026-08-06', 16)).toBe(true)
    expect(isDayPlayed('2026-08-05', '2026-08-06', 8)).toBe(true)
    expect(isDayPlayed('2026-08-07', '2026-08-06', 23)).toBe(false)
  })
})

// ─── Ajustement du dîner ─────────────────────────────────────────────────────
describe('ajustement du dîner', () => {
  const day = buildDay(0, true)
  const dinner = day.meals.find(m => m.slot === 'dinner')!

  it('ne dit rien quand l\'écart tient dans l\'incertitude du calcul', () => {
    expect(dinnerAdjustment(day.total.kcal, day.total.kcal + ADJUST_THRESHOLD - 1, dinner)).toBeNull()
  })

  it('propose une portion plus petite quand la séance a moins coûté que prévu', () => {
    const a = dinnerAdjustment(day.total.kcal, day.total.kcal - 150, dinner)!
    expect(a.applied).toBeLessThan(0)
    expect(a.toG).toBeLessThan(a.fromG)
    expect(a.label).toContain('au lieu de')
  })

  it('propose une portion plus grande quand la séance a plus coûté', () => {
    const a = dinnerAdjustment(day.total.kcal, day.total.kcal + 150, dinner)!
    expect(a.applied).toBeGreaterThan(0)
    expect(a.toG).toBeGreaterThan(a.fromG)
  })

  it('agit sur un féculent, jamais sur les protéines', () => {
    const a = dinnerAdjustment(day.total.kcal, day.total.kcal - 150, dinner)!
    expect(STARCHY_IDS).toContain(a.foodId!)
  })

  // Régression : sans plancher, un écart important vidait l'assiette de son féculent.
  it('ne descend pas la portion sous 40 % ni au-dessus de 180 %', () => {
    const bas = dinnerAdjustment(day.total.kcal, day.total.kcal - 2000, dinner)!
    const haut = dinnerAdjustment(day.total.kcal, day.total.kcal + 2000, dinner)!
    expect(bas.toG).toBeGreaterThanOrEqual(bas.fromG * 0.4 - 5)
    expect(haut.toG).toBeLessThanOrEqual(haut.fromG * 1.8 + 5)
  })

  it('arrondit la portion à 5 g près', () => {
    const a = dinnerAdjustment(day.total.kcal, day.total.kcal - 137, dinner)!
    expect(a.toG % 5).toBe(0)
  })

  it('applique l\'ajustement au plan et recalcule les totaux', () => {
    const a = dinnerAdjustment(day.total.kcal, day.total.kcal - 150, dinner)!
    const adjusted = applyAdjustment(day, a)
    expect(adjusted.total.kcal).toBeLessThan(day.total.kcal)
    expect(adjusted.meals.find(m => m.slot === 'dinner')!.adjusted).toBe(true)
    // On n'a touché qu'au féculent : les protéines ne bougent qu'à la marge (un féculent
    // en apporte un peu), jamais assez pour passer sous la cible.
    expect(day.total.p - adjusted.total.p).toBeLessThan(5)
    expect(adjusted.total.p).toBeGreaterThan(day.total.p * 0.97)
  })

  it('laisse le plan intact sans ajustement', () => {
    expect(applyAdjustment(day, null)).toBe(day)
  })
})

// ─── Repas cuisinés d'avance ─────────────────────────────────────────────────
// Le week-end, tout est cuisiné d'un coup et les portions sont figées : « 165 g au
// lieu de 255 g » devient inapplicable. La consigne doit devenir un retrait.
describe('boîtes assemblées à l\'avance', () => {
  const day = buildDay(0, true)

  it('dit quoi laisser dans la boîte au lieu de donner un poids à peser', () => {
    const plan = adjustPlanFor(day, day.total.kcal - 150, 'assembled')!
    expect(plan.portion).toBeNull()
    expect(plan.steps.length).toBeGreaterThan(0)
    expect(plan.steps[0].label).toContain('Laisse')
    expect(plan.steps[0].kcal).toBeLessThan(0)
  })

  it('donne un poids à peser quand les féculents sont à part', () => {
    const plan = adjustPlanFor(day, day.total.kcal - 150, 'separate')!
    expect(plan.portion).not.toBeNull()
    expect(plan.steps).toHaveLength(0)
  })

  // Régression : sans plafond, la consigne devenait « laisse tout le riz », ce qui
  // revient à ne pas l'avoir cuisiné.
  it('ne fait jamais laisser plus de la moitié d\'une portion', () => {
    const steps = removalSteps(day, 5000)
    const dinner = day.meals.find(m => m.slot === 'dinner')!
    const starchy = dinner.items.find(i => STARCHY_IDS.includes(i.food))!
    const step = steps.find(s => s.slot === 'dinner' && s.kind === 'partial')!
    const leftG = -step.kcal / (FOOD_BY_ID[starchy.food].kcal / 100)
    // + 1 g de tolérance : les kcal de l'étape sont arrondies, donc reconstruire les
    // grammes par division rend un chiffre légèrement au-dessus. C'est l'arrondi
    // qu'on tolère, pas le plafond qu'on relâche.
    expect(leftG).toBeLessThanOrEqual(starchy.g * LEAVE_MAX + 1)
  })

  it('enchaîne sur les repas annexes quand le féculent ne suffit pas', () => {
    const steps = removalSteps(day, 600)
    expect(steps.some(s => s.kind === 'drop')).toBe(true)
    // Le fromage blanc du soir passe en dernier : c'est la caséine nocturne.
    const drops = steps.filter(s => s.kind === 'drop').map(s => s.slot)
    if (drops.includes('night')) expect(drops.indexOf('snack')).toBeLessThan(drops.indexOf('night'))
  })

  it('propose un ajout simple quand la séance a coûté plus cher', () => {
    const plan = adjustPlanFor(day, day.total.kcal + 150, 'assembled')!
    expect(plan.steps[0].kind).toBe('add')
    expect(plan.steps[0].kcal).toBeGreaterThan(0)
  })

  it('en mode « assemblé », retirer 300 kcal coûte des protéines — et c\'est le prix', () => {
    // Ce mode suppose que la boîte est déjà faite : on ne peut plus jouer sur les
    // grammages, seulement laisser des choses de côté. Il supprime donc des repas
    // ENTIERS, collation protéinée comprise, là où le mode « féculents à part » se
    // contente de réduire le riz.
    //
    // Le test borne ce coût au lieu de prétendre qu'il est nul : c'est ce que fait
    // vraiment le code, et c'est la raison pour laquelle ce mode n'est pas exposé
    // dans l'interface. Si un jour il l'est, ce chiffre-là est l'argument contre.
    const plan = adjustPlanFor(day, day.total.kcal - 300, 'assembled')!
    const after = applySteps(day, plan)
    const perdu = day.total.p - after.total.p
    expect(perdu).toBeGreaterThan(0) // il en coûte, ce n'est pas gratuit
    expect(perdu).toBeLessThan(45) // mais jamais au point de vider la journée
    expect(after.total.p).toBeGreaterThan(day.total.p * 0.75)
  })

  it('recalcule les totaux pour refléter ce qui sera vraiment mangé', () => {
    const target = day.total.kcal - 150
    const plan = adjustPlanFor(day, target, 'assembled')!
    const after = applySteps(day, plan)
    expect(after.total.kcal).toBeLessThan(day.total.kcal)
    expect(Math.abs(after.total.kcal - target)).toBeLessThan(80)
  })

  it('supprime réellement le repas sauté du plan', () => {
    const plan = adjustPlanFor(day, day.total.kcal - 300, 'assembled')!
    const after = applySteps(day, plan)
    for (const s of plan.steps.filter(x => x.kind === 'drop')) {
      expect(after.meals.map(m => m.slot)).not.toContain(s.slot)
    }
  })

  it('ne dit rien quand l\'écart est négligeable, quel que soit le mode', () => {
    expect(adjustPlanFor(day, day.total.kcal + 20, 'assembled')).toBeNull()
    expect(adjustPlanFor(day, day.total.kcal + 20, 'separate')).toBeNull()
  })
})

// ─── Horaires ────────────────────────────────────────────────────────────────
describe('horaires des repas', () => {
  const minutes = (t: string) => {
    const m = t.match(/(\d{1,2})\s*h?\s*(\d{2})?/)!
    return Number(m[1]) * 60 + Number(m[2] ?? 0)
  }

  it('rien avant 9 h : lever à 8 h, et un quart d\'heure après le réveil rien ne passe', () => {
    // Le petit-déjeuner était à 10 h. Il est passé à 9 h — l'heure d'arrivée au
    // bureau — parce que 2 h 25 avant la séance ne suffisaient pas à digérer 412 g
    // et 15 g de fibres : début de séance lourd, sprint écourté. 9 h donne 3 h 25.
    //
    // Et pas plus tôt : à 8 h 15, on remplacerait un problème de digestion par un
    // problème d'appétit, ce qui est exactement ce qu'on cherche à éviter.
    for (const slots of [SLOTS_GYM, SLOTS_REST]) {
      for (const s of slots) expect(minutes(s.time)).toBeGreaterThanOrEqual(540)
    }
  })

  it('laisse au moins trois heures entre le petit-déjeuner et la séance', () => {
    // C'est LE chiffre qui a changé, et celui qu'il faut garder : un repas complet
    // demande 3 à 4 h avant un effort. Départ à la salle à 12 h au plus tôt.
    const pdj = minutes(SLOTS_GYM.find(s => s.id === 'pdj')!.time)
    expect(minutes('12 h') - pdj).toBeGreaterThanOrEqual(180)
  })

  it('garde les lipides du matin bas, ils retardent la vidange gastrique', () => {
    // Les oléagineux sont passés du petit-déjeuner à la collation de l'après-midi :
    // même total sur la journée, mais plus rien de gras juste avant l'entraînement.
    for (const r of Object.values(RECIPE_BY_ID)) {
      if (r.kind !== 'pdj') continue
      // Le petit-déjeuner salé fait exception : ses lipides viennent des œufs, qui
      // en sont la base — on ne peut pas les retirer sans supprimer le plat.
      if (r.id === 'pdj-sale') continue
      expect(macrosOf(r.items).l).toBeLessThan(10)
    }
  })

  it('les horaires sont strictement croissants dans chaque journée', () => {
    for (const slots of [SLOTS_GYM, SLOTS_REST]) {
      const t = slots.map(s => minutes(s.time))
      expect(t).toEqual([...t].sort((a, b) => a - b))
    }
  })

  it('le déjeuner suit la séance les jours de salle, et l\'appétit les autres', () => {
    // 13 h 45 un jour de salle n'est PAS un choix : départ entre 12 h et 12 h 25,
    // retour au bureau entre 13 h 30 et 13 h 50, boîte mangée dans la foulée. C'est
    // le milieu de la fourchette, et ça ne se négocie pas.
    expect(SLOTS_GYM.find(s => s.id === 'lunch')!.time).toBe('13 h 45')
    // Sans séance, cette contrainte n'existe pas. L'app affichait quand même 13 h 45
    // pendant que le déjeuner se prenait à 12 h 30 : un plan que la réalité contredit
    // tous les mercredis finit par décrédibiliser les créneaux qui comptent vraiment.
    expect(SLOTS_REST.find(s => s.id === 'lunch')!.time).toBe('12 h 30')
    expect(minutes(SLOTS_REST.find(s => s.id === 'lunch')!.time))
      .toBeLessThan(minutes(SLOTS_GYM.find(s => s.id === 'lunch')!.time))
  })

  it('ne laisse aucun trou de plus de cinq heures, jour de repos compris', () => {
    // Avancer le déjeuner allonge l'après-midi : 12 h 30 → 17 h fait 4 h 30, le plus
    // long écart de la journée. Au-delà de cinq heures on ne tient pas sans grignoter,
    // et c'est exactement ce que le plan cherche à éviter.
    for (const slots of [SLOTS_GYM, SLOTS_REST]) {
      const t = slots.map(s => minutes(s.time))
      for (let i = 1; i < t.length; i++) expect(t[i] - t[i - 1]).toBeLessThanOrEqual(300)
    }
  })

  it('plus aucun créneau ne tombe pendant la séance ou le trajet', () => {
    // Entre le départ (12 h au plus tôt) et le retour (13 h 30 au plus tôt), Grégoire
    // est en salle, en vestiaire ou dans la rue : rien ne peut y être avalé. C'est ce
    // qui condamnait l'ancien shaker de 13 h 20.
    const dansLeTrou = SLOTS_GYM
      .map(s => ({ id: s.id, m: minutes(s.time) }))
      .filter(s => s.m > minutes('12 h') && s.m < minutes('13 h 30'))
    expect(dansLeTrou).toEqual([])
  })

  it('la banane se détache du petit-déjeuner et se rapproche de la séance', () => {
    // Collée au bol de 10 h, elle ne passait tout simplement pas — et son sucre
    // sert à l'effort, donc plus elle en est proche, mieux c'est. Elle reste
    // néanmoins à distance du départ : avalée sur le pas de la porte, elle ne
    // serait pas digérée.
    const pdj = minutes(SLOTS_GYM.find(s => s.id === 'pdj')!.time)
    const pre = minutes(SLOTS_GYM.find(s => s.id === 'pre')!.time)
    expect(pre - pdj).toBeGreaterThanOrEqual(60)
    expect(minutes('12 h') - pre).toBeGreaterThanOrEqual(10)
    expect(pre).toBeLessThan(minutes(SLOTS_GYM.find(s => s.id === 'lunch')!.time))
  })

  it('la créatine, elle, reste collée au petit-déjeuner : c\'est ce qui en fait une habitude', () => {
    for (const slots of [SLOTS_GYM, SLOTS_REST]) {
      const pdj = minutes(slots.find(s => s.id === 'pdj')!.time)
      expect(minutes(slots.find(s => s.id === 'creatine')!.time) - pdj).toBeLessThanOrEqual(15)
    }
  })

  it('« 9 h » sans minutes est bien ordonné par la frise', () => {
    // Le format français abrège « 9 h 00 » en « 9 h » : la frise doit quand même
    // le placer avant 9 h 05, et pas le renvoyer en fin de journée.
    const day = buildDay(0, true)
    const line = timelineOf(day, [], [])
    const t = line.map(e => minutes(e.time))
    expect(t).toEqual([...t].sort((a, b) => a - b))
    expect(t[0]).toBe(540)
  })
})

// ─── Ajustement sur ce qui reste ─────────────────────────────────────────────
describe('ingredientLines — chaque ingrédient une seule fois', () => {
  it('additionne l\'aromate qui va dans le plat ET dans la sauce', () => {
    // Le dîner poisson affichait « Citron 20 g » dans les ingrédients puis
    // « Citron 10 g » dans la sauce. Devant le frigo, ça oblige à faire l'addition
    // de tête — au mieux ; au pire on n'en sort que la moitié.
    const lignes = ingredientLines(RECIPE_BY_ID['din-poisson'])
    const citron = lignes.filter(l => l.food === 'citron')
    expect(citron).toHaveLength(1)
    expect(citron[0].g).toBe(30)
    expect(citron[0].sauceG).toBe(10)
    expect(citron[0].sauceOnly).toBe(false)
  })

  it('n\'affiche aucun ingrédient deux fois, sur AUCUN plat', () => {
    // Six plats sur neuf sont concernés : c'est l'invariant, pas un cas isolé.
    for (const r of Object.values(RECIPE_BY_ID)) {
      const noms = ingredientLines(r).map(l => l.food)
      expect(new Set(noms).size).toBe(noms.length)
    }
  })

  it('marque ce qui n\'existe que dans la sauce', () => {
    const lignes = ingredientLines(RECIPE_BY_ID['din-poisson'])
    const yaourt = lignes.find(l => l.food === 'yaourt-grec-0')!
    expect(yaourt.sauceOnly).toBe(true)
    expect(yaourt.g).toBe(yaourt.sauceG)
  })

  it('laisse à zéro ce qui ne va pas dans la sauce', () => {
    const lignes = ingredientLines(RECIPE_BY_ID['din-poisson'])
    const poisson = lignes.find(l => l.food === 'cabillaud-colin')!
    expect(poisson.sauceG).toBe(0)
    expect(poisson.sauceOnly).toBe(false)
  })

  it('ne perd pas un gramme : le total colle aux macros du plat servi', () => {
    // C'est le vrai garde-fou. Si la fusion oubliait une ligne ou en comptait une en
    // trop, la fiche afficherait des ingrédients qui ne font pas les calories
    // annoncées juste au-dessus.
    for (const r of Object.values(RECIPE_BY_ID)) {
      const parLignes = macrosOf(ingredientLines(r).map(l => ({ food: l.food, g: l.g })))
      const parPlat = macrosOf(expandItems(r))
      expect(parLignes.kcal).toBeCloseTo(parPlat.kcal, 6)
      expect(parLignes.p).toBeCloseTo(parPlat.p, 6)
    }
  })

  it('garde l\'ordre de la cuisine : le plat d\'abord, la sauce ensuite', () => {
    const lignes = ingredientLines(RECIPE_BY_ID['din-poisson'])
    expect(lignes[0].food).toBe('cabillaud-colin')
    expect(lignes.at(-1)!.sauceOnly).toBe(true)
  })

  it('rend simplement les items quand le plat n\'a pas de sauce', () => {
    const sansSauce = Object.values(RECIPE_BY_ID).find(r => !r.sauce && r.items.length > 1)!
    const lignes = ingredientLines(sansSauce)
    expect(lignes.map(l => l.food)).toEqual(sansSauce.items.map(i => i.food))
    expect(lignes.every(l => l.sauceG === 0 && !l.sauceOnly)).toBe(true)
  })
})

describe('adjustSignature — ce qu\'on a confirmé est-il encore ce qu\'on propose ?', () => {
  const day = buildDay(0, true)

  it('rend une chaîne vide quand il n\'y a rien à ajuster', () => {
    expect(adjustSignature(null)).toBe('')
  })

  it('donne la même empreinte pour le même conseil, recalculé', () => {
    const target = Math.round(day.total.kcal) - 250
    const a = adjustRemaining(day, target, [], 0, 'separate')
    const b = adjustRemaining(day, target, [], 0, 'separate')
    expect(adjustSignature(a)).toBe(adjustSignature(b))
    expect(adjustSignature(a)).not.toBe('')
  })

  it('change d\'empreinte quand la portion visée change', () => {
    // C'est tout l'intérêt : on confirme « 250 g de riz », puis un extra de 300 kcal
    // rend le conseil caduc. La confirmation doit expirer d'elle-même.
    // 80 et non 60 : le seuil de déclenchement EST à 60, et `Math.round` sur le
    // total pouvait faire tomber l'écart réel à 59,6 selon les décimales du jour.
    // Le test échouait alors sur un arrondi, pas sur le comportement testé.
    const petit = adjustRemaining(day, Math.round(day.total.kcal) - 80, [], 0, 'separate')
    const gros = adjustRemaining(day, Math.round(day.total.kcal) - 180, [], 0, 'separate')
    expect(petit!.portion!.toG).not.toBe(gros!.portion!.toG)
    expect(adjustSignature(petit)).not.toBe(adjustSignature(gros))
  })

  it('ne dépend pas des kcal en mode portion : seuls l\'aliment et le poids comptent', () => {
    // Passé le plancher de portion (40 % de l'assiette), creuser l'écart ne change
    // plus les grammes. Redemander une confirmation pour un conseil identique au
    // gramme près serait du bruit — et le bruit finit par faire ignorer le bouton.
    const a = adjustRemaining(day, Math.round(day.total.kcal) - 200, [], 0, 'separate')
    const b = adjustRemaining(day, Math.round(day.total.kcal) - 400, [], 0, 'separate')
    expect(a!.delta).not.toBe(b!.delta) // l'écart à combler, lui, a bien doublé
    expect(a!.portion!.toG).toBe(b!.portion!.toG)
    expect(adjustSignature(a)).toBe(adjustSignature(b))
  })

  it('distingue les étapes du mode assemblé', () => {
    const a = adjustRemaining(day, Math.round(day.total.kcal) - 400, [], 0, 'assembled')
    const sig = adjustSignature(a)
    if (a && a.steps.length) {
      expect(sig.startsWith('s:')).toBe(true)
      expect(sig).toContain(a.steps[0].slot)
    }
  })
})

describe('applySteps — le contrat sur lequel repose le bouton de confirmation', () => {
  const day = buildDay(0, true)

  it('un ajustement non confirmé laisse le plan RIGOUREUSEMENT intact', () => {
    // C'est l'invariant qui fait tenir toute la confirmation : tant que le bouton
    // n'est pas pressé, l'écran passe `null` et le plan doit ressortir identique.
    // Si `applySteps` se mettait un jour à normaliser, arrondir ou recalculer quoi
    // que ce soit au passage, le compteur bougerait sans que personne n'ait rien
    // validé — exactement le comportement qu'on vient de retirer.
    const intact = applySteps(day, null)
    expect(intact.total).toEqual(day.total)
    expect(intact.meals).toHaveLength(day.meals.length)
    for (const [i, m] of intact.meals.entries()) {
      expect(m.macros).toEqual(day.meals[i].macros)
      expect(m.items).toEqual(day.meals[i].items)
      expect(m.adjusted).toBeFalsy()
    }
  })

  it('un ajustement confirmé rapproche bien le plan de la cible', () => {
    const target = Math.round(day.total.kcal) - 200
    const plan = adjustRemaining(day, target, [], 0, 'separate')
    const avant = Math.abs(day.total.kcal - target)
    const apres = Math.abs(applySteps(day, plan).total.kcal - target)
    expect(apres).toBeLessThan(avant)
  })

  it('marque le repas touché, et lui seul', () => {
    // L'étiquette « ajusté » sur la carte est la seule trace visible du changement :
    // la coller sur un repas intact ferait douter de tous les autres.
    const plan = adjustRemaining(day, Math.round(day.total.kcal) - 200, [], 0, 'separate')
    const out = applySteps(day, plan)
    const touches = out.meals.filter(m => m.adjusted)
    expect(touches).toHaveLength(1)
    expect(touches[0].slot).toBe('dinner')
  })

  it('va chercher les calories dans les glucides, pas dans les protéines', () => {
    // La règle du plan : les protéines protègent la masse maigre, les lipides
    // l'équilibre hormonal, les glucides absorbent le déficit.
    //
    // Le compte n'est pas exactement nul côté protéines, et il ne peut pas l'être :
    // un féculent en contient un peu, donc retirer 100 g de riz emporte ses ~2 g. Ce
    // que ce test garde, c'est que la réduction vient des GLUCIDES — le jour où
    // l'ajustement irait piocher dans la collation protéinée, ce rapport s'effondre.
    const plan = adjustRemaining(day, Math.round(day.total.kcal) - 200, [], 0, 'separate')
    const out = applySteps(day, plan)

    const perduKcal = day.total.kcal - out.total.kcal
    const perduP = day.total.p - out.total.p
    const perduG = day.total.g - out.total.g

    expect(perduKcal).toBeGreaterThan(0)
    expect(perduP).toBeLessThan(5) // quelques grammes, pas une prise entière
    expect(perduG * KCAL_G / perduKcal).toBeGreaterThan(0.8) // l'essentiel vient de là
    // Les lipides ne bougent quasiment pas : la trace de gras d'un féculent, rien de
    // plus. Ils ne sont jamais la variable d'ajustement.
    expect(day.total.l - out.total.l).toBeLessThan(1)
  })
})

describe('adjustRemaining', () => {
  const day = buildDay(0, true)
  const slots = day.meals.map(m => m.slot)

  it('upcomingPlan retire les repas validés et recalcule le total', () => {
    const rest = upcomingPlan(day, [slots[0]])
    expect(rest.meals).toHaveLength(day.meals.length - 1)
    expect(rest.total.kcal).toBeLessThan(day.total.kcal)
    expect(rest.total.kcal).toBeCloseTo(day.total.kcal - day.meals[0].macros.kcal, 0)
  })

  it('ne propose rien quand tous les repas sont validés', () => {
    expect(adjustRemaining(day, 1500, slots, day.total.kcal, 'assembled')).toBeNull()
  })

  it('ne retire pas deux fois un écart déjà rattrapé', () => {
    // Cible 400 kcal sous le plan. Journée entière : il faut retirer ~400.
    const target = Math.round(day.total.kcal) - 400
    const naif = adjustPlanFor(day, target, 'assembled')!
    expect(naif.covered).toBeLessThan(0)

    // Même journée, mais le déjeuner a été mangé ALLÉGÉ de 400 kcal : il ne reste
    // plus rien à corriger le soir.
    const lunch = day.meals.find(m => m.slot === 'lunch')!
    const eatenSoFar = day.meals
      .filter(m => ['pdj', 'pre', 'lunch'].includes(m.slot))
      .reduce((n, m) => n + m.macros.kcal, 0) - 400
    const reste = adjustRemaining(day, target, ['pdj', 'pre', 'lunch'], eatenSoFar, 'assembled')
    expect(lunch).toBeTruthy()
    expect(reste).toBeNull()
  })

  it('coupe bien le soir quand rien n\'a encore été mangé', () => {
    const target = Math.round(day.total.kcal) - 400
    const plan = adjustRemaining(day, target, [], 0, 'assembled')!
    expect(plan.covered).toBeLessThan(0)
    expect(plan.steps.every(st => slots.includes(st.slot))).toBe(true)
  })

  it('un extra de la matinée se paie le soir, dans la limite du plafond', () => {
    const target = Math.round(day.total.kcal)
    // 500 kcal notés en extra, aucun repas validé : il faut retirer 500 kcal sur ce
    // qui reste. ADJUST_MAX plafonne à 300 — au-delà, retirer plus rendrait le dîner
    // ridicule, et le report hebdomadaire prend le relais.
    const plan = adjustRemaining(day, target, [], 500, 'assembled')!
    expect(plan.covered).toBeLessThan(0)
    expect(Math.abs(plan.delta)).toBe(ADJUST_MAX)
  })
})

// ─── Cibles par macro ────────────────────────────────────────────────────────
describe('macroTargets', () => {
  it('protéines et lipides sortent du poids de corps, les glucides prennent le reste', () => {
    const t = macroTargets(94, 2000)
    expect(t.p).toBe(Math.round(94 * 2.1))
    expect(t.l).toBe(Math.round(94 * FAT_PER_KG))
    // Le total doit retomber sur la cible, à l'arrondi près.
    const kcal = t.p * KCAL_P + t.g * 4 + t.l * KCAL_L
    expect(Math.abs(kcal - 2000)).toBeLessThan(8)
  })

  it('ne propose jamais de glucides négatifs sur une cible très basse', () => {
    const t = macroTargets(94, 900) // protéines + lipides dépassent déjà 900 kcal
    expect(t.g).toBe(0)
  })

  it('suit la masse maigre quand la balance la donne, et rend les calories aux glucides', () => {
    const comp = { fatRatio: 26.5, fatMass: 24.53, leanMass: 68.07 }
    const sans = macroTargets(92.6, 2000)
    const avec = macroTargets(92.6, 2000, comp)
    expect(avec.p).toBeLessThan(sans.p)
    // Les lipides restent indexés sur le poids de corps : leur rôle est hormonal,
    // pas contractile.
    expect(avec.l).toBe(sans.l)
    // Ce que les protéines rendent, les glucides le reprennent : la cible calorique
    // ne bouge pas d'un gramme.
    expect(avec.g).toBeGreaterThan(sans.g)
    const kcal = avec.p * KCAL_P + avec.g * 4 + avec.l * KCAL_L
    expect(Math.abs(kcal - 2000)).toBeLessThan(8)
  })
})

describe('cible protéique sur la masse maigre', () => {
  // Les vraies mesures de la balance : 92,6 kg, 26,5 % de masse grasse, 24,53 kg de
  // gras. La « masse musculaire » de 64,63 kg n'est PAS la masse maigre — elle exclut
  // l'os. C'est 92,6 − 24,53 = 68,07 kg qui sert de base.
  const REAL = { fatRatio: 26.5, fatMass: 24.53, leanMass: 68.07, muscleMass: 64.63 }

  it('ne confond pas masse maigre et masse musculaire', () => {
    expect(leanMassOf(92.6, REAL)).toBe(68.07)
    expect(leanMassOf(92.6, REAL)).toBeGreaterThan(REAL.muscleMass)
  })

  it('retombe sur la masse maigre par deux chemins différents', () => {
    // Sans la valeur de la balance, poids − masse grasse doit donner la même chose.
    expect(leanMassOf(92.6, { fatMass: 24.53 })).toBe(68.07)
    // Et depuis le seul pourcentage, à l'arrondi près.
    expect(leanMassOf(92.6, { fatRatio: 26.5 })!).toBeCloseTo(68.06, 1)
  })

  it('interpole entre les bornes de la littérature, sans marche d\'escalier', () => {
    expect(proteinPerKgLean(PROTEIN_FAT_LOW)).toBe(PROTEIN_LEAN_MAX)
    expect(proteinPerKgLean(PROTEIN_FAT_HIGH)).toBe(PROTEIN_LEAN_MIN)
    // Hors bornes, on plafonne au lieu d'extrapoler.
    expect(proteinPerKgLean(3)).toBe(PROTEIN_LEAN_MAX)
    expect(proteinPerKgLean(55)).toBe(PROTEIN_LEAN_MIN)
    // Monotone décroissante : plus on est sec, plus le coefficient monte.
    for (let f = 10; f < 32; f++) expect(proteinPerKgLean(f)).toBeGreaterThan(proteinPerKgLean(f + 1))
  })

  it('donne une cible plus basse que le calcul sur le poids de corps', () => {
    const plan = proteinPlan(92.6, REAL)
    expect(plan.basis).toBe('lean')
    expect(plan.leanKg).toBe(68.07)
    expect(plan.g).toBeLessThan(proteinTarget(92.6))
    // Reste dans la fourchette admise rapportée au poids de corps (1,6 - 2,2 g/kg).
    expect(plan.g / 92.6).toBeGreaterThan(1.6)
    expect(plan.g / 92.6).toBeLessThan(2.2)
  })

  it('la cible baisse à mesure qu\'on sèche, à masse maigre constante', () => {
    // Même masse maigre, moins de gras : le coefficient monte, donc la cible aussi.
    // C'est le comportement voulu — c'est quand il n'y a plus de gras à brûler que le
    // muscle devient la variable d'ajustement.
    const gras = proteinPlan(92.6, { fatRatio: 26.5, leanMass: 68.07 })
    const sec = proteinPlan(78, { fatRatio: 12.7, leanMass: 68.07 })
    expect(sec.g).toBeGreaterThan(gras.g)
  })

  it('retombe sur le poids de corps quand la balance ne mesure rien', () => {
    for (const comp of [null, undefined, {}, { fatRatio: 0 }, { fatRatio: 99 }]) {
      const plan = proteinPlan(94, comp)
      expect(plan.basis).toBe('weight')
      expect(plan.g).toBe(197)
      expect(plan.leanKg).toBeNull()
    }
  })

  it('écarte une masse grasse impossible plutôt que de la croire', () => {
    // Une masse grasse supérieure au poids, ou nulle : la balance s'est trompée de
    // personne ou de mesure. Mieux vaut le repli qu'une masse maigre inventée.
    expect(leanMassOf(92.6, { fatMass: 120 })).toBeNull()
    expect(leanMassOf(92.6, { leanMass: 200 })).toBeNull()
    expect(fatRatioOf(92.6, { fatRatio: 1 })).toBeNull()
  })

  it('vise toujours 2,1 g/kg sans mesure — la rétrocompatibilité tient', () => {
    expect(proteinTarget(94)).toBe(197)
  })
})

describe('macroGaps', () => {
  const targets = macroTargets(94, 2000)

  it('signale un manque de protéines', () => {
    const gaps = macroGaps({ kcal: 0, p: targets.p - 60, g: targets.g, l: targets.l }, targets)
    const p = gaps.find(x => x.key === 'p')!
    expect(p.tone).toBe('low')
    expect(p.delta).toBe(-60)
    expect(p.advice).toContain('fromage blanc')
  })

  it('ne reproche jamais un excès de protéines', () => {
    const gaps = macroGaps({ kcal: 0, p: targets.p + 80, g: targets.g, l: targets.l }, targets)
    expect(gaps.find(x => x.key === 'p')!.tone).toBe('ok')
  })

  it('signale un excès de glucides et dit où couper', () => {
    const gaps = macroGaps({ kcal: 0, p: targets.p, g: Math.round(targets.g * 1.4), l: targets.l }, targets)
    const g = gaps.find(x => x.key === 'g')!
    expect(g.tone).toBe('high')
    expect(g.advice).toContain('jamais sur les protéines')
  })

  it('signale un plancher lipidique non atteint', () => {
    const gaps = macroGaps({ kcal: 0, p: targets.p, g: targets.g, l: Math.round(targets.l * 0.5) }, targets)
    const l = gaps.find(x => x.key === 'l')!
    expect(l.tone).toBe('low')
    expect(l.advice).toMatch(/hormonale/)
  })

  it('tolère les petits écarts : le comptage se trompe déjà de 10 %', () => {
    const near = Math.round(targets.g * (1 + MACRO_BAND * 0.8))
    expect(macroGaps({ kcal: 0, p: targets.p, g: near, l: targets.l }, targets).find(x => x.key === 'g')!.tone).toBe('ok')
  })

  it('encaisse une cible vide sans planter', () => {
    const gaps = macroGaps({ kcal: 0, p: 0, g: 0, l: 0 }, { p: 0, g: 0, l: 0, kcal: 0 })
    expect(gaps).toHaveLength(3)
    expect(gaps.every(g => Number.isFinite(g.pct))).toBe(true)
  })
})

describe('donutArcs', () => {
  it('enchaîne les arcs sans trou ni recouvrement', () => {
    const arcs = donutArcs({ kcal: 0, p: 100, g: 200, l: 50 }, 2000)
    expect(arcs).toHaveLength(3)
    expect(arcs[0].from).toBe(0)
    expect(arcs[0].to).toBeCloseTo(arcs[1].from, 6)
    expect(arcs[1].to).toBeCloseTo(arcs[2].from, 6)
  })

  it('la fin du dernier arc est la progression totale', () => {
    // 100 g P + 200 g G + 50 g L = 400 + 800 + 450 = 1650 kcal sur 2000.
    const arcs = donutArcs({ kcal: 0, p: 100, g: 200, l: 50 }, 2000)
    expect(arcs.at(-1)!.to).toBeCloseTo(1650 / 2000, 6)
  })

  it('laisse dépasser au-delà de la cible plutôt que de tronquer', () => {
    const arcs = donutArcs({ kcal: 0, p: 200, g: 400, l: 100 }, 2000)
    expect(arcs.at(-1)!.to).toBeGreaterThan(1)
  })

  it('renvoie une liste vide sans cible', () => {
    expect(donutArcs({ kcal: 0, p: 100, g: 100, l: 30 }, 0)).toEqual([])
  })
})

// ─── Semaine type, courses et cuisine ────────────────────────────────────────
const GYM_WEEK = [true, true, false, true, true, false, false]
const NO_GYM = [false, false, false, false, false, false, false]
const A = () => builtinWeeks()[0]

describe('semaines livrées', () => {
  it('découpe le cycle de quatorze jours en deux semaines de sept', () => {
    const [a, b] = builtinWeeks()
    expect(a.days).toHaveLength(7)
    expect(b.days).toHaveLength(7)
    expect(a.days[0].slots.lunch).toBe(CYCLE[0].lunch)
    expect(b.days[0].slots.lunch).toBe(CYCLE[7].lunch)
  })

  it('les marque comme livrées : elles se réinitialisent, elles ne se perdent pas', () => {
    for (const w of builtinWeeks()) expect(w.builtin).toBe(true)
  })

  it('normalise une semaine tronquée sans lever d\'erreur', () => {
    const w = normalizeWeek({ id: 'x', days: [{ slots: { lunch: 'boite-a' } }] })!
    expect(w.days).toHaveLength(7)
    expect(w.days[6]).toEqual({ off: false, slots: {} })
    expect(w.name).toBe('Ma semaine')
  })

  it('refuse ce qui n\'est pas une semaine', () => {
    expect(normalizeWeek(null)).toBeNull()
    expect(normalizeWeek({ id: 'x' })).toBeNull()
  })
})

describe('ce que la semaine impose', () => {
  it('compte une portion par repas principal réellement prévu', () => {
    const sel = cookSelection(A(), GYM_WEEK)
    expect(Object.values(sel).reduce((a, b) => a + b, 0)).toBe(14)
    for (const id of Object.keys(sel)) expect(['boite', 'diner']).toContain(RECIPE_BY_ID[id].kind)
  })

  it('un dîner minute compte quand même : il s\'achète et se cuisine', () => {
    const sel = cookSelection(A(), GYM_WEEK)
    expect(Object.keys(sel).some(id => !RECIPE_BY_ID[id].batch)).toBe(true)
  })

  it('les collations restent hors sélection : on ne choisit pas son porridge', () => {
    const sel = cookSelection(A(), GYM_WEEK)
    expect(Object.keys(sel)).not.toContain('pdj')
    expect(Object.keys(sel)).not.toContain('col-aprem-salle')
  })

  it('un jour d\'absence ne coûte ni portion ni course', () => {
    const week = A()
    week.days[5].off = true
    week.days[6].off = true
    expect(weekDaysOn(week)).toBe(5)
    const sel = cookSelection(week, GYM_WEEK)
    expect(Object.values(sel).reduce((a, b) => a + b, 0)).toBe(10)
    const grams = weekGrams(week, GYM_WEEK)
    const plein = weekGrams(A(), GYM_WEEK)
    expect(grams['flocons-d-avoine']).toBeLessThan(plein['flocons-d-avoine'])
  })

  it('une surcharge de créneau change le plat servi', () => {
    const week = A()
    week.days[0].slots.pdj = 'col-aprem-repos'
    const plan = weekDayPlans(week, GYM_WEEK)[0]!
    expect(plan.meals.find(m => m.slot === 'pdj')!.recipeId).toBe('col-aprem-repos')
  })
})

describe('les courses de la semaine', () => {
  it('couvre TOUS les aliments de la semaine, petit-déjeuner compris', () => {
    // Le vrai test de la liste : ne pas rentrer du magasin sans petit-déjeuner.
    // Huit aliments manquaient jadis — avoine, fromage blanc, whey, fruits rouges,
    // banane, créatine, pomme, amandes — parce qu'ils n'étaient dans aucun plat.
    const requis = new Set<string>()
    for (const plan of weekDayPlans(A(), GYM_WEEK)) {
      for (const m of plan!.meals) for (const it of m.items) requis.add(it.food)
    }
    const achetes = new Set(shoppingFromWeek(A(), GYM_WEEK).flatMap(c => c.lines).map(l => l.food.id))
    expect([...requis].filter(f => !achetes.has(f))).toEqual([])
  })

  it('n\'achète ni banane ni shaker pour les jours sans séance', () => {
    const avec = weekGrams(A(), GYM_WEEK)
    const sans = weekGrams(A(), NO_GYM)
    expect(sans['banane']).toBeUndefined()
    expect(avec['banane']).toBe(4 * 120)
  })


  it('achète moins de féculents quand les séances sautent', () => {
    expect(weekGrams(A(), NO_GYM)['riz-basmati']).toBeLessThan(weekGrams(A(), GYM_WEEK)['riz-basmati'])
  })

  it('additionne un ingrédient partagé sur une seule ligne', () => {
    const ids = shoppingFromWeek(A(), GYM_WEEK).flatMap(c => c.lines).map(l => l.food.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('suit l\'ordre des rayons, pas l\'ordre alphabétique', () => {
    const ranks = shoppingFromWeek(A(), GYM_WEEK).map(c => CAT_ORDER.indexOf(c.cat))
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b))
  })

  it('trie chaque rayon du plus lourd au plus léger', () => {
    for (const { lines } of shoppingFromWeek(A(), GYM_WEEK)) {
      for (let i = 1; i < lines.length; i++) expect(lines[i - 1].grams).toBeGreaterThanOrEqual(lines[i].grams)
    }
  })

  it('rend une liste vide quand la semaine entière est vide', () => {
    expect(shoppingFrom({})).toEqual([])
  })

  it('formate les quantités en kg au-delà du kilo', () => {
    expect(fmtQty(850)).toBe('850 g')
    expect(fmtQty(1500)).toBe('1,5 kg')
  })
})

describe('conservation', () => {
  it('prend la durée la plus courte des ingrédients', () => {
    // Boîte A = poulet (3 j) + riz et légumes (4 j par défaut) → 3 jours.
    expect(keepsOf(RECIPE_BY_ID['boite-a'])).toBe(3)
    // Le poisson tombe à 2 jours et tire tout le plat avec lui.
    expect(keepsOf(RECIPE_BY_ID['din-poisson'])).toBe(2)
  })

  it('un ingrédient frais ne condamne pas le plat entier', () => {
    // Poulet-lentilles-salade : la salade tient 1 jour, mais on veut quand même
    // pouvoir cuire le poulet et les lentilles le dimanche.
    const r = RECIPE_BY_ID['din-poulet']
    expect(keepsOf(r)).toBe(3)
    expect(freshItemsOf(r).map(i => i.food)).toEqual(['salade-verte'])
  })

  it('retombe sur la valeur par défaut sans information', () => {
    expect(keepsOf({ id: 'x', name: 'x', kind: 'boite', batch: true, steps: '', items: [] })).toBe(KEEPS_DEFAULT)
  })

  it('le seuil du frais reste sous la conservation par défaut', () => {
    expect(KEEPS_FRESH).toBeLessThan(KEEPS_DEFAULT)
  })
})

describe('répartition des sessions de cuisine', () => {
  it('le dimanche couvre tout ce qui tient depuis la veille du lundi', () => {
    expect(cookSlotFor(0, 3)).toBe('dim')
    expect(cookSlotFor(2, 3)).toBe('dim')
  })

  it('bascule au mercredi soir ce qui n\'aurait pas tenu', () => {
    // Un plat de 3 jours mangé jeudi : 5 jours après le dimanche, impossible.
    expect(cookSlotFor(3, 3)).toBe('mer')
    expect(cookSlotFor(5, 3)).toBe('mer')
  })

  it('laisse au jour même ce que même le mercredi ne couvre pas', () => {
    expect(cookSlotFor(6, 3)).toBe('minute')
    expect(cookSlotFor(5, 2)).toBe('minute')
  })

  it('un plat qui tient toute la semaine se fait entièrement le dimanche', () => {
    for (let d = 0; d < 7; d++) expect(cookSlotFor(d, 8)).toBe('dim')
  })

  it('ne renonce plus à un plat parce qu\'il est meilleur frais', () => {
    // Régression : le drapeau « à faire minute » écartait TOUS les dîners de la
    // session du dimanche — la moitié de la semaine disparaissait du programme.
    const dim = cookPlan(A(), GYM_WEEK).find(s => s.id === 'dim')!
    const kinds = dim.dishes.map(d => RECIPE_BY_ID[d.recipeId].kind)
    expect(kinds).toContain('boite')
    expect(kinds).toContain('diner')
    expect(dim.dishes.some(d => !RECIPE_BY_ID[d.recipeId].batch)).toBe(true)
  })
})

describe('cookPlan', () => {
  const sessions = cookPlan(A(), GYM_WEEK)
  const byId = Object.fromEntries(sessions.map(s => [s.id, s]))

  it('ouvre par le dimanche et ne remonte jamais une session vide', () => {
    expect(sessions[0].id).toBe('dim')
    for (const s of sessions) expect(s.dishes.length).toBeGreaterThan(0)
  })

  it('ne cuisine deux fois aucune portion', () => {
    // 7 midis + 7 dîners + 7 petits-déjeuners : celui par défaut se prépare
    // désormais à l'avance, il entre donc dans les sessions comme le reste.
    const total = sessions.reduce((n, s) => n + s.dishes.reduce((m, d) => m + d.n, 0), 0)
    expect(total).toBe(21)
  })

  it('met au dimanche tout ce que la conservation autorise', () => {
    // Huit portions sur vingt et une : les viandes cuites tiennent trois jours, pas
    // sept. Le chiffre reste bas, et c'est le vrai — d'où la sortie par le congélateur.
    const dim = byId.dim.dishes.reduce((n, d) => n + d.n, 0)
    expect(dim).toBe(8)
    for (const d of byId.dim.dishes) expect(Math.max(...d.days)).toBeLessThanOrEqual(d.keeps - 1)
  })

  it('propose de congeler pour supprimer la session du mercredi', () => {
    const gelables = byId.mer.freezable!
    expect(gelables.length).toBeGreaterThan(0)
    // Rien qui se congèle mal ne doit être proposé : les œufs deviennent caoutchouc.
    for (const d of gelables) expect(freezableOf(RECIPE_BY_ID[d.recipeId])).toBe(true)
  })

  it('n\'attache la sortie congélateur qu\'à la session du mercredi', () => {
    expect(byId.dim.freezable).toBeUndefined()
    expect(byId.minute?.freezable).toBeUndefined()
  })

  it('range chaque portion dans la session que sa conservation autorise', () => {
    for (const s of sessions) {
      for (const d of s.dishes) {
        for (const dow of d.days) expect(cookSlotFor(dow, d.keeps)).toBe(s.id)
      }
    }
  })

  it('nomme les jours concernés en toutes lettres', () => {
    expect(listDays([0, 1, 3])).toBe('lundi, mardi et jeudi')
    expect(listDays([2])).toBe('mercredi')
  })

  it('estime une durée pour les sessions, pas pour le jour même', () => {
    expect(byId.dim.minutes).toBeGreaterThan(0)
    expect(byId.minute?.minutes ?? 0).toBe(0)
  })
})

describe('les fibres, au jour le jour', () => {
  it('comptent ce qui est réellement coché, pas la journée entière', () => {
    const day = buildDay(0, true)
    const rien = fiberIntake(day, [])
    const tout = fiberIntake(day, day.meals.map(m => m.slot))
    expect(rien.eaten).toBe(0)
    expect(rien.planned).toBe(tout.planned)
    expect(tout.eaten).toBe(tout.planned)
  })

  it('la journée du plan tient la référence sans exploser le seuil de vigilance', () => {
    for (let i = 0; i < CYCLE_LENGTH; i++) {
      const g = fiberIntake(buildDay(i, DEFAULT_TRAINED(i)), []).planned
      expect(g).toBeGreaterThanOrEqual(FIBER_MIN)
      expect(g).toBeLessThanOrEqual(FIBER_HIGH)
    }
  })

  it('dit ce qu\'il faut faire, dans les deux sens', () => {
    expect(fiberVerdict(15).tone).toBe('low')
    expect(fiberVerdict(15).advice).toMatch(/complète/)
    expect(fiberVerdict(30).tone).toBe('ok')
    expect(fiberVerdict(60).tone).toBe('high')
    // Le conseil qui compte au-dessus du seuil : boire.
    expect(fiberVerdict(60).advice).toMatch(/bois/i)
  })

  it('ne compte pas les repas hors plan : on n\'en connaît que les calories', () => {
    // Inventer les fibres d'un extra donnerait un chiffre faux avec l'air d'être juste.
    const day = buildDay(0, true)
    expect(fiberIntake(day, ['pdj']).eaten).toBe(fiberOf(day.meals.find(m => m.slot === 'pdj')!.items))
  })
})

describe('l\'ajustement sur des plats faits maison', () => {
  // Le vrai test de l'ajustement du soir : il doit continuer de marcher sur des
  // repas que le plan ne connaît pas. Sinon la mécanique tombe le jour où l'on
  // commence à saisir ses propres plats — c'est-à-dire dès qu'on s'approprie l'outil.
  const lib = {
    foods: {
      ...FOOD_BY_ID,
      quinoa: { id: 'quinoa', name: 'Quinoa', cat: 'feculents' as const, kcal: 368, p: 14, g: 64, l: 6 },
      seitan: { id: 'seitan', name: 'Seitan', cat: 'viandes' as const, kcal: 140, p: 25, g: 6, l: 2 },
    },
    recipes: {
      ...RECIPE_BY_ID,
      'mon-diner': {
        id: 'mon-diner',
        name: 'Mon dîner',
        kind: 'diner' as const,
        batch: false,
        steps: '',
        items: [{ food: 'seitan', g: 180 }, { food: 'quinoa', g: 100 }, { food: 'courgettes', g: 200 }],
      },
    },
  }

  it('reconnaît un féculent hors de la liste livrée', () => {
    expect(isStarchy(lib.foods.quinoa)).toBe(true)
    expect(isStarchy(lib.foods.seitan)).toBe(false)
    expect(isStarchy(undefined)).toBe(false)
  })

  it('rogne le quinoa d\'un plat maison pour tenir la cible', () => {
    const day = buildDay(0, true, lib, { slots: { dinner: 'mon-diner' } })
    const dinner = day.meals.find(m => m.slot === 'dinner')!
    expect(dinner.recipeId).toBe('mon-diner')
    // Journée volontairement trop chargée : l'ajustement doit trouver une prise.
    const plan = adjustRemaining(day, day.total.kcal - 200, [], 0, 'separate', lib.foods)
    expect(plan).not.toBeNull()
    const after = applySteps(day, plan, lib.foods)
    const q = (d: typeof day) => d.meals.flatMap(m => m.items).find(i => i.food === 'quinoa')?.g ?? 0
    expect(q(after)).toBeLessThan(q(day))
  })

  it('module aussi un féculent maison les jours sans séance', () => {
    const gym = buildDay(0, true, lib, { slots: { dinner: 'mon-diner' } })
    const rest = buildDay(0, false, lib, { slots: { dinner: 'mon-diner' } })
    const q = (d: typeof gym) => d.meals.flatMap(m => m.items).find(i => i.food === 'quinoa')!.g
    expect(q(rest)).toBeLessThan(q(gym))
  })

  it('ne touche jamais à la protéine ni aux légumes', () => {
    const gym = buildDay(0, true, lib, { slots: { dinner: 'mon-diner' } })
    const rest = buildDay(0, false, lib, { slots: { dinner: 'mon-diner' } })
    const g = (d: typeof gym, f: string) => d.meals.flatMap(m => m.items).find(i => i.food === f)!.g
    expect(g(rest, 'seitan')).toBe(g(gym, 'seitan'))
    expect(g(rest, 'courgettes')).toBe(g(gym, 'courgettes'))
  })
})

describe('les variantes de petit-déjeuner et de collation', () => {
  const kcalOf = (id: string) => macrosOf(RECIPE_BY_ID[id].items).kcal
  const pOf = (id: string) => macrosOf(RECIPE_BY_ID[id].items).p

  it('chaque petit-déjeuner tient les macros du porridge à 10 % près', () => {
    // C'est la condition pour qu'en changer soit un vrai choix : une option qui
    // pèse 200 kcal de plus n'est pas une alternative, c'est un piège.
    const ref = kcalOf('pdj-croquant')
    for (const r of Object.values(RECIPE_BY_ID).filter(x => x.kind === 'pdj')) {
      expect(Math.abs(kcalOf(r.id) - ref) / ref).toBeLessThan(0.1)
      expect(pOf(r.id)).toBeGreaterThanOrEqual(pOf('pdj-croquant') * 0.9)
    }
  })

  it('offre au moins un petit-déjeuner préparable à l\'avance et un liquide', () => {
    const pdj = Object.values(RECIPE_BY_ID).filter(r => r.kind === 'pdj')
    expect(pdj.some(r => r.batch)).toBe(true)
    expect(pdj.some(r => /boire|smoothie/i.test(r.name))).toBe(true)
  })

  it('le petit-déjeuner PAR DÉFAUT se prépare à l\'avance', () => {
    // Il se mange à 10 h au bureau : un défaut qui réclame un micro-ondes et deux
    // minutes debout n'est pas un défaut, c'est un obstacle.
    for (const slots of [SLOTS_GYM, SLOTS_REST]) {
      const id = slots.find(s => s.id === 'pdj')!.recipe!
      expect(RECIPE_BY_ID[id].batch).toBe(true)
    }
  })

  it('les collations restent sous 180 kcal', () => {
    for (const id of ['col-cacao', 'col-skyr', 'col-mousse', 'col-oeufs', 'col-shaker', 'col-soir-cacahuete']) {
      expect(kcalOf(id)).toBeLessThanOrEqual(180)
    }
  })

  it('propose au moins une collation salée : le sucré finit par écœurer', () => {
    expect(RECIPE_BY_ID['col-oeufs'].items.map(i => i.food)).toContain('cornichons')
  })

  it('la mousse aquafaba offre le meilleur rapport protéines / calories', () => {
    const ratio = (id: string) => pOf(id) / kcalOf(id)
    const autres = ['col-cacao', 'col-skyr', 'col-oeufs', 'col-shaker'].map(ratio)
    expect(ratio('col-mousse')).toBeGreaterThan(Math.max(...autres))
  })
})

describe('ce qui se prépare à l\'avance entre dans la session', () => {
  const week = () => {
    const w = builtinWeeks()[0]
    for (const d of w.days) { d.slots.pdj = 'pdj-overnight'; d.slots.snack = 'col-oeufs' }
    return w
  }

  it('cuisine aussi les petits-déjeuners et collations préparables à l\'avance', () => {
    // Régression : trois recettes étaient marquées « à l'avance » sans jamais
    // apparaître dans une session — donc sans jamais dire quand les faire.
    const dim = cookPlan(week(), GYM_WEEK).find(s => s.id === 'dim')!
    const ids = dim.dishes.map(d => d.recipeId)
    expect(ids).toContain('pdj-overnight')
    expect(ids).toContain('col-oeufs')
  })

  it('laisse dehors ce qui se fait sur le moment', () => {
    // Le petit-déjeuner et la collation-shaker se montent sur le moment : ils n'ont rien
    // à faire dans une session de préparation.
    const w = builtinWeeks()[0]
    const ids = cookPlan(w, GYM_WEEK).flatMap(s => s.dishes.map(d => d.recipeId))
    expect(ids).not.toContain('pdj')
    expect(ids).not.toContain('col-aprem-salle')
  })

  it('respecte la conservation déclarée sur la recette, pas celle des ingrédients', () => {
    // Avoine et fromage blanc tiennent longtemps ; le bocal monté tient 3 jours.
    expect(keepsOf(RECIPE_BY_ID['pdj-overnight'])).toBe(3)
    const dim = cookPlan(week(), GYM_WEEK).find(s => s.id === 'dim')!
    expect(dim.dishes.find(d => d.recipeId === 'pdj-overnight')!.n).toBe(3)
  })

  it('compte en pots, pas en boîtes, et donne le mode d\'emploi', () => {
    const dim = cookPlan(week(), GYM_WEEK).find(s => s.id === 'dim')!
    const oats = dim.steps.find(st => st.title.startsWith('Overnight oats'))!
    expect(oats.title).toMatch(/pots/)
    expect(oats.lines[0]).toMatch(/par pot/)
    expect(oats.hint).toMatch(/LA VEILLE/)
  })

  it('n\'applique pas aux collations les consignes de cuisson des plats', () => {
    // « Œufs battus versés sur les légumes » n'a aucun sens pour des œufs durs :
    // les étapes de cuisson ne regardent que les repas principaux.
    const dim = cookPlan(week(), GYM_WEEK).find(s => s.id === 'dim')!
    const prot = dim.steps.find(st => /protéines/i.test(st.title))!
    expect(prot.lines.some(l => /Œufs entiers/.test(l))).toBe(false)
  })
})

describe('les sauces', () => {
  it('sont comptées dans le plat : elles se mangent, même à part', () => {
    const nu = macrosOf(RECIPE_BY_ID['boite-a'].items)
    const avec = macrosOf(expandItems(RECIPE_BY_ID['boite-a']))
    expect(avec.kcal).toBeGreaterThan(nu.kcal)
    expect(avec.p).toBeGreaterThan(nu.p)
  })

  it('entrent dans les courses avec le reste', () => {
    const ids = shoppingFromWeek(A(), GYM_WEEK).flatMap(c => c.lines).map(l => l.food.id)
    expect(ids).toContain('yaourt-grec-0')
    expect(ids).toContain('paprika-fume')
    expect(ids).toContain('ail')
  })

  it('ne pénalisent pas la conservation du plat : elles ne sont pas dans la boîte', () => {
    // Le yaourt grec se congèle mal. S'il comptait dans le plat, la Boîte A ne
    // pourrait plus jamais partir au congélateur — alors qu'il est dans un pot.
    expect(freezableOf(RECIPE_BY_ID['boite-a'])).toBe(true)
    expect(keepsOf(RECIPE_BY_ID['boite-a'])).toBe(3)
  })

  it('ont leur propre étape, séparée de l\'assemblage', () => {
    const steps = cookSteps(cookPlan(A(), GYM_WEEK)[0].dishes)
    const sauces = steps.find(st => /sauces/i.test(st.title))!
    expect(sauces.hint).toMatch(/JAMAIS dans la boîte/)
    expect(sauces.lines.length).toBeGreaterThan(0)
    // Les quantités sont multipliées par le nombre de portions du plat servi.
    //
    // On vérifie la MULTIPLICATION, pas un nombre écrit en dur. La version
    // précédente attendait « 4 portions » : un chiffre qui ne dépendait que de
    // l'ordre des plats dans le cycle, et qui est tombé à la première rotation
    // retouchée — alors que la règle testée, elle, n'avait pas bougé d'un pouce.
    const ligne = sauces.lines.find(l => /(\d+) portions/.test(l))!
    expect(ligne).toBeDefined()
    const n = Number(ligne.match(/(\d+) portions/)![1])
    expect(n).toBeGreaterThan(1)
    const base = RECIPE_BY_ID[Object.keys(RECIPE_BY_ID).find(id => RECIPE_BY_ID[id].kind === 'sauce' && ligne.startsWith(RECIPE_BY_ID[id].name))!]
    for (const it of base.items) {
      const g = Math.round(it.g * n * 10) / 10
      expect(ligne, `${base.name} × ${n} doit servir ${g} g de ${it.food}`).toContain(`${g} g`)
    }
  })

  it('restent légères : aucune ne dépasse 90 kcal la portion', () => {
    for (const r of Object.values(RECIPE_BY_ID).filter(x => x.kind === 'sauce')) {
      expect(macrosOf(r.items).kcal).toBeLessThanOrEqual(90)
    }
  })

  it('assaisonnent tous les repas principaux livrés', () => {
    for (const r of Object.values(RECIPE_BY_ID)) {
      if (r.kind === 'boite' || r.kind === 'diner') expect(r.sauce).toBeTruthy()
    }
  })
})

describe('le congélateur, quand il y a la place', () => {
  const sans = cookPlan(A(), GYM_WEEK)
  const avec = cookPlan(A(), GYM_WEEK, undefined, { freezer: true })
  const dimOf = (p: typeof sans) => p.find(s => s.id === 'dim')!

  it('n\'est jamais supposé : sans réglage, le plan ne change pas', () => {
    expect(cookPlan(A(), GYM_WEEK, undefined, {})).toEqual(sans)
    expect(dimOf(sans).dishes.some(d => d.frozen)).toBe(false)
  })

  it('remonte au dimanche tout ce qui se congèle', () => {
    expect(avec.find(s => s.id === 'mer')).toBeUndefined()
    const total = dimOf(avec).dishes.reduce((n, d) => n + d.n, 0)
    expect(total).toBeGreaterThan(dimOf(sans).dishes.reduce((n, d) => n + d.n, 0))
  })

  it('laisse au jour même ce qui se congèle mal', () => {
    // L'omelette : les œufs cuits deviennent caoutchouteux une fois congelés.
    const minute = avec.find(s => s.id === 'minute')!
    expect(minute.dishes.every(d => !freezableOf(RECIPE_BY_ID[d.recipeId]))).toBe(true)
  })

  it('ne congèle pas ce qui tenait déjà au frigo', () => {
    for (const d of dimOf(avec).dishes) {
      if (Math.max(...d.days) < d.keeps) expect(d.frozen).toBe(false)
    }
  })

  it('sépare les portions d\'un même plat selon leur destination', () => {
    // Le plat du lundi va au frigo, celui du vendredi au congélateur : deux entrées,
    // parce que ce ne sont ni le même geste ni la même étagère.
    //
    // On cherche N'IMPORTE quel plat dans ce cas plutôt qu'un identifiant en dur :
    // l'invariant porte sur la séparation, pas sur le poisson. Écrit en dur, ce test
    // tombait dès qu'on changeait un dîner du cycle — ce qui est arrivé.
    const dishes = dimOf(avec).dishes
    const parPlat = new Map<string, boolean[]>()
    for (const d of dishes) parPlat.set(d.recipeId, [...(parPlat.get(d.recipeId) ?? []), d.frozen])
    const partages = [...parPlat.values()].filter(dest => dest.length > 1)

    expect(partages.length).toBeGreaterThan(0)
    for (const dest of partages) expect([...dest].sort()).toEqual([false, true])
  })

  it('range le frigo et le congélateur dans deux listes distinctes', () => {
    const last = dimOf(avec).steps.at(-1)!
    expect(last.lines).toContain('AU FRIGO :')
    expect(last.lines).toContain('AU CONGÉLATEUR, tout de suite :')
  })

  it('ne propose plus la sortie congélateur quand elle est déjà prise', () => {
    expect(sans.find(s => s.id === 'mer')!.freezable!.length).toBeGreaterThan(0)
    for (const s of avec) expect(s.freezable).toBeUndefined()
  })

  it('cookPlaceFor : le frigo d\'abord, le congélateur en secours', () => {
    expect(cookPlaceFor(0, 3, true, { freezer: true })).toEqual({ where: 'dim', frozen: false })
    expect(cookPlaceFor(5, 3, true, { freezer: true })).toEqual({ where: 'dim', frozen: true })
    expect(cookPlaceFor(5, 3, false, { freezer: true })).toEqual({ where: 'mer', frozen: false })
    expect(cookPlaceFor(5, 3, true, {})).toEqual({ where: 'mer', frozen: false })
  })
})

describe('la recette guidée', () => {
  const steps = cookSteps(cookPlan(A(), GYM_WEEK)[0].dishes)
  const titles = steps.map(s => s.title)

  it('numérote les étapes sans trou, dans l\'ordre', () => {
    expect(steps.map(s => s.n)).toEqual(steps.map((_, i) => i + 1))
  })

  it('commence par le four et finit par le rangement', () => {
    expect(titles[0]).toMatch(/four/i)
    expect(titles.at(-1)).toMatch(/range/i)
  })

  it('sort les quantités des étapes : elles ont leur propre liste', () => {
    // Une recette se lit en deux temps — ce qu'on sort, puis ce qu'on fait. Les
    // quantités noyées dans une première étape obligeaient à remonter dans le
    // texte à chaque fois qu'on cherchait un poids.
    const ing = cookIngredients(cookPlan(A(), GYM_WEEK)[0].dishes)
    expect(ing.length).toBeGreaterThan(10)
    expect(ing.map(i => i.name)).not.toContain(undefined)
    // Du plus lourd au plus léger : les kilos d'abord, les pincées ensuite.
    const g = ing.map(i => Number.parseFloat(i.qty.replace(',', '.')) * (i.qty.includes('kg') ? 1000 : 1))
    expect(g).toEqual([...g].sort((a, b) => b - a))
  })

  it('marque ce qui se pèse cru, et rappelle les repères d\'achat', () => {
    const ing = cookIngredients(cookPlan(A(), GYM_WEEK)[0].dishes)
    expect(ing.find(i => i.foodId === 'filet-de-poulet')!.raw).toBe(true)
    expect(ing.find(i => i.foodId === 'brocolis')!.raw).toBe(false)
    expect(ing.find(i => i.foodId === 'paprika-fume')!.note).toMatch(/c. à café/)
  })

  it('n\'oublie pas les ingrédients des sauces', () => {
    const ing = cookIngredients(cookPlan(A(), GYM_WEEK)[0].dishes)
    expect(ing.map(i => i.foodId)).toContain('yaourt-grec-0')
  })

  it('lance le four avant de cuisiner quoi que ce soit', () => {
    const four = titles.findIndex(t => /four/i.test(t))
    const prot = titles.findIndex(t => /protéines/i.test(t))
    expect(four).toBeGreaterThan(-1)
    expect(four).toBeLessThan(prot)
  })

  it('cuit les féculents avant les légumes : c\'est le plus long', () => {
    expect(titles.findIndex(t => /féculents/i.test(t)))
      .toBeLessThan(titles.findIndex(t => /légumes/i.test(t)))
  })

  it('donne les temps de cuisson, pas seulement les quantités', () => {
    const fec = steps.find(s => /féculents/i.test(s.title))!
    expect(fec.lines.some(l => /min/.test(l))).toBe(true)
  })

  it('additionne les quantités au lieu de répéter chaque recette', () => {
    const fec = steps.find(s => /féculents/i.test(s.title))!
    const noms = fec.lines.map(l => l.split(' — ')[0])
    expect(new Set(noms).size).toBe(noms.length)
  })

  it('rappelle de ne PAS portionner les féculents', () => {
    expect(steps.find(s => /féculents/i.test(s.title))!.hint).toMatch(/SANS portionner/)
  })

  it('donne le contenu d\'UNE boîte, pas le total du plat', () => {
    const boite = steps.find(s => s.title.startsWith('Boîte A'))!
    expect(boite.lines.some(l => /120 g par boîte/.test(l))).toBe(true)
  })

  it('sort les ingrédients frais de l\'assemblage et le dit', () => {
    const poulet = steps.find(s => /Poulet, lentilles/.test(s.title))
    if (poulet) {
      expect(poulet.lines.some(l => /Salade/i.test(l))).toBe(false)
      expect(poulet.hint).toMatch(/le jour même/)
    }
  })

  it('ne propose aucune étape sans plat', () => {
    expect(cookSteps([])).toEqual([])
  })
})

describe('totaux et stock', () => {
  it('les totaux suivent le nombre de portions', () => {
    const one = selectionTotals({ 'boite-a': 1 })
    const three = selectionTotals({ 'boite-a': 3 })
    // À l'unité près : chaque total est arrondi une fois, à la fin. Trois portions
    // d'un plat à 681,3 kcal font 2044, pas 3 × 681.
    expect(Math.abs(three.kcal - one.kcal * 3)).toBeLessThanOrEqual(3)
    expect(three.portions).toBe(3)
    expect(three.dishes).toBe(1)
  })

  it('ignore les plats à zéro portion et les identifiants inconnus', () => {
    const t = selectionTotals({ 'boite-a': 0, 'plat-fantome': 5 })
    expect(t.portions).toBe(0)
    expect(t.kcal).toBe(0)
  })

  it('retranche ce qui a été mangé, sans jamais descendre sous zéro', () => {
    expect(stockOf({ 'boite-a': 4 }, { 'boite-a': 3 })).toEqual({ 'boite-a': 1 })
    expect(stockOf({ 'boite-a': 2 }, { 'boite-a': 5 })).toEqual({ 'boite-a': 0 })
  })
})

// ─── Taux de matière grasse des laitiers ─────────────────────────────────────
describe('taux de matière grasse acheté', () => {
  const FB = FOOD_BY_ID['fromage-blanc-0']
  const libAt = (pct: number) => {
    const foods = { ...FOOD_BY_ID }
    for (const [id, f] of Object.entries(FOOD_BY_ID)) if (isAdjustableDairy(f)) foods[id] = atFatPct(f, pct)
    return { foods, recipes: RECIPE_BY_ID }
  }

  it('laisse le produit du plan intact quand on déclare 0 %', () => {
    // « 0 % » en rayon, c'est le produit du plan, qui porte 0,2 g à l'étiquette.
    // Recalculer pour 0,2 g remplacerait les kcal de l'étiquette par un 4/4/9
    // théorique — 50 au lieu de 47 — et changerait les chiffres de quelqu'un qui
    // n'a rien changé à ses courses.
    expect(atFatPct(FB, 0)).toBe(FB)
    expect(atFatPct(FB, 0).kcal).toBe(47)
  })

  it('colle aux étiquettes du rayon', () => {
    const trois = atFatPct(FB, 3)
    expect(trois.l).toBe(3)
    expect(trois.kcal).toBeGreaterThanOrEqual(70) // rayon : 72-75
    expect(trois.kcal).toBeLessThanOrEqual(80)
    expect(trois.p).toBeGreaterThan(7) // rayon : ~7,5
    expect(trois.p).toBeLessThan(FB.p) // dilué par la crème remise
  })

  it('dilue aussi les micronutriments', () => {
    // Le calcium ne se concentre pas parce qu'on ajoute du gras. Sans ça, le
    // compteur de micros annoncerait une couverture qui n'existe pas.
    expect(atFatPct(FB, 8).micro!.ca!).toBeLessThan(FB.micro!.ca!)
  })

  it('refuse un taux de crème', () => {
    expect(atFatPct(FB, 90).l).toBe(FAT_PCT_MAX)
  })

  it('ne propose le réglage que sur les laitiers maigres', () => {
    expect(isAdjustableDairy(FOOD_BY_ID['fromage-blanc-0'])).toBe(true)
    expect(isAdjustableDairy(FOOD_BY_ID['yaourt-grec-0'])).toBe(true)
    expect(isAdjustableDairy(FOOD_BY_ID['huile-d-olive'])).toBe(false)
    expect(isAdjustableDairy(FOOD_BY_ID['filet-de-poulet'])).toBe(false)
  })

  it('réduit la quantité de laitier et monte la poudre déjà là', () => {
    const items = [{ food: 'fromage-blanc-0', g: 200 }, { food: 'whey-poudre', g: 15 }, { food: 'flocons-d-avoine', g: 60 }]
    const out = rebalanceDairy(items, libAt(3).foods)
    expect(out[0].g).toBeLessThan(200)
    expect(out[1].g).toBeGreaterThan(15)
    expect(out[2].g).toBe(60) // rien d'autre ne bouge
  })

  it('ne vide pas le bol : le plancher tient', () => {
    // Tenir calories ET protéines à 3 % ramènerait les 200 g du matin à 53 g. Les
    // macros tomberaient juste, il ne resterait plus de petit-déjeuner.
    const items = [{ food: 'fromage-blanc-0', g: 200 }, { food: 'whey-poudre', g: 15 }]
    const out = rebalanceDairy(items, libAt(8).foods)
    expect(out[0].g).toBeGreaterThanOrEqual(200 * DAIRY_KEEP_MIN)
  })

  it('tient les calories quand la recette n\'a pas de poudre', () => {
    // Le fromage blanc du soir : une seule inconnue, on tient les calories.
    const items = [{ food: 'fromage-blanc-0', g: 150 }]
    const out = rebalanceDairy(items, libAt(3).foods)
    const avant = macrosOf(items).kcal
    const apres = macrosOf(out, libAt(3).foods).kcal
    expect(Math.abs(apres - avant)).toBeLessThan(15)
  })

  it('ne touche à rien sans taux déclaré', () => {
    const items = [{ food: 'fromage-blanc-0', g: 200 }, { food: 'whey-poudre', g: 15 }]
    expect(rebalanceDairy(items, FOOD_BY_ID)).toEqual(items)
  })

  it('garde la cible protéique du jour malgré le changement de taux', () => {
    // C'est TOUT l'intérêt du rééquilibrage. Réduire le laitier sans compenser
    // ferait tomber la journée à 160 g de protéines pour une cible de 175.
    const lib = libAt(3)
    let p = 0
    for (let i = 0; i < CYCLE_LENGTH; i++) p += buildDay(i, DEFAULT_TRAINED(i), lib).total.p
    expect(p / CYCLE_LENGTH).toBeGreaterThanOrEqual(proteinTarget(92.4, { fatRatio: 26.41, leanMass: 67.99 }) * 0.95)
  })

  it('chiffre ce qui reste à la charge de la journée', () => {
    const lib = libAt(3)
    const cost = dairySwapCost(lib, i => DEFAULT_TRAINED(i))
    expect(cost.grams).toBeLessThan(0) // moins de laitier
    expect(cost.rawKcal).toBeGreaterThan(cost.kcal) // le rééquilibrage a servi
    expect(cost.kcal).toBeLessThan(cost.rawKcal / 2) // et il en rattrape plus de la moitié
  })
})

// ─── La rotation des dîners ──────────────────────────────────────────────────
//
// Le cycle a été refait le 12/08 : plus de maquereau, et un ordre calculé plutôt
// que choisi. Ces tests verrouillent les règles qui l'ont produit — sans eux, la
// prochaine retouche à la main peut casser silencieusement l'une d'elles, et on ne
// le verrait qu'au moment de cuisiner.
describe('rotation des dîners sur le cycle', () => {
  const dinners = CYCLE.map(d => d.dinner)
  const MINUTE_DAYS = [2, 5, 6] // mer, sam, dim : cf. cookSlotFor pour un plat keeps=2

  it('ne programme plus de maquereau', () => {
    // Il portait la vitamine D et les oméga-3, mais il n'était pas acheté. Un plat
    // qu'on ne cuisine jamais n'est pas un plat, c'est un trou dans la semaine.
    expect(dinners).not.toContain('din-maquereau')
    // La recette RESTE dans la bibliothèque : elle se choisit à la main le jour où
    // le poissonnier en a. La retirer aurait détruit du travail pour rien.
    expect(RECIPE_BY_ID['din-maquereau']).toBeDefined()
  })

  it('ne sert jamais deux fois le même dîner à moins de trois jours', () => {
    // Écart cyclique : le dimanche de la semaine 2 est suivi du lundi de la 1.
    for (const plat of new Set(dinners)) {
      const pos = dinners.map((d, i) => (d === plat ? i : -1)).filter(i => i >= 0)
      for (let j = 0; j < pos.length; j++) {
        const a = pos[j], b = pos[(j + 1) % pos.length]
        const gap = b > a ? b - a : b + CYCLE_LENGTH - a
        expect(gap, `${plat} revient après ${gap} jour(s)`).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('ne répète jamais la même protéine au déjeuner ET au dîner', () => {
    // Poulet le midi PUIS poulet le soir, c'est le jour où on n'ouvre pas la boîte.
    for (const [i, d] of CYCLE.entries()) {
      if (d.lunch === 'boite-a') expect(d.dinner, `jour ${i}`).not.toBe('din-poulet')
      if (d.lunch === 'boite-c') expect(['din-poisson', 'din-saumon'], `jour ${i}`).not.toContain(d.dinner)
    }
  })

  it('place l\'omelette les seuls jours où elle se fait à la minute', () => {
    // Des œufs cuits le dimanche pour mardi deviennent caoutchouteux : le plat de
    // dix minutes qu'on avait conçu se transforme en restes. Seuls mercredi, samedi
    // et dimanche renvoient « minute » pour un plat qui se garde deux jours.
    for (const [i, d] of CYCLE.entries()) {
      if (d.dinner === 'din-omelette') {
        expect(MINUTE_DAYS, `omelette au jour ${i}`).toContain(i % 7)
        expect(cookSlotFor(i % 7, keepsOf(RECIPE_BY_ID['din-omelette']))).toBe('minute')
      }
    }
  })

  it('garde le même effort de préparation qu\'avant, semaine par semaine', () => {
    // Trois types de boîte par semaine, pas quatre : la session du dimanche ne doit
    // pas s'allonger d'une casserole parce qu'on a réordonné les dîners.
    for (const w of [0, 1]) {
      const boxes = new Set(CYCLE.slice(w * 7, w * 7 + 7).map(d => d.lunch))
      expect(boxes.size, `semaine ${w + 1}`).toBeLessThanOrEqual(3)
    }
  })

  it('tient la vitamine D sans maquereau, par les champignons UV', () => {
    // C'était le risque du retrait : on avait porté la couverture de 24 % à 70 %,
    // et le maquereau en fournissait 20,7 µg par dîner. Les champignons exposés aux
    // UV (10 µg / 100 g, 22 kcal) la reprennent — et la dépassent.
    const plans = Array.from({ length: CYCLE_LENGTH }, (_, i) => buildDay(i, DEFAULT_TRAINED(i)))
    const vd = microCoverage(plans).find(m => m.key === 'vd')!
    expect(vd.pct).toBeGreaterThanOrEqual(75)
    const o3 = microCoverage(plans).find(m => m.key === 'o3')!
    expect(o3.pct).toBeGreaterThanOrEqual(100)
  })
})

// ─── Deux listes plutôt qu'une ───────────────────────────────────────────────
describe('ingrédients séparés plat / sauce', () => {
  it('met dans la poêle ce qui va dans la poêle, dans le pot ce qui va dans le pot', () => {
    const s = splitIngredients(RECIPE_BY_ID['din-poisson'])
    expect(s.sauceName).toBe(RECIPE_BY_ID['sauce-blanche'].name)
    expect(s.dish.map(l => l.food)).toEqual(RECIPE_BY_ID['din-poisson'].items.map(i => i.g && i.food))
    expect(s.sauce.map(l => l.food)).toEqual(RECIPE_BY_ID['sauce-blanche'].items.map(i => i.food))
    // le yaourt grec n'existe QUE dans le pot
    expect(s.dish.some(l => l.food === 'yaourt-grec-0')).toBe(false)
    expect(s.sauce.some(l => l.food === 'yaourt-grec-0')).toBe(true)
  })

  it('donne le total à sortir du frigo sur les ingrédients partagés', () => {
    // C'est ce que la fusion réglait et qu'il ne faut pas reperdre : le citron du
    // dîner poisson est à 20 g dans le plat et 10 g dans la sauce. Les deux lignes
    // portent « 30 g en tout », personne n'a d'addition à faire devant le frigo.
    const s = splitIngredients(RECIPE_BY_ID['din-poisson'])
    const dishCitron = s.dish.find(l => l.food === 'citron')!
    const sauceCitron = s.sauce.find(l => l.food === 'citron')!
    expect(dishCitron.g).toBe(20)
    expect(sauceCitron.g).toBe(10)
    expect(dishCitron.total).toBe(30)
    expect(sauceCitron.total).toBe(30)
  })

  it('ne perd pas un gramme : les deux listes réunies font le plat servi', () => {
    // Le garde-fou qui vaut les autres. Si la séparation oubliait une ligne ou en
    // comptait une en trop, la fiche afficherait des ingrédients qui ne font pas les
    // calories annoncées juste au-dessus — et personne ne le verrait à l'œil.
    for (const r of Object.values(RECIPE_BY_ID)) {
      const s = splitIngredients(r)
      const parListes = macrosOf([...s.dish, ...s.sauce].map(l => ({ food: l.food, g: l.g })))
      const parPlat = macrosOf(expandItems(r))
      expect(parListes.kcal, r.name).toBeCloseTo(parPlat.kcal, 6)
      expect(parListes.p, r.name).toBeCloseTo(parPlat.p, 6)
    }
  })

  it('rend une liste vide de sauce quand le plat n\'en a pas', () => {
    const sans = Object.values(RECIPE_BY_ID).find(r => !r.sauce && r.items.length > 1)!
    const s = splitIngredients(sans)
    expect(s.sauce).toEqual([])
    expect(s.sauceName).toBeNull()
    // et chaque total vaut sa propre quantité : rien n'est partagé
    for (const l of s.dish) expect(l.total).toBe(l.g)
  })

  it('affiche les grammages APRÈS rééquilibrage du laitier', () => {
    // La fiche annonçait 200 g de fromage blanc pendant que le plan en servait 100
    // dès qu'un taux de MG était déclaré — et c'est le chiffre de la fiche qu'on pèse.
    const foods = { ...FOOD_BY_ID, 'fromage-blanc-0': atFatPct(FOOD_BY_ID['fromage-blanc-0'], 5) }
    const pdj = RECIPE_BY_ID['pdj-croquant']
    const brut = pdj.items.find(i => i.food === 'fromage-blanc-0')!.g
    const equilibre = rebalanceDairy(pdj.items, foods).find(i => i.food === 'fromage-blanc-0')!.g
    expect(equilibre).toBeLessThan(brut)
    const s = splitIngredients({ ...pdj, items: rebalanceDairy(pdj.items, foods) })
    expect(s.dish.find(l => l.food === 'fromage-blanc-0')!.g).toBe(equilibre)
  })
})

// ─── Choisir son plat, sans demander la permission au frigo ──────────────────
describe('choix du plat d\'un créneau', () => {
  const LIB = { foods: FOOD_BY_ID, recipes: RECIPE_BY_ID }

  it('propose TOUS les plats de la famille, cuisinés ou non', () => {
    // Le stock filtrait la liste : on ne pouvait pas dire « aujourd'hui je mange autre
    // chose » si cet autre chose n'avait pas été coché à la session de cuisine. Or ce
    // choix ne gère pas un frigo, il donne les bonnes quantités pour la journée.
    const midi = choicesForSlot('lunch', LIB, {})
    const attendu = activeRecipes(LIB, 'boite').length + activeRecipes(LIB, 'diner').length
    expect(midi).toHaveLength(attendu)
    expect(midi.every(c => c.left === null)).toBe(true) // stock inconnu, pas zéro
  })

  it('accepte un dîner à midi, et une boîte le soir', () => {
    // L'erreur venait de moi : j'ai conseillé de mettre la dinde et le saumon — deux
    // recettes de DÎNER — dans les boîtes du midi lors d'une session de batch cooking.
    // L'app refusait ensuite de les proposer à midi, et il ne restait que les trois
    // boîtes. Un plat n'appartient pas à une heure de la journée.
    const midi = choicesForSlot('lunch', LIB).map(c => c.id)
    expect(midi).toContain('din-dinde')
    expect(midi).toContain('din-saumon')
    expect(choicesForSlot('dinner', LIB).map(c => c.id)).toContain('boite-a')
  })

  it('garde le type du créneau EN TÊTE de liste', () => {
    // Élargir ne doit pas noyer le choix évident : à midi les boîtes d'abord.
    expect(slotKinds('lunch')).toEqual(['boite', 'diner'])
    expect(slotKinds('dinner')).toEqual(['diner', 'boite'])
    expect(slotKinds('pdj')).toEqual(['pdj', 'collation'])
    expect(slotKinds('snack')).toEqual(['collation', 'pdj'])
    expect(choicesForSlot('lunch', LIB)[0].kind).toBe('boite')
    expect(choicesForSlot('dinner', LIB)[0].kind).toBe('diner')
  })

  it('rend le stock quand il est connu, sans jamais s\'en servir pour filtrer', () => {
    const midi = choicesForSlot('lunch', LIB, { 'boite-a': 0 })
    const a = midi.find(c => c.id === 'boite-a')!
    expect(a, 'boite-a doit rester proposée même à zéro portion').toBeDefined()
    expect(a.left).toBe(0)
  })

  it('couvre tous les créneaux d\'une journée, pas seulement midi et soir', () => {
    // On change aussi de petit-déjeuner ou de collation, et c'était impossible.
    expect(choicesForSlot('pdj', LIB).length).toBeGreaterThan(1)
    expect(choicesForSlot('snack', LIB).length).toBeGreaterThan(1)
    expect(choicesForSlot('night', LIB).length).toBeGreaterThan(1)
    expect(choicesForSlot('pre', LIB).length).toBeGreaterThan(1)
    expect(choicesForSlot('dinner', LIB).length).toBeGreaterThan(1)
  })

  it('ne propose rien pour la créatine : ce n\'est pas un repas', () => {
    // Elle est rangée en « collation » pour que ses zéros calories entrent dans les
    // totaux. La proposer en alternative à une collation n'aurait aucun sens.
    expect(slotKind('creatine')).toBeNull()
    expect(choicesForSlot('creatine', LIB)).toEqual([])
  })

  it('associe chaque créneau au bon type de plat', () => {
    for (const slots of [SLOTS_GYM, SLOTS_REST]) {
      for (const s of slots) {
        const kind = slotKind(s.id)
        if (!kind) continue
        // Le plat par défaut du créneau doit appartenir au type proposé, sinon la
        // liste de remplacement n'inclurait pas le plat qu'on est en train de manger.
        const def = s.recipe ?? (s.from === 'lunch' ? CYCLE[0].lunch : CYCLE[0].dinner)
        expect(RECIPE_BY_ID[def].kind, `${s.id} → ${def}`).toBe(kind)
      }
    }
  })

  it('trie par nom : on cherche un plat, pas un identifiant', () => {
    const noms = choicesForSlot('diner', LIB).map(c => c.name)
    expect(noms).toEqual([...noms].sort((a, b) => a.localeCompare(b)))
  })
})
