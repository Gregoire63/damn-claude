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

// ─────────────────────────────────────────────────────────────────────────────
// Cuisiner pour plusieurs repas.
// ─────────────────────────────────────────────────────────────────────────────
//
// On prépare le dîner du soir ET la boîte du lendemain : la casserole double, pas
// l'assiette. Et ça ne tombe pas toujours symétriquement — deux jours pour soi, un
// seul pour l'autre, qui déjeune dehors demain. D'où un compte PAR PERSONNE.
//
// Le piège, et c'est le seul qui compte : monter l'appétit à 200 % donnerait les
// mêmes grammages et tout le reste faux. « Appétit » dit ce qu'on mange ce soir, et
// `partDeMoi` le suit — la fiche annoncerait alors une assiette double et le suivi
// compterait un dîner de trop. Le nombre de repas multiplie ce qu'on PÈSE, rien
// d'autre.

describe('le nombre de repas par personne', () => {
  const foyer = [MOI, camille]

  it('vaut un repas quand rien n’est dit', async () => {
    const { repasDe } = await import('../../lib/foyer')
    expect(repasDe({ membres: ['moi'], invites: [] }, 'moi')).toBe(1)
    expect(repasDe(null, 'moi')).toBe(1)
  })

  it('multiplie ce qu’on pèse', async () => {
    const { facteurRepas } = await import('../../lib/foyer')
    const seul = { membres: ['moi'], invites: [] }
    expect(facteurRepas(seul, foyer)).toBe(1)
    expect(facteurRepas({ ...seul, repas: { moi: 2 } }, foyer)).toBe(2)
  })

  /** LE cas de la demande : deux jours pour moi, un seul pour Camille. */
  it('compte chacun séparément', async () => {
    const { facteurRepas } = await import('../../lib/foyer')
    // 1 × 2 + 0,6 × 1 = 2,6
    expect(facteurRepas({ membres: ['moi', 'camille'], invites: [], repas: { moi: 2 } }, foyer)).toBe(2.6)
    // 1 × 2 + 0,6 × 2 = 3,2
    expect(facteurRepas({ membres: ['moi', 'camille'], invites: [], repas: { moi: 2, camille: 2 } }, foyer)).toBe(3.2)
  })

  /**
   * LA règle. Cuisiner double ne fait pas manger double : l'assiette de ce soir
   * reste une portion, et c'est elle que le suivi compte.
   */
  it('ne change PAS ce que je mets dans mon assiette ce soir', async () => {
    const { partDeMoi } = await import('../../lib/foyer')
    const seul = { membres: ['moi'], invites: [] }
    expect(partDeMoi(seul, foyer)).toBe(1)
    // Deux repas cuisinés : mon assiette est la moitié de la casserole, pas le tout.
    expect(partDeMoi({ ...seul, repas: { moi: 2 } }, foyer)).toBe(0.5)
    // Et elle ne double jamais — c'est ce qu'un appétit à 200 % aurait fait.
    expect(partDeMoi({ ...seul, repas: { moi: 2 } }, foyer)).toBeLessThanOrEqual(1)
  })

  it('ne compte pas les invités deux fois', async () => {
    const { facteurRepas } = await import('../../lib/foyer')
    // Un invité est à table ce soir, un point c'est tout. Qui repart avec une boîte
    // est un convive de plus, pas un convive multiplié.
    const c = { membres: ['moi'], invites: [{ nom: 'Léa', appetit: 1 }], repas: { moi: 3 } }
    expect(facteurRepas(c, foyer)).toBe(4) // 1 × 3 + 1
  })

  it('le dit dans le libellé', async () => {
    const { libelleRepas } = await import('../../lib/foyer')
    expect(libelleRepas({ membres: ['moi'], invites: [], repas: { moi: 2 } }, foyer)).toBe('Moi ×2')
    expect(libelleRepas({ membres: ['moi', 'camille'], invites: [], repas: { moi: 2 } }, foyer)).toBe('Moi ×2 + Camille')
  })
})

describe('poser et défaire un nombre de repas', () => {
  it('n’écrit rien pour un repas : l’ordinaire ne se stocke pas', async () => {
    const { avecRepas } = await import('../../lib/foyer')
    const c = { membres: ['moi'], invites: [] }
    expect(avecRepas(c, 'moi', 1).repas).toBeUndefined()
    // Et revenir à 1 EFFACE, plutôt que d'écrire un 1 qui traînerait.
    expect(avecRepas(avecRepas(c, 'moi', 3), 'moi', 1).repas).toBeUndefined()
  })

  it('borne aux extrêmes plutôt que de refuser', async () => {
    const { avecRepas, REPAS_MAX } = await import('../../lib/foyer')
    const c = { membres: ['moi'], invites: [] }
    expect(avecRepas(c, 'moi', 99).repas!.moi).toBe(REPAS_MAX)
    expect(avecRepas(c, 'moi', 0).repas).toBeUndefined()
    expect(avecRepas(c, 'moi', Number.NaN).repas).toBeUndefined()
  })

})

describe('relire un repas venu du stockage', () => {
  /** Une sauvegarde d'avant ce réglage doit passer sans migration ni surprise. */
  it('encaisse un repas qui ne connaît pas ce champ', async () => {
    const { normaliserRepas } = await import('../../lib/foyer')
    const c = normaliserRepas({ membres: ['moi', 'camille'], invites: [] })!
    expect(c.repas).toBeUndefined()
  })

  /**
   * Une entrée orpheline — le membre a été décoché depuis — ferait réapparaître un
   * ×2 le jour où on le recoche, sans que rien ne l'ait demandé.
   */
  it('jette le compte d’un membre qui n’est plus à table', async () => {
    const { normaliserRepas } = await import('../../lib/foyer')
    const c = normaliserRepas({ membres: ['moi'], invites: [], repas: { moi: 2, camille: 3 } })!
    expect(c.repas).toEqual({ moi: 2 })
  })

  it('nettoie les valeurs impossibles', async () => {
    const { normaliserRepas, REPAS_MAX } = await import('../../lib/foyer')
    const c = normaliserRepas({ membres: ['moi', 'camille'], invites: [], repas: { moi: 'nawak', camille: 400 } })!
    expect(c.repas).toEqual({ camille: REPAS_MAX })
  })
})
