import { ressourceProtegee } from '../../../../utils/decouverte'

/**
 * Le MÊME document, à l'adresse que la RFC 9728 prescrit vraiment.
 *
 * Pour une ressource `https://exemple.fr/api/mcp`, le segment bien-connu s'insère
 * entre l'hôte et le chemin : `/.well-known/oauth-protected-resource/api/mcp`. Un
 * client qui applique la règle tombait sur un 404 et en concluait que ce serveur
 * n'expose aucune découverte — donc pas d'inscription automatique de client. Le
 * message affiché parlait alors d'identifiant à saisir à la main, ce qui ne
 * ressemble en rien à la cause.
 */
export default defineEventHandler(event => ressourceProtegee(getRequestURL(event).origin))
