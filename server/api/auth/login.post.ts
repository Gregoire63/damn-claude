import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import { OWNER_SUB, origin, rpId, setSession } from './_auth'
import { SESSION_TTL, readCredentials, setCredentialCounter, signToken, verifyToken } from '../../utils/vault'

/**
 * La connexion : le téléphone signe le défi, le serveur vérifie.
 *
 * Le coffre peut contenir PLUSIEURS passkeys — le téléphone, et celui de secours
 * posé sur l'ordinateur. C'est l'authentificateur qui choisit lequel il présente,
 * et il le dit dans `response.id` : on vérifie donc contre CELUI-LÀ. Chercher au
 * hasard, ou ne regarder que le premier, ferait échouer la connexion depuis le
 * second appareil — c'est-à-dire exactement le jour où on en a besoin.
 *
 * Le compteur mérite un mot. Un authentificateur incrémente un compteur à chaque
 * signature ; s'il revient en arrière, c'est le signe d'une clé clonée. On le
 * réécrit donc à chaque connexion réussie, et une régression fait échouer la
 * vérification — c'est SimpleWebAuthn qui s'en charge, à condition qu'on lui
 * repasse la valeur mémorisée.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ response?: Record<string, unknown> }>(event)
  const creds = await readCredentials()
  if (!creds.length) throw createError({ statusCode: 404, statusMessage: 'Aucune clé d\'accès enregistrée' })

  const presente = String(body?.response?.id ?? '')
  const cred = creds.find(c => c.id === presente)
  if (!cred) throw createError({ statusCode: 401, statusMessage: 'Clé d\'accès inconnue' })

  const challenge = verifyToken(getCookie(event, 'gr-challenge'), Date.now())
  if (!challenge || challenge.scope !== 'challenge') {
    throw createError({ statusCode: 400, statusMessage: 'Demande expirée. Recommence.' })
  }

  const verification = await verifyAuthenticationResponse({
    response: body?.response as never,
    expectedChallenge: String(challenge.challenge),
    expectedOrigin: origin(event),
    expectedRPID: rpId(event),
    requireUserVerification: true,
    credential: {
      id: cred.id,
      publicKey: new Uint8Array(Buffer.from(cred.publicKey, 'base64url')),
      counter: cred.counter,
    },
  })
  if (!verification.verified) throw createError({ statusCode: 401, statusMessage: 'Signature refusée' })

  await setCredentialCounter(cred.id, verification.authenticationInfo.newCounter)
  deleteCookie(event, 'gr-challenge', { path: '/' })
  setSession(event, signToken({ sub: OWNER_SUB, scope: 'app' }, SESSION_TTL, Date.now()))
  return { ok: true }
})
