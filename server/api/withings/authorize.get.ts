import { defineEventHandler, getQuery, sendRedirect } from 'h3'
import { signToken } from '../../utils/vault'

// Étape 1 du flux OAuth2 : on envoie l'utilisateur chez Withings.
// Le client_id n'est pas secret, mais on construit l'URL côté serveur pour que
// l'application n'ait qu'une seule source de vérité sur le redirect_uri — une
// divergence d'un caractère et Withings refuse l'échange, sans expliquer pourquoi.
export default defineEventHandler((event) => {
  const cfg = useRuntimeConfig(event)
  const clientId = cfg.withings?.clientId
  if (!clientId) {
    throw createError({ statusCode: 501, statusMessage: 'Withings non configuré : NUXT_WITHINGS_CLIENT_ID manquant.' })
  }

  const { origin, nonce } = getQuery(event) as { origin?: string, nonce?: string }
  const base = origin || getRequestURL(event).origin

  /**
   * Le `state` est SIGNÉ, il n'est plus rangé dans un cookie.
   *
   * Le cookie marchait dans un navigateur ordinaire et ne pouvait pas marcher ici :
   * il était posé dans le pot de la PWA, et le retour de Withings arrive dans Safari,
   * qui a le sien. On comparait donc une valeur à rien, et ça donnait « state
   * invalide » à chaque tentative.
   *
   * Une signature HMAC ne dépend d'aucun stockage : elle voyage dans l'URL et se
   * vérifie partout. Elle porte le nonce tiré par l'application, ce qui rattache le
   * retour à la connexion qui l'a lancé, et une expiration de dix minutes.
   */
  if (!nonce || nonce.length < 16) {
    throw createError({ statusCode: 400, statusMessage: 'Nonce manquant : relance la connexion depuis l\'application.' })
  }
  const state = signToken({ sub: 'withings', scope: 'oauth', nonce }, 600, Date.now())

  const url = new URL('https://account.withings.com/oauth2_user/authorize2')
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', clientId)
  // user.metrics : pesées et composition. user.activity : les pas comptés par Health Mate.
  url.searchParams.set('scope', 'user.info,user.metrics,user.activity')
  url.searchParams.set('redirect_uri', `${base}/api/withings/callback`)
  url.searchParams.set('state', state)

  return sendRedirect(event, url.toString())
})
