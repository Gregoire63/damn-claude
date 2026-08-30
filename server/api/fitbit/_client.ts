import { Buffer } from 'node:buffer'
import type { H3Event } from 'h3'

// Appels signés vers Fitbit. Isolés ici parce qu'ils manipulent le client_secret :
// tout ce fichier doit rester hors du bundle client.
//
// ─────────────────────────────────────────────────────────────────────────────
// Pourquoi PAS de PKCE, alors que Fitbit le recommande.
// ─────────────────────────────────────────────────────────────────────────────
//
// PKCE protège un client PUBLIC — une application mobile ou un script, qui ne peut
// pas garder de secret. Ici le secret vit dans les variables d'environnement du
// serveur et n'atteint jamais le navigateur : c'est un client confidentiel, et
// Fitbit documente explicitement le flux sans PKCE pour ce cas.
//
// L'ajouter aurait même été moins sûr dans cette architecture. Le `code_verifier`
// doit être disponible au moment de l'échange, qui se fait dans le retour OAuth —
// un contexte navigateur qu'on ne choisit pas (cf. le commentaire de callback.get).
// Le seul endroit où le faire voyager serait le `state`, qui est signé mais LISIBLE :
// on publierait le verifier avec le code, ce qui annule exactement ce que PKCE
// protège. Mieux vaut un client confidentiel assumé qu'un PKCE décoratif.

const AUTH_URL = 'https://www.fitbit.com/oauth2/authorize'
const TOKEN_URL = 'https://api.fitbit.com/oauth2/token'
const API_URL = 'https://api.fitbit.com'

/** `weight` pour les pesées, `activity` pour les pas. Rien de plus : on ne demande
 *  pas le sommeil ou le rythme cardiaque, qu'on n'afficherait nulle part. */
export const SCOPES = 'weight activity'

export interface Tokens {
  access_token: string
  refresh_token: string
  expires_in: number
  user_id?: string
}

export function creds(event: H3Event) {
  const cfg = useRuntimeConfig(event)
  const clientId = cfg.fitbit?.clientId
  const clientSecret = cfg.fitbit?.clientSecret
  if (!clientId || !clientSecret) {
    throw createError({ statusCode: 501, statusMessage: 'Fitbit non configuré : NUXT_FITBIT_CLIENT_ID et NUXT_FITBIT_CLIENT_SECRET sont requis.' })
  }
  return { clientId, clientSecret }
}

export const authUrl = (clientId: string, redirectUri: string, state: string) => {
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
}

/**
 * L'erreur porte le code HTTP, pour que l'appelant distingue un jeton mort d'une panne.
 *
 * Contrairement à Withings, Fitbit répond avec de vrais codes HTTP — pas un 200 qui
 * cache un statut dans le corps. C'est plus simple, et il ne faut donc surtout pas
 * recopier ici la gymnastique écrite pour Withings.
 */
export class FitbitError extends Error {
  constructor(readonly status: number, readonly detail: string) {
    super(`Fitbit ${status}: ${detail}`)
    this.name = 'FitbitError'
  }

  /** 401 : jeton expiré ou révoqué. 403 : le scope manque — réautoriser n'y changera
   *  rien tant que l'application déclarée ne demande pas « weight » et « activity ». */
  get isAuth() { return this.status === 401 }
}

const basic = (id: string, secret: string) => `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`

async function token(event: H3Event, form: Record<string, string>): Promise<Tokens> {
  const { clientId, clientSecret } = creds(event)
  try {
    return await $fetch<Tokens>(TOKEN_URL, {
      method: 'POST',
      body: new URLSearchParams({ client_id: clientId, ...form }).toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': basic(clientId, clientSecret),
      },
    })
  }
  catch (e) {
    const r = e as { status?: number, data?: { errors?: { message?: string }[] } }
    // Fitbit détaille la cause dans `errors[0].message` : la recopier évite de
    // renvoyer un « 400 » nu, qui n'apprend rien sur ce qu'il faut corriger.
    throw new FitbitError(r.status ?? 0, r.data?.errors?.[0]?.message ?? (e as Error).message)
  }
}

export const exchangeCode = (event: H3Event, code: string, redirectUri: string) =>
  token(event, { grant_type: 'authorization_code', code, redirect_uri: redirectUri })

export const refreshTokens = (event: H3Event, refreshToken: string) =>
  token(event, { grant_type: 'refresh_token', refresh_token: refreshToken })

/**
 * Lecture authentifiée.
 *
 * `-` désigne l'utilisateur du jeton : on n'a pas besoin de connaître son
 * identifiant Fitbit, et ne pas le manipuler évite de le stocker.
 *
 * `Accept-Language` n'est PAS décoratif : c'est lui qui décide des UNITÉS. Sans
 * en-tête, Fitbit répond en unités américaines et les poids arrivent en livres —
 * un 91,5 kg devient 201,7, et rien dans la réponse ne dit que c'est le cas. On
 * verrait un bond de 110 kg du jour au lendemain sans comprendre. `fr_FR` force le
 * système métrique.
 */
export async function api<T>(path: string, accessToken: string): Promise<T> {
  try {
    return await $fetch<T>(`${API_URL}${path}`, {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept-Language': 'fr_FR' },
    })
  }
  catch (e) {
    const r = e as { status?: number, data?: { errors?: { message?: string }[] } }
    throw new FitbitError(r.status ?? 0, r.data?.errors?.[0]?.message ?? (e as Error).message)
  }
}
