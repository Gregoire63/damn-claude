import { describe, expect, it } from 'vitest'
import { nextMeal } from '../../lib/nutritionStats'
import type { TimelineEntry } from '../../lib/nutritionStats'

// ─────────────────────────────────────────────────────────────────────────────
// Le prochain repas mis en avant sur l'accueil
//
// C'est un choix qui se voit tout de suite quand il est faux : l'écran d'accueil
// annonce un repas, et la feuille des repas en montre un autre. Le piège n'est pas
// le cas courant mais les deux bords — le repas qu'on vient de manger sans l'avoir
// coché, et la soirée où l'on rattrape toute la journée d'un coup.

const repas = (time: string, slot: string, done = false): TimelineEntry =>
  ({ key: `plan:${slot}`, time, label: slot, kcal: 400, kind: 'plan', slot, done })

const journee = [
  repas('9 h', 'pdj'),
  repas('9 h 05', 'creatine'),
  repas('13 h 45', 'lunch'),
  repas('17 h', 'snack'),
  repas('20 h 30', 'dinner'),
]
const h = (heures: number, minutes = 0) => heures * 60 + minutes

describe('nextMeal', () => {
  it('propose le repas du moment', () => {
    expect(nextMeal(journee, h(8, 30))?.slot).toBe('pdj')
    expect(nextMeal(journee, h(13))?.slot).toBe('lunch')
    expect(nextMeal(journee, h(19))?.slot).toBe('dinner')
  })

  it('garde le repas en cours pendant une heure et demie après son horaire', () => {
    // On coche rarement à la minute : à 14 h 30 c'est encore le déjeuner qu'on valide,
    // pas la collation de 17 h.
    expect(nextMeal(journee, h(14, 30))?.slot).toBe('lunch')
    expect(nextMeal(journee, h(15, 20))?.slot).toBe('snack')
  })

  it('saute ce qui est franchement passé au lieu de s\'y accrocher', () => {
    // Le vrai défaut d'avant : un petit-déjeuner oublié restait « prochain repas »
    // jusqu'au soir, et le dîner passait inaperçu.
    expect(nextMeal(journee, h(20))?.slot).toBe('dinner')
  })

  it('ignore ce qui est déjà coché', () => {
    const avance = [repas('9 h', 'pdj', true), repas('9 h 05', 'creatine', true), repas('13 h 45', 'lunch')]
    expect(nextMeal(avance, h(9, 30))?.slot).toBe('lunch')
  })

  it('retombe sur le plus ancien non coché quand tout est passé', () => {
    // Minuit moins le quart, on rattrape la journée : un écran vide ne dirait rien.
    expect(nextMeal(journee, h(23, 45))?.slot).toBe('pdj')
  })

  it('rend null quand la journée est entièrement validée', () => {
    expect(nextMeal(journee.map(e => ({ ...e, done: true })), h(21))).toBeNull()
    expect(nextMeal([], h(12))).toBeNull()
  })

  it('ignore les extras : on ne met en avant que des repas du plan', () => {
    const avecExtra: TimelineEntry[] = [
      { key: 'extra:1', time: '10 h', label: 'Café', kcal: 20, kind: 'extra', extraId: '1', done: true },
      repas('13 h 45', 'lunch'),
    ]
    expect(nextMeal(avecExtra, h(11))?.slot).toBe('lunch')
  })

  it('sans horloge, garde l\'ancien comportement', () => {
    // Le paramètre est optionnel : un appelant qui ne le passe pas n'est pas cassé.
    expect(nextMeal(journee)?.slot).toBe('pdj')
  })
})
