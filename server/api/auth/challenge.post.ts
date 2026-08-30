import { generateAuthenticationOptions, generateRegistrationOptions } from '@simplewebauthn/server'
import { OWNER_SUB, ownerNameSync, rpId, session } from './_auth'
import { CHALLENGE_TTL, readCredential, signToken } from '../../utils/vault'

/**
 * Le défi, et pourquoi il repart dans un cookie signé.
 *
 * WebAuthn tient sur une garantie simple : le serveur envoie une valeur aléatoire,
 * le téléphone la signe, le serveur vérifie que c'est bien CETTE valeur qui a été
 * signée. Une signature interceptée ne peut donc pas être rejouée.
 *
 * Il faut donc se souvenir du défi entre l'aller et le retour. Une table de
 * sessions serait la façon classique ; ici il n'y a pas de base, et surtout les
 * fonctions sont sans état — la requête de retour peut atterrir sur une autre
 * instance. Le défi voyage donc dans un cookie SIGNÉ, à durée de vie courte :
 * l'appelant le porte sans pouvoir le forger.
 */
export default defineEventHandler(async (event) => {
  const { mode, nom } = await readBody<{ mode?: 'register' | 'login', nom?: string }>(event) ?? {}
  const cred = await readCredential()
  const id = rpId(event)

  if (mode === 'register') {
    // Un seul passkey. Une fois posé, l'enregistrement est CLOS : sans cela,
    // n'importe qui passant sur le portfolio pourrait s'en créer un.
    if (cred) throw createError({ statusCode: 409, statusMessage: 'Un passkey est déjà enregistré' })
    // Le nom voyage AVEC la demande de défi : la fenêtre du système l'affiche au
    // moment même où l'on pose le passkey, et il n'existe encore nulle part —
    // c'est précisément l'instant où on le déclare.
    const qui = String(nom ?? '').trim().slice(0, 40) || ownerNameSync()
    const options = await generateRegistrationOptions({
      rpName: `Van Claude — ${qui}`,
      rpID: id,
      userID: new TextEncoder().encode(OWNER_SUB),
      userName: qui,
      attestationType: 'none',
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required', // biométrie ou code : la simple présence ne suffit pas
      },
    })
    setChallenge(event, options.challenge)
    return options
  }

  if (!cred) throw createError({ statusCode: 404, statusMessage: 'Aucun passkey enregistré' })
  const options = await generateAuthenticationOptions({
    rpID: id,
    allowCredentials: [{ id: cred.id }],
    userVerification: 'required',
  })
  setChallenge(event, options.challenge)
  return options
})

function setChallenge(event: Parameters<typeof setCookie>[0], challenge: string) {
  const token = signToken({ sub: 'challenge', scope: 'challenge', challenge }, CHALLENGE_TTL, Date.now())
  setCookie(event, 'gr-challenge', token, {
    httpOnly: true, secure: !import.meta.dev, sameSite: 'lax', path: '/', maxAge: CHALLENGE_TTL,
  })
}
