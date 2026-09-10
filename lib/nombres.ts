// ─────────────────────────────────────────────────────────────────────────────
// Arrondir ce qui va se lire.
// ─────────────────────────────────────────────────────────────────────────────
//
// Un nombre calculé n'a aucune raison de tomber juste. Une médiane de médianes, une
// moyenne, un rapport entre deux charges : la division rend ce qu'elle rend, et
// `String(n)` le recopie jusqu'à la dernière décimale que la machine sait écrire.
// On lit alors « tu en fais 7.6249999999999996 reps en médiane », et le chiffre perd
// exactement ce qui faisait son intérêt — être lisible d'un coup d'œil.
//
// Deux causes, et la seconde surprend toujours :
//
//  1. la division elle-même — 22 / 3 n'a pas de fin ;
//  2. la représentation binaire des décimaux. `0.1 + 0.2` vaut
//     `0.30000000000000004`, et aucune division n'est en cause. Un simple cumul de
//     grammages suffit à faire apparaître une queue de décimales.
//
// D'où la règle du dépôt : **tout nombre calculé qui part vers un écran ou vers un
// message s'arrondit à sa sortie**, pas au milieu du calcul. Arrondir en cours de
// route ferait dériver le résultat ; arrondir à la fin ne change que ce qu'on lit.
//
// Deux décimales est le pas retenu partout : c'est le centième de kilo, le centime,
// et le coefficient de machine. En dessous, la précision affichée serait une
// promesse que la mesure ne tient pas — une balance de salle ne pèse pas le
// milligramme.

/** Le pas d'arrondi par défaut : le centième. */
export const DECIMALES = 2

/**
 * Arrondit à `decimales` chiffres après la virgule.
 *
 * `Number.EPSILON` corrige le cas de bord classique : `1.005 * 100` vaut
 * `100.49999999999999` en binaire, donc `Math.round` rendrait `1` au lieu de `1.01`.
 * Le décalage est infime et ne change rien aux valeurs qui tombent juste.
 */
export function arrondi(n: number, decimales = DECIMALES): number {
  if (!Number.isFinite(n)) return n
  const p = 10 ** decimales
  return Math.round((n + Number.EPSILON * Math.sign(n) * Math.abs(n)) * p) / p
}
