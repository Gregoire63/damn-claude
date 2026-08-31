import { generateAuthenticationOptions, generateRegistrationOptions } from '@simplewebauthn/server'
import { OWNER_SUB, ownerNameSync, rpId, session } from './_auth'
import { CHALLENGE_TTL, readCredentials, signToken } from '../../utils/vault'

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
  const creds = await readCredentials()
  const id = rpId(event)

  if (mode === 'register') {
    /*
     * Deux cas légitimes, et un seul refus.
     *
     * Aucun passkey : c'est l'installation, `register.post` exigera le code de
     * démarrage. Déjà connecté : c'est un passkey de SECOURS, et il ne demande
     * aucun secret — une session valide prouve déjà qu'on tient le coffre.
     *
     * Le refus, c'est le visiteur non connecté d'une instance déjà installée. Sans
     * lui, n'importe qui posant son propre passkey deviendrait propriétaire.
     */
    if (creds.length && !session(event)) {
      throw createError({ statusCode: 409, statusMessage: 'Un passkey est déjà enregistré — connecte-toi pour en ajouter un second' })
    }
    // Le nom voyage AVEC la demande de défi : la fenêtre du système l'affiche au
    // moment même où l'on pose le passkey, et il n'existe encore nulle part —
    // c'est précisément l'instant où on le déclare.
    const qui = String(nom ?? '').trim().slice(0, 40) || ownerNameSync()
    const options = await generateRegistrationOptions({
      rpName: `Damn Claude — ${qui}`,
      rpID: id,
      userID: new TextEncoder().encode(OWNER_SUB),
      userName: qui,
      attestationType: 'none',
      // Les passkeys DÉJÀ posés : sans cette liste, le même appareil en créerait un
      // second, et la sauvegarde de secours serait un doublon du téléphone.
      excludeCredentials: creds.map(c => ({ id: c.id })),
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'required', // biométrie ou code : la simple présence ne suffit pas
      },
    })
    setChallenge(event, options.challenge)
    return options
  }

  if (!creds.length) throw createError({ statusCode: 404, statusMessage: 'Aucun passkey enregistré' })
  const options = await generateAuthenticationOptions({
    rpID: id,
    // TOUS : c'est l'authentificateur qui choisit celui qu'il présente, et le
    // passkey de secours ne servirait à rien s'il n'était pas proposé.
    allowCredentials: creds.map(c => ({ id: c.id })),
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
