/**
 * Ce que ce serveur sait faire, en OAuth 2.1.
 *
 * `code` + PKCE uniquement : pas de flux implicite, pas de mot de passe échangé.
 * L'enregistrement dynamique de client n'est pas exposé — il n'y a qu'un client,
 * celui du connecteur, dont l'identifiant et le secret sont posés en variables
 * d'environnement puis recopiés une fois dans la fenêtre de Claude. Un point
 * d'entrée d'inscription ouvert sur un site public serait une porte de plus à
 * surveiller pour un besoin qui n'existe pas ici.
 */
export default defineEventHandler((event) => {
  const base = getRequestURL(event).origin
  return {
    issuer: base,
    authorization_endpoint: `${base}/api/oauth/authorize`,
    token_endpoint: `${base}/api/oauth/token`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none'],
    scopes_supported: ['suivi'],
  }
})
