// Import relatif : testé dans le projet « unit », qui tourne en Node pur sans la
// résolution de chemins de Nuxt.
import type { BodyEntry } from './withings'

// ─────────────────────────────────────────────────────────────────────────────
// D'où viennent le poids et les pas.
// ─────────────────────────────────────────────────────────────────────────────
//
// L'application ne connaissait qu'une balance, la mienne. Ça n'a jamais été un choix :
// c'est simplement la seule que j'avais sous la main quand j'ai écrit le code. Le
// résultat, c'est qu'héberger ce dépôt sans balance Withings donnait une application
// dont deux écrans sur cinq restaient vides — sans jamais dire pourquoi.
//
// Ce fichier est la liste de ce qui peut alimenter ces deux chiffres, et RIEN d'autre :
// pas d'appel réseau, pas de jeton, pas de DOM. Un fournisseur y est une fiche
// déclarative. Ajouter une marque, c'est ajouter une fiche et une fonction de
// conversion — pas toucher à l'écran, au stockage, ni au calcul des calories.
//
// Deux décisions valent d'être dites, parce qu'elles se paient plus tard sinon.
//
// La première : « manuel » EST un fournisseur, au même rang que les autres. La
// tentation était d'en faire un cas particulier — « si aucune balance, alors afficher
// un champ ». C'est ce qui l'avait relégué au fond de l'écran Withings, où personne
// ne le trouvait. Une personne sans objet connecté est un utilisateur normal, pas une
// exception à traiter en dernier.
//
// La seconde : un fournisseur dont les identifiants ne sont pas configurés ne
// s'affiche PAS. Proposer un bouton « Connecter Fitbit » qui mène à une erreur 503
// est pire que de ne rien proposer : on croit à une panne, on réessaie, on cherche.

/** Ce qu'un fournisseur sait fournir. Le tri de l'écran s'en sert. */
export type Capability = 'poids' | 'pas' | 'composition'

export interface Provider {
  id: string
  /** Le nom que voit l'utilisateur — la marque, telle qu'elle est écrite dessus. */
  label: string
  /**
   * Le pictogramme de la liste.
   *
   * Un emoji, et pas un fichier : une liste de marques se parcourt à la forme avant
   * de se lire, et charger quatre images pour quatre lignes qu'on regarde une fois à
   * l'installation coûte plus que ça ne rapporte.
   */
  icone: string
  capabilities: Capability[]
  /**
   * `null` = rien à configurer, le fournisseur est toujours disponible.
   * Sinon, les variables d'environnement à poser pour qu'il apparaisse.
   */
  env: string[] | null
  /** Ce qu'on affiche quand le fournisseur n'est pas disponible. */
  note?: string
  /** Pourquoi il est indisponible même correctement configuré. Rare, et documenté. */
  bloque?: string
}

/**
 * Les fournisseurs connus.
 *
 * Garmin figure ici alors qu'il ne marche pas, et c'est délibéré : sans la fiche, la
 * question « et Garmin ? » se reposerait tous les six mois et il faudrait refaire la
 * recherche. Elle est faite, elle est datée, elle est écrite.
 */
export const PROVIDERS: Provider[] = [
  {
    id: 'manual',
    icone: '✍️',
    label: 'À la main',
    capabilities: ['poids', 'pas'],
    env: null,
    note: 'Aucun objet connecté. Tu saisis ton poids au réveil et tes pas si tu les connais — c\'est ce que faisaient les carnets, et ça suffit à tout calculer.',
  },
  {
    id: 'withings',
    icone: '⚖️',
    label: 'Withings',
    capabilities: ['poids', 'pas', 'composition'],
    env: ['NUXT_WITHINGS_CLIENT_ID', 'NUXT_WITHINGS_CLIENT_SECRET'],
    note: 'Balances Body / Body+ / Body Scan et montres ScanWatch. Donne aussi la masse grasse, maigre, hydrique et osseuse.',
  },
  {
    id: 'fitbit',
    icone: '⌚',
    label: 'Fitbit',
    capabilities: ['poids', 'pas'],
    env: ['NUXT_FITBIT_CLIENT_ID', 'NUXT_FITBIT_CLIENT_SECRET'],
    note: 'Montres Fitbit et balance Aria. L\'inscription développeur passe désormais par un compte Google.',
  },
  {
    id: 'garmin',
    icone: '🧭',
    label: 'Garmin',
    capabilities: ['poids', 'pas', 'composition'],
    env: ['NUXT_GARMIN_CLIENT_ID', 'NUXT_GARMIN_CLIENT_SECRET'],
    // Vérifié en août 2026 : le formulaire de demande d'accès a été retiré et le
    // programme est en pause sans date de réouverture annoncée. Ce n'est pas une
    // limite de ce code — personne ne peut obtenir d'identifiants aujourd'hui.
    bloque: 'Le programme développeur Garmin est en pause depuis 2026 : le formulaire de demande a été retiré et aucune date de réouverture n\'est annoncée. Impossible d\'obtenir des identifiants, quel que soit le code écrit ici.',
  },
]

export const providerById = (id: string): Provider | null =>
  PROVIDERS.find(p => p.id === id) ?? null

/**
 * Les fournisseurs réellement proposables sur CETTE instance.
 *
 * `configured` dit quelles variables d'environnement sont posées — le serveur le sait,
 * le navigateur ne doit pas connaître les valeurs. On ne transmet donc que des noms.
 */
