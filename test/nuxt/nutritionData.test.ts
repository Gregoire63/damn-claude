import { rebalanceDairy } from '../../lib/nutritionStats'
import { poserSemaineExemple } from '../exemple'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Ces tests tournent sur le PACK D'EXEMPLE : l'application ne livre plus de données.
// Voir test/exemple.ts pour le pourquoi.
vi.mock('../../data/nutritionProgram', () => (import('../exemple')).then(m => m.catalogueExemple()))
vi.mock('../../data/sportProgram', () => (import('../exemple')).then(m => m.programmeExemple()))

// Ces tests couvrent le CÂBLAGE du module nutrition (localStorage, aller-retour
// d'écriture, export/import), pas les calculs — ceux-là sont dans
// test/unit/nutritionStats.test.ts.
// Le composable garde son état au niveau du module : on réimporte à neuf à chaque
// test pour repartir d'une hydratation propre.
beforeEach(() => {
  localStorage.clear()
  // Ni le planning ni la semaine type n'ont plus de défaut : sans eux, tous les
  // jours sont des jours de repos et rien ne se déplace.
  poserSemaineExemple()
  vi.resetModules()
})

const load = async () => {
  const { useNutrition } = await import('../../composables/useNutrition')
  const n = useNutrition()
  n.hydrate()
  return n
}

describe('semaines types de menus', () => {
  it('livre deux semaines et en active une sans rien démarrer', async () => {
    const n = await load()
    expect(n.menus.value.filter(m => m.builtin)).toHaveLength(2)
    expect(n.activeWeek.value).not.toBeNull()
    expect(n.selectionSummary.value.portions).toBe(14)
  })
})

describe('semaine type', () => {
  it('place les séances lundi, mardi, jeudi, vendredi et le télétravail mardi et vendredi', async () => {
    const n = await load()
    const week = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09']
    expect(week.map(d => n.dayFor(d).gym)).toEqual([true, true, false, true, true, false, false])
    expect(week.map(d => n.dayFor(d).tt)).toEqual([false, true, false, false, true, false, false])
  })

  it('modifie la semaine type et la relit après rechargement', async () => {
    const n = await load()
    n.setWeekDay(2, 'tt', true) // mercredi en télétravail
    expect(n.dayFor('2026-08-05').tt).toBe(true)

    vi.resetModules()
    const again = await load()
    expect(again.dayFor('2026-08-05').tt).toBe(true)
    again.resetWeek()
    expect(again.dayFor('2026-08-05').tt).toBe(false)
  })
})

describe('exceptions du jour', () => {
  it('surcharge la semaine type pour une date, sans la modifier', async () => {
    const n = await load()
    expect(n.dayFor('2026-08-03').gym).toBe(true)

    n.setOverride('2026-08-03', { gym: false })
    expect(n.dayFor('2026-08-03').gym).toBe(false)
    // La semaine type n'a pas bougé : c'est bien la journée qui s'adapte.
    expect(n.week.value.gym[0]).toBe(true)
    expect(n.hasOverride('2026-08-03')).toBe(true)

    n.clearOverride('2026-08-03')
    expect(n.dayFor('2026-08-03').gym).toBe(true)
  })

  it('mémorise les pas du jour et sait les effacer', async () => {
    const n = await load()
    n.setSteps('2026-08-06', 9400)
    expect(n.stepsFor('2026-08-06')).toBe(9400)
    n.setSteps('2026-08-06', null)
    expect(n.stepsFor('2026-08-06')).toBeNull()
    // Plus rien à surcharger : l'exception disparaît au lieu de rester vide.
    expect(n.hasOverride('2026-08-06')).toBe(false)
  })

  it('permet d\'imposer un plat sur une date', async () => {
    const n = await load()
    n.setOverride('2026-08-06', { dinner: 'din-saumon' })
    expect(n.dayFor('2026-08-06').menu.dinner).toBe('din-saumon')
  })
})

