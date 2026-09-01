import { createHash, timingSafeEqual } from 'node:crypto'
import { ACCESS_TTL, signToken, verifyToken } from '../../utils/vault'
import { OWNER_SUB } from '../auth/_auth'
import { clientInscrit, verifierClient } from '../../utils/clients'

/**
 * L'échange du code contre un jeton d'accès.
 *
 * Trois vérifications, et chacune ferme une attaque précise :
 *
 *  • l'identité du client — son secret pour celui des variables d'environnement,
 *    la signature du code pour un client inscrit, qui n'en a pas ;
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

  const clientId = String(form.client_id ?? '')
  const expectedId = (process.env.NUXT_MCP_CLIENT_ID || '').trim()
  const expectedSecret = (process.env.NUXT_MCP_CLIENT_SECRET || '').trim()

  /*
   * Deux sortes de clients, deux preuves différentes.
   *
   * Celui des variables d'environnement présente son secret : c'est le client
   * historique, et une instance déjà branchée à Claude ne doit pas se déconnecter
   * parce qu'on a ouvert une porte à côté.
   *
   * Un client INSCRIT n'a pas de secret, et ce n'est pas un manque : il tourne dans
   * un navigateur, il ne peut rien garder de secret, et lui en donner un ne ferait
   * qu'ajouter un mot de passe partagé de plus. Ce qui le prouve, c'est que le code
   * lui a été REMIS À LUI — la signature du code porte son identifiant — et qu'il
   * détient le `code_verifier` de PKCE. Les deux sont vérifiables ; un secret
   * recopié dans mille installations ne l'est pas.
   */
  const inscrit = clientInscrit(clientId)
  if (!inscrit) {
    if (!expectedSecret) throw createError({ statusCode: 503, statusMessage: 'Client MCP non configuré' })
    if (clientId !== expectedId || !safeEqual(form.client_secret ?? '', expectedSecret)) {
      throw createError({ statusCode: 401, statusMessage: 'invalid_client' })
    }
  }

  const code = verifyToken(form.code, Date.now())
  if (!code || code.scope !== 'code') throw createError({ statusCode: 400, statusMessage: 'invalid_grant' })
  // Le code appartient au client à qui il a été remis. Sans ce contrôle, un client
  // inscrit pourrait échanger le code d'un autre — le secret partagé jouait ce rôle
  // pour le client historique, il n'y a plus de secret ici.
  if (code.clientId !== undefined && code.clientId !== clientId) {
    throw createError({ statusCode: 400, statusMessage: 'invalid_grant (client)' })
  }
  if (inscrit && verifierClient(clientId, String(code.redirectUri ?? '')) !== 'ok') {
    throw createError({ statusCode: 401, statusMessage: 'invalid_client' })
  }
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
