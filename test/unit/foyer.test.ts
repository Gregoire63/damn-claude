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
