import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { ofetch } from 'ofetch'
import { ErreurConnecteur } from './types'
import type { Adaptateur, Identifiants, Jetons, Releve } from './types'
import type { BodyEntry } from '../../lib/mesures'

// Polar : montres Vantage, Grit X, Pacer, Ignite, et balances Polar.
//
// ⚠️ NON VÉRIFIÉ DE BOUT EN BOUT, septembre 2026. Sont vérifiés dans la documentation
// de Polar : les URL d'autorisation et de jetons, l'authentification Basic, la portée
// `accesslink.read_all`, l'inscription de l'utilisateur en POST /v3/users, l'adresse de
// l'API et les chemins `/v3/users/activities` et `/v3/users/physical-info`. N'ont PAS pu
// être vérifiés : le nom exact des champs dans les réponses — d'où la lecture défensive
// plus bas.
//
// ─────────────────────────────────────────────────────────────────────────────
// L'étape en plus : Polar veut qu'on INSCRIVE l'utilisateur.
// ─────────────────────────────────────────────────────────────────────────────
//
// Après l'échange du code, un `POST /v3/users` rattache le compte à l'application. Sans
// lui, toutes les lectures répondent 404 — et un 404 sur une donnée se lit comme « pas
// de données », pas comme « il manque une inscription ». C'est le genre de détail qui
// coûte une soirée.
//
// Elle se fait donc DANS `echanger`, au moment où l'on tient le jeton pour la première
// fois. Un 409 signifie « déjà inscrit » : c'est le cas normal d'une reconnexion, et il
// ne doit surtout pas faire échouer le raccordement.

const AUTH_URL = 'https://flow.polar.com/oauth2/authorization'
const TOKEN_URL = 'https://polarremote.com/v2/oauth2/token'
const API_URL = 'https://www.polaraccesslink.com'

/** La seule portée qu'AccessLink propose. */
const SCOPES = 'accesslink.read_all'

const JOUR = 86400
const FENETRE_JOURS = 90

interface JetonsBruts { access_token: string, refresh_token?: string, expires_in: number, x_user_id?: number }

const basic = (id: string, secret: string) => `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`
const isoDe = (ms: number) => new Date(ms).toISOString().slice(0, 10)
const estJour = (v: unknown): v is string => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ''))

function erreur(e: unknown): ErreurConnecteur {
  const r = e as { status?: number, data?: { message?: string } }
  const statut = r.status ?? 0
  return new ErreurConnecteur('polar', statut, r.data?.message ?? (e as Error).message, statut === 401)
}

/**
 * Polar rend du JSON ou du XML selon l'humeur de l'endpoint : `Accept` n'est pas
 * décoratif. Sans lui, on reçoit du XML qu'`ofetch` rend en chaîne, et la lecture
 * échoue sur un objet qui n'en est pas un.
 */
const api = <T>(chemin: string, acces: string) =>
  ofetch<T>(`${API_URL}${chemin}`, {
    headers: { 'Authorization': `Bearer ${acces}`, 'Accept': 'application/json' },
  }).catch((e) => { throw erreur(e) })

async function jetons(ids: Identifiants, form: Record<string, string>): Promise<JetonsBruts> {
  try {
    return await ofetch<JetonsBruts>(TOKEN_URL, {
      method: 'POST',
      body: new URLSearchParams(form).toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json;charset=UTF-8',
        'Authorization': basic(ids.clientId, ids.clientSecret),
      },
    })
  }
  catch (e) { throw erreur(e) }
}

const enJetons = (t: JetonsBruts): Jetons => ({
  acces: t.access_token,
  // AccessLink n'émet PAS de jeton de rafraîchissement : celui d'accès vit très
  // longtemps. La chaîne vide dit « rien à rafraîchir » — et la route de synchro ne
  // tentera donc jamais un rafraîchissement qui ne peut pas aboutir.
  rafraichissement: t.refresh_token ?? '',
  expireA: Math.floor(Date.now() / 1000) + (t.expires_in || 0),
})

