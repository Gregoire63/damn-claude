import { ressourceProtegee } from '../../utils/decouverte'

/**
 * « Qui protège cette ressource ? », à la racine.
 *
 * Premier maillon de la découverte OAuth du protocole MCP : un client qui reçoit un
 * 401 lit ce document pour savoir à quel serveur d'autorisation s'adresser, plutôt
 * que de le deviner ou de l'avoir codé en dur.
 *
 * La RFC 9728 attend en réalité ce document SOUS le chemin de la ressource — voir
 * le fichier voisin `oauth-protected-resource/api/mcp.get.ts`. Cette adresse-ci
 * reste servie parce qu'elle a été annoncée, et qu'un connecteur déjà installé la
 * suit.
 */
export default defineEventHandler(event => ressourceProtegee(getRequestURL(event).origin))
