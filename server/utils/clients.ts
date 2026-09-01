import { CLIENT_TTL, signToken, verifyToken } from './vault'

/**
 * QUI a le droit de demander l'accès — et pourquoi ça ne se stocke pas.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Il n'y avait qu'un client : un identifiant et un secret posés en variables
 * d'environnement, à recopier à la main dans la fenêtre de Claude. C'est trois
 * champs à remplir pour chaque personne qui installe l'application — et un secret
 * partagé par toutes, ce qui n'a de secret que le nom.
 *
 * Le protocole prévoit mieux : un client s'INSCRIT (RFC 7591), reçoit un
 * identifiant, et il n'y a plus rien à recopier. L'obstacle habituel est le
 * stockage — un point d'inscription ouvert sur un site public écrit une ligne par
 * appel, donc il faut une limite, une purge, une surveillance.
 *
 * On n'en stocke aucune. L'identifiant EST un jeton signé qui porte ses propres
 * redirections : le serveur n'a rien à retenir, la signature le lui redit à chaque
 * fois. C'est déjà comme ça que fonctionnent les sessions et les codes de ce
 * projet, et ça garde la propriété qui compte sur des fonctions sans état.
 *
 * Ce qu'un identifiant inscrit ne donne PAS, et c'est ce qui rend l'inscription
 * ouverte acceptable :
 *
 *  · aucun accès. La page d'autorisation exige la clé d'accès du propriétaire
 *    AVANT de fabriquer le moindre code — s'inscrire ne fait que demander poliment ;
 *  · aucune liberté sur la redirection. Elle est cuite dans l'identifiant : un
 *    identifiant volé ne peut pas faire renvoyer le code ailleurs, ce qui est
 *    précisément l'attaque que l'inscription ouverte inviterait sinon.
 *
 * Le client historique, celui des variables d'environnement, continue de
 * fonctionner : une instance déjà connectée à Claude ne doit pas se déconnecter
 * parce qu'on a ajouté une porte à côté.
 */

/** L'identifiant statique, s'il y en a un. Vide sur une instance neuve. */
const statique = () => (process.env.NUXT_MCP_CLIENT_ID || '').trim()

/**
 * Fabrique l'identifiant d'un client qui vient de s'inscrire.
 *
 * Les redirections sont DANS l'identifiant, et c'est tout l'intérêt : il n'y a pas
 * de table à consulter, donc pas de table à tenir à jour.
 */
export function inscrireClient(redirections: string[], nom: string, nowMs = Date.now()): string {
  return signToken({ sub: 'client', scope: 'client', uris: redirections, nom }, CLIENT_TTL, nowMs)
}

export type VerdictClient = 'ok' | 'inconnu' | 'redirection'

/**
 * Ce client peut-il demander l'accès, et vers CETTE redirection ?
 *
 * `redirection` distingué d'`inconnu` volontairement : le premier est une erreur de
 * configuration du client, le second un identifiant qui n'a jamais existé ou dont
 * la signature ne vaut plus rien. Les deux se réparent différemment.
 */
export function verifierClient(clientId: string, redirection: string, nowMs = Date.now()): VerdictClient {
  const attendu = statique()
  // Le client des variables d'environnement : sa redirection n'a jamais été
  // déclarée nulle part, on ne peut donc pas la vérifier — c'est la faiblesse que
  // l'inscription supprime.
  if (attendu && clientId === attendu) return 'ok'

  const jeton = verifyToken(clientId, nowMs)
  if (!jeton || jeton.scope !== 'client') return 'inconnu'
  const uris = Array.isArray(jeton.uris) ? jeton.uris.map(String) : []
  return uris.includes(redirection) ? 'ok' : 'redirection'
}

/** Vrai si cet identifiant vient d'une inscription, pas des variables d'environnement. */
export const clientInscrit = (clientId: string): boolean => {
  const attendu = statique()
  return !attendu || clientId !== attendu
}

/**
 * Une redirection acceptable.
 *
 * HTTPS uniquement, et c'est ce que la page d'autorisation exigeait déjà. Une
 * redirection en clair sur un réseau qu'on ne choisit pas rendrait le code
 * d'autorisation lisible en chemin — PKCE le rattrape, mais on ne construit pas une
 * défense sur un seul filet.
 *
 * Pas de fragment : la spécification l'interdit, et un client qui en met un ne
 * recevra jamais son code.
 */
export function redirectionValide(uri: string): boolean {
  try {
    const u = new URL(uri)
    return u.protocol === 'https:' && !u.hash
  }
  catch { return false }
}

/**
 * Ce qu'on ACCORDE à un client qui s'inscrit, face à ce qu'il demande.
 *
 * On n'a jamais accordé qu'`authorization_code`. La première version REFUSAIT
 * pourtant l'inscription dès que la demande contenait autre chose — or presque tous
 * les clients demandent aussi `refresh_token`, c'est la valeur par défaut de
 * beaucoup de bibliothèques. L'inscription échouait donc avec un 400 avant même le
 * premier écran d'autorisation, pour une préférence que le client n'exigeait pas.
 *
 * La RFC 7591 dit l'inverse de ce qu'on faisait : le serveur répond avec les
 * autorisations qu'il accorde, et le client s'y tient. On ne refuse que si rien de
 * ce qui est demandé n'est réalisable.
 */
const GRANTS_SUPPORTES = ['authorization_code']

export function grantsAccordes(demandes: string[]): string[] {
  const voulus = demandes.length ? demandes : GRANTS_SUPPORTES
  return voulus.filter(g => GRANTS_SUPPORTES.includes(g))
}
