/**
 * Le PLAN d'un fractionné — la partie qui se calcule, sans horloge ni son.
 *
 * Elle vit dans `lib/` et pas dans le composable pour une raison précise : c'est ici
 * que se décide combien de sprints on court et dans quel ordre, et c'est donc ici
 * qu'une erreur coûte une séance. Le composable, lui, ne fait qu'égrener ce plan
 * dans le temps ; il touche à `window`, à l'audio et à la synthèse vocale, ce qui
 * l'exclut du projet de tests Node.
 */

export type PhaseKind = 'echauffement' | 'repos' | 'sprint' | 'calme'

export interface Segment {
  kind: PhaseKind
  dureeS: number
  /** Numéro du sprint (1-based), porté par le sprint et par le repos qui le suit. */
  num?: number
  /** Vrai sur le DERNIER sprint : l'annonce change, et c'est ce qui fait tenir. */
  dernier?: boolean
}

export interface Reglage {
  echauffementS: number
  reposApresS: number
  sprintS: number
  reposS: number
  sprints: number
  retourAuCalmeS: number
}

/**
 * Les valeurs par défaut sont celles d'une vraie séance, pas des chiffres ronds :
 * 3 min de course tranquille, 1 min de repos, puis 6 × (30 s / 2 min). Un défaut qui
 * ne ressemble à aucune séance se re-saisit intégralement à chaque fois — autant ne
 * rien pré-remplir du tout.
 */
export const REGLAGE_DEFAUT: Reglage = {
  echauffementS: 180,
  reposApresS: 60,
  sprintS: 30,
  reposS: 120,
  sprints: 6,
  retourAuCalmeS: 0,
}

/**
 * Les bornes ne sont pas décoratives.
 *
 * `sprints: 0` produit un plan sans le moindre effort — on lance, et le téléphone
 * annonce « terminé ». Une durée de sprint à 0 crée un segment de longueur nulle que
 * la recherche de phase traverse sans jamais l'annoncer : le bloc saute un sprint,
 * silencieusement. On borne donc à l'ENTRÉE, une fois, plutôt que de se demander à
 * dix endroits si la valeur est plausible.
 */
export const BORNES: Record<keyof Reglage, [number, number]> = {
  echauffementS: [0, 3600],
  reposApresS: [0, 1800],
  sprintS: [5, 900],
  reposS: [5, 1800],
  sprints: [1, 40],
  retourAuCalmeS: [0, 3600],
}

/** Ramène un réglage quelconque — saisi, restauré, corrompu — dans ses bornes. */
export function borner(r: Partial<Reglage> | null | undefined): Reglage {
  const out = { ...REGLAGE_DEFAUT }
  if (!r || typeof r !== 'object') return out
  for (const k of Object.keys(BORNES) as (keyof Reglage)[]) {
    const v = Number(r[k])
    if (!Number.isFinite(v)) continue
    const [min, max] = BORNES[k]
    out[k] = Math.round(Math.min(max, Math.max(min, v)))
  }
  return out
}

/**
 * Le plan complet, en segments.
 *
 * Pas de repos après le DERNIER sprint : on enchaîne sur le retour au calme s'il y
 * en a un, sinon c'est fini. Deux minutes à attendre que le téléphone dise
 * « terminé » alors qu'on a fini de courir, c'est deux minutes pendant lesquelles on
 * range son téléphone et on n'entend pas la fin.
 */
export function planDe(r: Reglage): Segment[] {
  const out: Segment[] = []
  if (r.echauffementS > 0) out.push({ kind: 'echauffement', dureeS: r.echauffementS })
  if (r.reposApresS > 0) out.push({ kind: 'repos', dureeS: r.reposApresS })
  for (let i = 1; i <= r.sprints; i++) {
    const dernier = i === r.sprints
    out.push({ kind: 'sprint', dureeS: r.sprintS, num: i, dernier })
    if (!dernier) out.push({ kind: 'repos', dureeS: r.reposS, num: i })
  }
  if (r.retourAuCalmeS > 0) out.push({ kind: 'calme', dureeS: r.retourAuCalmeS })
  return out
}

/** Durée totale du bloc, en secondes — annoncée avant de lancer. */
export function dureeTotale(r: Reglage): number {
  return planDe(r).reduce((n, s) => n + s.dureeS, 0)
}

/**
 * Bornes absolues (ms depuis le départ) de chaque segment, la première à 0.
 *
 * C'est la pièce qui rend le chrono insensible au gel de l'onglet : la phase en
 * cours se DÉDUIT du temps écoulé au lieu d'être déclenchée par un minuteur par
 * segment. Un onglet gelé trente secondes revient sur la bonne phase d'un coup.
 */
export function bornesDe(plan: Segment[]): number[] {
  const out: number[] = [0]
  let t = 0
  for (const s of plan) { t += s.dureeS * 1000; out.push(t) }
  return out
}

/** L'index du segment courant, ou `plan.length` quand le bloc est fini. */
export function segmentA(plan: Segment[], ecouleMs: number): number {
  const b = bornesDe(plan)
  for (let i = 0; i < plan.length; i++) {
    if (ecouleMs < b[i + 1]) return i
  }
  return plan.length
}

export function fmtDuree(s: number): string {
  const m = Math.floor(s / 60)
  const r = s % 60
  return m ? (r ? `${m} min ${r} s` : `${m} min`) : `${r} s`
}

export function fmtChrono(s: number): string {
  const v = Math.max(0, Math.round(s))
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`
}

export const LIBELLE_PHASE: Record<PhaseKind, string> = {
  echauffement: 'Échauffement',
  repos: 'Repos',
  sprint: 'Sprint',
  calme: 'Retour au calme',
}

/** Ce qui est annoncé au début d'une phase — le texte que la voix prononce. */
export function texteAnnonce(s: Segment): string {
  if (s.kind === 'sprint') return s.dernier ? 'Dernier sprint !' : `Sprint ${s.num} !`
  return LIBELLE_PHASE[s.kind]
}
