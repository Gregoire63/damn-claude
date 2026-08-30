// ─────────────────────────────────────────────
// Programme recomp — points faibles pec/bras/abdos, jambes maintien + sprint
// ─────────────────────────────────────────────

export interface Exercise {
  id: string
  name: string
  sets: number
  reps: string
  muscles: string[]
  cues: string[]
  machine: string
  bodyweight?: boolean // charge = poids de corps (+ lest) — préremplie avec le poids du profil
  superset?: [string, string] // 2 mouvements enchaînés — saisie d'une charge par mouvement
  /**
   * Repos entre deux séries de travail, en SECONDES.
   *
   * Réglé sur le mouvement et non sur les reps : le nombre de reps dit la charge,
   * le repos dépend de ce que la série a coûté. Non renseigné → déduit des reps
   * par `restFor` dans lib/rest.ts.
   */
  rest?: number
  /**
   * Ce que compte une série : des RÉPÉTITIONS, ou du TEMPS.
   *
   * Absent = `reps`, et c'est le cas des vingt-trois mouvements livrés. Le champ
   * n'existe que parce qu'un coach peut vouloir ajouter du farmer's walk ou une
   * suspension à la barre, dont la série se mesure en secondes.
   *
   * Ce n'est pas une étiquette d'affichage. Trois mécanismes lisent `reps` comme un
   * nombre — la progression automatique, la détection de record, le 1RM estimé — et
   * « 30-40 s » leur donnerait 40 répétitions : une charge conseillée à la hausse
   * parce qu'on a « atteint 40 reps », un record de 1RM calculé sur des secondes.
   * Faux, et faux silencieusement. `mesure: 'temps'` les court-circuite tous les trois.
   */
  mesure?: 'reps' | 'temps'
  /**
   * Un mouvement de confort : on le fait s'il reste du temps.
   *
   * Il s'affiche grisé en fin de séance et ne compte pas dans le seuil des 80 %
   * qui autorise l'enregistrement — sinon un accessoire facultatif bloquerait la
   * validation d'une séance faite. En revanche il compte NORMALEMENT dans le volume,
   * les records et l'historique dès qu'il est réellement fait : c'est du travail.
   */
  optionnel?: boolean
}

// Plan de sprint détaillé, avec variante extérieur (piste) et tapis
export interface SprintPlan {
  title: string
  goal: string
  warmup: string[]
  protocol: { label: string; value: string }[]
  exterieur: string[]
  tapis: string[]
  tapisNote: string
  cues: string[]
  cooldown: string
}

export interface Session {
  id: string
  name: string
  tag: string
  color: string
  sprint: SprintPlan | null
  exercises: Exercise[]
}

/**
 * Le programme livré est VIDE, et c'est délibéré.
 *
 * Il a longtemps contenu quatre séances — celles d'une personne. Toute installation
 * neuve démarrait donc sur le programme de quelqu'un d'autre : ses exercices, ses
 * machines, ses identifiants. On ne « commençait » pas, on effaçait.
 *
 * Les séances se créent maintenant depuis l'application ou par le connecteur
 * (`creer-seance`), et l'ancien programme est devenu l'exemple qu'on importe si on
 * le veut : `data/exemple/programme.ts` → `public/exemple.json`.
 *
 * Le tableau reste là, typé et exporté, parce que TOUTE la chaîne part de lui :
 * `mergeProgram(PROGRAM, custom)` empile les modifications sur le livré. Vide, il
 * rend simplement le programme personnel — même code, aucun cas particulier.
 */
export const PROGRAM: Session[] = []

export const ALL_EXERCISES = PROGRAM.flatMap(s => s.exercises)

/**
 * Borne HAUTE de la fourchette — et `null` dès qu'il n'y a pas de FOURCHETTE.
 *
 * C'est délibéré, et ça se lit comme un oubli. Le commentaire d'à côté dit qu'une
 * valeur seule est « ses deux bornes à la fois » ; cette fonction refuse quand même
 * de rendre 15 pour « 15 », et elle a raison.
 *
 * La double progression a besoin de DEUX bornes : on monte la charge en atteignant
 * le haut, et on retombe au bas de la fourchette au nouveau poids. Avec un nombre
 * fixe il n'y a pas de bas où retomber — atteindre la cible devient vrai à chaque
 * séance, et « objectif atteint → +2,5 kg » se déclenche à chaque fois. Vérifié sur
 * ses données réelles : `curl-21` est un protocole 7+7+7 où les 21 reps sont là par
 * construction, trois séances sur trois. Rendre une borne haute lui ferait ajouter
 * du poids indéfiniment, sans que rien ne le retienne.
 *
 * Un exercice à nombre fixe progresse donc par le ressenti (« facile » → on monte)
 * ou par la stagnation, ce qui est le bon comportement pour un accessoire.
 *
 * Si un jour on veut qu'un de ces exercices s'auto-régule : lui donner une vraie
 * fourchette (« 12-15 »), pas contourner cette fonction.
 */
