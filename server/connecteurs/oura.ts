import { Buffer } from 'node:buffer'
import { ofetch } from 'ofetch'
import { ErreurConnecteur } from './types'
import type { Adaptateur, Identifiants, Jetons, Releve } from './types'

// Oura : la bague. Troisième marque, et la preuve que le raccord ne suppose pas une
// balance — celle-ci ne pèse rien du tout.
//
// ⚠️ NON VÉRIFIÉ DE BOUT EN BOUT, août 2026. Sont vérifiés dans la documentation
// d'Oura : les URL d'autorisation et de jetons, la liste des portées, l'adresse de
// l'API v2 et le fait que `daily_activity` porte les pas. N'a PAS pu être vérifié : le
// nom exact du champ de date dans chaque enregistrement — d'où la lecture défensive
// plus bas, qui accepte les trois formes plausibles plutôt que de parier sur une.
//
// ─────────────────────────────────────────────────────────────────────────────
// Pourquoi Oura ne rend AUCUNE pesée.
// ─────────────────────────────────────────────────────────────────────────────
//
// La portée `personal` donne un poids. C'est celui que la personne a tapé dans
// l'application Oura, une fois, il y a peut-être deux ans : une valeur de profil, sans
// date et sans historique. L'enregistrer comme une pesée du jour fabriquerait une
// mesure qui n'a jamais eu lieu — et elle irait nourrir le métabolisme de base et la
// courbe de poids, où plus rien ne la distinguerait d'une vraie.
//
// La bague ne pèse pas. On demande donc la seule portée qui serve — `daily` — et on
// rend `pesees: []`. C'est aussi ce que raconte sa fiche : `capabilities: ['pas']`, et
// l'écran affiche « pas » sans promettre autre chose. Une marque n'a pas à tout
// fournir pour valoir la peine d'être branchée.

const AUTH_URL = 'https://cloud.ouraring.com/oauth/authorize'
const TOKEN_URL = 'https://api.ouraring.com/oauth/token'
const API_URL = 'https://api.ouraring.com/v2'

/** `daily` couvre les résumés quotidiens, dont l'activité. Rien d'autre n'est demandé :
 *  ni le sommeil, ni la fréquence cardiaque, qu'on n'afficherait nulle part. */
const SCOPES = 'daily'

const JOUR = 86400
const FENETRE_JOURS = 90

interface JetonsBruts { access_token: string, refresh_token: string, expires_in: number }
interface Activite {
  data?: { day?: string, summary_date?: string, timestamp?: string, steps?: number }[]
}

const basic = (id: string, secret: string) => `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`
const isoDe = (ms: number) => new Date(ms).toISOString().slice(0, 10)

function erreur(e: unknown): ErreurConnecteur {
  const r = e as { status?: number, data?: { detail?: string } }
  const statut = r.status ?? 0
  // 401 : le jeton est mort. 403 : la portée manque — réautoriser n'y changera rien
  // tant que l'application déclarée ne demande pas « daily ». Les confondre ferait
  // tourner en rond entre l'écran et la console développeur.
  return new ErreurConnecteur('oura', statut, r.data?.detail ?? (e as Error).message, statut === 401)
}

async function jetons(ids: Identifiants, form: Record<string, string>): Promise<Jetons> {
  try {
    const t = await ofetch<JetonsBruts>(TOKEN_URL, {
      method: 'POST',
      body: new URLSearchParams(form).toString(),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        // Oura accepte les identifiants dans le corps OU en Basic. On prend Basic :
        // un secret dans un corps de requête finit dans les journaux d'accès de tout
        // ce qui passe entre les deux, un en-tête d'autorisation non.
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

const oura: Adaptateur = {
  id: 'oura',

  autoriser({ clientId, redirectUri, state }) {
    const u = new URL(AUTH_URL)
    u.searchParams.set('response_type', 'code')
    u.searchParams.set('client_id', clientId)
    u.searchParams.set('scope', SCOPES)
    u.searchParams.set('redirect_uri', redirectUri)
    u.searchParams.set('state', state)
    return u.toString()
  },

  echanger: (ids, code, redirectUri) =>
    jetons(ids, { grant_type: 'authorization_code', code, redirect_uri: redirectUri }),

  rafraichir: (ids, rafraichissement) =>
    jetons(ids, { grant_type: 'refresh_token', refresh_token: rafraichissement }),

  async lire(_ids, acces, depuis): Promise<Releve> {
    const maintenant = Date.now()
    const jours = depuis > 0
      ? Math.min(365, Math.max(1, Math.ceil((maintenant / 1000 - depuis) / JOUR)))
      : FENETRE_JOURS
    const params = new URLSearchParams({
      start_date: isoDe(maintenant - jours * JOUR * 1000),
      end_date: isoDe(maintenant),
    })

    let r: Activite
    try {
      r = await ofetch<Activite>(`${API_URL}/usercollection/daily_activity?${params}`, {
        headers: { Authorization: `Bearer ${acces}` },
      })
    }
    catch (e) { throw erreur(e) }

    return {
      pesees: [],
      pas: (r.data ?? [])
        .map((j) => {
          // Lecture défensive : la documentation consultée ne fixe pas le nom du champ
          // de date de façon certaine. Deviner et se tromper donnerait des journées
          // « undefined » silencieusement écartées — et une marque qui « ne remonte
          // rien » sans qu'on sache pourquoi.
          const date = j.day ?? j.summary_date ?? (j.timestamp ?? '').slice(0, 10)
          return { date, steps: Math.round(j.steps ?? 0) }
        })
        .filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p.date) && p.steps > 0)
        .sort((a, b) => a.date.localeCompare(b.date)),
      curseur: Math.floor(maintenant / 1000),
    }
  },
}

export default oura
