/**
 * Le document « qui protège cette ressource » — RFC 9728.
 *
 * Écrit une seule fois, servi à DEUX adresses, et c'est tout l'objet de ce fichier.
 *
 * La RFC ne met pas ce document à la racine quand la ressource a un CHEMIN : pour
 * `https://exemple.fr/api/mcp`, elle insère le segment bien-connu entre l'hôte et le
 * chemin, ce qui donne `/.well-known/oauth-protected-resource/api/mcp`. On ne le
 * servait qu'à la racine — un client qui applique la règle à la lettre tombait donc
 * sur un 404, et concluait que le serveur n'expose aucune découverte, donc pas
 * d'inscription automatique de client. Le message qu'il affiche alors parle
 * d'identifiant à saisir à la main, et n'a plus aucun rapport avec la cause.
 *
 * On garde l'adresse racine : c'est celle que l'en-tête `WWW-Authenticate` annonçait
 * jusqu'ici, et un connecteur déjà installé la suit.
 */
export const ressourceProtegee = (base: string) => ({
  resource: `${base}/api/mcp`,
  authorization_servers: [base],
  scopes_supported: ['suivi'],
  bearer_methods_supported: ['header'],
})