export function topOfRange(reps: string): number | null {
  const m = reps.match(/(\d+)\s*-\s*(\d+)/)
  return m ? parseInt(m[2], 10) : null
}

/**
 * Borne BASSE : « 8-10 » → 8 ; « 15 » → 15, la valeur seule servant de plancher.
 *
 * Asymétrique avec `topOfRange`, et c'est voulu — les deux bornes ne servent pas à
 * la même chose. Le plancher déclenche une DÉCHARGE quand on tombe dessous à
 * l'échec ; il a du sens sur un nombre fixe. Le plafond déclenche une MONTÉE ; il
 * n'en a pas (cf. ci-dessus).
 *
 * Attention : sur un nombre fixe, ce plancher ne vaut que si la fiche dit vrai. Si
 * le programme annonce 15 reps et qu'on en fait 8 séance après séance, tout « à
 * l'échec » déclenche une décharge — ce n'est pas la fonction qui est fautive, c'est
 * la fiche. `repsGap` (lib/repsGap.ts) est là pour rendre cet écart visible.
 *
 * Elle sert à distinguer les deux situations que le ressenti « à l'échec » ne
 * distingue pas tout seul : arriver à l'échec À 8 reps sur du 8-10, c'est la
 * série qu'on voulait ; arriver à l'échec à 5, c'est une charge trop lourde.
 * Sans cette borne, les deux donnaient le même conseil — redescendre.
 */
export function bottomOfRange(reps: string): number | null {
  const range = reps.match(/(\d+)\s*-\s*(\d+)/)
  if (range) return parseInt(range[1], 10)
  const single = reps.match(/(\d+)/)
  return single ? parseInt(single[1], 10) : null
}

// Incrément suggéré selon le groupe musculaire
export function suggestedIncrement(ex: Exercise): number {
  const lower = ['quadris', 'ischios', 'fessiers', 'mollets']
  return ex.muscles.some(m => lower.includes(m)) ? 5 : 2.5
}

// ─────────────────────────────────────────────
// Tracés SVG des zones musculaires (viewBox 0 0 100 140)
// ─────────────────────────────────────────────
export const MUSCLE_PATHS_FRONT: Record<string, string> = {
  'pecs': 'M32,34 Q40,30 48,34 L48,46 Q40,50 32,46 Z M52,34 Q60,30 68,34 L68,46 Q60,50 52,46 Z',
  'epaules-av': 'M22,30 Q28,24 33,30 L31,40 Q25,40 22,36 Z M67,30 Q72,24 78,30 L78,36 Q75,40 69,40 Z',
  'epaules-lat': 'M20,32 Q17,36 19,42 L25,40 Q22,36 24,31 Z M80,32 Q83,36 81,42 L75,40 Q78,36 76,31 Z',
  'biceps': 'M20,44 Q24,42 27,45 L26,58 Q22,60 19,57 Z M73,45 Q76,42 80,44 L81,57 Q78,60 74,58 Z',
  'avant-bras': 'M17,60 Q21,58 25,60 L23,74 Q20,76 17,73 Z M75,60 Q79,58 83,60 L83,73 Q80,76 77,74 Z',
  'abdos': 'M40,50 L60,50 L58,74 Q50,78 42,74 Z',
  'quadris': 'M38,80 Q44,78 47,82 L46,106 Q42,110 38,106 Z M53,82 Q56,78 62,80 L62,106 Q58,110 54,106 Z',
  'mollets': 'M39,112 Q43,110 46,113 L45,128 Q42,130 39,127 Z M54,113 Q57,110 61,112 L61,127 Q58,130 55,128 Z',
}

export const MUSCLE_PATHS_BACK: Record<string, string> = {
  'dos': 'M33,30 Q50,26 67,30 L64,58 Q50,64 36,58 Z',
  'lombaires': 'M41,57 Q50,55 59,57 L58,65 Q50,67 42,65 Z',
  'epaules-ar': 'M22,30 Q28,24 33,30 L31,39 Q25,39 22,36 Z M67,30 Q72,24 78,30 L78,36 Q75,39 69,39 Z',
  'triceps': 'M20,43 Q24,41 27,44 L26,58 Q22,60 19,56 Z M73,44 Q76,41 80,43 L81,56 Q78,60 74,58 Z',
  'fessiers': 'M38,62 Q50,58 62,62 L61,78 Q50,84 39,78 Z',
  'ischios': 'M38,82 Q44,80 47,84 L46,105 Q42,108 38,104 Z M53,84 Q56,80 62,82 L62,104 Q58,108 54,105 Z',
  'mollets': 'M39,110 Q43,108 46,111 L45,127 Q42,129 39,126 Z M54,111 Q57,108 61,110 L61,126 Q58,129 55,127 Z',
}