export function availableProviders(configured: string[]): Provider[] {
  const set = new Set(configured)
  return PROVIDERS.filter(p => !p.bloque && (p.env === null || p.env.every(v => set.has(v))))
}

/** Les fournisseurs qu'on montre en grisé, avec la raison. Ne rien montrer du tout
 *  ferait croire que l'application ne les connaît pas. */
export function unavailableProviders(configured: string[]): { provider: Provider, raison: string }[] {
  const set = new Set(configured)
  return PROVIDERS
    .filter(p => p.bloque || (p.env !== null && !p.env.every(v => set.has(v))))
    .map(p => ({
      provider: p,
      raison: p.bloque ?? `À configurer sur l'hébergement : ${p.env!.join(', ')}.`,
    }))
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversion des charges utiles vers la forme de l'application.
// ─────────────────────────────────────────────────────────────────────────────
//
// C'est la seule partie qui change vraiment d'une marque à l'autre, et c'est du calcul
// pur : donné en entrée, testable sans réseau. Le reste du chemin — l'autorisation, le
// rafraîchissement du jeton, l'écriture dans le journal — est commun.

/** Une pesée Fitbit. `https://api.fitbit.com/1/user/-/body/log/weight/date/…`. */
export interface FitbitWeighIn {
  date: string // « 2026-08-19 »
  time?: string // « 07:12:31 »
  weight: number // kg si l'unité du compte est métrique
  fat?: number // % de masse grasse, absent si la balance ne le mesure pas
  logId?: number
}

/**
 * Fitbit → une pesée.
 *
 * Fitbit rend la date et l'heure séparément, contrairement à Withings qui donne un
 * horodatage epoch. Sans l'heure, deux pesées le même jour deviendraient la même
 * entrée : `at` doit donc rester distinct, et on retombe sur minuit faute de mieux.
 */
export function fromFitbitWeight(w: FitbitWeighIn): BodyEntry | null {
  if (!w || typeof w.weight !== 'number' || !(w.weight > 0)) return null
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(w.date))) return null
  const heure = /^\d{2}:\d{2}(:\d{2})?$/.test(String(w.time ?? '')) ? String(w.time) : '00:00:00'
  return {
    date: w.date,
    at: `${w.date}T${heure.slice(0, 5)}`,
    kg: Math.round(w.weight * 100) / 100,
    // Une masse grasse à 0 % n'existe pas : c'est le champ absent, rendu par un zéro.
    ...(typeof w.fat === 'number' && w.fat > 0 ? { fatRatio: Math.round(w.fat * 10) / 10 } : {}),
    source: 'fitbit',
  }
}

/**
 * Une série temporelle Fitbit — poids ou pas.
 *
 * `body-weight` et `activities-steps` ont la même forme, et c'est heureux : une
 * seule conversion pour les deux. Le piège est que `value` est une CHAÎNE, y compris
 * pour les pas (« 8421 »). Additionner ces chaînes donnerait « 84218421 » sans que
 * rien ne proteste — c'est le genre d'erreur qu'on ne voit qu'en regardant un total
 * de pas à sept chiffres.
 */
export interface FitbitPoint { dateTime: string, value: string | number }

const nombre = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim())
  return Number.isFinite(n) ? n : null
}
const estJour = (v: unknown): v is string => /^\d{4}-\d{2}-\d{2}$/.test(String(v))

/**
 * La série de poids Fitbit → des pesées.
 *
 * Cette série ne porte PAS la masse grasse : c'est une valeur par jour, et rien
 * d'autre. On la complète ailleurs avec le journal de pesées du jour, qui, lui, la
 * donne quand la balance sait la mesurer.
 */
export function fromFitbitSeries(points: FitbitPoint[]): BodyEntry[] {
  if (!Array.isArray(points)) return []
  const out: BodyEntry[] = []
  for (const p of points) {
    if (!p || !estJour(p.dateTime)) continue
    const kg = nombre(p.value)
    // Fitbit rend 0 pour un jour sans pesée : ce n'est pas un poids, c'est un trou.
    if (kg === null || kg <= 0) continue
    out.push({ date: p.dateTime, at: `${p.dateTime}T07:00`, kg: Math.round(kg * 100) / 100, source: 'fitbit' })
  }
  return out
}

/** La série de pas Fitbit → un nombre de pas par date. Zéro est une valeur. */
export function fromFitbitStepSeries(points: FitbitPoint[]): { date: string, steps: number }[] {
  if (!Array.isArray(points)) return []
  const out: { date: string, steps: number }[] = []
  for (const p of points) {
    if (!p || !estJour(p.dateTime)) continue
    const n = nombre(p.value)
    if (n === null || n < 0) continue
    out.push({ date: p.dateTime, steps: Math.round(n) })
  }
  return out
}

/** Le résumé d'activité Fitbit — `…/activities/date/AAAA-MM-JJ.json`. */
export interface FitbitActivity { summary?: { steps?: number } }

/** Fitbit → un nombre de pas, ou `null` s'il n'y en a pas. Zéro pas est une valeur
 *  légitime (un jour au lit) et doit se distinguer de « pas de donnée ». */
export function fromFitbitSteps(a: FitbitActivity): number | null {
  const n = a?.summary?.steps
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : null
}
