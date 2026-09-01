// Le journal des mesures corporelles, et ce qu'on en déduit.
//
// Pur : aucun appel réseau, aucun DOM, aucune marque. Ce fichier ne connaît ni
// Withings ni Fitbit — il connaît des pesées, qui portent leur provenance. C'est
// ce qui permet à une deuxième marque d'écrire dans le MÊME historique plutôt que
// de s'en construire un à côté : deux séries du même poids, et la courbe en
// choisirait une pendant que le métabolisme de base prendrait l'autre.
//
// Le décodage propre à une marque vit dans `lib/<marque>.ts` et dans son adaptateur
// `server/connecteurs/<marque>.ts`. Rien de tout cela ne remonte ici.
//
// Dans lib/ et non utils/ : Nuxt auto-importe tout utils/, et ces symboles n'ont
// aucune raison d'atterrir dans l'espace de noms global de l'application.

/** Une pesée, telle qu'on la conserve. Tout est optionnel sauf la date et le poids. */
export interface BodyEntry {
  date: string // ISO court
  at: string // ISO complet, pour distinguer deux pesées le même jour
  kg: number
  fatRatio?: number // %
  fatMass?: number // kg
  muscleMass?: number // kg
  waterMass?: number // kg
  boneMass?: number // kg
  leanMass?: number // kg
  heartRate?: number
  /**
   * D'où vient la pesée : l'identifiant d'un fournisseur de `lib/providers.ts`, ou
   * « manual ».
   *
   * Une chaîne libre, et pas une union fermée. L'union obligeait à modifier CE
   * fichier — le modèle de données — pour ajouter une marque, alors qu'une marque
   * n'est qu'une source de plus. Le test de conformité vérifie que chaque
   * fournisseur déclaré donne bien une source valide ; la provenance, elle, se
   * relit des mois plus tard, quand un chiffre surprend.
   */
  source: string
  /** Pesée trop éloignée de la tendance : probablement quelqu'un d'autre. Écartée des stats. */
  suspect?: boolean
  /** « C'est bien moi » : lève la quarantaine définitivement. */
  confirmed?: boolean
}

/** Trie, déduplique par horodatage et garde l'ordre chronologique. */
export function mergeEntries(existing: BodyEntry[], incoming: BodyEntry[]): BodyEntry[] {
  const byAt = new Map<string, BodyEntry>()
  for (const e of existing) byAt.set(e.at, e)
  // Les nouvelles écrasent les anciennes : une re-synchronisation corrige une mesure révisée.
  for (const e of incoming) byAt.set(e.at, e)
  return [...byAt.values()].sort((a, b) => a.at.localeCompare(b.at))
}

/** Pas quotidiens renvoyés par `measure – getactivity`. */
export interface ActivityDay { date: string, steps: number, distance?: number, calories?: number }

export function parseActivity(rows: { date: string, steps?: number, distance?: number, calories?: number }[]): ActivityDay[] {
  return rows
    .filter(r => typeof r.steps === 'number' && r.steps >= 0)
    .map(r => ({ date: r.date, steps: Math.round(r.steps!), distance: r.distance, calories: r.calories }))
    .sort((a, b) => a.date.localeCompare(b.date))
}

// ─── Quarantaine : la balance s'est trompée de personne ─────────────────────

/**
 * Écart toléré par rapport à la tendance, en kilos.
 *
 * Une balance partagée reconnaît l'utilisateur au poids : deux personnes proches
 * peuvent être confondues, et la mesure part alors dans le mauvais compte. Aucun
 * réglage d'API ne corrige ça — c'est une erreur commise avant l'envoi.
 *
 * 3 kg : au-delà, ce n'est physiologiquement plus la même personne d'un jour à
 * l'autre. Le corps varie de 1 à 2 kg par jour (sel, glycogène, transit,
 * hydratation), jamais de trois.
 */
