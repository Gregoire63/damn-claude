/**
 * « Qui protège cette ressource ? »
 *
 * Premier maillon de la découverte OAuth du protocole MCP : un client qui reçoit
 * un 401 lit ce document pour savoir à quel serveur d'autorisation s'adresser,
 * plutôt que de le deviner ou de l'avoir codé en dur.
 */
export default defineEventHandler((event) => {
  const base = getRequestURL(event).origin
  return {
    resource: `${base}/api/mcp`,
    authorization_servers: [base],
    scopes_supported: ['suivi'],
    bearer_methods_supported: ['header'],
  }
})
