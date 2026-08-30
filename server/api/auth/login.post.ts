import { verifyAuthenticationResponse } from '@simplewebauthn/server'
import { origin, rpId, setSession } from './_auth'
import { SESSION_TTL, readCredential, signToken, verifyToken, writeCredential } from '../../utils/vault'

/**
 * La connexion : le téléphone signe le défi, le serveur vérifie.
 *
 * Le compteur mérite un mot. Un authentificateur incrémente un compteur à chaque
 * signature ; s'il revient en arrière, c'est le signe d'une clé clonée. On le
 * réécrit donc à chaque connexion réussie, et une régression fait échouer la
 * vérification — c'est SimpleWebAuthn qui s'en charge, à condition qu'on lui
 * repasse la valeur mémorisée.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ response?: Record<string, unknown> }>(event)
  const cred = await readCredential()
  if (!cred) throw createError({ statusCode: 404, statusMessage: 'Aucun passkey enregistré' })

  const challenge = verifyToken(getCookie(event, 'gr-challenge'), Date.now())
  if (!challenge || challenge.scope !== 'challenge') {
    throw createError({ statusCode: 400, statusMessage: 'Défi expiré — recommence' })
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

  await writeCredential({ ...cred, counter: verification.authenticationInfo.newCounter })
  deleteCookie(event, 'gr-challenge', { path: '/' })
  setSession(event, signToken({ sub: OWNER_SUB, scope: 'app' }, SESSION_TTL, Date.now()))
  return { ok: true }
})
