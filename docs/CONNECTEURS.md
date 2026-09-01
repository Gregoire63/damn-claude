# Ajouter un connecteur

Une balance, une montre, une bague : tout ce qui sait rendre un **poids** ou des
**pas** peut alimenter cette application. Ce document décrit le chemin complet, de la
création de l'application chez la marque jusqu'au test qui refuse un adaptateur
incomplet.

Compte une heure si l'API de la marque est documentée. L'essentiel du temps passe chez
elle, pas ici.

---

## Ce qui existe déjà, et que tu n'as pas à réécrire

Le trajet OAuth de cette application a été écrit contre une vraie balance, et il porte
plusieurs corrections que rien ne laisse deviner tant qu'on ne s'est pas fait avoir :

- **Le nonce qui survit au saut de navigateur.** Une application posée sur l'écran
  d'accueil qui part autoriser sort de son contexte : iOS ouvre Safari, et le retour
  atterrit là. Les jetons sont donc déposés côté serveur et l'application vient les
  chercher avec un nonce qu'elle a tiré avant de partir.
- **Le rafraîchissement AVANT la lecture.** Beaucoup de marques invalident l'ancien
  jeton de rafraîchissement à la seconde où elles en émettent un nouveau. Rafraîchir au
  milieu d'une synchro et échouer ensuite condamne le compte, définitivement.
- **La quarantaine des pesées aberrantes**, le miroir vers le journal des séances, la
  règle du jour en cours révisé seulement vers le haut.

Tout cela est commun. Un adaptateur ne le voit même pas.

---

## 1. Chez la marque

Crée une application dans sa console développeur, et déclare **l'URL de retour** :

```
https://<ton-domaine>/api/connect/<marque>/callback
```

`<marque>` est l'identifiant que tu choisiras à l'étape 3, en minuscules.
L'application affiche cette URL, prête à copier, dans **Profil → Connecteurs → la
marque** — et depuis l'étape *Connecteurs* du parcours d'installation, en touchant
**Configurer**. Recopie-la au caractère près : un écart d'un slash fait échouer
l'échange avec un message qui ne dit jamais lequel des deux est faux.

Note l'**identifiant** (client ID) et le **secret** (client secret). Demande les
portées minimales : une autorisation qui réclame le sommeil et la position pour compter
des pas se fait refuser, à raison.

## 2. L'adaptateur

```bash
cp server/connecteurs/_gabarit.ts.txt server/connecteurs/<marque>.ts
```

Quatre fonctions à remplir, décrites dans `server/connecteurs/types.ts` :

| Fonction | Ce qu'elle fait |
| --- | --- |
| `autoriser` | L'URL où envoyer la personne. **Pure** : aucun appel réseau. |
| `echanger` | Le code d'autorisation contre un jeu de jetons. |
| `rafraichir` | Un jeu de jetons neuf. |
| `lire` | Les données depuis un instant, **traduites**. |

Trois règles, et elles se paient cher si on les oublie.

**`lire` rend des `BodyEntry`, jamais le JSON de la marque.** La traduction se fait une
fois, sur le serveur, à l'endroit où l'on sait ce qu'on lit. La version d'avant rendait
du brut pour une marque et du traduit pour l'autre : les deux traductions ont divergé,
et le navigateur portait deux fois le même code.

**Un adaptateur ne lit ni `process.env` ni la configuration.** Ses identifiants lui sont
donnés. C'est ce qui permet de les faire venir tantôt de l'hébergeur, tantôt du coffre,
sans qu'il ait à le savoir — et ce qui le rend testable sans démarrer un serveur. Un
test le vérifie.

**`auth: true` uniquement quand seule une réautorisation peut réparer.** Un quota
dépassé ou un réseau qui saute marqués « auth » feraient brûler un jeton de
rafraîchissement pour rien. Un `403 scope manquant` n'est pas non plus un problème
d'autorisation à renouveler : réautoriser n'y changera rien tant que la case n'est pas
cochée dans la console.

## 3. La fiche

Dans `lib/providers.ts` — c'est elle qui décide de ce que l'écran raconte :

```ts
{
  id: 'oura',              // le même que l'`id` de l'adaptateur
  icone: '💍',             // un emoji : une liste se parcourt à la forme avant de se lire
  label: 'Oura',
  capabilities: ['pas'],   // ce qu'elle fournit VRAIMENT
  identifiants: true,      // la marque veut une application déclarée chez elle
  console: 'https://…',    // où la déclarer
  note: 'Bague Oura. Compte les pas…',
}
```

`capabilities` n'est pas décoratif : l'écran affiche « poids · masse grasse · pas » à
partir de cette liste. Promettre un poids qui n'arrivera jamais est pire que se taire —
Oura est justement le cas : la bague ne pèse rien, sa fiche ne promet que les pas.

## 4. Le registre

