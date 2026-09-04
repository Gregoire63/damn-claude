import { describe, expect, it } from 'vitest'
import {
  APPETIT_MAX, APPETIT_MIN, borner, facteurConvives, idConvive,
  libelleConvives, MOI, normaliserConvives, pourConvives,
} from '../../lib/foyer'

/*
 * Deux personnes ne mangent presque jamais pareil, et c'est tout le sujet : un ×2
 * fait trop pour l'un ou pas assez pour l'autre, et on finit par corriger de tête,
 * ingrédient par ingrédient, à chaque plat.
 */
const camille = { id: 'camille', nom: 'Camille', appetit: 0.6, actif: true }

describe('le facteur', () => {
  it('vaut 1 quand on cuisine pour soi', () => {
    expect(facteurConvives([MOI])).toBe(1)
  })

  /* LE cas : pas ×2, ×1,6. */
  it('additionne les appétits de ceux qui mangent', () => {
    expect(facteurConvives([MOI, camille])).toBe(1.6)
  })

  it('ignore ceux qui ne mangent pas ce soir', () => {
    expect(facteurConvives([MOI, { ...camille, actif: false }])).toBe(1)
  })

  it('ne rend jamais zéro, même sur un stockage bricolé', () => {
    expect(facteurConvives([{ ...MOI, actif: false }])).toBe(1)
    expect(facteurConvives([])).toBe(1)
  })

  it('borne un appétit aberrant plutôt que de le suivre', () => {
    expect(borner(0)).toBe(APPETIT_MIN)
    expect(borner(99)).toBe(APPETIT_MAX)
    expect(facteurConvives([MOI, { ...camille, appetit: 900 }])).toBe(1 + APPETIT_MAX)
  })
})

describe('les grammages', () => {
  it('se multiplient et s\'arrondissent au gramme', () => {
    expect(pourConvives(150, 1.6)).toBe(240)
    expect(pourConvives(85, 1.6)).toBe(136)
    // On ne pèse pas au dixième de gramme : la balance de cuisine ne le montre pas.
    expect(pourConvives(33, 1.6)).toBe(53)
  })

  it('ne bouge pas quand on cuisine seul', () => {
    expect(pourConvives(150, 1)).toBe(150)
  })
})

describe('ce qui est relu du stockage', () => {
  /*
   * « Moi » est l'UNITÉ de tout le module nutrition : les cibles, les macros, ce qui
   * reste au frigo. Le rendre réglable ou supprimable ferait dériver tout le reste
   * sans que rien ne le dise.
   */
  it('réinjecte Moi, en tête, à 1, et au repas', () => {
    for (const brut of [null, [], 'nawak', [{ id: 'moi', nom: 'Moi', appetit: 0.2, actif: false }]]) {
      const l = normaliserConvives(brut)
      expect(l[0]).toEqual(MOI)
    }
  })

  it('garde les autres, bornés et nettoyés', () => {
    const l = normaliserConvives([{ id: 'c', nom: '  Camille  ', appetit: '0.6', actif: true }])
    expect(l).toHaveLength(2)
    expect(l[1]).toEqual({ id: 'c', nom: 'Camille', appetit: 0.6, actif: true })
  })

  it('jette ce qui n\'a ni identifiant ni nom, et les doublons', () => {
    const l = normaliserConvives([
      { id: '', nom: 'Sans id' }, { id: 'x', nom: '' },
      { id: 'c', nom: 'Camille' }, { id: 'c', nom: 'Doublon' },
    ])
    expect(l.map(c => c.id)).toEqual(['moi', 'c'])
  })
})

describe('le libellé', () => {
  it('dit « Moi seul » quand personne d\'autre ne mange', () => {
    expect(libelleConvives([MOI])).toBe('Moi seul')
  })
  it('énumère sinon', () => {
    expect(libelleConvives([MOI, camille])).toBe('Moi + Camille')
  })
})

