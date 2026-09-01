import { Buffer } from 'node:buffer'
import { ofetch } from 'ofetch'
import { fromFitbitSeries, fromFitbitStepSeries, fromFitbitWeight } from '../../lib/providers'
import type { FitbitPoint, FitbitWeighIn } from '../../lib/providers'
import { ErreurConnecteur } from './types'
import type { Adaptateur, Identifiants, Jetons, Releve } from './types'

// Fitbit : montres, bracelets et balance Aria.
//
// ⚠️ NON VÉRIFIÉ DE BOUT EN BOUT. Les points d'entrée et les formats viennent de la
// documentation officielle (vérifiée en août 2026) et le trajet reprend celui de
// Withings, éprouvé lui. Aucun compte développeur n'était disponible pour dérouler le
// flux en vrai : le premier qui branche une vraie application doit s'attendre à
// corriger un détail, et les messages d'erreur sont écrits pour ça.
//
// ─────────────────────────────────────────────────────────────────────────────
// Pourquoi PAS de PKCE, alors que Fitbit le recommande.
// ─────────────────────────────────────────────────────────────────────────────
//
// PKCE protège un client PUBLIC — une application mobile ou un script, qui ne peut
// pas garder de secret. Ici le secret vit sur le serveur et n'atteint jamais le
// navigateur : c'est un client confidentiel, et Fitbit documente explicitement le
// flux sans PKCE pour ce cas.
//
// L'ajouter aurait même été moins sûr dans cette architecture. Le `code_verifier`
// doit être disponible au moment de l'échange, qui se fait dans le retour OAuth — un
// contexte navigateur qu'on ne choisit pas. Le seul endroit où le faire voyager
// serait le `state`, qui est signé mais LISIBLE : on publierait le verifier avec le
// code, ce qui annule exactement ce que PKCE protège.

const AUTH_URL = 'https://www.fitbit.com/oauth2/authorize'
const TOKEN_URL = 'https://api.fitbit.com/oauth2/token'
const API_URL = 'https://api.fitbit.com'

/** `weight` pour les pesées, `activity` pour les pas. Rien de plus : on ne demande
 *  pas le sommeil ni le rythme cardiaque, qu'on n'afficherait nulle part. */
const SCOPES = 'weight activity'

const JOUR = 86400
const FENETRE_JOURS = 90
/** Fitbit plafonne la plage à 1095 jours. */
const MAX_JOURS = 1095

interface JetonsBruts { access_token: string, refresh_token: string, expires_in: number, user_id?: string }

const basic = (id: string, secret: string) => `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`
const isoDe = (ms: number) => new Date(ms).toISOString().slice(0, 10)

/**
 * Contrairement à Withings, Fitbit répond avec de vrais codes HTTP — pas un 200 qui
 * cache un statut dans le corps. C'est plus simple, et il ne faut donc surtout pas
 * recopier ici la gymnastique écrite pour Withings.
 *
 * 401 : jeton mort, il faut réautoriser. 403 : le scope manque — réautoriser n'y
 * changera rien tant que l'application déclarée ne demande pas « weight » et
 * « activity ». On ne marque donc AUTH que le 401 : un 403 rangé là ferait tourner
 * en rond entre l'écran et le portail développeur.
 */
function erreur(e: unknown): ErreurConnecteur {
  const r = e as { status?: number, data?: { errors?: { message?: string }[] } }
  const statut = r.status ?? 0
  // Fitbit détaille la cause dans `errors[0].message` : la recopier évite de rendre
  // un « 400 » nu, qui n'apprend rien sur ce qu'il faut corriger.
  const detail = r.data?.errors?.[0]?.message ?? (e as Error).message
  return new ErreurConnecteur('fitbit', statut, detail, statut === 401)
}

async function jetons(ids: Identifiants, form: Record<string, string>): Promise<Jetons> {
  try {
    const t = await ofetch<JetonsBruts>(TOKEN_URL, {
      method: 'POST',
      body: new URLSearchParams({ client_id: ids.clientId, ...form }).toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': basic(ids.clientId, ids.clientSecret),
      },
    })
    return {
      acces: t.access_token,
      rafraichissement: t.refresh_token,
      expireA: Math.floor(Date.now() / 1000) + (t.expires_in || 0),
    }
  }
  catch (e) { throw erreur(e) }
}