Une ligne dans `server/connecteurs/index.ts` :

```ts
export const ADAPTATEURS: Adaptateur[] = [withings, fitbit, oura, taMarque]
```

Volontairement explicite plutôt qu'un balayage du dossier : un import statique se
compile, alors qu'un chargement dynamique ferait disparaître une marque mal nommée sans
un mot, à l'exécution, chez quelqu'un d'autre.

**C'est tout.** Aucun écran, aucune route, aucun composable à toucher. La liste vient de
`/api/sources`, les gestes de `useConnecteur(id)`, et le navigateur ne connaît aucune
marque par son nom.

## 5. Les identifiants

Deux chemins, et l'ordre entre les deux est une décision :

1. **Les variables de l'hébergeur** — `NUXT_<MARQUE>_CLIENT_ID` et
   `NUXT_<MARQUE>_CLIENT_SECRET`, déduites de l'identifiant. Le secret n'atteint alors
   ni le navigateur ni le coffre. Prioritaire.
2. **Le formulaire de l'application** — Profil → Connecteurs → la marque, derrière le
   passkey. Le secret est chiffré (AES-256-GCM, clé dérivée de `NUXT_VAULT_SECRET`)
   avant d'être rangé, et ne ressort jamais du serveur.

Le second existe parce que le premier rendait ce dépôt inutilisable par quelqu'un
d'autre : brancher une balance imposait d'aller dans l'interface d'un hébergeur, poser
deux variables et **redéployer**. Autant dire que personne ne le faisait.

L'environnement passe devant pour deux raisons : sur une instance qui a déjà ses
variables, une saisie malheureuse dans l'écran ne doit pas pouvoir casser une connexion
qui marche ; et un secret rangé chez l'hébergeur est mieux protégé que le même secret
rangé dans les données de l'application.

⚠️ **Changer `NUXT_VAULT_SECRET` rend les identifiants du coffre illisibles.** C'est
voulu — un secret changé doit invalider ce qu'il protégeait — et l'écran le dit au lieu
de laisser deviner. Il faut les ressaisir.

## 6. Les tests

```bash
npx vitest run --project unit connecteurs
```

`test/unit/connecteurs.test.ts` refuse un adaptateur incomplet : identifiant absent de
`lib/providers.ts`, URL d'autorisation sans `scope` ou sans `state`, lecture de
`process.env`, fiche branchable sans adaptateur. L'oubli échoue en intégration continue
plutôt qu'à l'exécution, chez quelqu'un qui branche vraiment sa montre.

Ajoute au moins un test de **traduction** : une charge utile réaliste en entrée, des
`BodyEntry` en sortie. Les appels réseau sont remplacés (`vi.mock('ofetch')`) — un test
qui dépend d'internet ne dit rien le jour où il échoue.

## 7. Ce qui ne se vérifie qu'en vrai

Deux marques de ce dépôt portent un avertissement daté en tête de fichier : leur trajet
suit la documentation officielle, mais aucun compte développeur n'était disponible pour
le dérouler. Si tu branches une vraie application, **corrige le fichier et retire
l'avertissement** — et si tu trouves un écart, écris-le : c'est exactement ce que le
suivant cherchera.

---

## Les marques déjà étudiées

| Marque | État | Notes |
| --- | --- | --- |
| **Withings** | ✅ vérifié en vrai | Balances Body, montres ScanWatch. Répond toujours HTTP 200, le vrai statut est dans le corps. Fait tourner ses jetons de rafraîchissement. |
| **Fitbit** | ⚠️ non déroulé | Vrais codes HTTP. `Accept-Language` décide des unités : sans lui, les poids arrivent en livres. |
| **Polar** | ⚠️ non déroulé | Montres Vantage, Grit X, Pacer, Ignite. Inscription obligatoire (`POST /v3/users`) après l'échange du code, sans quoi tout répond 404. N'émet pas de jeton de rafraîchissement. |
| **Oura** | ⚠️ non déroulé | Pas seulement : la bague ne pèse pas. Le champ de date est lu de trois façons, faute d'avoir pu le confirmer. |
| **Garmin** | ⛔ impossible | Programme développeur en pause depuis 2026, formulaire de demande retiré (revérifié en septembre 2026). |
| **Apple Watch** | ⛔ impossible | HealthKit est une API de l'appareil, réservée aux applications iOS. Aucun serveur ne peut lire ces données. |
| **Wear OS / Samsung** | ⛔ impossible | Health Connect est une base locale à Android, sans accès distant ; les API web de Google Fit ont fermé. |

Les trois dernières lignes ont une fiche dans `lib/providers.ts` **sans adaptateur**, avec
un `bloque` daté. C'est délibéré : sans elles, la personne qui porte une Apple Watch
ouvre l'écran, ne trouve rien, et cherche une manipulation qui n'existe pas.
