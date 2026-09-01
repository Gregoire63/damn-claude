// Import relatif : testé dans le projet « unit », qui tourne en Node pur sans la
// résolution de chemins de Nuxt.
import type { BodyEntry } from './mesures'

// ─────────────────────────────────────────────────────────────────────────────
// Les marques qui peuvent alimenter le poids et les pas.
// ─────────────────────────────────────────────────────────────────────────────
//
// Ce fichier est une liste de fiches déclaratives, et RIEN d'autre : pas d'appel
// réseau, pas de jeton, pas de DOM. Ajouter une marque, c'est ajouter une fiche ici et
// un adaptateur dans server/connecteurs/ — ni écran, ni stockage, ni calcul à toucher.
//
// La saisie à la main N'EST PAS une fiche. Elle l'a été, au motif qu'une personne sans
// objet connecté est un utilisateur normal ; mais une ligne « À la main — par défaut »
// dans une liste de marques à brancher n'apprend rien et ne se branche pas. La saisie
// vit là où l'on regarde ses mesures — Rapport → Corps —, avec la date et la masse
// grasse, et cette liste ne répond plus qu'à une question : qu'est-ce que je peux
// brancher ?
//
// Une décision vaut d'être dite, parce qu'elle se paie plus tard sinon : un
// fournisseur dont les identifiants ne sont pas configurés ne propose PAS de bouton.
// « Connecter Fitbit » qui mène à une erreur 501 est pire que rien — on croit à une
// panne, on réessaie, on cherche.

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
     * `true` = la marque veut une application déclarée chez elle, donc un identifiant et
     * un secret — posés soit dans l'application, soit chez l'hébergeur. C'est le cas de
     * toutes celles connues aujourd'hui ; le champ existe pour une source qui n'en
     * demanderait pas (un import de fichier, un service ouvert).
     *
     * On ne liste pas les NOMS des variables ici : ils se déduisent de l'identifiant
     * (`NUXT_WITHINGS_CLIENT_ID`, voir server/utils/connecteurs.ts). Les écrire à la
     * main dans chaque fiche, c'était une occasion de faute de frappe par marque, et une
     * raison de plus de toucher ce fichier en ajoutant un connecteur.
     */
    identifiants: boolean
  /**
   * Où déclarer cette application. Affiché tel quel dans l'écran de configuration :
   * chercher soi-même « portail développeur <marque> » est la première marche, et la
   * plus bête, de toutes celles qui découragent.
   */
  console?: string
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
      id: 'withings',
    icone: '⚖️',
    label: 'Withings',
    capabilities: ['poids', 'pas', 'composition'],
    identifiants: true,
    console: 'https://developer.withings.com/dashboard/',
    note: 'Balances Body, Body+, Body Scan et montres ScanWatch. Poids, masse grasse, masse maigre, hydratation et masse osseuse.',
  },
  {
    id: 'fitbit',
    icone: '⌚',
    label: 'Fitbit',
    capabilities: ['poids', 'pas'],
    identifiants: true,
    console: 'https://dev.fitbit.com/apps/new',
    note: 'Montres et bracelets Fitbit, balance Aria. Poids et pas.',
  },
    {
          id: 'polar',
          // Polar a inventé le cardiofréquencemètre de poignet : l'icône le dit, et surtout
          // elle ne se confond pas avec les deux autres montres de la liste.
          icone: '❤️',
      label: 'Polar',
      capabilities: ['poids', 'pas'],
      identifiants: true,
      console: 'https://admin.polaraccesslink.com/',
      note: 'Montres Vantage, Grit X, Pacer et Ignite, et balances Polar. Pas quotidiens et pesées.',
    },
    {
      id: 'oura',
    icone: '💍',
    label: 'Oura',
    // Une bague ne pèse pas : elle compte les pas, et c'est tout ce qu'on lui demande.
    // La liste des capacités n'est pas décorative — c'est elle qui décide de ce que
    // l'écran promet, et promettre un poids qui n'arrivera jamais est pire que se
    // taire.
    capabilities: ['pas'],
    identifiants: true,
    console: 'https://cloud.ouraring.com/oauth/applications',
    note: 'Bague Oura. Pas et activité quotidienne. Ne mesure pas le poids.',
  },
  {
    id: 'garmin',
    icone: '🧭',
    label: 'Garmin',
    capabilities: ['poids', 'pas', 'composition'],
    identifiants: true,
    console: 'https://developer.garmin.com/gc-developer-program/',
        // Vérifié en septembre 2026 : le formulaire de demande d'accès a été retiré et le
        // programme est en pause sans date de réouverture annoncée. Ce n'est pas une
        // limite de ce code — personne ne peut obtenir d'identifiants aujourd'hui.
        bloque: 'Le programme développeur Garmin est suspendu depuis 2026 : aucun identifiant ne peut être obtenu pour le moment.',
      },
      /**
       * Les deux montres qu'on demande le plus, et qu'aucune application web ne peut lire.
       *
       * Elles figurent ici POUR ÊTRE VUES. Sans elles, quelqu'un qui porte une Apple Watch
       * ouvre cet écran, ne trouve rien, et conclut que l'application ne sait pas faire —
       * ou pire, cherche une manipulation qui n'existe pas. La raison tient en une ligne,
       * elle est vérifiée, elle est datée : c'est tout ce qu'il y a à en dire.
       *
       * `identifiants: false` : il n'y a pas d'application à déclarer quelque part. Ce
       * n'est pas une question d'autorisation, c'est qu'il n'existe aucune API serveur.
       */
      {
        id: 'apple',
        icone: '🍎',
        label: 'Apple Watch',
        capabilities: ['poids', 'pas'],
        identifiants: false,
        // Vérifié en septembre 2026 : HealthKit est une API de l'appareil, réservée aux
        // applications iOS natives. Aucun serveur ne peut lire ces données, quel que soit
        // le code écrit ici.
        bloque: 'Les données de santé Apple ne sortent pas de l\'iPhone : elles ne sont lisibles que par une application iOS installée sur l\'appareil. Aucun site ne peut y accéder. Exporte-les depuis l\'app Santé, ou passe par une balance connectée.',
      },
      {
            id: 'wearos',
            icone: '🤖',
        label: 'Wear OS et Samsung',
        capabilities: ['poids', 'pas'],
        identifiants: false,
        // Vérifié en septembre 2026 : Health Connect est une base locale à Android, sans
        // API distante, et Google Fit a fermé ses API REST. Samsung Health reste un SDK
        // Android réservé à des partenaires.
        bloque: 'Ces montres écrivent dans Health Connect, une base locale à Android sans accès distant — et les API web de Google Fit ont fermé. Aucun site ne peut lire ces données.',
      },
    ]

