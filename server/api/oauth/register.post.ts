import { grantsAccordes, inscrireClient, redirectionValide } from '../../utils/clients'

/**
 * L'inscription d'un client — RFC 7591.
 *
 * C'est ce que Claude tente en premier quand on lui donne l'adresse du connecteur.
 * Tant que ce point d'entrée n'existait pas, il répondait « L'enregistrement
 * automatique du client n'est pas pris en charge » et demandait un identifiant à
 * recopier depuis les variables d'hébergement. Trois champs à remplir pour chaque
 * personne qui installe l'application, et un secret identique pour toutes.
 *
 * L'inscription est OUVERTE, et ce n'est pas un oubli. Elle ne donne aucun accès :
 * la page d'autorisation exige la clé d'accès du propriétaire avant de fabriquer le
 * moindre code. S'inscrire, c'est obtenir de quoi DEMANDER — la réponse, elle, se
 * donne avec un doigt sur un capteur.
 *
 * Rien n'est stocké : l'identifiant rendu est un jeton signé qui porte ses propres
 * redirections (voir server/utils/clients.ts). Un point d'entrée ouvert qui n'écrit
 * rien n'a ni quota à tenir, ni table à purger.
 *
 * Aucun secret n'est rendu, volontairement. Ce client est PUBLIC au sens d'OAuth
 * 2.1 : il tourne dans un navigateur, il ne peut donc rien garder de secret, et
 * prétendre le contraire n'ajoute qu'un mot de passe partagé de plus. C'est PKCE
 * qui protège l'échange, et lui seul est vérifiable.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<Record<string, unknown>>(event) ?? {}

  const brutes = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : []
  if (!brutes.length) {
    throw createError({ statusCode: 400, statusMessage: 'invalid_redirect_uri : redirect_uris est obligatoire' })
  }
  if (brutes.length > 5) {
    throw createError({ statusCode: 400, statusMessage: 'invalid_redirect_uri : cinq redirections au maximum' })
  }
  const mauvaise = brutes.find(u => !redirectionValide(u))
  if (mauvaise) {
    throw createError({ statusCode: 400, statusMessage: `invalid_redirect_uri : ${mauvaise} — il faut une adresse https sans fragment` })
  }

  // Ce qu'on accorde face à ce qui est demandé : voir server/utils/clients.ts.
  const demandes = Array.isArray(body.grant_types) ? body.grant_types.map(String) : []
  const accordes = grantsAccordes(demandes)
  if (!accordes.length) {
    throw createError({
      statusCode: 400,
      statusMessage: `invalid_client_metadata : seul authorization_code est supporté (demandé : ${demandes.join(', ')})`,
    })
  }

  const nom = String(body.client_name ?? '').trim().slice(0, 60)
  const emisA = Math.floor(Date.now() / 1000)

  setResponseStatus(event, 201)
  return {
    client_id: inscrireClient(brutes, nom),
    client_id_issued_at: emisA,
    // 0 = ne expire jamais. L'identifiant n'est pas un accès : le faire expirer
    // déconnecterait un connecteur qui marche, sans rien protéger de plus.
    client_secret_expires_at: 0,
    redirect_uris: brutes,
    grant_types: accordes,
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: 'suivi',
    ...(nom ? { client_name: nom } : {}),
  }
})
