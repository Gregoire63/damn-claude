import type { Exercise, Session } from '../data/sportProgram'

// Les groupes musculaires d'une séance, en mots.
//
// Vivaient dans la page. Ils en sont sortis parce que deux écrans les demandent
// maintenant — l'accueil pour ses cartes de séance, l'aperçu en lecture seule pour
// sa liste d'exercices — et qu'une fonction pure recopiée est une fonction qui
// diverge.

// Libellés COMPACTS pour les pastilles des cartes de séance (les 3 faisceaux
// d'épaule y sont regroupés, sinon la carte déborde). L'analyse de volume, elle,
// les distingue — cf. MUSCLE_LABELS dans utils/sportStats.
export const MUSCLE_LABELS: Record<string, string> = {
  pecs: 'Pecs', 'epaules-av': 'Épaules', 'epaules-lat': 'Épaules', 'epaules-ar': 'Épaules',
  triceps: 'Triceps', biceps: 'Biceps', 'avant-bras': 'Avant-bras', abdos: 'Abdos',
  dos: 'Dos', lombaires: 'Lombaires', quadris: 'Quadris', ischios: 'Ischios', fessiers: 'Fessiers', mollets: 'Mollets',
}
export function sessionMuscles(s: Session): string[] {
  const seen: string[] = []
  for (const e of s.exercises) for (const m of e.muscles) {
    const l = MUSCLE_LABELS[m] || m
    if (!seen.includes(l)) seen.push(l)
  }
  return seen.slice(0, 4)
}
export function exMuscles(e: Exercise): string[] {
  const seen: string[] = []
  for (const m of e.muscles) { const l = MUSCLE_LABELS[m] || m; if (!seen.includes(l)) seen.push(l) }
  return seen.slice(0, 4)
}

