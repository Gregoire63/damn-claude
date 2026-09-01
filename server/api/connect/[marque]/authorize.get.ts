import { defineEventHandler, getQuery, sendRedirect } from 'h3'
import { signToken } from '../../../utils/vault'
import { identifiantsOuRefus, marqueDe, urlRetour } from './_commun'

/**
 * Étape 1 : on envoie la personne chez la marque.
 *
 * Le `state` est SIGNÉ, il n'est pas rangé dans un cookie. Le cookie marchait dans un
 * navigateur ordinaire et ne pouvait pas marcher ici : il était posé dans le pot de la
 * PWA, et le retour arrive dans Safari, qui a le sien. On comparait donc une valeur à
 * rien, et ça donnait « state invalide » à chaque tentative.
 *
 * Une signature HMAC ne dépend d'aucun stockage : elle voyage dans l'URL et se vérifie
 * partout. Elle porte le nonce tiré par l'application — ce qui rattache le retour à la
 * connexion qui l'a lancé — et une expiration de dix minutes.
 */
export default defineEventHandler(async (event) => {
  const a = marqueDe(event)
  const { clientId } = await identifiantsOuRefus(a)
  const { origin, nonce } = getQuery(event) as { origin?: string, nonce?: string }
  const base = origin || getRequestURL(event).origin

  if (!nonce || nonce.length < 16) {
    throw createError({ statusCode: 400, statusMessage: 'Requête incomplète. Relance la connexion depuis l\'application.' })
  }
  const state = signToken({ sub: a.id, scope: 'oauth', nonce }, 600, Date.now())
  return sendRedirect(event, a.autoriser({ clientId, redirectUri: urlRetour(base, a.id), state }))
})