describe('bibliothèque', () => {
  it('crée un aliment et le rend disponible dans les plats', async () => {
    const n = await load()
    const id = n.addFood({ name: 'Skyr nature', cat: 'laitiers', kcal: 64, p: 11, g: 4, l: 0.2 })
    expect(id).toBe('skyr-nature')
    expect(n.library.value.foods[id].name).toBe('Skyr nature')
    expect(n.isCustomFood(id)).toBe(true)
  })

  it('modifie un aliment livré et sait revenir à l\'original', async () => {
    const n = await load()
    const before = n.library.value.foods['filet-de-poulet'].kcal
    n.patchFood('filet-de-poulet', { kcal: 125 })
    expect(n.library.value.foods['filet-de-poulet'].kcal).toBe(125)
    n.resetFood('filet-de-poulet')
    expect(n.library.value.foods['filet-de-poulet'].kcal).toBe(before)
  })

  it('crée un plat, le retrouve après rechargement, et le supprime', async () => {
    const n = await load()
    const id = n.addRecipe({ name: 'Poke bowl', kind: 'boite', batch: true, steps: '', items: [{ food: 'saumon', g: 150 }] })
    expect(n.library.value.recipes[id].name).toBe('Poke bowl')

    vi.resetModules()
    const again = await load()
    expect(again.library.value.recipes[id]).toBeDefined()
    again.removeRecipe(id)
    expect(again.library.value.recipes[id]).toBeUndefined()
  })

  it('met un plat de côté sans le supprimer', async () => {
    const n = await load()
    n.toggleRecipeActive('din-saumon')
    expect(n.isRecipeActive('din-saumon')).toBe(false)
    expect(n.library.value.recipes['din-saumon']).toBeDefined()
    expect(n.library.value.recipes['din-saumon'].disabled).toBe(true)
  })
})

describe('séance annulée', () => {
  // Régression : sans réduction, une séance annulée laisserait la journée à ~2 200 kcal
  // pour une dépense de jour de repos — le déficit de la semaine y passe.
  it('fait réellement baisser les calories de la journée', async () => {
    const n = await load()
    const { buildDay } = await import('../../lib/nutritionStats')
    const before = n.dayPlanFor('2026-08-03', n.dayFor('2026-08-03').gym)!.total.kcal
    n.setOverride('2026-08-03', { gym: false })
    const after = n.dayPlanFor('2026-08-03', n.dayFor('2026-08-03').gym)!.total.kcal
    // Le seuil a baissé avec les grammages : les sauces et les épices ont pris une
    // part de l'énergie des féculents, et c'est sur eux que porte la modulation.
    // L'écart reste franc — il ne s'agit pas de vérifier un chiffre mais qu'annuler
    // une séance se voit vraiment dans l'assiette.
    expect(before - after).toBeGreaterThan(120)
  })
})

describe('repas hors plan', () => {
  it('ajoute un extra avec son heure et sait le retirer', async () => {
    const n = await load()
    const id = n.addExtra('2026-08-06', { label: 'Restaurant', kcal: 850, p: 40, g: 70, l: 35, time: '20:30' })
    expect(n.extrasFor('2026-08-06')).toHaveLength(1)
    expect(n.extrasFor('2026-08-06')[0].time).toBe('20:30')

    vi.resetModules()
    const again = await load()
    expect(again.extrasFor('2026-08-06')).toHaveLength(1)
    again.removeExtra('2026-08-06', id)
    expect(again.extrasFor('2026-08-06')).toHaveLength(0)
  })
})

describe('repas cochés', () => {
  it('mémorise les repas pris jour par jour', async () => {
    const n = await load()
    n.toggleEaten('2026-08-06', 'pdj')
    n.toggleEaten('2026-08-06', 'lunch')
    n.toggleEaten('2026-08-07', 'pdj')
    expect(n.eatenCount('2026-08-06')).toBe(2)
    expect(n.eatenCount('2026-08-07')).toBe(1)
    expect(n.isEaten('2026-08-06', 'dinner')).toBe(false)

    n.toggleEaten('2026-08-06', 'pdj')
    expect(n.eatenCount('2026-08-06')).toBe(1)
  })
})

