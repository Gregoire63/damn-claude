// Import relatif : testé dans le projet « unit », qui tourne en Node pur sans la
// résolution de chemins de Nuxt.

// ─────────────────────────────────────────────────────────────────────────────
// LA pesée courante. Une seule façon de la trouver.
// ─────────────────────────────────────────────────────────────────────────────
//
// Il y en avait cinq, réparties dans autant d'écrans, et elles ne disaient pas toutes
// la même chose. Trois triaient les pesées par date avant de prendre la plus récente ;
// deux prenaient le DERNIER ÉLÉMENT DU TABLEAU — ce qui revient au même tant que le
// tableau est trié, et ne revient plus au même dès qu'il ne l'est plus.
//
// Or il ne l'est pas toujours. `setWeight` trie après chaque ajout, donc l'usage
// quotidien tient. Mais l'import d'une sauvegarde JSON, la restauration de
// l'instantané de secours et la reprise d'un miroir écrivent le tableau TEL QUEL,
// sans le retrier. Il suffit d'une pesée rattrapée après coup — une date d'hier
// ajoutée aujourd'hui — pour que le tableau cesse d'être trié.
//
// Ce jour-là, l'écran des réglages annonce un poids, l'écran du jour un autre, et
// c'est le métabolisme de base qui diverge : la cible calorique de la journée est
// calculée sur une pesée, la corpulence affichée sur une autre. Rien ne plante, rien
// ne s'affiche en rouge. On mange simplement à côté pendant des semaines.
//
// D'où ce fichier : deux fonctions, qui trient toutes les deux, et que personne n'a
// de raison de réécrire.

export interface Weighing { date: string, kg: number }

/** Les pesées du plus ancien au plus récent, sans toucher au tableau d'origine. */
const chronologique = <T extends Weighing>(entries: T[]): T[] =>
  [...entries].sort((a, b) => a.date.localeCompare(b.date))

/**
 * La pesée la plus récente, en date — celle du matin.
 *
 * `null` sans aucune pesée : mieux vaut ne rien afficher qu'un poids inventé, dont
 * découleraient un métabolisme, une cible calorique et une cible protéique tout
 * aussi inventés.
 */
export function latestWeight(entries: Weighing[]): number | null {
  const kept = entries.filter(e => typeof e?.kg === 'number' && e.kg > 0 && typeof e?.date === 'string')
  if (!kept.length) return null
  return chronologique(kept).at(-1)!.kg
}

/**
 * Le poids connu le plus proche d'une date, sans jamais regarder après elle.
 *
 * C'est ce qui permet de relire une séance de mars avec le poids de mars : sur les
 * exercices au poids du corps, la charge soulevée est le poids de CE jour-là, pas
 * celui d'aujourd'hui. Prendre le poids actuel ferait apparaître une progression
 * ou une régression qui n'est que la variation de la balance.
 *
 * Avant la première pesée, on rend la plus ancienne connue plutôt que `null` : une
 * séance sans poids du tout ne peut rien afficher, alors qu'un poids approché de
 * quelques kilos reste lisible — et c'est signalé par `exact`.
 */
export function weightOn(entries: Weighing[], iso: string): { kg: number, exact: boolean } | null {
  const kept = chronologique(entries.filter(e => typeof e?.kg === 'number' && e.kg > 0))
  if (!kept.length) return null
  const avant = kept.filter(e => e.date <= iso)
  if (avant.length) return { kg: avant.at(-1)!.kg, exact: true }
  return { kg: kept[0].kg, exact: false }
}
