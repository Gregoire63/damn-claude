/**
 * Ce que ce serveur sait faire, en OAuth 2.1.
 *
 * `code` + PKCE uniquement : pas de flux implicite, pas de mot de passe échangé.
 *
 * `registration_endpoint` est ce que Claude lit en premier. Sans lui, il annonce
 * « L'enregistrement automatique du client n'est pas pris en charge » et réclame un
 * identifiant à recopier depuis les variables d'hébergement — trois champs pour
 * chaque personne qui installe l'application, et un secret partagé par toutes.
 * L'inscription ne donne aucun accès : voir server/api/oauth/register.post.ts.
 */
export default defineEventHandler((event) => {
  const base = getRequestURL(event).origin
  return {
    issuer: base,
    authorization_endpoint: `${base}/api/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    registration_endpoint: `${base}/api/oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    scopes_supported: ['suivi'],
  }
})
