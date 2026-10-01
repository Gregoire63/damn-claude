// ─────────────────────────────────────────────────────────────────────────────
// Le journal des échecs : ce que l'application n'a pas réussi à faire.
// ─────────────────────────────────────────────────────────────────────────────
//
// Une boîte de réception qui n'a pas pu être relevée affichait « Rien en attente »,
// exactement comme une boîte vide. Trois propositions ont attendu une soirée pendant
// que l'écran annonçait le calme, et personne ne pouvait le savoir : l'échec était
// avalé par un `catch` muet, au nom du « le coffre est un confort, pas une
// dépendance ». C'est vrai pour l'application. Ça ne l'est pas pour celui qui
// l'utilise.
//
// Deux lecteurs, et c'est ce qui dicte la forme :
//
//   · l'ÉCRAN, qui doit pouvoir dire « je n'ai pas pu demander » plutôt que de
//     laisser croire qu'il n'y a rien ;
//   · le MIROIR, donc Claude, qui lit le journal comme il lit le foyer ou les
//     activités, et qui peut alors expliquer un silence au lieu de le redécouvrir —
//     ou proposer de nettoyer ce que l'erreur signale.
//
// Ce qui N'Y ENTRE PAS : les refus de `localStorage` (quota plein, navigation
// privée). Ils sont déjà rattrapés là où ils arrivent, ils ne cassent rien, et les
// enregistrer noierait les trois lignes qui comptent sous trente qui ne comptent
// pas. On ne note que ce qui concerne le serveur et les propositions — c'est-à-dire
// ce qui peut mentir en silence.

/** Où ça a échoué. Court, stable, et c'est la clé de regroupement des répétitions. */
export type Poste
  = | 'boite' // relever les propositions en attente
    | 'miroir' // pousser la sauvegarde vers le coffre
    | 'session' // demander qui on est
    | 'proposition' // appliquer ou classer une proposition
    | 'connecteur' // aller chercher pesées et pas

export interface Echec {
  /** Première occurrence, en ISO. C'est la date qui situe le silence. */
  at: string
  poste: Poste
  /** Le message tel qu'il a été reçu — jamais réécrit, c'est lui qu'on diagnostique. */
  quoi: string
  /** Le code HTTP quand il y en a un : 401 et 503 ne se réparent pas pareil. */
  http?: number
  /**
   * Ce sur quoi ça portait : l'identifiant d'une proposition, un chemin de
   * correction. Sans lui, « proposition refusée » n'est pas actionnable.
   */
  sujet?: string
  /** Dernière occurrence et nombre total : voir plus bas pourquoi on regroupe. */
  dernier: string
  fois: number
}

/** Au-delà, ce n'est plus une boîte de réception d'échecs mais une archive. */
export const JOURNAL_MAX = 50
/** Un échec de plus de deux semaines ne se diagnostique plus : il se raconte. */
export const JOURNAL_JOURS = 14

const MS_PAR_JOUR = 86_400_000

/**
 * Deux échecs sont LE MÊME quand ils ont le même poste, le même message et le même
 * sujet.
 *
 * Sans ce regroupement, une veille qui échoue toutes les minutes remplit les
 * cinquante places en moins d'une heure et pousse dehors tout le reste — y compris
 * l'erreur unique et parlante qu'on cherchait. Avec, la même panne tient sur une
 * ligne qui dit « 47 fois depuis 18 h 43 », ce qui est à la fois plus court et plus
 * informatif qu'une liste de quarante-sept lignes identiques.
 */
const memeEchec = (a: Pick<Echec, 'poste' | 'quoi' | 'sujet'>, b: Pick<Echec, 'poste' | 'quoi' | 'sujet'>) =>
  a.poste === b.poste && a.quoi === b.quoi && (a.sujet ?? '') === (b.sujet ?? '')

/** Ce qu'on passe à `noterEchec` : le reste (dates, comptage) se calcule ici. */
export type EchecNouveau = Omit<Echec, 'at' | 'dernier' | 'fois'>

/**
 * Range un échec de plus, et rend la liste complète.
 *
 * Pure : la liste entre, la liste sort. Tout le reste de l'application a droit à un
 * `ref`, mais la règle d'anneau et de regroupement se teste sans navigateur, et
 * c'est elle qui décide de ce que Claude lira dans six mois.
 */
export function noterEchec(liste: Echec[], e: EchecNouveau, maintenant: string): Echec[] {
  const existant = liste.find(x => memeEchec(x, e))
  const suite = existant
    ? liste.map(x => (x === existant ? { ...x, dernier: maintenant, fois: x.fois + 1 } : x))
    : [...liste, { ...e, at: maintenant, dernier: maintenant, fois: 1 }]
  return elaguer(suite, maintenant)
}

/**
 * Jette le trop vieux, puis le trop nombreux.
 *
 * Dans cet ordre, et pas l'inverse : élaguer par l'âge d'abord libère des places
 * pour ce qui est récent. Le tri se fait sur la DERNIÈRE occurrence — une panne
 * ouverte depuis une semaine mais encore active vaut mieux qu'un incident clos
 * d'hier.
 */
export function elaguer(liste: Echec[], maintenant: string): Echec[] {
  const limite = Date.parse(maintenant) - JOURNAL_JOURS * MS_PAR_JOUR
  return liste
    .filter(e => Date.parse(e.dernier) >= limite)
    .sort((a, b) => Date.parse(a.dernier) - Date.parse(b.dernier))
    .slice(-JOURNAL_MAX)
}

/** Ne garde pas ce qui est désigné. Sert au nettoyage demandé depuis une conversation. */
export const oublierEchecs = (liste: Echec[], postes: Poste[], avant?: string): Echec[] =>
  liste.filter(e => !(postes.includes(e.poste) && (!avant || Date.parse(e.dernier) < Date.parse(avant))))

/** Lecture tolérante : un journal illisible n'a jamais empêché l'application de démarrer. */
export function lireJournal(brut: unknown): Echec[] {
  if (!Array.isArray(brut)) return []
  return brut.filter((e): e is Echec =>
    !!e && typeof e === 'object'
    && typeof (e as Echec).at === 'string'
    && typeof (e as Echec).poste === 'string'
    && typeof (e as Echec).quoi === 'string')
    .map(e => ({ ...e, dernier: e.dernier ?? e.at, fois: Number.isFinite(e.fois) ? e.fois : 1 }))
}

const LIBELLES: Record<Poste, string> = {
  boite: 'relevé de la boîte de réception',
  miroir: 'envoi de la sauvegarde au coffre',
  session: 'vérification de la session',
  proposition: 'application d\'une proposition',
  connecteur: 'relevé des pesées et des pas',
}

/** La phrase qu'on montre, et celle que Claude lit. Même source, pas deux vocabulaires. */
export const libellePoste = (p: Poste): string => LIBELLES[p] ?? p