/** Une pesée datée, à partir d'une fiche d'informations physiques. */
function peseeDe(o: Record<string, unknown>): BodyEntry | null {
  const kg = Number(o.weight)
  if (!(kg > 0)) return null
  // La date porte trois noms possibles selon les versions de l'API.
  const brut = String(o.created ?? o.date ?? o['start-time'] ?? '')
  const date = brut.slice(0, 10)
  if (!estJour(date)) return null
  return { date, at: `${date}T07:00`, kg: Math.round(kg * 100) / 100, source: 'polar' }
}

const polar: Adaptateur = {
  id: 'polar',

  autoriser({ clientId, redirectUri, state }) {
    const u = new URL(AUTH_URL)
    u.searchParams.set('response_type', 'code')
    u.searchParams.set('client_id', clientId)
    u.searchParams.set('scope', SCOPES)
    u.searchParams.set('redirect_uri', redirectUri)
    u.searchParams.set('state', state)
    return u.toString()
  },

  async echanger(ids, code, redirectUri) {
    const bruts = await jetons(ids, { grant_type: 'authorization_code', code, redirect_uri: redirectUri })
    const j = enJetons(bruts)
    try {
      await ofetch(`${API_URL}/v3/users`, {
        method: 'POST',
        body: { 'member-id': randomUUID() },
        headers: { 'Authorization': `Bearer ${j.acces}`, 'Accept': 'application/json' },
      })
    }
    catch (e) {
      // 409 : ce compte est déjà rattaché à l'application. C'est le cas normal d'une
      // reconnexion, et il ne doit pas faire échouer le raccordement.
      if ((e as { status?: number }).status !== 409) throw erreur(e)
    }
    return j
  },

  async rafraichir(ids, rafraichissement) {
    // Jamais appelé en pratique : AccessLink n'émet pas de jeton de rafraîchissement.
    // La route ne l'appelle que si le client en détient un, donc si Polar en émet un
    // jour. On l'implémente quand même — un adaptateur incomplet échouerait plus tard,
    // au pire moment.
    return enJetons(await jetons(ids, { grant_type: 'refresh_token', refresh_token: rafraichissement }))
  },

  async lire(_ids, acces, depuis): Promise<Releve> {
    const maintenant = Date.now()
    const jours = depuis > 0
      ? Math.min(365, Math.max(1, Math.ceil((maintenant / 1000 - depuis) / JOUR)))
      : FENETRE_JOURS
    const debut = isoDe(maintenant - jours * JOUR * 1000)
    const fin = isoDe(maintenant)

    /**
     * Lecture défensive de l'enveloppe : selon les endpoints, Polar rend une liste
     * nue, un objet `{ activities: [...] }` ou `{ data: [...] }`. Deviner et se
     * tromper donnerait une marque qui « ne remonte rien » sans qu'on sache pourquoi.
     */
    const liste = (r: unknown): Record<string, unknown>[] => {
      if (Array.isArray(r)) return r as Record<string, unknown>[]
      const o = (r ?? {}) as Record<string, unknown>
      for (const cle of ['activities', 'physical-informations', 'physicalInformations', 'data']) {
        if (Array.isArray(o[cle])) return o[cle] as Record<string, unknown>[]
      }
      return []
    }

    const activites = liste(await api<unknown>(
      `/v3/users/activities?from=${debut}&to=${fin}&steps=true`, acces))

    // Les pesées sont un bonus : une montre sans balance n'en rend aucune, et l'échec
    // de cet appel ne doit pas emporter les pas.
    const physiques = liste(await api<unknown>('/v3/users/physical-info', acces).catch(() => []))

    return {
      pesees: physiques.map(peseeDe).filter((e): e is BodyEntry => !!e),
      pas: activites
        .map((a) => {
          const date = String(a.date ?? a.day ?? a['created'] ?? '').slice(0, 10)
          return { date, steps: Math.round(Number(a['active-steps'] ?? a.steps ?? 0)) }
        })
        // Zéro pas est une vraie journée, mais Polar rend aussi zéro pour un jour qu'il
        // ne connaît pas — l'écrire ferait tomber la cible calorique sous l'estimation.
        .filter(p => estJour(p.date) && p.steps > 0)
        .sort((a, b) => a.date.localeCompare(b.date)),
      curseur: Math.floor(maintenant / 1000),
    }
  },
}

export default polar
