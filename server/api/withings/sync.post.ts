import { WithingsError, api, refreshTokens } from './_client'
import type { Tokens } from './_client'

// Récupère pesées + activité. Le navigateur envoie ses jetons, le serveur les
// rafraîchit si besoin et renvoie les nouveaux : le client_secret ne sort jamais d'ici.
//
// Pas de base de données côté serveur : les jetons vivent dans le localStorage du
// téléphone, comme le reste de l'appli sport. C'est aussi pour ça qu'il n'y a pas de
// webhook Withings — un webhook a besoin d'un serveur qui stocke, sinon il n'a
// personne à prévenir. La synchro se fait donc à l'ouverture de l'appli, ce qui suffit
// largement pour une pesée par jour.

interface Body {
  accessToken?: string
  refreshToken?: string
  /** epoch (s) : ne redemande que ce qui est plus récent. */
  since?: number
}

interface MeasResponse {
  updatetime: number
  timezone: string
  measuregrps: { date: number, measures: { value: number, type: number, unit: number }[] }[]
}

interface ActivityResponse {
  activities: { date: string, steps?: number, distance?: number, calories?: number, totalcalories?: number }[]
}

const day = 86400
const isoOf = (t: number) => new Date(t * 1000).toISOString().slice(0, 10)

export default defineEventHandler(async (event) => {
  const body = await readBody<Body>(event)
  if (!body?.accessToken && !body?.refreshToken) {
    throw createError({ statusCode: 400, statusMessage: 'Aucun jeton fourni : reconnecte le compte Withings.' })
  }

  const nowSec = Math.floor(Date.now() / 1000)
  // 90 jours par défaut : assez pour tracer une tendance dès la première synchro.
  const since = body.since && body.since > 0 ? body.since : nowSec - 90 * day

  let access = body.accessToken ?? ''
  let renewed: Tokens | null = null
  let needsReconnect = false

  const out = (extra: Record<string, unknown>) => ({
    groups: [] as MeasResponse['measuregrps'],
    timezone: null as string | null,
    updatetime: nowSec,
    activity: [] as ActivityResponse['activities'],
    // Les jetons renouvelés repartent TOUJOURS, y compris quand la suite a échoué.
    // C'est la règle qui manquait : Withings invalide l'ancien refresh_token dès
    // qu'il en émet un nouveau, donc un jeton émis mais non transmis est un compte
    // cassé jusqu'à reconnexion manuelle. Il ne doit exister AUCUN chemin de sortie
    // qui perde `renewed`.
    tokens: renewed
      ? { accessToken: renewed.access_token, refreshToken: renewed.refresh_token, expiresIn: renewed.expires_in }
      : null,
    needsReconnect,
    error: null as string | null,
    ...extra,
  })

  /**
   * Le jeton d'accès vit 3 h. On tente, et on rafraîchit UNIQUEMENT sur une erreur
   * d'authentification.
   *
   * Le « uniquement » a son importance : la version précédente réessayait sur
   * n'importe quelle erreur. Un quota dépassé ou un réseau qui saute brûlait donc un
   * refresh_token pour rien — et comme Withings enterre l'ancien à la seconde où il
   * en émet un nouveau, une seule requête malchanceuse pouvait condamner le compte.
   */
  async function withRetry<T>(run: (token: string) => Promise<T>): Promise<T> {
    try {
      return await run(access)
    }
    catch (err) {
      if (!body.refreshToken) throw err
      if (!(err instanceof WithingsError) || !err.isAuth) throw err
      renewed = await refreshTokens(event, body.refreshToken)
      access = renewed.access_token
      return await run(access)
    }
  }

  let meas: MeasResponse
  try {
    meas = await withRetry(t => api<MeasResponse>('/measure', t, {
      action: 'getmeas',
      meastypes: '1,5,6,8,11,76,77,88',
      category: '1',
      lastupdate: String(since),
    }))
  }
  catch (err) {
    // Le refresh_token lui-même a été refusé : ça ne se répare pas ici, il faut
    // repasser par Withings. On le dit, au lieu de rendre une erreur brute que le
    // téléphone affichera sans savoir qu'un bouton « Reconnecter » existe.
    if (err instanceof WithingsError && err.isAuth) {
      needsReconnect = true
      return out({ error: 'La balance a révoqué l\'autorisation. Reconnecte le compte Withings, une fois : tes mesures déjà récupérées ne bougent pas.' })
    }
    // Toute autre panne : on rend quand même les jetons s'il y en a de neufs.
    if (renewed) return out({ error: (err as Error).message.slice(0, 160) })
    throw err
  }

  // getactivity veut des dates, pas des epochs. Son échec n'est jamais bloquant :
  // les pas sont un bonus, les pesées sont le sujet.
  const activity = await withRetry(t => api<ActivityResponse>('/v2/measure', t, {
    action: 'getactivity',
    startdateymd: isoOf(since),
    enddateymd: isoOf(nowSec),
    data_fields: 'steps,distance,calories,totalcalories',
  })).catch(() => ({ activities: [] } as ActivityResponse))

  return out({
    groups: meas.measuregrps ?? [],
    timezone: meas.timezone ?? null,
    updatetime: meas.updatetime ?? nowSec,
    activity: activity.activities ?? [],
  })
})
