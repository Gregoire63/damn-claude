// Décodage des mesures Withings. Pur : aucun appel réseau, aucun DOM.
//
// Ce fichier ne contient QUE ce qui est propre à Withings — l'encodage `value ×
// 10^unit` et la table des types de mesure. Le journal des pesées, la quarantaine
// et les statistiques sont dans `lib/mesures.ts` : ils valent pour n'importe quelle
// source, et les laisser ici faisait croire le contraire.
//
// Les échanges HTTP vivent dans `server/connecteurs/withings.ts`, parce que le
// client_secret n'a rien à faire dans un navigateur.

import type { BodyEntry } from './mesures'

/** Types de mesure Withings. https://developer.withings.com/api-reference — Measure v2. */
export const MEAS = {
  weight: 1,
  height: 4,
  leanMass: 5, // masse maigre (kg)
  fatRatio: 6, // masse grasse (%)
  fatMass: 8, // masse grasse (kg)
  muscleMass: 76,
  waterMass: 77,
  boneMass: 88,
  heartRate: 11,
} as const

export type MeasKey = keyof typeof MEAS

/** Réponse brute de `measure – getmeas`. */
export interface RawGroup {
  date: number // epoch (s)
  measures: { value: number, type: number, unit: number }[]
}

const p2 = (n: number) => String(n).padStart(2, '0')

/**
 * Withings encode chaque valeur en `value × 10^unit` — 74850 avec unit −3 vaut 74,85.
 * Ne pas appliquer l'exposant donne des poids à cinq chiffres, ce qui se voit ;
 * l'oublier sur la masse grasse donne des pourcentages plausibles mais faux.
 */
export const decode = (value: number, unit: number) => value * 10 ** unit

/** Convertit un groupe de mesures Withings en une pesée exploitable. */
export function parseGroup(g: RawGroup, tzOffsetMin = 0): BodyEntry | null {
  const byType = new Map<number, number>()
  for (const m of g.measures) byType.set(m.type, decode(m.value, m.unit))

  const kg = byType.get(MEAS.weight)
  if (!kg || kg <= 0) return null // sans poids, la pesée n'apprend rien

  const d = new Date((g.date + tzOffsetMin * 60) * 1000)
  const date = `${d.getUTCFullYear()}-${p2(d.getUTCMonth() + 1)}-${p2(d.getUTCDate())}`
  const at = `${date}T${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`

  const pick = (t: number) => {
    const v = byType.get(t)
    return v !== undefined && v > 0 ? Math.round(v * 100) / 100 : undefined
  }

  const entry: BodyEntry = { date, at, kg: Math.round(kg * 100) / 100, source: 'withings' }
  entry.fatRatio = pick(MEAS.fatRatio)
  entry.fatMass = pick(MEAS.fatMass)
  entry.muscleMass = pick(MEAS.muscleMass)
  entry.waterMass = pick(MEAS.waterMass)
  entry.boneMass = pick(MEAS.boneMass)
  entry.leanMass = pick(MEAS.leanMass)
  entry.heartRate = pick(MEAS.heartRate)

  // La balance donne parfois le pourcentage sans la masse, ou l'inverse : on complète.
  if (entry.fatRatio && !entry.fatMass) entry.fatMass = Math.round(entry.kg * entry.fatRatio) / 100
  if (entry.fatMass && !entry.fatRatio) entry.fatRatio = Math.round(entry.fatMass / entry.kg * 10000) / 100
  if (entry.fatMass && !entry.leanMass) entry.leanMass = Math.round((entry.kg - entry.fatMass) * 100) / 100

  return entry
}