/**
 * `Accept-Language` n'est PAS décoratif : c'est lui qui décide des UNITÉS. Sans
 * en-tête, Fitbit répond en unités américaines et les poids arrivent en livres — un
 * 91,5 kg devient 201,7, et rien dans la réponse ne dit que c'est le cas. On verrait
 * un bond de 110 kg du jour au lendemain sans comprendre.
 */
async function api<T>(chemin: string, acces: string): Promise<T> {
  try {
    return await ofetch<T>(`${API_URL}${chemin}`, {
      headers: { 'Authorization': `Bearer ${acces}`, 'Accept-Language': 'fr_FR' },
    })
  }
  catch (e) { throw erreur(e) }
}

const fitbit: Adaptateur = {
  id: 'fitbit',

  autoriser({ clientId, redirectUri, state }) {
    const u = new URL(AUTH_URL)
    u.searchParams.set('response_type', 'code')
    u.searchParams.set('client_id', clientId)
    u.searchParams.set('scope', SCOPES)
    u.searchParams.set('redirect_uri', redirectUri)
    u.searchParams.set('state', state)
    // Fitbit plafonne à 31 536 000 s (un an). Un jeton d'accès vit 8 h de toute
    // façon ; c'est le refresh_token qui compte, et il ne sert que s'il dure.
    u.searchParams.set('expires_in', '31536000')
    return u.toString()
  },

  echanger: (ids, code, redirectUri) =>
    jetons(ids, { grant_type: 'authorization_code', code, redirect_uri: redirectUri }),

  rafraichir: (ids, rafraichissement) =>
    jetons(ids, { grant_type: 'refresh_token', refresh_token: rafraichissement }),

  /**
   * TROIS appels, et pas un de plus :
   *   · la série de poids sur la période, qui donne la tendance ;
   *   · la série de pas sur la même période ;
   *   · le journal de pesées du JOUR seulement, le seul à porter la masse grasse. La
   *     demander sur trois mois coûterait quatre-vingt-dix requêtes pour un chiffre
   *     qui n'intéresse qu'au jour le jour.
   */
  async lire(_ids, acces, depuis): Promise<Releve> {
    const maintenant = Date.now()
    const jours = depuis > 0
      ? Math.min(MAX_JOURS, Math.max(1, Math.ceil((maintenant / 1000 - depuis) / JOUR)))
      : FENETRE_JOURS
    const fin = isoDe(maintenant)
    const debut = isoDe(maintenant - jours * JOUR * 1000)

    const [poids, pas] = await Promise.all([
      api<{ 'body-weight': FitbitPoint[] }>(`/1/user/-/body/weight/date/${debut}/${fin}.json`, acces),
      api<{ 'activities-steps': FitbitPoint[] }>(`/1/user/-/activities/steps/date/${debut}/${fin}.json`, acces),
    ])

    const pesees = fromFitbitSeries(poids['body-weight'] ?? [])

    // La masse grasse du jour, en complément — et sans faire échouer la synchro.
    // Toutes les balances ne la mesurent pas, et un compte sans pesée du jour rend
    // une liste vide : aucun de ces deux cas n'est une erreur.
    try {
      const log = await api<{ weight?: FitbitWeighIn[] }>(`/1/user/-/body/log/weight/date/${fin}.json`, acces)
      for (const w of log.weight ?? []) {
        const e = fromFitbitWeight(w)
        if (!e?.fatRatio) continue
        const cible = pesees.find(x => x.date === e.date)
        if (cible) cible.fatRatio = e.fatRatio
        else pesees.push(e)
      }
    }
    catch { /* pas de composition aujourd'hui : la tendance de poids suffit */ }

    return {
      pesees,
      // Zéro pas est une vraie journée, mais l'écrire écraserait l'estimation d'un
      // jour que Fitbit ne connaît simplement pas. On ne rend que le positif.
      pas: fromFitbitStepSeries(pas['activities-steps'] ?? []).filter(p => p.steps > 0),
      curseur: Math.floor(maintenant / 1000),
    }
  },
}

export default fitbit
