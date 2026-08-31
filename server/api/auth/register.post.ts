import { verifyRegistrationResponse } from '@simplewebauthn/server'
import { OWNER_SUB, origin, rpId, session, setSession } from './_auth'
import {
  SESSION_TTL, addCredential, brulerBootstrap, readCredentials,
  signToken, verifyToken, verifierBootstrap,
} from '../../utils/vault'

/**
 * Poser un passkey — le premier, ou un de secours.
 *
 * Deux portes, et une seule ouverte à la fois.
 *
 * **Le premier** se crée à partir de rien : c'est le seul moment qui a besoin d'un
 * secret hors-bande, le code de démarrage posé en variable d'environnement. Sans
 * lui, le premier visiteur deviendrait le propriétaire du coffre. Le code est
 * BRÛLÉ à l'usage : il ne rouvrira plus rien, et le réarmer suppose de changer la
 * variable chez l'hébergeur — donc de contrôler le déploiement.
 *
 * **Les suivants** ne demandent aucun code : ils exigent une session valide,
 * c'est-à-dire un passkey déjà en main. C'est ce qui a permis de retirer le mot de
 * passe permanent. Tant qu'il n'y en avait qu'un, perdre le téléphone imposait de
 * garder un double valide pour toujours ; avec un passkey de secours sur
 * l'ordinateur, le double n'a plus lieu d'être.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ bootstrap?: string, nom?: string, label?: string, response?: Record<string, unknown> }>(event)
  const creds = await readCredentials()
  const connecte = !!session(event)

  // La porte « secours » d'abord : une session valide se suffit à elle-même, et il
  // serait absurde d'exiger en plus un code déjà consommé.
  if (!connecte) {
    if (creds.length) throw createError({ statusCode: 409, statusMessage: 'Un passkey est déjà enregistré — connecte-toi pour en ajouter un second' })
    const verdict = await verifierBootstrap(String(body?.bootstrap ?? ''))
    if (verdict === 'absent') throw createError({ statusCode: 503, statusMessage: 'NUXT_VAULT_BOOTSTRAP non configuré' })
    if (verdict === 'verrouille') throw createError({ statusCode: 429, statusMessage: 'Trop de tentatives — réessaie dans un quart d\'heure' })
    if (verdict === 'consomme') throw createError({ statusCode: 403, statusMessage: 'Ce code de démarrage a déjà servi. Change NUXT_VAULT_BOOTSTRAP chez ton hébergeur pour en réarmer un.' })
    if (verdict !== 'ok') throw createError({ statusCode: 403, statusMessage: 'Code de démarrage invalide' })
  }

  const challenge = verifyToken(getCookie(event, 'gr-challenge'), Date.now())
  if (!challenge || challenge.scope !== 'challenge') {
    throw createError({ statusCode: 400, statusMessage: 'Défi expiré — recommence' })
  }

  const verification = await verifyRegistrationResponse({
    response: body?.response as never,
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
  const qui = String(body?.nom ?? '').trim().slice(0, 40)
  // L'étiquette dit QUEL appareil : sans elle, une liste de deux passkeys ne permet
  // pas de choisir lequel révoquer quand on en perd un.
  const ou = String(body?.label ?? '').trim().slice(0, 30)
  await addCredential({
    id: credential.id,
    publicKey: Buffer.from(credential.publicKey).toString('base64url'),
    counter: credential.counter,
    at: new Date().toISOString(),
    ...(ou ? { label: ou } : {}),
    ...(qui && !creds.length ? { ownerName: qui } : {}),
  })

  // Après le premier seulement : brûler le code sur l'ajout d'un passkey de secours
  // le consommerait sans qu'on l'ait présenté.
  if (!connecte) await brulerBootstrap()

  deleteCookie(event, 'gr-challenge', { path: '/' })
  setSession(event, signToken({ sub: OWNER_SUB, scope: 'app' }, SESSION_TTL, Date.now()))
  return { ok: true, passkeys: (await readCredentials()).length }
})
