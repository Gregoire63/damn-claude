# Sécurité

## Ce que ce projet protège, et ce qu'il ne protège pas

Damn Claude est une application **mono-utilisateur auto-hébergée**. Une instance
appartient à une personne, et le modèle de menace est celui-là : un site public dont
l'accès en écriture doit rester réservé à son propriétaire.

Ce qui est en place :

- **Passkey (WebAuthn)** pour l'accès au coffre. Lié au domaine, donc non rejouable
  ailleurs. Le coffre en accepte **plusieurs** : un passkey de secours se pose depuis
  un second appareil sans aucun secret, la session en cours suffisant à prouver qu'on
  tient déjà le coffre. Chacun se révoque, sauf le dernier.
- **Un code de démarrage à usage unique**, fabriqué à chaque build et imprimé dans le
  journal de déploiement — lisible du seul propriétaire du site. Il est consommé dès
  qu'il sert : on range son empreinte, jamais sa valeur, et le réarmer suppose un
  redéploiement. Verrou de quinze minutes après cinq échecs, le bon code compris.
  Aucun secret permanent n'est nécessaire ; `NUXT_VAULT_BOOTSTRAP` reste acceptée en
  repli et constitue l'option la plus faible.
- **OAuth 2.1 + PKCE (S256 obligatoire)** pour le connecteur MCP. Les clients
  **s'inscrivent** (RFC 7591) et l'inscription est ouverte : elle ne donne rien.
  L'identifiant rendu est un jeton signé qui porte ses propres redirections — rien
  n'est stocké, donc aucune table à purger — et trois contrôles le tiennent :
  l'autorisation exige la clé d'accès du propriétaire avant de fabriquer le moindre
  code ; la redirection demandée doit être l'une de celles déclarées à l'inscription,
  donc un identifiant recopié ne peut pas détourner le code ; et le code
  d'autorisation porte le client à qui il a été remis, donc un client ne peut pas
  échanger celui d'un autre. `NUXT_MCP_CLIENT_ID` / `NUXT_MCP_CLIENT_SECRET` restent
  acceptées pour les instances installées avant, et ce chemin-là exige toujours son
  secret.
- **Jetons HMAC sans état**, avec expiration portée par le jeton. Le serveur ne
  retient rien entre deux requêtes.
- **Le connecteur n'écrit jamais.** Il dépose des propositions ; l'application les
  applique après validation explicite. Une compromission du connecteur ne modifie
  aucune donnée par elle-même.
- **Aucun secret dans le dépôt.** `.env` est ignoré, `.env.example` ne contient que
  des noms de variables.

Ce qui n'est **pas** couvert : le multi-utilisateur, l'isolation entre comptes, la
conformité réglementaire d'un service. Ce ne sont pas des manques à corriger, c'est
hors du modèle.

## Signaler une faille

N'ouvrez **pas** d'issue publique. Écrivez à l'adresse du profil GitHub
[@Gregoire63](https://github.com/Gregoire63) avec :

- ce que vous avez trouvé et où (fichier, route) ;
- comment le reproduire ;
- l'impact que vous estimez.

Réponse sous une semaine. Ce projet n'a ni programme de prime, ni SLA — c'est un
projet personnel, et la promesse est simplement de lire, de répondre et de corriger.

## Si vous hébergez votre propre instance

- Les variables d'environnement se posent **dans l'interface de l'hébergeur**, jamais
  dans un fichier commité.
- Un secret qui a été poussé une fois dans un dépôt public est compromis : effacer le
  fichier ne répare rien, seule la régénération répare.
- `GET /api/vault/health` dit quelles variables manquent, sans jamais révéler de
  valeur — des booléens de présence, rien d'autre.
- **Une seule variable est obligatoire** : `NUXT_VAULT_SECRET`. Le code de démarrage
  est fabriqué au build, et les clients OAuth s'inscrivent seuls.
