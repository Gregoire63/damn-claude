import { describe, expect, it } from 'vitest'
import { MEAS, decode, parseGroup } from '../../lib/withings'
import type { RawGroup } from '../../lib/withings'

// ─────────────────────────────────────────────────────────────────────────────
// Le décodage Withings, et rien d'autre.
// ─────────────────────────────────────────────────────────────────────────────
//
// Le journal des pesées, la quarantaine et les statistiques ne sont plus ici :
// ils ne doivent rien à Withings et se testent dans mesures.test.ts. Ce qui reste
// est la seule chose que cette marque a de particulier — un encodage maison.

// Un groupe de mesures tel que Withings le renvoie : valeurs entières + exposant.
const group = (epoch: number, kg: number, fat?: number, muscle?: number): RawGroup => ({
  date: epoch,
  measures: [
    { value: Math.round(kg * 1000), type: MEAS.weight, unit: -3 },
    ...(fat !== undefined ? [{ value: Math.round(fat * 1000), type: MEAS.fatMass, unit: -3 }] : []),
    ...(muscle !== undefined ? [{ value: Math.round(muscle * 1000), type: MEAS.muscleMass, unit: -3 }] : []),
  ],
})

const EPOCH = Date.UTC(2026, 0, 5, 7, 30) / 1000 // lundi 5 janvier 2026, 07 h 30 UTC
const DAY = 86400

describe('decode', () => {
  it('applique l\'exposant Withings', () => {
    expect(decode(74850, -3)).toBeCloseTo(74.85, 5)
    expect(decode(94, 0)).toBe(94)
    expect(decode(15, 1)).toBe(150)
  })
})

describe('parseGroup', () => {
  it('extrait poids, date et heure', () => {
    const e = parseGroup(group(EPOCH, 94.3))!
    expect(e.kg).toBe(94.3)
    expect(e.date).toBe('2026-01-05')
    expect(e.at).toBe('2026-01-05T07:30')
    expect(e.source).toBe('withings')
  })

  it('refuse un groupe sans poids exploitable', () => {
    expect(parseGroup({ date: EPOCH, measures: [{ value: 60, type: MEAS.heartRate, unit: 0 }] })).toBeNull()
    expect(parseGroup(group(EPOCH, 0))).toBeNull()
  })

  it('complète le pourcentage de gras quand seule la masse est donnée', () => {
    const e = parseGroup(group(EPOCH, 100, 25))!
    expect(e.fatMass).toBe(25)
    expect(e.fatRatio).toBeCloseTo(25, 1)
    expect(e.leanMass).toBe(75) // 100 − 25
  })

  it('complète la masse de gras quand seul le pourcentage est donné', () => {
    const e = parseGroup({
      date: EPOCH,
      measures: [
        { value: 90000, type: MEAS.weight, unit: -3 },
        { value: 20000, type: MEAS.fatRatio, unit: -3 },
      ],
    })!
    expect(e.fatRatio).toBe(20)
    expect(e.fatMass).toBeCloseTo(18, 2) // 20 % de 90 kg
  })

  it('décale l\'horodatage selon le fuseau demandé', () => {
    const e = parseGroup(group(EPOCH, 94), 60)! // UTC+1
    expect(e.at).toBe('2026-01-05T08:30')
  })
})

