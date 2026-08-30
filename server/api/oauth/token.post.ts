import { createHash, timingSafeEqual } from 'node:crypto'
import { ACCESS_TTL, signToken, verifyToken } from '../../utils/vault'
import { OWNER_SUB } from '../auth/_auth'

/**
 * L'échange du code contre un jeton d'accès.
 *
 * Trois vérifications, et chacune ferme une attaque précise :
 *
 *  • le `client_secret`, pour qu'un client qui ne serait pas le connecteur ne
 *    puisse pas se présenter ici ;
 *  • le `code_verifier` (PKCE), pour qu'un code intercepté dans la redirection soit
 *    inutilisable sans le secret gardé par le client d'origine ;
 *  • l'`redirect_uri`, qui doit être celle pour laquelle le code a été émis, sinon
 *    un client malveillant pourrait faire renvoyer le code ailleurs.
 *
 * Le code lui-même est un jeton signé de deux minutes : rien à stocker, rien à
 * nettoyer, et il expire tout seul.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, string>>(event)
  const form = body ?? {}
  if (form.grant_type !== 'authorization_code') {
    throw createError({ statusCode: 400, statusMessage: 'unsupported_grant_type' })
  }

  const expectedId = (process.env.NUXT_MCP_CLIENT_ID || '').trim()
  const expectedSecret = (process.env.NUXT_MCP_CLIENT_SECRET || '').trim()
  if (!expectedId || !expectedSecret) {
    throw createError({ statusCode: 503, statusMessage: 'Client MCP non configuré' })
  }
  if (form.client_id !== expectedId || !safeEqual(form.client_secret ?? '', expectedSecret)) {
    throw createError({ statusCode: 401, statusMessage: 'invalid_client' })
  }

  const code = verifyToken(form.code, Date.now())
  if (!code || code.scope !== 'code') throw createError({ statusCode: 400, statusMessage: 'invalid_grant' })
  if (form.redirect_uri && form.redirect_uri !== code.redirectUri) {
    throw createError({ statusCode: 400, statusMessage: 'redirect_uri_mismatch' })
  }

  const verifier = form.code_verifier ?? ''
  const computed = createHash('sha256').update(verifier).digest('base64url')
  if (!verifier || !safeEqual(computed, String(code.challenge))) {
    throw createError({ statusCode: 400, statusMessage: 'invalid_grant (PKCE)' })
  }

  return {
    access_token: signToken({ sub: OWNER_SUB, scope: 'suivi' }, ACCESS_TTL, Date.now()),
    token_type: 'Bearer',
    expires_in: ACCESS_TTL,
    scope: 'suivi',
  }
})

/** Comparaison à temps constant : `===` s'arrête au premier octet différent et
 *  laisse deviner le secret, octet par octet. */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}
