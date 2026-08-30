import { FitbitError, api, creds, refreshTokens } from './_client'
import type { Tokens } from './_client'
import { fromFitbitSeries, fromFitbitStepSeries, fromFitbitWeight } from '~/lib/providers'
import type { FitbitPoint, FitbitWeighIn } from '~/lib/providers'

/**
 * Récupère pesées et pas. Le navigateur envoie ses jetons, le serveur les rafraîchit
 * si besoin et renvoie les nouveaux : le client_secret ne sort jamais d'ici.
 *
 * Pas de base de données côté serveur : les jetons vivent dans le localStorage du
 * téléphone, comme pour Withings. C'est aussi pourquoi il n'y a pas d'abonnement aux
 * notifications Fitbit — un webhook a besoin d'un serveur qui stocke, sinon il n'a
 * personne à prévenir.
 *
 * TROIS appels, et pas un de plus :
 *   · la série de poids sur la période, qui donne la tendance ;
 *   · la série de pas sur la même période ;
 *   · le journal de pesées du JOUR seulement, qui est le seul à porter la masse
 *     grasse. La demander sur trois mois coûterait quatre-vingt-dix requêtes pour
 *     un chiffre qui n'intéresse qu'au jour le jour.
 */
interface Body {
  accessToken?: string
  refreshToken?: string
  /** Nombre de jours à redemander. Borné : Fitbit plafonne la plage à 1095 jours. */
  days?: number
}

const jour = 86400
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10)

export default defineEventHandler(async (event) => {
  // Les identifiants D'ABORD, avant de toucher au réseau. Sans ce contrôle, une
  // instance non configurée partait quand même appeler Fitbit, échouait pour une
  // raison sans rapport, et l'écran annonçait « autorisations manquantes » — on
  // serait allé chercher dans le portail développeur un problème qui était dans les
  // variables d'environnement.
  creds(event)

  const body = await readBody<Body>(event)
  if (!body?.accessToken && !body?.refreshToken) {
    throw createError({ statusCode: 400, statusMessage: 'Aucun jeton fourni : reconnecte le compte Fitbit.' })
  }

  const jours = Math.min(Math.max(Math.round(body.days ?? 90), 1), 1095)
  const fin = isoOf(Date.now())
  const debut = isoOf(Date.now() - jours * jour * 1000)

  let access = body.accessToken ?? ''
  let refreshed: Tokens | null = null

  /**
   * Un appel, et une seule reprise après rafraîchissement.
   *
   * Le jeton d'accès Fitbit vit huit heures : l'expiration est le cas NORMAL, pas
   * une erreur. Mais on ne réessaie qu'une fois — si le jeton fraîchement obtenu
   * échoue à son tour, le problème n'est pas le jeton, et boucler le masquerait.
   */
  async function lire<T>(path: string): Promise<T> {
    try {
      return await api<T>(path, access)
    }
    catch (e) {
      if (!(e instanceof FitbitError) || !e.isAuth || !body.refreshToken) throw e
      refreshed = await refreshTokens(event, body.refreshToken)
      access = refreshed.access_token
      return await api<T>(path, access)
    }
  }

  try {
    const [poids, pas] = await Promise.all([
      lire<{ 'body-weight': FitbitPoint[] }>(`/1/user/-/body/weight/date/${debut}/${fin}.json`),
      lire<{ 'activities-steps': FitbitPoint[] }>(`/1/user/-/activities/steps/date/${debut}/${fin}.json`),
    ])

    const entries = fromFitbitSeries(poids['body-weight'] ?? [])

    /**
     * La masse grasse du jour, en complément — et sans faire échouer la synchro.
     *
     * Toutes les balances ne la mesurent pas, et un compte sans pesée du jour rend
     * une liste vide. Aucun de ces deux cas n'est une erreur : on tente, et on
     * continue sans si ça ne vient pas.
     */
    try {
      const log = await lire<{ weight?: FitbitWeighIn[] }>(`/1/user/-/body/log/weight/date/${fin}.json`)
      for (const w of log.weight ?? []) {
        const e = fromFitbitWeight(w)
        if (!e?.fatRatio) continue
        const cible = entries.find(x => x.date === e.date)
        if (cible) cible.fatRatio = e.fatRatio
        else entries.push(e)
      }
    }
    catch { /* pas de composition aujourd'hui : la tendance de poids suffit */ }

    return {
      entries,
      steps: fromFitbitStepSeries(pas['activities-steps'] ?? []),
      ...(refreshed
        ? {
            tokens: {
              accessToken: (refreshed as Tokens).access_token,
              refreshToken: (refreshed as Tokens).refresh_token,
              expiresAt: Math.floor(Date.now() / 1000) + (refreshed as Tokens).expires_in,
            },
          }
        : {}),
    }
  }
  catch (e) {
    if (e instanceof FitbitError) {
      /**
       * Trois causes, trois gestes — et surtout, pas de fourre-tout.
       *
       * 403 : l'application déclarée chez Fitbit ne demande pas les bons scopes.
       *       Réautoriser n'y changera rien tant que « weight » et « activity » ne
       *       sont pas cochés dans le portail développeur.
       * 401 : le refresh_token est mort. Là, il faut vraiment réautoriser.
       * Le reste — panne, quota, coupure réseau — se rend TEL QUEL. Le ranger sous
       * l'un des deux autres enverrait chercher une autorisation dans un problème
       * qui n'en est pas un, et c'est exactement ce qui se passait ici.
       */
      if (e.status === 403) {
        throw createError({ statusCode: 403, statusMessage: 'Fitbit refuse : l\'application déclarée n\'a pas les autorisations « weight » et « activity ».' })
      }
      if (e.status === 401) {
        throw createError({ statusCode: 401, statusMessage: 'Autorisation Fitbit expirée : reconnecte le compte.' })
      }
      throw createError({ statusCode: 502, statusMessage: `Fitbit injoignable : ${e.detail.slice(0, 120)}` })
    }
    throw e
  }
})
