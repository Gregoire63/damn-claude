// Correspondance exercice → jeu d'images « position de départ / position de fin ».
// La valeur est le nom de dossier dans la source d'images (voir scripts/fetch-exercise-images.mjs).
// Les fichiers finaux attendus par l'app : /public/exercises/<idExercice>-1.jpg (départ)
// et <idExercice>-2.jpg (fin). Tant qu'ils sont absents, l'app retombe sur le schéma musculaire.
export const EXERCISE_IMAGE_SLUGS: Record<string, string> = {
  'dc-barre': 'Barbell_Bench_Press_-_Medium_Grip',
  'di-halteres': 'Incline_Dumbbell_Press',
  'dips': 'Dips_-_Chest_Version',
  'curl-ez': 'EZ-Bar_Curl',
  'ext-corde': 'Triceps_Pushdown_-_Rope_Attachment',
  'curl-incline': 'Incline_Dumbbell_Curl',
  'crunch-cable': 'Cable_Crunch',
  'tirage-v': 'Wide-Grip_Lat_Pulldown',
  'lombaires': 'Hyperextensions_-_Back_Extensions',
  'tractions': 'Pullups',
  'rowing-m': 'Seated_Cable_Rows',
  'dev-mil': 'Dumbbell_Shoulder_Press',
  'elev-lat': 'Side_Lateral_Raise',
  'face-pull': 'Face_Pull',
  'squat': 'Barbell_Full_Squat',
  'sdt-r': 'Romanian_Deadlift',
  'fentes': 'Dumbbell_Lunges',
  'mollets': 'Standing_Calf_Raises',
  'releves': 'Hanging_Leg_Raise',
  'dev-halteres': 'Dumbbell_Bench_Press',
  'ecartes': 'Cable_Crossover',
  'curl-marteau': 'Hammer_Curls',
  'curl-21': 'EZ-Bar_Curl',
  'ext-uni': 'Standing_One-Arm_Dumbbell_Triceps_Extension',
  'crunch-leste': 'Weighted_Crunches',
}

// Supersets : deux mouvements distincts, une image (position de travail) par mouvement,
// avec le nom du mouvement en libellé au lieu de « Départ / Fin ».
export const EXERCISE_IMAGE_PAIRS: Record<string, [{ slug: string; label: string }, { slug: string; label: string }]> = {
  'ss-bras': [
    { slug: 'Triceps_Pushdown_-_Rope_Attachment', label: 'Pushdown' },
    { slug: 'Cable_Rope_Overhead_Triceps_Extension', label: 'Overhead' },
  ],
}

// Exercices disposant d'images (pour l'affichage conditionnel côté composant)
export function hasExerciseImages(exId: string): boolean {
  return exId in EXERCISE_IMAGE_SLUGS || exId in EXERCISE_IMAGE_PAIRS
}

// Libellés des deux images : nom des mouvements pour un superset, sinon Départ / Fin
export function exerciseImageLabels(exId: string): [string, string] {
  const pair = EXERCISE_IMAGE_PAIRS[exId]
  return pair ? [pair[0].label, pair[1].label] : ['Départ', 'Fin']
}
