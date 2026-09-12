import { describe, expect, it } from 'vitest'
import type { Recipe } from '../../data/nutritionProgram'
import type { DayOverride, MenuWeek } from '../../lib/nutritionStats'
import { PHRASE_HISTORIQUE, phraseNettoyage, phraseSauceServie, phraseUsages, usagesAliment, usagesPlat } from '../../lib/suppression'

// ─────────────────────────────────────────────────────────────────────────────
// Ce qu'une suppression emporte avec elle.
// ─────────────────────────────────────────────────────────────────────────────
//
// Le même identifiant de plat est posé à quatre endroits qui ne se voient pas : les
// semaines types, les exceptions de planning, les jours où on a pris autre chose, et
// les plats qui le servent comme sauce. Rien ne les relie, rien ne les vérifie.
//
// Supprimer sans les regarder ne produisait PAS d'erreur — c'est tout le problème.
// `buildDay` saute un plat introuvable, donc le créneau disparaissait, simplement, et
// le total du jour baissait d'autant. On cherche l'explication dans les calories.
//
// Et la réparation évidente — « nettoyer », vider les créneaux — était PIRE : une
// semaine type est la seule mémoire de ce qui a été mangé, puisque aucun total de
// journée n'est stocké. La vider retirait le repas de tous les jeudis déjà vécus.
// Mesuré à l'écran : 2 022 kcal → 1 464 sur un jeudi passé.
//
// Ce module ne supprime rien : il répond à « qu'est-ce qui pointe vers ça ? ».

const plat = (id: string, name: string, extra: Partial<Recipe> = {}): Recipe => ({
  id, name, kind: 'diner', batch: false, steps: '', items: [], ...extra,
})

const semaine = (id: string, name: string, slots: Record<number, Record<string, string>>): MenuWeek => ({
  id,
  name,
  days: Array.from({ length: 7 }, (_, i) => ({ off: false, slots: slots[i] ?? {} })),
})

const CATALOGUE: Record<string, Recipe> = {
  saumon: plat('saumon', 'Saumon riz', { items: [{ food: 'saumon', g: 150 }, { food: 'riz', g: 80 }] }),
  poulet: plat('poulet', 'Poulet brocolis', { sauce: 'blanche', items: [{ food: 'poulet', g: 180 }] }),
  dinde: plat('dinde', 'Dinde patates', { sauce: 'blanche', items: [{ food: 'dinde', g: 180 }] }),
  blanche: plat('blanche', 'Sauce blanche', { kind: 'sauce', items: [{ food: 'skyr', g: 60 }] }),
  vieux: plat('vieux', 'Plat déjà supprimé', { deleted: true, sauce: 'blanche', items: [{ food: 'riz', g: 80 }] }),
}

const AUJ = '2026-09-12'
const HIER = '2026-09-11'
const DEMAIN = '2026-09-13'

/** Une source d'usages complète, dont on ne précise que ce qui compte pour le test. */
const SRC = (p: Partial<Parameters<typeof usagesPlat>[1]>) => ({
  menus: [], recipes: CATALOGUE, overrides: {}, picked: {}, aujourdhui: AUJ, ...p,
})

