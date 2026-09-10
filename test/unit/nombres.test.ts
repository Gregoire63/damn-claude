import { describe, expect, it } from 'vitest'
import { arrondi } from '../../lib/nombres'

// ─────────────────────────────────────────────────────────────────────────────
// Les nombres à rallonge.
// ─────────────────────────────────────────────────────────────────────────────
//
// Deux causes, et la seconde est celle qu'on oublie : la division qui ne tombe pas
// juste, et la représentation binaire des décimaux — `0.1 + 0.2` vaut
// `0.30000000000000004` sans qu'aucune division soit en cause.
//
// Ce qui se teste ici est le contrat : arrondir ce qui va se lire, sans rien casser
// de ce qui tombait déjà juste.

describe('arrondi', () => {
  it('coupe une division sans fin', () => {
    expect(arrondi(22 / 3)).toBe(7.33)
    expect(arrondi(7.625)).toBe(7.63)
  })

  it('efface la queue binaire, celle qu’aucune division n’explique', () => {
    expect(arrondi(0.1 + 0.2)).toBe(0.3)
    expect(arrondi(76.43 + 0.01)).toBe(76.44)
  })

  /** Le cas de bord que `Math.round` seul rate : 1.005 × 100 = 100.49999999999999. */
  it('arrondit vers le haut ce qui est pile à la moitié', () => {
    expect(arrondi(1.005)).toBe(1.01)
    expect(arrondi(2.675)).toBe(2.68)
  })

  it('ne touche pas à ce qui tombe déjà juste', () => {
    expect(arrondi(76.4)).toBe(76.4)
    expect(arrondi(100)).toBe(100)
    expect(arrondi(0)).toBe(0)
  })

  it('marche dans les négatifs', () => {
    expect(arrondi(-0.35000000000000003)).toBe(-0.35)
    expect(arrondi(-7.625)).toBe(-7.63)
  })

  it('accepte un autre nombre de décimales', () => {
    expect(arrondi(7.625, 1)).toBe(7.6)
    expect(arrondi(7.625, 0)).toBe(8)
  })

  /** Une valeur non finie traverse sans être maquillée en nombre. */
  it('laisse passer ce qui n’est pas un nombre fini', () => {
    expect(arrondi(Number.NaN)).toBeNaN()
    expect(arrondi(Infinity)).toBe(Infinity)
  })
})
