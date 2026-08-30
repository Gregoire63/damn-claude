import { describe, expect, it } from 'vitest'
import { cookedWeight, portioningFor, ratioFor, ratioFromWeighing } from '../../lib/cooked'

// ─────────────────────────────────────────────────────────────────────────────
// Cru → cuit
//
// Une erreur ici ne fait rien planter : elle produit une portion fausse, donc des
// calories fausses, tous les midis. Ce qui compte le plus dans ces tests, c'est ce
// que le module REFUSE de convertir — un aliment sans ratio doit rendre `null`
// plutôt qu'un nombre qui aurait l'air d'une réponse.

describe('ratioFor', () => {
  it('rend la valeur de référence et dit qu\'elle n\'est pas mesurée', () => {
    expect(ratioFor('riz-basmati')).toEqual({ ratio: 2.6, mesure: false })
  })

  it('préfère la pesée de l\'utilisateur à la valeur de référence', () => {
    expect(ratioFor('riz-basmati', { mesures: { 'riz-basmati': 2.9 } }))
      .toEqual({ ratio: 2.9, mesure: true })
  })

  it('ignore une pesée aberrante et retombe sur la référence', () => {
    // Une casserole pesée avec son contenu donne 12 ; l'accepter figerait l'erreur.
    for (const faux of [0, -1, 0.1, 9, 42]) {
      expect(ratioFor('riz-basmati', { mesures: { 'riz-basmati': faux } })).toEqual({ ratio: 2.6, mesure: false })
    }
  })

  it('rend null pour ce qui ne se pèse pas cuit', () => {
    expect(ratioFor('filet-de-poulet')).toBeNull()
    expect(ratioFor('brocolis')).toBeNull()
    expect(ratioFor('nawak')).toBeNull()
  })

  it('ne convertit PAS les flocons d\'avoine', () => {
    // Ils absorbent énormément en porridge, mais aucune recette ne les cuit :
    // overnight oats, granola sur le yaourt, smoothie. Annoncer un poids cuit sur
    // un bol de yaourt n'est pas une approximation, c'est une erreur.
    expect(ratioFor('flocons-d-avoine')).toBeNull()
    expect(cookedWeight('flocons-d-avoine', 60)).toBeNull()
  })
})

describe('cookedWeight', () => {
  it('convertit et arrondit à 5 g', () => {
    // 150 × 2,6 = 390. Afficher 389 promettrait une précision qui n'existe pas.
    expect(cookedWeight('riz-basmati', 150)).toBe(390)
    expect(cookedWeight('pates-completes', 100)).toBe(240)
    expect(cookedWeight('lentilles-vertes', 80)).toBe(200)
  })

  it('gère aussi ce qui PERD de l\'eau', () => {
    expect(cookedWeight('patate-douce', 200)).toBe(150) // frites au four
    expect(cookedWeight('pommes-de-terre', 200)).toBe(170)
  })

  it('rend null plutôt qu\'un chiffre inventé', () => {
    expect(cookedWeight('filet-de-poulet', 150)).toBeNull()
    expect(cookedWeight('riz-basmati', 0)).toBeNull()
    expect(cookedWeight('riz-basmati', -50)).toBeNull()
  })
})

describe('portioningFor', () => {
  const items = [
    { food: 'riz-basmati', g: 150 },
    { food: 'filet-de-poulet', g: 160 }, // pas de ratio : se compte à l'unité
    { food: 'brocolis', g: 200 },
  ]

  it('ne rend que les aliments qui se répartissent au poids', () => {
    const out = portioningFor(items, 5)
    expect(out.map(x => x.foodId)).toEqual(['riz-basmati'])
  })

  it('donne le total du batch ET la part d\'une boîte', () => {
    const [riz] = portioningFor(items, 5)
    expect(riz.cruParBoite).toBe(150)
    expect(riz.cruTotal).toBe(750)
    expect(riz.totalCuit).toBe(1950) // 750 × 2,6
    expect(riz.parBoite).toBe(390) // c'est LE chiffre devant la casserole
  })

  it('suit la pesée de l\'utilisateur jusque dans la répartition', () => {
    const [riz] = portioningFor(items, 5, { mesures: { 'riz-basmati': 2.9 } })
    expect(riz.parBoite).toBe(435)
    expect(riz.mesure).toBe(true)
  })

  it('porte la note quand le chiffre dépend fortement de la cuisson', () => {
    const [pdt] = portioningFor([{ food: 'pommes-de-terre', g: 250 }], 4)
    expect(pdt.note).toMatch(/vapeur/)
  })

  it('rend une liste vide sur un nombre de boîtes absurde', () => {
    expect(portioningFor(items, 0)).toEqual([])
    expect(portioningFor(items, -3)).toEqual([])
  })
})

describe('ratioFromWeighing', () => {
  it('déduit le ratio de la casserole', () => {
    expect(ratioFromWeighing(750, 1950)).toBe(2.6)
    expect(ratioFromWeighing(200, 150)).toBe(0.75)
  })

  it('refuse ce qui ne peut pas être une cuisson', () => {
    expect(ratioFromWeighing(750, 9000)).toBeNull() // casserole comprise
    expect(ratioFromWeighing(750, 100)).toBeNull() // pesée à côté
    expect(ratioFromWeighing(0, 500)).toBeNull()
    expect(ratioFromWeighing(500, 0)).toBeNull()
  })
})
