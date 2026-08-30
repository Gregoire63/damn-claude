import { describe, expect, it } from 'vitest'
import { latestWeight, weightOn } from '../../lib/weight'

// Ces deux fonctions n'existaient pas : cinq écrans les réimplémentaient, et deux
// d'entre eux lisaient le dernier élément du tableau au lieu de la date la plus
// récente. Tant que le tableau est trié, les deux coïncident — et `setWeight` le
// trie. Mais l'import d'une sauvegarde, la restauration de l'instantané de secours
// et la reprise d'un miroir l'écrivent TEL QUEL.
//
// Ce jour-là, les réglages affichent un poids et l'écran du jour un autre. Comme le
// métabolisme de base en découle, puis la cible calorique, on mange à côté sans
// qu'aucun écran ne signale quoi que ce soit. C'est cette panne silencieuse que les
// tests « dans le désordre » verrouillent.

const P = (date: string, kg: number) => ({ date, kg })

const DESORDRE = [
  P('2026-08-19', 91.58),
  P('2026-08-10', 92.56),
  P('2026-08-15', 92.49),
]

describe('la pesée courante', () => {
  it('prend la date la plus récente, tableau trié', () => {
    expect(latestWeight([P('2026-08-10', 92.56), P('2026-08-15', 92.49), P('2026-08-19', 91.58)])).toBe(91.58)
  })

  /** LA raison d'être du module. */
  it('prend la date la plus récente même DANS LE DÉSORDRE', () => {
    expect(latestWeight(DESORDRE)).toBe(91.58)
  })

  it('ne rend rien plutôt qu’un poids inventé', () => {
    // Sans poids, pas de métabolisme, pas de cible : mieux vaut un écran muet qu'un
    // écran qui conseille sur un chiffre sorti de nulle part.
    expect(latestWeight([])).toBeNull()
  })

  it('ignore les entrées inexploitables au lieu de les compter', () => {
    const sale = [P('2026-08-19', 0), P('2026-08-18', 91.84), { date: '2026-08-20', kg: null } as never]
    expect(latestWeight(sale)).toBe(91.84)
  })

  it('ne modifie pas le tableau qu’on lui donne', () => {
    const copie = [...DESORDRE]
    latestWeight(copie)
    expect(copie.map(e => e.date)).toEqual(DESORDRE.map(e => e.date))
  })
})

describe('le poids à une date', () => {
  it('ne regarde jamais après la date demandée', () => {
    // Relire une séance de mars avec le poids d'aujourd'hui ferait apparaître une
    // progression sur les tractions qui n'est que la variation de la balance.
    expect(weightOn(DESORDRE, '2026-08-16')).toEqual({ kg: 92.49, exact: true })
  })

  it('trouve la bonne pesée même dans le désordre', () => {
    expect(weightOn(DESORDRE, '2026-08-19')).toEqual({ kg: 91.58, exact: true })
    expect(weightOn(DESORDRE, '2026-08-11')).toEqual({ kg: 92.56, exact: true })
  })

  it('avant la première pesée, rend la plus ancienne EN LE DISANT', () => {
    const r = weightOn(DESORDRE, '2026-01-01')
    expect(r).toEqual({ kg: 92.56, exact: false })
  })

  it('rend null quand il n’y a rien du tout', () => {
    expect(weightOn([], '2026-08-19')).toBeNull()
  })
})