describe('prix et panier', () => {
  it('enregistre un prix au kilo et l\'arrondit au centime', async () => {
    const n = await load()
    n.setPrice('filet-de-poulet', 9.876)
    expect(n.prices.value['filet-de-poulet']).toBe(9.88)
  })

  it('efface le prix quand la saisie est vidée ou invalide', async () => {
    const n = await load()
    n.setPrice('filet-de-poulet', 10)
    n.setPrice('filet-de-poulet', null)
    expect(n.prices.value['filet-de-poulet']).toBeUndefined()
    n.setPrice('saumon', -3)
    expect(n.prices.value.saumon).toBeUndefined()
  })

  it('archive un panier et le relit', async () => {
    const n = await load()
    n.addBasket(87.4, 7, '2026-08-03')
    expect(n.baskets.value[0]).toEqual({ date: '2026-08-03', total: 87.4, days: 7 })

    vi.resetModules()
    const again = await load()
    expect(again.baskets.value).toHaveLength(1)
    again.removeBasket(0)
    expect(again.baskets.value).toHaveLength(0)
  })

  it('refuse un panier à zéro', async () => {
    const n = await load()
    n.addBasket(0, 7, '2026-08-03')
    expect(n.baskets.value).toHaveLength(0)
  })
})

describe('mode de préparation', () => {
  it('part sur les féculents à part, le mode le plus souple', async () => {
    const n = await load()
    expect(n.prepMode.value).toBe('separate')
  })

  it('mémorise le passage en boîtes assemblées', async () => {
    const n = await load()
    n.setPrepMode('assembled')
    expect(localStorage.getItem('gr-nutri-prep-v1')).toBe('assembled')

    vi.resetModules()
    const again = await load()
    expect(again.prepMode.value).toBe('assembled')
  })

  it('ignore une valeur stockée invalide', async () => {
    localStorage.setItem('gr-nutri-prep-v1', 'nimportequoi')
    const n = await load()
    expect(n.prepMode.value).toBe('separate')
  })
})

describe('sauvegarde', () => {
  it('exporte et restaure l\'intégralité de l\'état', async () => {
    const n = await load()
    n.setPrice('saumon', 18.5)
    n.toggleChecked('saumon')
    n.setOverride('2026-08-04', { gym: false, steps: 9000 })
    n.toggleEaten('2026-08-04', 'pdj')
    n.addExtra('2026-08-04', { label: 'Resto', kcal: 700, p: 0, g: 0, l: 0 })
    n.addFood({ name: 'Mon skyr', cat: 'laitiers', kcal: 64, p: 11, g: 4, l: 0.2 })
    n.addBasket(50, 7, '2026-08-03')
    n.setPrepMode('assembled')
    const snapshot = JSON.parse(JSON.stringify(n.exportData()))

    localStorage.clear()
    vi.resetModules()
    const fresh = await load()
    fresh.restore({ nutrition: snapshot })

    expect(fresh.prices.value.saumon).toBe(18.5)
    expect(fresh.isChecked('saumon')).toBe(true)
    expect(fresh.dayFor('2026-08-04').gym).toBe(false)
    expect(fresh.stepsFor('2026-08-04')).toBe(9000)
    expect(fresh.extrasFor('2026-08-04')).toHaveLength(1)
    expect(fresh.library.value.foods['mon-skyr']).toBeDefined()
    expect(fresh.isEaten('2026-08-04', 'pdj')).toBe(true)
    expect(fresh.baskets.value).toHaveLength(1)
    expect(fresh.prepMode.value).toBe('assembled')
  })

  it('accepte une sauvegarde ancienne sans bloc nutrition', async () => {
    const n = await load()
    expect(() => n.restore({})).not.toThrow()
  })

  // Les sauvegardes de la version précédente stockaient les séances annulées à part.
  it('convertit une ancienne liste de jours annulés en exceptions', async () => {
    const n = await load()
    n.restore({ nutrition: { skipped: ['2026-08-03'] } })
    expect(n.dayFor('2026-08-03').gym).toBe(false)
  })
})