describe('ce qui pointe vers un plat', () => {
  it('ne trouve rien pour un plat que personne n’a programmé', () => {
    const u = usagesPlat('saumon', SRC({}))
    expect(u.aucun).toBe(true)
    expect(phraseUsages(u)).toBe('Rien ne l’utilise.')
    // Rien à nettoyer, donc rien à annoncer : une phrase vide vaut mieux qu'une
    // promesse creuse.
    expect(phraseNettoyage(u)).toBe('')
  })

  it('compte les JOURS d’une semaine type, pas la semaine', () => {
    // Le même plat deux fois dans la semaine, c'est deux créneaux à vider. Compter
    // les semaines dirait « 1 » et laisserait croire à un seul trou à reboucher.
    const s = semaine('w1', 'Semaine A', { 0: { lunch: 'saumon' }, 3: { dinner: 'saumon' } })
    const u = usagesPlat('saumon', SRC({ menus: [s] }))
    expect(u.menus).toEqual([{ id: 'w1', nom: 'Semaine A', jours: 2 }])
  })

  it('ignore les semaines qui ne le programment pas', () => {
    const a = semaine('w1', 'Semaine A', { 0: { lunch: 'saumon' } })
    const b = semaine('w2', 'Semaine B', { 0: { lunch: 'poulet' } })
    const u = usagesPlat('saumon', SRC({ menus: [a, b] }))
    expect(u.menus.map(m => m.id)).toEqual(['w1'])
  })

  /**
   * La sauce est le cas le plus silencieux de tous.
   *
   * Ses ingrédients entrent dans les macros du plat sans apparaître dans sa liste.
   * Supprimer la sauce sans rien dire n'efface donc aucune ligne à l'écran : le plat
   * pèse simplement cent kilocalories de moins, pour toujours.
   */
  it('nomme les plats qui le servent en sauce', () => {
    const u = usagesPlat('blanche', SRC({}))
    expect(u.sauceDe.map(s => s.nom)).toEqual(['Dinde patates', 'Poulet brocolis'])
    // Ce n'est PAS une information à afficher à côté des autres : c'est un refus.
    expect(phraseSauceServie(u.sauceDe)).toContain('Ces plats le servent')
    expect(phraseSauceServie([u.sauceDe[0]!])).toContain('Ce plat le sert')
  })

  it('ne compte pas un plat déjà supprimé parmi ceux qui utilisent la sauce', () => {
    // `vieux` porte `sauce: 'blanche'` mais ne se choisit plus : le signaler ferait
    // hésiter sur un lien qui n'existe plus pour personne.
    const u = usagesPlat('blanche', SRC({}))
    expect(u.sauceDe.map(s => s.id)).not.toContain('vieux')
  })

  /**
   * Seul le FUTUR compte. Une exception posée hier dit ce qui a été mangé hier : on
   * n'y touchera pas, donc l'annoncer ferait craindre une perte qui n'aura pas lieu.
   */
  it('ne relève que les exceptions et les choix À VENIR', () => {
    const overrides: Record<string, DayOverride> = {
      [HIER]: { dinner: 'saumon' },
      [AUJ]: { gym: false },
      [DEMAIN]: { lunch: 'saumon' },
    }
    const picked = { [HIER]: { dinner: 'saumon' }, [DEMAIN]: { lunch: 'saumon' } }
    const u = usagesPlat('saumon', SRC({ overrides, picked }))
    expect(u.exceptions).toEqual([DEMAIN])
    expect(u.choisi).toEqual([DEMAIN])
    expect(u.aucun).toBe(false)
  })

  /** Rien QUE du passé : il n'y a rien à annoncer, donc rien à craindre. */
  it('ne compte pas un passé qu’on ne touchera pas', () => {
    const u = usagesPlat('saumon', SRC({
      overrides: { [HIER]: { dinner: 'saumon' } },
      picked: { '2026-03-04': { dinner: 'saumon' } },
    }))
    expect(u.aucun).toBe(true)
  })

  /** Un plat qui se sert lui-même en sauce ne doit pas se compter comme son propre usage. */
  it('ne se compte pas lui-même', () => {
    const recipes = { auto: plat('auto', 'Plat qui se sauce lui-même', { sauce: 'auto' }) }
    expect(usagesPlat('auto', SRC({ recipes })).sauceDe).toEqual([])
  })
})

describe('la phrase de confirmation', () => {
  it('nomme les semaines plutôt que de les compter en silence', () => {
    const a = semaine('w1', 'Semaine A', { 0: { lunch: 'saumon' } })
    const b = semaine('w2', 'Perte de poids', { 2: { dinner: 'saumon' } })
    const u = usagesPlat('saumon', SRC({ menus: [a, b] }))
    const p = phraseUsages(u)
    expect(p).toContain('2 semaines types')
    expect(p).toContain('Semaine A, Perte de poids')
  })

  it('accorde le singulier', () => {
    const a = semaine('w1', 'Semaine A', { 0: { lunch: 'saumon' } })
    const p = phraseUsages(usagesPlat('saumon', SRC({ menus: [a] })))
    expect(p).toContain('1 semaine type')
    expect(p).not.toContain('semaines types')
  })

  /** L'état et l'acte sont deux informations différentes : les fondre donne une
   *  phrase qu'on relit deux fois. */
  it('annonce ce qui va se voir, et ce qu’il restera à faire', () => {
    // Deux jours programmés → deux repas qui sauteront. On ne promet PAS de vider
    // les créneaux : les vider réécrirait les jeudis déjà vécus.
    const a = semaine('w1', 'Semaine A', { 0: { lunch: 'saumon' }, 3: { dinner: 'saumon' } })
    const n = phraseNettoyage(usagesPlat('saumon', SRC({ menus: [a] })))
    expect(n.startsWith('2 repas à venir sauteront')).toBe(true)
    expect(n).toContain('remets un plat dans ces créneaux')
    expect(n).not.toContain('videront')
    expect(n.endsWith('.')).toBe(true)
  })

  it('accorde le singulier du nettoyage aussi', () => {
    const a = semaine('w1', 'Semaine A', { 0: { lunch: 'saumon' } })
    expect(phraseNettoyage(usagesPlat('saumon', SRC({ menus: [a] })))).toContain('1 repas à venir sautera')
  })

  /** Sans cette ligne, on n'ose pas faire le ménage de peur de fausser le suivi. */
  it('dit ce qui ne bouge pas', () => {
    expect(PHRASE_HISTORIQUE).toContain('journées déjà passées')
  })
})