describe('les identifiants', () => {
  it('se déduisent du nom, accents et espaces retirés', () => {
    expect(idConvive('Amélie Durand', [MOI])).toBe('amelie-durand')
  })
  it('ne se marchent pas dessus', () => {
    const un = { id: 'camille', nom: 'Camille', appetit: 1, actif: true }
    expect(idConvive('Camille', [MOI, un])).toBe('camille-2')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Les courses et la cuisine suivent le foyer.
// ─────────────────────────────────────────────────────────────────────────────
describe('quantités à acheter et à cuisiner', () => {
  const lib = {
    foods: {
      poulet: { id: 'poulet', name: 'Poulet', cat: 'viandes', kcal: 110, p: 23, g: 0, l: 2 },
      riz: { id: 'riz', name: 'Riz', cat: 'feculents', kcal: 350, p: 7, g: 78, l: 1 },
    },
    recipes: {
      boite: { id: 'boite', name: 'Boîte', kind: 'boite', batch: true, steps: '', items: [{ food: 'poulet', g: 150 }, { food: 'riz', g: 80 }] },
    },
  } as never

  const gramme = (l: { items: { id: string, qty: string }[] }[] | never, id: string) =>
    (l as { items: { id: string, qty: string }[] }[]).flatMap(r => r.items).find(i => i.id === id)?.qty

  it('cuisiner seul ne change rien à la liste', async () => {
    const { cookIngredients } = await import('../../lib/nutritionStats')
    const seul = cookIngredients([{ recipeId: 'boite', n: 4 }] as never, lib)
    expect(seul.find(i => i.foodId === 'poulet')?.qty).toBe('600 g')
  })

  /* 4 portions × 150 g × 1,6 = 960 g. Pas 1200 : ×2 aurait fait acheter 240 g de trop. */
  it('multiplie les grammages par le facteur du foyer', async () => {
    const { cookIngredients } = await import('../../lib/nutritionStats')
    const deux = cookIngredients([{ recipeId: 'boite', n: 4 }] as never, lib, facteurConvives([MOI, camille]))
    expect(deux.find(i => i.foodId === 'poulet')?.qty).toBe('960 g')
    expect(deux.find(i => i.foodId === 'riz')?.qty).toBe('512 g')
  })
})

describe('la liste de courses suit le foyer', () => {
  it('multiplie les grammages, sans toucher aux rayons', async () => {
    const { shoppingFrom } = await import('../../lib/nutritionStats')
    const foods = {
      poulet: { id: 'poulet', name: 'Poulet', cat: 'viandes', kcal: 110, p: 23, g: 0, l: 2 },
    } as never
    const seul = shoppingFrom({ poulet: 600 }, foods)
    const deux = shoppingFrom({ poulet: 600 * 1.6 }, foods)
    expect(seul[0]!.lines[0]!.qty).toBe('600 g')
    expect(deux[0]!.lines[0]!.qty).toBe('960 g')
    expect(deux[0]!.cat).toBe(seul[0]!.cat)
  })

  /* Le branchement est d'une ligne, et c'est exactement le genre de ligne qu'un
     refactor emporte sans que rien ne casse : la liste redeviendrait celle d'une
     personne, silencieusement. */
  it('le composable passe bien le facteur aux deux calculs', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../../composables/useNutrition.ts', import.meta.url), 'utf8')
    expect(src).toMatch(/shoppingFromWeek\([^)]*foyer\.facteur\.value/)
    expect(src).toMatch(/cookPlan\([^)]*facteur: foyer\.facteur\.value/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Qui mange CE repas, et ce que j'en mets dans mon assiette.
// ─────────────────────────────────────────────────────────────────────────────
describe('les convives d\'un repas', () => {
  const foyer = [MOI, camille]

  it('reprend le foyer quand rien n’est précisé', async () => {
    const { facteurRepas } = await import('../../lib/foyer')
    expect(facteurRepas(null, foyer)).toBe(1.6)
  })

  it('compte les membres cochés pour CE repas', async () => {
    const { facteurRepas } = await import('../../lib/foyer')
    expect(facteurRepas({ membres: ['moi'], invites: [] }, foyer)).toBe(1)
    expect(facteurRepas({ membres: ['moi', 'camille'], invites: [] }, foyer)).toBe(1.6)
  })

  /* Un invité ne rentre pas dans le foyer pour un dîner : on l'ajoute, il repart. */
  it('ajoute les invités ponctuels', async () => {
    const { facteurRepas } = await import('../../lib/foyer')
    const repas = { membres: ['moi', 'camille'], invites: [{ nom: 'Léa', appetit: 0.8 }, { nom: 'Invité', appetit: 1 }] }
    expect(facteurRepas(repas, foyer)).toBe(3.4)
  })

  it('remet Moi à table même si le stockage l’a perdu', async () => {
    const { normaliserRepas } = await import('../../lib/foyer')
    expect(normaliserRepas({ membres: ['camille'], invites: [] })?.membres).toEqual(['moi', 'camille'])
    expect(normaliserRepas({ membres: [], invites: [] })).toBe(null)
    expect(normaliserRepas('nawak')).toBe(null)
  })
})

describe('ce que je mets dans MON assiette', () => {
  const foyer = [MOI, camille]

  /*
   * LA question à laquelle la fiche ne répondait pas. Elle affichait les quantités
   * pour tout le monde et annonçait des macros « pour ta part », sans jamais dire
   * quelle fraction de la casserole c'était : on servait à vue, donc on mangeait
   * autre chose que ce que l'application comptait.
   */
  it('vaut tout le plat quand je mange seul', async () => {
    const { partDeMoi } = await import('../../lib/foyer')
    expect(partDeMoi({ membres: ['moi'], invites: [] }, foyer)).toBe(1)
  })

  it('vaut 1 / facteur sinon', async () => {
    const { partDeMoi } = await import('../../lib/foyer')
    // 1 / 1,6 = 0,625 : je mange 62,5 % du plat, pas la moitié.
    expect(partDeMoi({ membres: ['moi', 'camille'], invites: [] }, foyer)).toBeCloseTo(0.625, 3)
  })

  it('ne dépasse jamais le plat entier', async () => {
    const { partDeMoi } = await import('../../lib/foyer')
    expect(partDeMoi({ membres: [], invites: [] }, foyer)).toBeLessThanOrEqual(1)
  })
})

describe('le libellé d\'un repas', () => {
  it('énumère, invités compris', async () => {
    const { libelleRepas } = await import('../../lib/foyer')
    const foyer = [MOI, camille]
    expect(libelleRepas({ membres: ['moi'], invites: [] }, foyer)).toBe('Moi seul')
    expect(libelleRepas({ membres: ['moi', 'camille'], invites: [{ nom: 'Léa', appetit: 1 }] }, foyer))
      .toBe('Moi + Camille + 1 invité')
  })
})