export const providerById = (id: string): Provider | null =>
  PROVIDERS.find(p => p.id === id) ?? null

/**
 * Les fournisseurs réellement proposables sur CETTE instance.
 *
 * `configures` est la liste des marques dont le serveur a les identifiants — d'où
 * qu'ils viennent, variables d'hébergement ou coffre. Le navigateur reçoit des
 * identifiants de marque, jamais une valeur : savoir que Withings est configuré
 * n'aide personne à s'en servir.
 */
export function availableProviders(configures: string[]): Provider[] {
  const set = new Set(configures)
  return PROVIDERS.filter(p => !p.bloque && (!p.identifiants || set.has(p.id)))
}

/** Les fournisseurs qu'on montre en grisé, avec la raison. Ne rien montrer du tout
 *  ferait croire que l'application ne les connaît pas — et on irait chercher
 *  ailleurs une intégration qui n'attend qu'un formulaire. */
export function unavailableProviders(configures: string[]): { provider: Provider, raison: string }[] {
  const set = new Set(configures)
  return PROVIDERS
    .filter(p => p.bloque || (p.identifiants && !set.has(p.id)))
    .map(p => ({
      provider: p,
      raison: p.bloque ?? 'Non configuré. Déclare une application chez la marque, puis reporte son identifiant et son secret.',
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