export const SUSPECT_BASE_KG = 3
/** Tolérance ajoutée par jour sans pesée : trois semaines d'absence, ça bouge vraiment. */
export const SUSPECT_PER_DAY = 0.15
/** Plafond : au-delà, on redemande confirmation quoi qu'il arrive. */
export const SUSPECT_MAX_KG = 8

export function suspectThreshold(gapDays: number): number {
  return Math.min(SUSPECT_MAX_KG, SUSPECT_BASE_KG + Math.max(0, gapDays) * SUSPECT_PER_DAY)
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const daysBetween = (a: string, b: string) =>
  Math.abs(new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86400000

/**
 * Marque les pesées trop éloignées de la tendance. On compare à la MÉDIANE des trois
 * dernières pesées retenues, pas à la précédente : sinon une seule mesure aberrante
 * déplace la référence et fait passer toutes les suivantes — les vraies — pour
 * suspectes à leur tour.
 *
 * Rien n'est supprimé : la pesée est mise de côté, affichée, et l'utilisateur tranche.
 * Écarter en silence une vraie pesée serait pire que le problème traité.
 */
export function flagOutliers(entries: BodyEntry[]): BodyEntry[] {
  const sorted = [...entries].sort((a, b) => a.at.localeCompare(b.at))
  const accepted: BodyEntry[] = []
  return sorted.map((e) => {
    // Une saisie manuelle vient de l'utilisateur : elle n'est jamais mise en doute.
    if (e.confirmed || e.source === 'manual' || accepted.length < 2) {
      accepted.push(e)
      return { ...e, suspect: false }
    }
    const ref = median(accepted.slice(-3).map(a => a.kg))
    const gap = daysBetween(accepted.at(-1)!.date, e.date)
    if (Math.abs(e.kg - ref) > suspectThreshold(gap)) return { ...e, suspect: true }
    accepted.push(e)
    return { ...e, suspect: false }
  })
}

/** Les pesées en quarantaine, à faire trancher. */
export const suspectsOf = (entries: BodyEntry[]) => flagOutliers(entries).filter(e => e.suspect)

// ─── Statistiques corporelles ───────────────────────────────────────────────

/**
 * Le poids d'un jour ne veut rien dire : sel, glycogène, transit et hydratation le
 * font varier d'un kilo d'un jour à l'autre. Seule la moyenne glissante est lisible,
 * et c'est elle qu'il faut regarder pour décider quoi que ce soit.
 */
export const SMOOTH_DAYS = 7

export interface Point { date: string, value: number, avg?: number }

/**
 * Une valeur par jour (la dernière pesée du jour), puis moyenne glissante.
 * Les pesées en quarantaine sont exclues : une mesure appartenant à quelqu'un d'autre
 * fausserait la moyenne pendant sept jours et la pente pendant deux semaines.
 */
export function dailySeries(entries: BodyEntry[], key: keyof BodyEntry = 'kg'): Point[] {
  const byDay = new Map<string, number>()
  for (const e of flagOutliers(entries)) {
    if (e.suspect) continue
    const v = e[key]
    if (typeof v === 'number' && v > 0) byDay.set(e.date, v)
  }
  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  return days.map(([date, value], i) => {
    const window = days.slice(Math.max(0, i - SMOOTH_DAYS + 1), i + 1)
    const avg = window.reduce((n, [, v]) => n + v, 0) / window.length
    return { date, value: Math.round(value * 100) / 100, avg: Math.round(avg * 100) / 100 }
  })
}

/** Pente d'une série, en unité par semaine, par régression linéaire sur les derniers jours. */
export function weeklySlope(points: Point[], days = 14): number | null {
  const pts = points.slice(-days).filter(p => p.avg !== undefined)
  if (pts.length < 4) return null
  const t0 = new Date(pts[0].date + 'T00:00:00').getTime()
  const xs = pts.map(p => (new Date(p.date + 'T00:00:00').getTime() - t0) / 86400000)
  const ys = pts.map(p => p.avg!)
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  const den = xs.reduce((a, x) => a + (x - mx) ** 2, 0)
  if (!den) return null
  const slope = xs.reduce((a, x, i) => a + (x - mx) * (ys[i] - my), 0) / den
  return Math.round(slope * 7 * 1000) / 1000
}

export type LossQuality = 'unknown' | 'good' | 'mixed' | 'poor'

/**
 * Au-delà de deux mois, un taux de masse grasse ne dit plus rien du corps
 * d'aujourd'hui : à 0,5 kg de perte par semaine, deux mois valent 4 kg.
 */
export const COMP_MAX_AGE_DAYS = 60

/** Un taux de masse grasse exploitable. Hors de ces bornes, la balance s'est trompée. */
const usableFat = (e: BodyEntry) => typeof e.fatRatio === 'number' && e.fatRatio >= 3 && e.fatRatio <= 70

export interface CarriedComp {
  kg: number
  fatRatio?: number
  fatMass?: number
  leanMass?: number
  /** Date de la mesure de composition retenue, `null` si aucune n'est exploitable. */
  measuredOn: string | null
  /** Vrai quand le taux vient d'une pesée ANTÉRIEURE à celle qui donne le poids. */
  carried: boolean
}

/**
 * Le poids le plus récent, associé au taux de masse grasse le plus récent qui existe.
 *
 * Le piège que ça évite : une balance sans impédance, ou une pesée notée à la main
 * sans le pourcentage, ferait retomber la cible protéique sur le poids de corps du
 * jour au lendemain — une vingtaine de grammes de protéines en plus d'un coup, pour
 * une composition qui n'a pas bougé d'un pouce.
 *
 * On garde donc le POIDS de la dernière pesée et le TAUX de la dernière pesée qui en
 * avait un. Le poids fluctue au jour le jour (eau, sel, transit), le taux évolue en
 * semaines : les mélanger dans ce sens-là est le bon compromis, l'inverse serait faux.
 *
 * On ne reporte QUE le pourcentage, jamais la masse grasse ni la masse maigre en
 * kilos : celles-là appartiennent à la pesée qui les a mesurées, et les recopier
 * fabriquerait une composition qui n'a jamais existé. Elles se recalculent depuis le
 * taux et le poids du jour.
 *
 * Passé `maxAgeDays`, on cesse de reporter et on laisse la cible retomber sur le
 * poids de corps — qui surestime. C'est délibéré : en déficit, une cible protéique
 * trop haute coûte des calories, une cible trop basse coûte du muscle.
 */
export function carriedComp(entries: BodyEntry[], maxAgeDays = COMP_MAX_AGE_DAYS): CarriedComp | null {
  const last = entries.at(-1)
  if (!last) return null
  if (usableFat(last)) {
    return {
      kg: last.kg,
      fatRatio: last.fatRatio,
      fatMass: last.fatMass,
      leanMass: last.leanMass,
      measuredOn: last.date,
      carried: false,
    }
  }
  const source = [...entries].reverse().find(usableFat)
  if (!source) return { kg: last.kg, measuredOn: null, carried: false }
  const ageDays = Math.round(
    (Date.parse(`${last.date}T00:00:00Z`) - Date.parse(`${source.date}T00:00:00Z`)) / 86400000,
  )
  if (ageDays > maxAgeDays) return { kg: last.kg, measuredOn: null, carried: false }
  return { kg: last.kg, fatRatio: source.fatRatio, measuredOn: source.date, carried: true }
}

export interface Composition {
  days: number
  kg: number // variation de poids
  fat: number | null // variation de masse grasse
  lean: number | null // variation de masse maigre
  fatShare: number | null // part de la perte qui vient du gras (0 → 1)
  quality: LossQuality
  advice: string
}

/** Au-delà de cette part de masse maigre perdue, le déficit est trop agressif. */
export const LEAN_LOSS_ALERT = 0.35

/**
 * Ce que vaut vraiment la perte : combien vient du gras, combien du muscle.
 * C'est le seul apport réel d'une balance à impédancemétrie — le poids seul ne
 * distingue pas les deux, et c'est pourtant toute la question en déficit.
 */
export function composition(entries: BodyEntry[], days = 28): Composition {
  const withFat = entries.filter(e => typeof e.fatMass === 'number')
  const kgSeries = dailySeries(entries, 'kg')
  const kgDelta = kgSeries.length >= 2
    ? Math.round((kgSeries.at(-1)!.avg! - kgSeries[Math.max(0, kgSeries.length - days)].avg!) * 100) / 100
    : 0

  if (withFat.length < 4) {
    return {
      days,
      kg: kgDelta,
      fat: null,
      lean: null,
      fatShare: null,
      quality: 'unknown',
      advice: 'Il faut quelques pesées avec mesure de composition pour dire si tu perds du gras ou du muscle. La balance s\'en charge dès qu\'elle est en place.',
    }
  }

  const fatSeries = dailySeries(withFat, 'fatMass')
  const leanSeries = dailySeries(withFat, 'leanMass')
  const delta = (s: Point[]) => (s.length >= 2
    ? Math.round((s.at(-1)!.avg! - s[Math.max(0, s.length - days)].avg!) * 100) / 100
    : null)

  const fat = delta(fatSeries)
  const lean = delta(leanSeries)

  if (fat === null || lean === null || Math.abs(fat) + Math.abs(lean) < 0.2) {
    return { days, kg: kgDelta, fat, lean, fatShare: null, quality: 'unknown', advice: 'Variations encore trop faibles pour conclure. Laisse passer deux semaines de plus.' }
  }

  // Part de la perte imputable au gras. Négatif = on a pris du gras.
  const totalLoss = -(fat + lean)
  const fatShare = totalLoss > 0 ? Math.max(0, Math.min(1, -fat / totalLoss)) : null

  let quality: LossQuality = 'unknown'
  let advice = ''
  if (fatShare === null) {
    quality = 'unknown'
    advice = 'Le poids ne baisse pas sur la période : rien à décomposer pour l\'instant.'
  }
  else if (fatShare >= 1 - LEAN_LOSS_ALERT + 0.1) {
    quality = 'good'
    advice = `${Math.round(fatShare * 100)} % de ce que tu perds est du gras. C'est exactement ce qu'on cherche : ne change rien.`
  }
  else if (fatShare >= 1 - LEAN_LOSS_ALERT) {
    quality = 'mixed'
    advice = `${Math.round(fatShare * 100)} % de gras dans la perte : correct, mais la masse maigre commence à payer. Vérifie que les protéines sont bien à 2 g par kilo et que les charges montent encore.`
  }
  else {
    quality = 'poor'
    advice = `Seulement ${Math.round(fatShare * 100)} % de la perte vient du gras : tu perds trop de muscle. Remonte de 150 à 200 kcal par jour et garde le même volume de séances — descendre plus bas ne ferait qu'aggraver ça.`
  }

  return { days, kg: kgDelta, fat, lean, fatShare, quality, advice }
}

/**
 * L'impédancemétrie grand public se trompe facilement de 3 à 5 points sur le
 * pourcentage absolu de masse grasse. La TENDANCE, elle, reste exploitable — à
 * condition de se peser dans les mêmes conditions, ce que dit ce rappel.
 */
export const IMPEDANCE_CAVEAT
  = 'Le pourcentage absolu affiché par une balance à impédancemétrie peut se tromper de 3 à 5 points : ne le prends pas au pied de la lettre. C\'est son évolution qui compte, et elle n\'est fiable que si tu te pèses toujours dans les mêmes conditions — le matin, à jeun, après être passé aux toilettes, avant de boire.'
