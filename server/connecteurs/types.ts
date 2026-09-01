import type { BodyEntry } from '../../lib/mesures'

// ─────────────────────────────────────────────────────────────────────────────
// Le contrat d'un connecteur.
// ─────────────────────────────────────────────────────────────────────────────
//
// Une marque n'a que trois choses de particulier : où l'on envoie la personne pour
// autoriser, comment on échange un code contre des jetons, et à quoi ressemblent ses
// données. Tout le reste — le nonce qui survit au saut vers le navigateur système, le
// dépôt des jetons côté serveur, l'ordre entre rafraîchissement et lecture, la
// fusion dans le journal — est commun, écrit une fois, et éprouvé.
//
// D'où ce fichier. Un adaptateur ne touche NI au stockage, NI aux routes, NI à
// l'écran : il traduit, dans les deux sens, et c'est tout. Ajouter une marque, c'est
// écrire un fichier à côté de withings.ts, puis une fiche dans lib/providers.ts pour
// qu'elle apparaisse. Rien d'autre ne bouge — c'est ce que vérifie le test de
// conformité (test/unit/connecteurs.test.ts).
//
// Deux règles valent d'être dites, parce qu'elles se paient très cher sinon.
//
// La première : un adaptateur rend des `BodyEntry`, JAMAIS le JSON de la marque. Le
// premier connecteur rendait du brut et le navigateur traduisait ; la deuxième marque
// a donc dû réécrire sa propre traduction côté client, et les deux ont divergé. Ici la
// traduction se fait une fois, sur le serveur, à l'endroit où l'on sait ce qu'on lit.
//
// La seconde : un adaptateur ne lit AUCUNE variable d'environnement et n'ouvre aucune
// session. Il reçoit ses identifiants en paramètre. C'est ce qui le rend testable sans
// serveur — et ce qui permet aux identifiants de venir tantôt de l'hébergeur, tantôt
// du coffre, sans qu'il ait à le savoir.

/** Les identifiants de l'application déclarée chez la marque. */
export interface Identifiants {
  clientId: string
  clientSecret: string
}

/** Des jetons, sous une forme unique. Chaque marque nomme les siens autrement. */
export interface Jetons {
  acces: string
  rafraichissement: string
  /** epoch (s) — quand le jeton d'accès cesse d'être valable. */
  expireA: number
}

/** Ce qu'une synchronisation rapporte, une fois traduit. */
export interface Releve {
  pesees: BodyEntry[]
  /** Zéro pas est une vraie journée ; une journée inconnue n'est pas dans la liste. */
  pas: { date: string, steps: number }[]
  /**
   * Où reprendre la prochaine fois (epoch s).
   *
   * C'est la MARQUE qui le décide, pas l'application : Withings rend un `updatetime`
   * qui tient compte des mesures corrigées après coup, et repartir de l'heure locale
   * raterait une pesée révisée hier soir.
   */
  curseur: number
}

/**
 * Une erreur venue d'une marque, avec la seule distinction qui change la conduite à
 * tenir : est-ce le JETON, ou est-ce autre chose ?
 *
 * Sans ce drapeau, une coupure réseau et une autorisation révoquée se ressemblent —
 * et l'application propose « réessayer » quand il faudrait « reconnecter », ou
 * l'inverse. Pire : rafraîchir un jeton sur une simple panne le brûle pour rien, et
 * chez Withings un refresh_token brûlé condamne le compte jusqu'à reconnexion
 * manuelle. Le drapeau n'est donc pas cosmétique.
 */
export class ErreurConnecteur extends Error {
  constructor(
    readonly marque: string,
    readonly statut: number,
    readonly detail: string,
    /** Vrai quand seul un nouveau passage par l'autorisation peut réparer. */
    readonly auth = false,
  ) {
    super(`${marque} ${statut}: ${detail}`)
    this.name = 'ErreurConnecteur'
  }
}

export interface Adaptateur {
  /** Doit correspondre à l'`id` de la fiche dans lib/providers.ts. */
  id: string

  /**
   * L'URL où envoyer la personne pour qu'elle autorise. Fonction PURE : aucun appel
   * réseau ici, ce qui la rend testable en une ligne.
   *
   * `redirectUri` est fabriqué par la route, une seule fois, et doit être recopié
   * TEL QUEL dans la console de la marque — un caractère d'écart fait échouer
   * l'échange avec un message qui ne dit jamais lequel des deux est faux.
   */
  autoriser(p: { clientId: string, redirectUri: string, state: string }): string

  /** Le code d'autorisation contre un jeu de jetons. */
  echanger(ids: Identifiants, code: string, redirectUri: string): Promise<Jetons>

  /** Un jeu de jetons neuf. Beaucoup de marques invalident l'ancien au passage. */
  rafraichir(ids: Identifiants, rafraichissement: string): Promise<Jetons>

  /**
   * Les données depuis `depuis` (epoch s ; 0 = tout ce qui est raisonnable).
   *
   * Ne rafraîchit RIEN : la route s'en charge avant d'appeler, et l'ordre a son
   * importance — voir le commentaire de refresh dans la route de synchronisation.
   */
  lire(ids: Identifiants, acces: string, depuis: number): Promise<Releve>
}