describe('la semaine type pilote tout', () => {
  it('compte les portions dans la semaine et en tire les courses', async () => {
    const n = await load()
    // 7 midis + 7 dîners : rien à saisir à la main, tout se compte dans le menu.
    expect(n.selectionSummary.value.portions).toBe(14)
    expect(n.selectionShopping.value.length).toBeGreaterThan(0)
    expect(n.daysCovered.value).toBe(7)
  })

  it('un jour d\'absence retire ses repas des courses et de la cuisine', async () => {
    const n = await load()
    const avant = n.selectionSummary.value.portions
    n.toggleMenuDayOff(6)
    expect(n.selectionSummary.value.portions).toBe(avant - 2)
    // La journée existe toujours — elle a une date, une dépense, une pesée
    // éventuelle — mais elle ne propose aucun repas. Renvoyer `null` obligeait
    // chaque écran à se protéger d'un cas rare, et un oubli suffisait pour une
    // page blanche.
    const off = n.dayPlanFor('2026-08-09', false) // un dimanche
    expect(off.off).toBe(true)
    expect(off.meals).toEqual([])
  })

  it('modifier une semaine livrée en fait une copie, l\'originale reste intacte', async () => {
    const n = await load()
    n.setMenuSlot(0, 'lunch', 'boite-c')
    expect(n.activeWeek.value!.builtin).toBeFalsy()
    expect(n.menus.value.filter(m => m.builtin)[0].days[0].slots.lunch).not.toBe('boite-c')
    expect(n.activeWeek.value!.days[0].slots.lunch).toBe('boite-c')
  })

  it('la semaine choisie sert tous les lundis suivants, indéfiniment', async () => {
    const n = await load()
    n.setMenuSlot(0, 'lunch', 'boite-c')
    // Deux mois plus tard, un lundi : le modèle se répète, plus de fenêtre de 14 jours.
    const plan = n.dayPlanFor('2026-10-12', true)!
    expect(plan.meals.find((m: { slot: string }) => m.slot === 'lunch')?.recipeId).toBe('boite-c')
  })

  it('changer de semaine ne réécrit pas le passé', async () => {
    const n = await load()
    n.applyMenuFrom('2026-08-03', n.menus.value[0].id)
    const avant = n.dayPlanFor('2026-08-04', true)!.meals.find((m: { slot: string }) => m.slot === 'lunch')?.recipeId
    n.applyMenuFrom('2026-08-31', n.menus.value[1].id)
    expect(n.dayPlanFor('2026-08-04', true)!.meals.find((m: { slot: string }) => m.slot === 'lunch')?.recipeId).toBe(avant)
  })

  it('les semaines perso survivent au rechargement, les livrées ne sont pas dupliquées', async () => {
    const n = await load()
    n.duplicateMenu('Semaine légère')
    vi.resetModules()
    const again = await load()
    expect(again.menus.value.filter(m => m.builtin)).toHaveLength(2)
    expect(again.menus.value.some(m => m.name === 'Semaine légère')).toBe(true)
  })

  it('« j\'ai pris autre chose » décrémente le stock du plat réellement mangé', async () => {
    const n = await load()
    const cible = Object.keys(n.stock.value)[0]
    const avant = n.stock.value[cible]
    n.setPicked('2026-08-10', 'lunch', cible)
    expect(n.stock.value[cible]).toBe(avant - 1)
    n.setPicked('2026-08-10', 'lunch', null)
    expect(n.stock.value[cible]).toBe(avant)
  })

  it('un plat explicitement pris l\'emporte sur celui proposé', async () => {
    const n = await load()
    n.setPicked('2026-08-12', 'dinner', 'din-saumon')
    const plan = n.dayPlanFor('2026-08-12', true)!
    expect(plan.meals.find((m: { slot: string }) => m.slot === 'dinner')?.recipeId).toBe('din-saumon')
  })

  it('les sessions de cuisine sortent de la semaine active', async () => {
    const n = await load()
    const ids = n.cookSessions.value.map(s => s.id)
    expect(ids[0]).toBe('dim')
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('confirmation de l\'ajustement du soir', () => {
  const SIG = 'p:riz-basmati:250'

  it('ne considère rien comme appliqué tant qu\'on n\'a pas confirmé', async () => {
    const n = await load()
    expect(n.isAdjustApplied('2026-08-10', SIG)).toBe(false)
  })

  it('retient la confirmation, et seulement pour cette forme-là', async () => {
    // Le cœur du mécanisme : on confirme « 250 g de riz », puis un extra change le
    // conseil. Un booléen resterait vrai et l'app afficherait des chiffres que
    // personne n'a validés. La signature, elle, ne correspond plus.
    const n = await load()
    n.setAdjustApplied('2026-08-10', SIG)
    expect(n.isAdjustApplied('2026-08-10', SIG)).toBe(true)
    expect(n.isAdjustApplied('2026-08-10', 'p:riz-basmati:180')).toBe(false)
  })

  it('ne confond pas deux jours', async () => {
    const n = await load()
    n.setAdjustApplied('2026-08-10', SIG)
    expect(n.isAdjustApplied('2026-08-11', SIG)).toBe(false)
  })

  it('« finalement non » rend la main', async () => {
    const n = await load()
    n.setAdjustApplied('2026-08-10', SIG)
    n.clearAdjustApplied('2026-08-10')
    expect(n.isAdjustApplied('2026-08-10', SIG)).toBe(false)
  })

  it('une signature vide ne vaut jamais confirmation', async () => {
    // Pas d'ajustement à proposer = rien à confirmer. Sans ce garde-fou, un jour sans
    // écart passerait pour « ajusté » et le bouton s'afficherait dans le vide.
    const n = await load()
    n.setAdjustApplied('2026-08-10', '')
    expect(n.isAdjustApplied('2026-08-10', '')).toBe(false)
  })

  it('survit à un rechargement', async () => {
    const n = await load()
    n.setAdjustApplied('2026-08-10', SIG)
    vi.resetModules()
    const again = await load()
    expect(again.isAdjustApplied('2026-08-10', SIG)).toBe(true)
  })
})

describe('sauvegarde complète', () => {
  it('emporte les confirmations d\'ajustement', async () => {
    // Régression déjà vue : une nouvelle clé de stockage ajoutée sans être branchée
    // sur l'export, et la restauration sur un autre appareil la perd en silence.
    const n = await load()
    n.setAdjustApplied('2026-08-10', 'p:riz-basmati:250')
    const snap = n.exportData()
    expect(snap.adjustOk['2026-08-10']).toBe('p:riz-basmati:250')

    localStorage.clear()
    vi.resetModules()
    const fresh = await load()
    expect(fresh.isAdjustApplied('2026-08-10', 'p:riz-basmati:250')).toBe(false)
    fresh.restore({ nutrition: snap })
    expect(fresh.isAdjustApplied('2026-08-10', 'p:riz-basmati:250')).toBe(true)
  })

  it('un fichier de sauvegarde ancien passe sans erreur', async () => {
    // Tout est optionnel côté restauration : une sauvegarde faite avant que
    // l'ajustement existe ne doit pas faire échouer l'import. Une sauvegarde qui
    // porte encore le sac de sport, retiré depuis, ne doit pas échouer non plus —
    // les clés inconnues sont simplement ignorées.
    const n = await load()
    expect(() => n.restore({ nutrition: { prices: {} } })).not.toThrow()
    expect(() => n.restore({ nutrition: { bag: { '2026-08-10': ['La banane'] } } })).not.toThrow()
    expect(() => n.restore({})).not.toThrow()
  })
})

describe('plats modifiés localement', () => {
  it('ne signale rien tant qu\'on n\'a touché à aucun plat', async () => {
    const n = await load()
    expect(n.isRecipePatched('boite-a')).toBe(false)
    expect(n.patchedRecipes.value).toEqual([])
  })

  it('signale un plat dont les grammages ont été modifiés', async () => {
    // C'est ce qui fait qu'une mise à jour du programme peut passer inaperçue : le
    // patch local écrase les grammages livrés, sans rien afficher.
    const n = await load()
    n.patchRecipe('boite-a', { items: [{ food: 'filet-de-poulet', g: 250 }] })
    expect(n.isRecipePatched('boite-a')).toBe(true)
    expect(n.patchedRecipes.value).toContain('boite-a')
    expect(n.library.value.recipes['boite-a'].items[0].g).toBe(250)
  })

  it('« revenir à la version d\'origine » rend vraiment la main au programme', async () => {
    const n = await load()
    const livre = n.library.value.recipes['boite-a'].items.find(i => i.food === 'filet-de-poulet')!.g
    n.patchRecipe('boite-a', { items: [{ food: 'filet-de-poulet', g: 250 }] })
    n.resetRecipe('boite-a')
    expect(n.isRecipePatched('boite-a')).toBe(false)
    expect(n.library.value.recipes['boite-a'].items.find(i => i.food === 'filet-de-poulet')!.g).toBe(livre)
  })

  it('un plat créé de toutes pièces n\'est pas « modifié »', async () => {
    // Il n'a pas de version livrée derrière lui : le bouton n'aurait aucun sens.
    const n = await load()
    const id = n.addRecipe({ name: 'Mon plat', kind: 'diner', batch: false, steps: '', items: [] })
    expect(n.isRecipePatched(id)).toBe(false)
  })
})

describe('rattrapage d\'une journée passée', () => {
  it('coche un repas sur n\'importe quelle date, pas seulement aujourd\'hui', async () => {
    // Les repas ne se cochaient que le jour même, alors qu'une séance passée se
    // corrige depuis le journal. L'asymétrie n'avait pas de raison d'être : c'est en
    // relisant sa semaine qu'on se rend compte qu'on a oublié de cocher.
    const n = await load()
    n.toggleEaten('2026-08-05', 'lunch')
    expect(n.isEaten('2026-08-05', 'lunch')).toBe(true)
    expect(n.eatenSlots('2026-08-05')).toEqual(['lunch'])
  })

  it('ne mélange jamais deux journées', async () => {
    const n = await load()
    n.toggleEaten('2026-08-05', 'lunch')
    n.toggleEaten('2026-08-06', 'dinner')
    expect(n.eatenSlots('2026-08-05')).toEqual(['lunch'])
    expect(n.eatenSlots('2026-08-06')).toEqual(['dinner'])
    expect(n.isEaten('2026-08-06', 'lunch')).toBe(false)
  })

  it('le rattrapage survit à un rechargement', async () => {
    const n = await load()
    n.toggleEaten('2026-08-05', 'pdj')
    vi.resetModules()
    const again = await load()
    expect(again.isEaten('2026-08-05', 'pdj')).toBe(true)
  })

  it('décocher rend bien la journée à son état initial', async () => {
    const n = await load()
    n.toggleEaten('2026-08-05', 'snack')
    n.toggleEaten('2026-08-05', 'snack')
    expect(n.eatenSlots('2026-08-05')).toEqual([])
  })
})

// ─── Le taux de MG reste réglable après l'avoir réglé ────────────────────────
describe('taux de matière grasse, réglable depuis la fiche du plat', () => {
  it('garde le laitier dans la liste réglable une fois un taux déclaré', async () => {
    // LE bug de la fiche recette : `isAdjustableDairy` exige un produit maigre au
    // départ (≤ 1 g de lipides). Jugé sur la fiche APRÈS application du taux, un
    // fromage blanc déclaré à 5 % cessait d'être « réglable » — le bouton
    // disparaissait et on restait bloqué sur son propre choix, sans retour possible.
    const n = await load()
    expect(n.dairyFoods.value.some(d => d.base.id === 'fromage-blanc-0')).toBe(true)
    n.setFatPct('fromage-blanc-0', 5)
    const apres = n.dairyFoods.value.find(d => d.base.id === 'fromage-blanc-0')
    expect(apres, 'le laitier doit rester réglable').toBeDefined()
    expect(apres!.pct).toBe(5)
    expect(apres!.food.l).toBe(5) // macros dérivées
    expect(apres!.base.l).toBeLessThanOrEqual(1) // fiche d'origine intacte
    // …et on peut revenir en arrière
    n.setFatPct('fromage-blanc-0', 0)
    expect(n.dairyFoods.value.find(d => d.base.id === 'fromage-blanc-0')!.pct).toBe(0)
  })

  it('adapte la quantité du plat au taux déclaré', async () => {
    const n = await load()
    const base = n.library.value.recipes['pdj-croquant'].items.find(i => i.food === 'fromage-blanc-0')!.g
    n.setFatPct('fromage-blanc-0', 5)
    const items = rebalanceDairy(n.library.value.recipes['pdj-croquant'].items, n.library.value.foods)
    expect(items.find(i => i.food === 'fromage-blanc-0')!.g).toBeLessThan(base)
    n.setFatPct('fromage-blanc-0', 0)
  })
})
