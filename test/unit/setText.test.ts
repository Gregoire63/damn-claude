import { describe, expect, it, vi } from 'vitest'
import { secText, setText, unitText } from '../../lib/setText'
import { PROGRAM } from '../../data/sportProgram'

// Ces tests tournent sur le PACK D'EXEMPLE : l'application ne livre plus de données.
// Voir test/exemple.ts pour le pourquoi.
vi.mock('../../data/sportProgram', () => (import('../exemple')).then(m => m.programmeExemple()))

// ─────────────────────────────────────────────────────────────────────────────
// « 91.5×40 » : deux nombres justes, une phrase fausse.
// ─────────────────────────────────────────────────────────────────────────────
//
// Le journal écrivait ça pour une suspension à la barre de quarante secondes. On y
// lit « quarante répétitions à 91,5 kg », c'est-à-dire un exercice qu'on n'a pas
// fait — et le poids affiché est le poids du corps, qui ne bougera jamais d'une
// séance à l'autre. Deux façons d'induire en erreur dans la même ligne.

const SUSPENSION = { mesure: 'temps' as const, bodyweight: true }
const DIPS = { bodyweight: true }
const DC = {}

describe('une série s’écrit dans l’unité de son exercice', () => {
  it('compte en secondes ce qui se compte en secondes', () => {
    expect(setText({ w: 91.5, r: 40 }, SUSPENSION, 91.5)).toBe('40 s')
    expect(setText({ w: 91.5, r: 8 }, SUSPENSION, 91.5)).toBe('8 s')
  })

  it('montre le LEST, pas le poids du corps répété', () => {
    // Répéter 91,5 kg sur chaque ligne d'un mois de dips ne dit rien, et masque
    // précisément la seule chose qui a bougé : les dix kilos ajoutés.
    expect(setText({ w: 101.5, r: 8 }, DIPS, 91.5)).toBe('+10×8')
    expect(setText({ w: 91.5, r: 8 }, DIPS, 91.5)).toBe('PDC×8')
    expect(setText({ w: 101.5, r: 40 }, SUSPENSION, 91.5)).toBe('40 s +10 kg')
  })

  it('ne change rien à un exercice ordinaire', () => {
    expect(setText({ w: 62.5, r: 8 }, DC)).toBe('62.5×8')
    expect(setText({ w: 60, r: 8 }, DC)).toBe('60×8')
  })

  it('garde les deux mouvements d’un superset', () => {
    const ss = { superset: ['Pushdown', 'Overhead'] as [string, string] }
    expect(setText({ w: 30, r: 12, w2: 20, r2: 12 }, ss)).toBe('30×12 + 20×12')
  })

  /**
   * Sans pesée pour ce jour-là, on ne peut pas extraire le lest — et l'inventer
   * afficherait un chiffre faux avec l'aplomb d'un chiffre mesuré. On rend alors
   * ce qui est enregistré, tel quel.
   */
  it('se rabat sur le total quand la pesée du jour manque', () => {
    expect(setText({ w: 101.5, r: 8 }, DIPS, null)).toBe('101.5×8')
    expect(setText({ w: 91.5, r: 40 }, SUSPENSION, null)).toBe('40 s à 91.5 kg')
  })

  it('tolère les séries héritées, enregistrées à 0 kg', () => {
    // Les relevés de jambes étaient enregistrés à 0 kg avant que la fiche les
    // déclare au poids de corps. Un lest négatif ne doit pas s'afficher.
    expect(setText({ w: 0, r: 10 }, DIPS, 91.5)).toBe('PDC×10')
  })

  it('écrit les durées comme le minuteur', () => {
    expect(secText(45)).toBe('45 s')
    expect(secText(59)).toBe('59 s')
    expect(secText(60)).toBe('1:00')
    expect(secText(90)).toBe('1:30')
  })

  it('donne le mot de l’unité', () => {
    expect(unitText(SUSPENSION)).toBe('s')
    expect(unitText(DC)).toBe('reps')
  })
})

describe('sur les fiches réelles', () => {
  const parId = Object.fromEntries(PROGRAM.flatMap(s => s.exercises).map(e => [e.id, e]))

  it('la suspension se lit en secondes, les tractions en reps', () => {
    expect(setText({ w: 91.5, r: 40 }, parId.suspension, 91.5)).toBe('40 s')
    expect(setText({ w: 96.5, r: 9 }, parId.tractions, 91.5)).toBe('+5×9')
  })

  it('la tenue à la barre aussi', () => {
    expect(setText({ w: 91.5, r: 15 }, parId['tractions-tenue'], 91.5)).toBe('15 s')
  })

  it('les relevés de jambes montrent enfin autre chose que 0', () => {
    expect(setText({ w: 93.5, r: 12 }, parId.releves, 91.5)).toBe('+2×12')
  })
})