describe('ce qui pointe vers un aliment', () => {
  it('nomme les plats qui l’utilisent, par ordre alphabétique', () => {
    const recipes = {
      ...CATALOGUE,
      salade: plat('salade', 'Anchois et riz', { items: [{ food: 'riz', g: 60 }] }),
    }
    expect(usagesAliment('riz', recipes).map(r => r.nom)).toEqual(['Anchois et riz', 'Saumon riz'])
  })

  it('ne compte pas les plats supprimés', () => {
    // `vieux` contient du riz, mais il ne se choisit plus : il ne doit pas bloquer.
    const recipes = { vieux: CATALOGUE.vieux! }
    expect(usagesAliment('riz', recipes)).toEqual([])
  })

  it('rend une liste vide pour un aliment que rien n’utilise', () => {
    expect(usagesAliment('quinoa', CATALOGUE)).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Le marquage, et les deux lectures qu'il sépare.
// ─────────────────────────────────────────────────────────────────────────────

describe('la pierre tombale', () => {
  it('marque sans retirer, pour les plats comme pour les aliments', async () => {
    const { mergeFoods, mergeRecipes } = await import('../../lib/nutritionStats')
    const r = mergeRecipes([plat('a', 'A'), plat('b', 'B')], {}, [], ['a'])
    // Toujours là — sans quoi une journée passée ne pourrait plus le nommer.
    expect(r.a!.name).toBe('A')
    expect(r.a!.deleted).toBe(true)
    expect(r.b!.deleted).toBe(false)

    const f = mergeFoods(
      [{ id: 'riz', name: 'Riz', cat: 'feculents', kcal: 350, p: 7, g: 78, l: 1 }],
      {},
      ['riz'],
    )
    expect(f.riz!.name).toBe('Riz')
    expect(f.riz!.deleted).toBe(true)
  })

  it('le retire de ce qui se choisit', async () => {
    const { activeRecipes } = await import('../../lib/nutritionStats')
    const recipes = mergeRecipesLocal(['a', 'b'], ['a'])
    const lib = { foods: {}, recipes }
    expect(activeRecipes(lib, 'diner').map(r => r.id)).toEqual(['b'])
  })

  /**
   * La semaine type n'a pas de date : elle dit ce qu'on VA cuisiner. C'est le seul
   * endroit où laisser passer un plat supprimé coûterait de l'argent — on en
   * achèterait les ingrédients.
   */
  it('sort des sept journées d’une semaine type, donc des courses', async () => {
    const { weekDayPlans } = await import('../../lib/nutritionStats')
    const recipes = mergeRecipesLocal(['a', 'b'], ['a'])
    const lib = { foods: {}, recipes }
    const s = semaine('w', 'S', { 0: { lunch: 'a', dinner: 'b' } })
    const jours = weekDayPlans(s, Array(7).fill(false), lib)
    expect(jours[0]!.meals.map(m => m.recipeId)).toEqual(['b'])
  })
})

/** Deux plats de dîner, dont certains marqués supprimés. */
function mergeRecipesLocal(ids: string[], gone: string[]): Record<string, Recipe> {
  return Object.fromEntries(ids.map(id => [id, { ...plat(id, id.toUpperCase()), deleted: gone.includes(id) }]))
}
