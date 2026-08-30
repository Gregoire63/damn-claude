import { describe, expect, it } from 'vitest'
import { dayBudget, fitInto } from '../../lib/dayBudget'
import type { SlotState } from '../../lib/dayBudget'

// Ce module ne fait que soustraire, et c'est précisément pour ça qu'il faut le
// tester : une soustraction fausse ne plante jamais, elle conseille simplement un
// dîner de 400 kcal quand il en restait 900. L'erreur se mange, elle ne se voit pas.

const s = (slot: string, kcal: number, p: number, mange = false, libre = false): SlotState =>
  ({ slot, time: '12 h', label: slot, plat: slot, macros: { kcal, p, g: 0, l: 0 }, mange, libre })

const BASE = { cible: 2400, cibleProteines: 180, extras: [] }

describe('le budget du jour', () => {
  it('ne compte QUE les créneaux cochés dans l’avalé', () => {
    const b = dayBudget({ ...BASE, slots: [s('pdj', 500, 40, true), s('lunch', 800, 60), s('dinner', 700, 55)] })
    expect(b.mange.kcal).toBe(500)
    expect(b.reste.kcal).toBe(1900)
    expect(b.reste.proteines).toBe(140)
  })

  it('compte les extras d’office — on ne note pas un carré de chocolat à l’avance', () => {
    const b = dayBudget({ ...BASE, extras: [{ kcal: 220, p: 3, g: 25, l: 12 }], slots: [s('pdj', 500, 40, true)] })
    expect(b.mange.kcal).toBe(720)
    expect(b.reste.kcal).toBe(1680)
  })

  /**
   * LA valeur qui manquait au connecteur. Savoir qu'il reste 900 kcal ne suffit pas :
   * si les créneaux non cochés en apportent déjà 1400, il faut ALLÉGER, pas ajouter.
   */
  it('sépare ce qui reste à manger de ce que le plan apporte encore', () => {
    const b = dayBudget({ ...BASE, slots: [s('pdj', 500, 40, true), s('lunch', 800, 60), s('dinner', 700, 55)] })
    expect(b.reste.kcal).toBe(1900)
    expect(b.restePrevu.kcal).toBe(1500)
    // Le plan est 400 kcal en dessous de la cible : il y a de la place.
    expect(b.reste.kcal - b.restePrevu.kcal).toBe(400)
  })

  it('rend un reste NÉGATIF plutôt que zéro quand la cible est dépassée', () => {
    // Un dépassement caché se répète ; un dépassement affiché se corrige le lendemain.
    const b = dayBudget({ ...BASE, slots: [s('pdj', 1500, 40, true), s('lunch', 1400, 90, true)] })
    expect(b.reste.kcal).toBe(-500)
    expect(b.reste.proteines).toBe(50)
  })

  it('n’invente pas de cible protéique sans pesée', () => {
    const b = dayBudget({ ...BASE, cibleProteines: null, slots: [s('pdj', 500, 40, true)] })
    expect(b.cibleProteines).toBeNull()
    expect(b.reste.proteines).toBeNull()
  })

  it('liste les créneaux à venir dans l’ordre, cochés exclus', () => {
    const b = dayBudget({ ...BASE, slots: [s('pdj', 500, 40, true), s('lunch', 800, 60), s('dinner', 700, 55)] })
    expect(b.aVenir.map(x => x.slot)).toEqual(['lunch', 'dinner'])
  })

  it('traite un repas hors plan comme n’importe quel créneau', () => {
    const b = dayBudget({ ...BASE, slots: [s('lunch', 1050, 45, true, true)] })
    expect(b.mange.kcal).toBe(1050)
    expect(b.reste.proteines).toBe(135)
  })

  it('additionne le prévu sur toute la journée, extras compris', () => {
    const b = dayBudget({ ...BASE, extras: [{ kcal: 100, p: 0, g: 25, l: 0 }], slots: [s('pdj', 500, 40, true), s('dinner', 700, 55)] })
    expect(b.prevu.kcal).toBe(1300)
  })
})

describe('confronter une composition au reste', () => {
  const budget = dayBudget({ ...BASE, slots: [s('pdj', 500, 40, true), s('lunch', 800, 60, true)] })

  it('dit ce qu’il resterait après ce repas', () => {
    // reste avant : 2400 − 1300 = 1100 kcal, 180 − 100 = 80 g de protéines
    const f = fitInto({ kcal: 640, p: 52, g: 45, l: 22 }, budget)
    expect(f.apres.kcal).toBe(460)
    expect(f.apres.proteines).toBe(28)
    expect(f.tient).toBe(true)
  })

  it('signale un dépassement au lieu de le raboter à zéro', () => {
    const f = fitInto({ kcal: 1400, p: 60, g: 120, l: 50 }, budget)
    expect(f.apres.kcal).toBe(-300)
    expect(f.tient).toBe(false)
  })

  it('reste muet sur les protéines quand il n’y a pas de cible', () => {
    const sans = dayBudget({ ...BASE, cibleProteines: null, slots: [] })
    expect(fitInto({ kcal: 500, p: 40, g: 30, l: 15 }, sans).apres.proteines).toBeNull()
  })
})
