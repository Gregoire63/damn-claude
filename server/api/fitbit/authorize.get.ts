import { defineEventHandler, getQuery, sendRedirect } from 'h3'
import { signToken } from '../../utils/vault'
import { authUrl, creds } from './_client'

/**
 * Étape 1 : on envoie l'utilisateur chez Fitbit.
 *
 * Même construction que pour Withings, et pour la même raison : l'URL de retour est
 * fabriquée ici, une seule fois. Une divergence d'un caractère entre ce qui est
 * déclaré chez Fitbit et ce qui est envoyé fait échouer l'échange, avec un message
 * qui ne dit pas lequel des deux est faux.
 */
export default defineEventHandler((event) => {
  const { clientId } = creds(event)
  const { origin, nonce } = getQuery(event) as { origin?: string, nonce?: string }
  const base = origin || getRequestURL(event).origin

  // Le `state` est signé et porte le nonce tiré par l'application : il rattache le
  // retour à la connexion qui l'a lancé, sans dépendre d'un cookie — lequel ne
  // survivrait pas au passage de la PWA à Safari (cf. callback.get).
  if (!nonce || nonce.length < 16) {
    throw createError({ statusCode: 400, statusMessage: 'Nonce manquant : relance la connexion depuis l\'application.' })
  }
  const state = signToken({ sub: 'fitbit', scope: 'oauth', nonce }, 600, Date.now())
  return sendRedirect(event, authUrl(clientId, `${base}/api/fitbit/callback`, state))
})
