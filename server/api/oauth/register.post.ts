import { grantsAccordes, inscrireClient, redirectionValide } from '../../utils/clients'
import { noteInscription } from '../../utils/trace'

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
  const demandes = Array.isArray(body.grant_types) ? body.grant_types.map(String) : []

  /*
   * On NOTE ce qu'on a reçu, avant de décider quoi que ce soit.
   *
   * Un client qui n'arrive pas à s'inscrire n'affiche jamais la raison : il dit
   * « impossible de s'inscrire » et propose de saisir un identifiant à la main. De
   * ce côté-ci, rien — ni sa requête, ni laquelle des vérifications l'a refusée.
   * `/api/vault/health` les montre maintenant, en mémoire et sans rien écrire.
   */
  const refuser = (message: string): never => {
    noteInscription({ nom: String(body.client_name ?? ''), uris: brutes, grants: demandes, clefs: Object.keys(body), issue: message.slice(0, 80) })
    throw createError({ statusCode: 400, statusMessage: message })
  }

  if (!brutes.length) refuser('invalid_redirect_uri : redirect_uris est obligatoire')
  // Une limite qui ne protège de rien coûte une inscription refusée : rien n'est
  // stocké ici, une adresse de plus n'allonge que l'identifiant rendu.
  if (brutes.length > 10) refuser('invalid_redirect_uri : dix redirections au maximum')
  const mauvaise = brutes.find(u => !redirectionValide(u))
  if (mauvaise) refuser(`invalid_redirect_uri : ${mauvaise} — il faut une adresse https sans fragment`)

  // Ce qu'on accorde face à ce qui est demandé : voir server/utils/clients.ts.
  const accordes = grantsAccordes(demandes)
  if (!accordes.length) refuser(`invalid_client_metadata : seul authorization_code est supporté (demandé : ${demandes.join(', ')})`)

  const nom = String(body.client_name ?? '').trim().slice(0, 60)
  noteInscription({ nom, uris: brutes, grants: demandes, clefs: Object.keys(body), issue: 'ok' })

  setResponseStatus(event, 201)
  return {
    client_id: inscrireClient(brutes, nom),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    /*
     * PAS de `client_secret_expires_at`.
     *
     * Il valait 0 — « n'expire jamais ». La RFC 7591 ne prévoit ce champ que
     * lorsqu'un secret est DÉLIVRÉ, et ce client public n'en reçoit aucun. Annoncer
     * l'expiration d'un secret qui n'existe pas laisse un client conformant conclure
     * qu'il en attendait un, et rejeter la réponse entière.
     */
    redirect_uris: brutes,
    grant_types: accordes,
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: 'suivi',
    ...(nom ? { client_name: nom } : {}),
  }
})
