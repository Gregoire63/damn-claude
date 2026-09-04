import { ofetch } from 'ofetch'
import { parseGroup } from '../../lib/withings'
import { parseActivity } from '../../lib/mesures'
import type { BodyEntry } from '../../lib/mesures'
import { ErreurConnecteur } from './types'
import type { Adaptateur, Identifiants, Jetons, Releve } from './types'

// Withings : balances Body et montres ScanWatch. La marque de référence de ce dépôt,
// et la seule dont le flux ait été déroulé en vrai de bout en bout.
//
// `ofetch` est importé explicitement plutôt que pris dans l'auto-import de Nitro :
// c'est ce qui permet de tester cet adaptateur en Node pur, sans serveur Nuxt.

const AUTH_URL = 'https://account.withings.com/oauth2_user/authorize2'
const TOKEN_URL = 'https://wbsapi.withings.net/v2/oauth2'
const API_URL = 'https://wbsapi.withings.net'

/** user.metrics : pesées et composition. user.activity : les pas de Health Mate. */
const SCOPES = 'user.info,user.metrics,user.activity'

/** 90 jours à la première synchro : assez pour tracer une tendance tout de suite. */
const FENETRE_S = 90 * 86400

/**
 * Statuts Withings qui parlent du JETON et de rien d'autre.
 *
 * 401 : le jeton d'accès est expiré ou révoqué — le cas normal, il vit 3 h.
 * 503 : « Invalid Params ». C'est le statut rendu par l'endpoint de jetons quand le
 *       refresh_token n'est plus valide. Attention : 503 est ici un statut WITHINGS,
 *       pas un code HTTP — Withings répond toujours 200 et met le vrai statut dans
 *       le corps. Confondre les deux envoie chercher une panne qui n'existe pas.
 */
const STATUTS_AUTH = [401, 503]

interface JetonsBruts { access_token: string, refresh_token: string, expires_in: number, userid?: number }
interface Mesures {
  updatetime: number
  timezone?: string
  measuregrps: { date: number, measures: { value: number, type: number, unit: number }[] }[]
}
interface Activite { activities: { date: string, steps?: number, distance?: number, calories?: number }[] }

/**
 * Withings renvoie TOUJOURS HTTP 200 : le vrai statut est dans `status` du corps.
 * Traiter la réponse comme réussie parce que le code HTTP est 200 fait passer les
 * erreurs de jeton pour des données vides, et le bogue devient introuvable.
 */
async function appel<T>(url: string, corps: Record<string, string>, entetes: Record<string, string> = {}): Promise<T> {
  let res: { status: number, body?: T, error?: string }
  try {
    res = await ofetch<{ status: number, body?: T, error?: string }>(url, {
      method: 'POST',
      body: new URLSearchParams(corps).toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...entetes },
    })
  }
  catch (e) {
    // Vraie panne HTTP : ni un jeton mort, ni un refus. Surtout ne pas la ranger
    // sous « auth », ce qui ferait brûler un refresh_token pour une coupure réseau.
    throw new ErreurConnecteur('withings', (e as { status?: number }).status ?? 0, (e as Error).message, false)
  }
  if (res.status !== 0) {
    throw new ErreurConnecteur('withings', res.status, res.error ?? 'erreur inconnue', STATUTS_AUTH.includes(res.status))
  }
  return res.body as T
}

const enJetons = (t: JetonsBruts): Jetons => ({
  acces: t.access_token,
  rafraichissement: t.refresh_token,
  expireA: Math.floor(Date.now() / 1000) + (t.expires_in || 0),
})

const withings: Adaptateur = {
  id: 'withings',

  autoriser({ clientId, redirectUri, state }) {
    const u = new URL(AUTH_URL)
    u.searchParams.set('response_type', 'code')
    u.searchParams.set('client_id', clientId)
    u.searchParams.set('scope', SCOPES)
    u.searchParams.set('redirect_uri', redirectUri)
    u.searchParams.set('state', state)
    return u.toString()
  },

  async echanger({ clientId, clientSecret }, code, redirectUri) {
    return enJetons(await appel<JetonsBruts>(TOKEN_URL, {
      action: 'requesttoken',
      grant_type: 'authorization_code',
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }))
  },

  async rafraichir({ clientId, clientSecret }, rafraichissement) {
    return enJetons(await appel<JetonsBruts>(TOKEN_URL, {
      action: 'requesttoken',
      grant_type: 'refresh_token',
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: rafraichissement,
    }))
  },

  async lire(_ids, acces, depuis): Promise<Releve> {
    const maintenant = Math.floor(Date.now() / 1000)
    /*
     * `depuis` a TROIS valeurs, et la confusion entre deux d'entre elles a coûté un
     * historique.
     *
     * 0 — première synchronisation : on remonte quatre-vingt-dix jours. C'est le bon
     *     défaut, personne ne veut six ans de pesées en découvrant l'application.
     * 1 — « tout récupérer », demandé explicitement : depuis l'origine des temps.
     * n — le curseur de la dernière synchronisation.
     *
     * Le mode complet envoyait 0, c'est-à-dire exactement le défaut : il redemandait
     * les quatre-vingt-dix derniers jours en promettant l'historique. Rien n'échouait,
     * rien ne le signalait — les mesures plus anciennes n'arrivaient simplement jamais.
     */
    const debut = depuis > 0 ? depuis : maintenant - FENETRE_S
    const auth = { Authorization: `Bearer ${acces}` }
    const jour = (t: number) => new Date(t * 1000).toISOString().slice(0, 10)

    const mesures = await appel<Mesures>(`${API_URL}/measure`, {
      action: 'getmeas',
      meastypes: '1,5,6,8,11,76,77,88',
      category: '1',
      lastupdate: String(debut),
    }, auth)

    // Les pas sont un bonus, les pesées sont le sujet : leur échec n'est jamais
    // bloquant. Une instance dont l'application déclarée n'a pas le scope activité
    // doit continuer à rapporter des pesées, pas rendre une erreur globale.
    const activite = await appel<Activite>(`${API_URL}/v2/measure`, {
      action: 'getactivity',
      /*
       * Les PAS, eux, restent bornés à un an — même en mode complet.
       *
       * Withings répond aux pesées sur toute la durée du compte, mais `getactivity`
       * sur cinquante ans de plage est une requête qu'aucune API n'aime, et des pas
       * d'il y a trois ans ne servent à rien ici : ils n'entrent que dans la dépense
       * du jour. Les pesées sont le sujet, les pas sont un bonus.
       */
      startdateymd: jour(Math.max(debut, maintenant - 400 * 86400)),
      enddateymd: jour(maintenant),
      data_fields: 'steps,distance,calories,totalcalories',
    }, auth).catch(() => ({ activities: [] } as Activite))

    return {
      pesees: (mesures.measuregrps ?? [])
        .map(g => parseGroup(g))
        .filter((e): e is BodyEntry => !!e),
      pas: parseActivity(activite.activities ?? []).map(a => ({ date: a.date, steps: a.steps })),
      // `updatetime` et non l'heure locale : il tient compte des mesures corrigées
      // après coup, qu'un curseur calculé ici raterait définitivement.
      curseur: mesures.updatetime || maintenant,
    }
  },
}

export default withings
