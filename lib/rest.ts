import type { Exercise } from '../data/sportProgram'

// ─────────────────────────────────────────────────────────────────────────────
// Combien de temps on souffle entre deux séries.
// ─────────────────────────────────────────────────────────────────────────────
//
// La règle d'origine déduisait le repos du NOMBRE DE REPS : ≤ 8 → 3 min, ≤ 12 →
// 2 min, au-delà → 1 min 15. C'est un raccourci défendable — peu de reps veut
// souvent dire lourd — mais il confond deux choses. Le nombre de reps dit la
// charge ; le repos dépend de ce que la série a COÛTÉ. Un squat et un relevé de
// jambes suspendu font tous les deux « 12 reps » et ne demandent rien de
// comparable : le premier a chargé la colonne et le souffle, le second un muscle
// de la taille d'une main.
//
// Le programme portait donc quatre décalages nets :
//   · relevés de jambes 3×12 → 2 min de repos entre des séries d'abdos ;
//   · soulevé de terre roumain 3×8-10 → 2 min, moins que le développé couché,
//     alors qu'il mobilise toute la chaîne postérieure et le bas du dos ;
//   · fentes marchées « 10/j » → lues comme 10 reps, alors qu'on en fait 20 ;
//   · curl marteau et leg curl 3×10-12 → 2 min sur de l'isolation.
//
// Et deux fragilités de lecture : la règle prend le DERNIER nombre de la chaîne.
// Sur « 7+7+7 (21) » elle attrape le 21 entre parenthèses — un total, pas une
// cible. Sur « max » elle ne trouve rien et retombe sur une valeur par défaut.
// Les deux tombaient à peu près juste, par chance.
//
// D'où `Exercise.rest` : le repos est désormais une DONNÉE du programme, réglée
// sur le mouvement. La déduction par les reps reste, en repli, pour tout ce qui
// n'est pas renseigné — une variante, un exercice ajouté plus tard.
//
// Sur le fond, la méta-analyse bayésienne de 2024 (Frontiers in Sports and Active
// Living) trouve un petit bénéfice hypertrophique au-delà de 60 s et plus de
// différence appréciable au-delà de ~90 s. Ce qui justifie encore trois minutes
// sur un squat ou un développé couché lourd, ce n'est donc pas l'hypertrophie
// directe : c'est de garder la charge et les reps sur les séries suivantes, donc
// le volume total. Là où le volume n'est pas en jeu — isolation, abdos — les
// secondes en plus n'achètent rien d'autre que de la séance.

/**
 * Repos après une série d'ÉCHAUFFEMENT. Court, mais pas nul : il faut bien le temps
 * de changer les disques, et sans décompte on traîne ou on enchaîne trop vite. Un
 * échauffement ne se récupère pas comme une série lourde — d'où les 45 secondes
 * plutôt que les deux à trois minutes d'une série de travail.
 */
export const WARMUP_REST = 45

/**
 * Repli : déduire le repos du nombre de reps, faute de mieux.
 *
 * Conservé pour les exercices sans `rest` — une variante de machine, un mouvement
 * ajouté après coup. Prend le dernier nombre de la chaîne, c'est-à-dire le haut de
 * la fourchette pour un « 8-10 ». Sans aucun chiffre (« max »), on suppose une
 * série de travail ordinaire : deux minutes.
 */
export function restFromReps(reps: string): number {
  const nums = reps.match(/\d+/g)
  const top = nums ? parseInt(nums[nums.length - 1], 10) : 12
  if (top <= 8) return 180
  if (top <= 12) return 120
  return 75
}

/**
 * Le repos prévu pour un exercice, en secondes.
 *
 * Structurel plutôt que `Exercise` complet : la fonction n'a besoin que de trois
 * champs, et `lib/` doit rester testable sans traîner tout le programme.
 *
 * La clause `temps` n'est pas un détail. « 30-40 s » passe dans `restFromReps` comme
 * s'il s'agissait de 40 répétitions, et ressort à 75 secondes — le repos d'une série
 * légère, alors qu'on vient de porter lourd sur quarante secondes. Un repos déduit
 * d'une DURÉE D'EFFORT ne veut rien dire ; on prend deux minutes, c'est-à-dire le
 * même défaut prudent que pour un « max » sans chiffre.
 *
 * Le cas ne devrait jamais se produire — `repos_s` est obligatoire à l'ajout — mais
 * c'est précisément le genre de garde qu'on est content d'avoir quand une donnée
 * arrive par un chemin qu'on n'avait pas prévu : un import, une vieille sauvegarde.
 */
export function restFor(e: Pick<Exercise, 'reps'> & { rest?: number, mesure?: 'reps' | 'temps' }): number {
  if (typeof e.rest === 'number' && e.rest > 0) return e.rest
  return e.mesure === 'temps' ? 120 : restFromReps(e.reps)
}

/** « 180 » → « 3:00 ». Le format du minuteur, pour que la carte annonce ce qu'il affichera. */
export function fmtRest(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}
