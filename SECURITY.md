# Sécurité

## Ce que ce projet protège, et ce qu'il ne protège pas

Van Claude est une application **mono-utilisateur auto-hébergée**. Une instance
appartient à une personne, et le modèle de menace est celui-là : un site public dont
l'accès en écriture doit rester réservé à son propriétaire.

Ce qui est en place :

- **Passkey (WebAuthn)** pour l'accès au coffre. Lié au domaine, donc non rejouable
  ailleurs. Le premier passkey exige un code de démarrage (`NUXT_VAULT_BOOTSTRAP`)
  posé en variable d'environnement.
- **OAuth 2.1 + PKCE (S256 obligatoire)** pour le connecteur MCP. Un seul client,
  dont l'identifiant et le secret sont des variables d'environnement. Pas
  d'enregistrement dynamique de client : c'est une porte de moins à surveiller pour
  un besoin qui n'existe pas ici.
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
