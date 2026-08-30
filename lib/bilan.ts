// Import relatif et non par alias : testé dans le projet « unit », qui tourne en
// Node pur sans la résolution de chemins de Nuxt.

// ─────────────────────────────────────────────────────────────────────────────
// La tendance de poids, telle qu'on a le droit de la lire.
// ─────────────────────────────────────────────────────────────────────────────
//
// C'est la partie du bilan qui contient un vrai calcul, donc la seule qui mérite
// des tests. Le reste — la séance du jour, les plats prévus — n'est qu'une lecture
// du miroir, vérifiable d'un coup d'œil.
//
// Deux décisions y sont prises, et aucune n'est neutre.

export interface Weighing { date?: string, kg?: number }

/**
 * La dernière pesée à cette date ou avant. `null` s'il n'y en a aucune AVANT.
 *
 * `bodyWeightAt` dans useWorkout se rabat, lui, sur la toute première pesée connue —
 * ce qui est le bon choix là-bas : afficher un poids approximatif vaut mieux qu'un
 * tiret dans une fiche de séance. Ici ce serait une faute. Comparer le poids
 * d'aujourd'hui à celui d'il y a trente jours en prenant, faute de mieux, la
 * première pesée du carnet, c'est fabriquer un écart de plusieurs kilos qui ne
 * mesure que l'ancienneté du carnet. On préfère ne rien dire.
 */
export function weightNear(list: Weighing[], iso: string): number | null {
  let best: { date: string, kg: number } | null = null
  for (const w of list) {
    if (typeof w.date !== 'string' || typeof w.kg !== 'number') continue
    if (w.date > iso) continue
    if (!best || w.date > best.date) best = { date: w.date, kg: w.kg }
  }
  return best?.kg ?? null
}

/** Décalage de jours sur une date ISO, en UTC pour ignorer les changements d'heure. */
export function shiftDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export interface WeightTrend {
  dernier: { date: string, kg: number } | null
  variation_7j: number | null
  variation_30j: number | null
  rythme: { kg_par_semaine: number, sur_jours: number } | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

/**
 * Variations et rythme hebdomadaire.
 *
 * Le rythme se lit sur la PLUS LONGUE fenêtre disponible. Sur sept jours, une
 * rétention d'eau après une séance de jambes pèse autant que la graisse perdue dans
 * la semaine : le chiffre part dans un sens ou dans l'autre sans que rien n'ait
 * changé, et il invite à corriger les calories pour du bruit. Trente jours lissent
 * ça. La fenêtre est rendue avec le chiffre — un rythme sans sa fenêtre ne veut rien
 * dire, et c'est ce qui permet de savoir combien on peut s'y fier.
 */
export function weightTrend(list: Weighing[], iso: string): WeightTrend {
  const valides = list.filter((w): w is { date: string, kg: number } =>
    typeof w.date === 'string' && typeof w.kg === 'number')
  const dernier = weightNear(valides, iso)
  const derniere = valides.filter(w => w.date <= iso).sort((a, b) => a.date.localeCompare(b.date)).at(-1) ?? null

  const delta = (n: number) => {
    const avant = weightNear(valides, shiftDays(iso, -n))
    // Une seule pesée rendrait `avant === dernier` et donc une variation de 0 —
    // « stable » alors qu'on ne sait rien. On exige deux dates distinctes.
    if (dernier === null || avant === null || !derniere || derniere.date === weighingDateAt(valides, shiftDays(iso, -n))) return null
    return round2(dernier - avant)
  }

  const v7 = delta(7)
  const v30 = delta(30)
  const rythme = v30 !== null
    ? { kg_par_semaine: round2(v30 / 30 * 7), sur_jours: 30 }
    : (v7 !== null ? { kg_par_semaine: v7, sur_jours: 7 } : null)

  return { dernier: derniere, variation_7j: v7, variation_30j: v30, rythme }
}

/** La DATE de la pesée retenue par `weightNear`, pour repérer qu'on compare une
 *  valeur à elle-même. */
function weighingDateAt(list: { date: string, kg: number }[], iso: string): string | null {
  let best: { date: string, kg: number } | null = null
  for (const w of list) {
    if (w.date > iso) continue
    if (!best || w.date > best.date) best = w
  }
  return best?.date ?? null
}
