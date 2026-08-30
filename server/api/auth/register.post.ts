import { verifyRegistrationResponse } from '@simplewebauthn/server'
import { origin, rpId, setSession } from './_auth'
import { SESSION_TTL, readCredential, signToken, verifyToken, writeCredential } from '../../utils/vault'

/**
 * Le tout premier passkey.
 *
 * C'est le seul moment où une identité se crée à partir de rien, donc le seul
 * endroit qui a besoin d'un secret hors-bande : un code de démarrage, posé en
 * variable d'environnement, connu du seul propriétaire du site. Sans lui, le
 * premier visiteur du portfolio deviendrait le propriétaire du coffre.
 *
 * Après cet appel, l'enregistrement se referme : il n'y a qu'un passkey, et
 * `challenge.post` refuse d'en proposer un second.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ bootstrap?: string, nom?: string, response?: Record<string, unknown> }>(event)
  const expected = (process.env.NUXT_VAULT_BOOTSTRAP || '').trim()
  if (!expected) throw createError({ statusCode: 503, statusMessage: 'NUXT_VAULT_BOOTSTRAP non configuré' })
  if (!body?.bootstrap || body.bootstrap !== expected) {
    throw createError({ statusCode: 403, statusMessage: 'Code de démarrage invalide' })
  }
  if (await readCredential()) throw createError({ statusCode: 409, statusMessage: 'Un passkey est déjà enregistré' })

  const challenge = verifyToken(getCookie(event, 'gr-challenge'), Date.now())
  if (!challenge || challenge.scope !== 'challenge') {
    throw createError({ statusCode: 400, statusMessage: 'Défi expiré — recommence' })
  }

  const verification = await verifyRegistrationResponse({
    response: body.response as never,
    expectedChallenge: String(challenge.challenge),
    expectedOrigin: origin(event),
    expectedRPID: rpId(event),
    requireUserVerification: true,
  })
  if (!verification.verified || !verification.registrationInfo) {
    throw createError({ statusCode: 400, statusMessage: 'Enregistrement refusé' })
  }

  const { credential } = verification.registrationInfo
  // Le nom est rangé AVEC le passkey : c'est la même chose qu'on déclare — à qui
  // appartient cette instance. Vide, l'instance reste anonyme et fonctionne.
  const qui = String(body.nom ?? '').trim().slice(0, 40)
  await writeCredential({
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    at: new Date().toISOString(),
    ...(qui ? { ownerName: qui } : {}),
  })
  deleteCookie(event, 'gr-challenge', { path: '/' })
  setSession(event, signToken({ sub: OWNER_SUB, scope: 'app' }, SESSION_TTL, Date.now()))
  return { ok: true }
})
