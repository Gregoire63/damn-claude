import { describe, expect, it } from 'vitest'
import { SESSION_FORFAIT, ageOn, sessionBurn } from '../../lib/energy'

// Ce fichier tient une RÈGLE MÉTIER, pas une fonction utilitaire.
//
// Elle existait en six exemplaires, dans six écrans, et les six ne disaient pas la
// même chose. Deux d'entre eux oubliaient le troisième cas — la séance prévue qui
// n'a jamais eu lieu — et créditaient quand même le forfait. La cible de ce jour-là
// s'en trouvait gonflée de plusieurs centaines de calories, et l'historique donnait
// l'impression d'avoir sous-mangé un jour où l'on avait visé juste.
//
// Une erreur de ce genre ne se voit pas : elle se lit, et on en tire des conclusions.

const seance = (at: string, durationMin = 55) =>
  ({ at, durationMin, entries: [{ sets: [{}, {}, {}] }] }) as never

const BASE = { kg: 91.6, bmr: 1895 }

describe('l’âge à une date', () => {
  it('se calcule sur l’année de la date, pas sur l’année en cours', () => {
    // Relire une séance de 2024 doit employer l'âge de 2024 : le métabolisme de base
    // en dépend, donc la cible calorique de la journée relue.
    expect(ageOn('2024-03-15', 1997)).toBe(27)
    expect(ageOn('2026-08-19', 1997)).toBe(29)
  })

  it('ne rend rien sans année de naissance', () => {
    expect(ageOn('2026-08-19', null)).toBeNull()
    expect(ageOn('2026-08-19', undefined)).toBeNull()
  })

  it('refuse un âge absurde plutôt que de le propager dans le métabolisme', () => {
    expect(ageOn('2026-08-19', 2030)).toBeNull() // né dans le futur
    expect(ageOn('2026-08-19', 1850)).toBeNull()
  })
})

describe('la dépense de la séance', () => {
  it('part de ce qui a VRAIMENT été fait dès qu’une séance est enregistrée', () => {
    const b = sessionBurn({ ...BASE, records: [seance('2026-08-19T12:30')], gymPlanned: true, played: true })
    expect(b).toBeGreaterThan(0)
    // Ce n'est pas le forfait : c'est estimé sur la durée et le volume.
    expect(b).not.toBe(SESSION_FORFAIT)
  })

  it('applique le forfait tant que la séance prévue est À VENIR', () => {
    // Supposer zéro le matin ferait afficher une cible qui bondirait le soir venu.
    expect(sessionBurn({ ...BASE, records: [], gymPlanned: true, played: false })).toBe(SESSION_FORFAIT)
  })

  /**
   * LA correction. Deux écrans créditaient le forfait ici — quatre cents calories
   * pour un entraînement qui n'a pas eu lieu.
   */
  it('ne crédite RIEN à une séance prévue que la journée a laissée passer', () => {
    expect(sessionBurn({ ...BASE, records: [], gymPlanned: true, played: true })).toBe(0)
  })

  it('ne crédite rien un jour sans séance prévue', () => {
    expect(sessionBurn({ ...BASE, records: [], gymPlanned: false, played: false })).toBe(0)
    expect(sessionBurn({ ...BASE, records: [], gymPlanned: false, played: true })).toBe(0)
  })

  it('compte une séance faite un jour NON prévu — le corps ne lit pas le planning', () => {
    const b = sessionBurn({ ...BASE, records: [seance('2026-08-19T12:30')], gymPlanned: false, played: true })
    expect(b).toBeGreaterThan(0)
  })

  it('ne rend jamais le forfait faute de poids : on ne devine pas une dépense', () => {
    // Sans poids ni métabolisme, une séance enregistrée ne peut pas être estimée.
    // Zéro est le seul chiffre honnête — le forfait serait une invention.
    expect(sessionBurn({ records: [seance('2026-08-19T12:30')], kg: null, bmr: null, gymPlanned: true, played: true })).toBe(0)
  })

  it('garde le forfait à une valeur unique', () => {
    // Il était déclaré cinq fois. Le réviser n'en aurait corrigé qu'une.
    expect(SESSION_FORFAIT).toBe(440)
  })
})
