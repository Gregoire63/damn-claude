# Damn Claude — repères pour travailler dans ce dépôt

Fiche destinée à un agent (Claude Code, Cowork) ou à quelqu'un qui ouvre le projet
pour la première fois. Elle dit ce qui n'est pas devinable en lisant les fichiers :
les règles qui ont coûté quelque chose, et pourquoi elles existent.

> À ne pas confondre avec **[SKILL.md](SKILL.md)**, qui est la fiche installée *dans*
> Claude pour qu'il sache se servir du connecteur MCP d'une instance déployée. Ce
> fichier-ci parle du CODE ; celui-là parle de l'APPLICATION en service.

## En trois lignes

Suivi d'entraînement et de nutrition, Nuxt 4 / Vue 3 / Nitro, déployé sur Netlify.
Une instance = une personne. Les données vivent dans le `localStorage` du téléphone ;
le serveur n'en garde qu'un miroir, poussé par le client, plus une boîte de
propositions que Claude dépose et que l'utilisateur valide à la main.

## Les commandes

| Commande | Ce qu'elle fait |
|---|---|
| `npm run dev` | Serveur de développement |
| `npm run build` | Build de production. **Jamais `nuxt generate`** — voir plus bas |
| `npm test` | Les deux projets Vitest (`unit` + `nuxt`) |
| `npm run check` | Trois garde-fous : sélecteurs CSS en double, clés de données en double, balisage Vue invalide |
| `npm run exemple` | Régénère `public/exemple.json` depuis `data/exemple/` |

Avant de proposer un changement : `npm run check && npm run build && npm test`.

Le build **avant** les tests, et pas l'inverse : `test/unit/demarrage.test.ts` cherche
le code de démarrage dans le bundle du navigateur, donc il lui faut un `.output`. Il
le construit lui-même s'il n'en trouve pas, mais c'est une minute payée deux fois. La
CI suit le même ordre.

## Les règles qui mordent

Chacune vient d'un bug réel. Les enfreindre ne casse rien tout de suite — c'est
précisément ce qui les rend dangereuses.

**`nuxt generate` supprime le serveur.** Il prérend tout en fichiers statiques, donc
`server/api/**` cesse d'exister : plus de connecteur, plus de passkey, plus de
synchronisation de balance. La commande de build est `npm run build`, dans
`netlify.toml`, et un champ rempli dans l'interface Netlify l'emporterait sur le
fichier.

**`data/` est VIDE, et doit le rester.** `PROGRAM`, `FOODS`, `RECIPES` et `CYCLE` sont
des tableaux vides. Le contenu vit dans `data/exemple/`, converti en
`public/exemple.json` par `npm run exemple`. Remettre « juste trois aliments pour
l'exemple » dans `data/nutritionProgram.ts` est le geste le plus naturel du monde et
personne ne le verrait : l'application marcherait, les tests passeraient, et chaque
nouvelle installation hériterait à nouveau du contenu de quelqu'un d'autre.
`test/unit/exempleImportable.test.ts` l'interdit.

**Un aliment, une recette, un exercice sont indexés par IDENTIFIANT.** Les journaux de
charges, les menus et l'historique pointent dessus. Réutiliser un identifiant libéré
range de vieux enregistrements sous un mouvement jamais fait. C'est pour ça que
« retirer » DÉSACTIVE au lieu de supprimer, partout.

**Aucun import dans `lib/onglets.ts`.** Ce fichier est lu par `nuxt.config.ts`, évalué
avant que les alias du projet existent. Un seul `import` y casse le build, avec un
message qui ne parle pas d'onglets.

**Les tests `unit` n'ont pas l'alias `~`.** Le projet Vitest `unit` tourne en Node pur :
dans `lib/`, les imports sont relatifs (`../data/…`). Le projet `nuxt` (happy-dom)
monte les composants et connaît l'alias.

**`overflow-x: hidden` casse `position: sticky`.** Il crée un conteneur de défilement.
`html` et `body` sont en `overflow-x: clip`, qui ne le fait pas. Un en-tête collant
mort se diagnostique en remontant les ancêtres, pas en relisant sa propre règle.

**Ne jamais écrire `-webkit-backdrop-filter` à côté de `backdrop-filter`.** Le
minificateur ne garde que la version préfixée, que Chromium ne supporte plus : le flou
disparaît en production et nulle part ailleurs.

**Le client Netlify Blobs se reconstruit à CHAQUE opération.** `NETLIFY_BLOBS_CONTEXT`
est injecté par invocation avec un jeton de courte durée ; le mémoïser au niveau du
module fige un jeton qui expire, et l'écriture échoue au bout d'une vingtaine de
minutes d'instance chaude — donc jamais en test, toujours en production.

**`vaultBootstrap` ne doit JAMAIS passer sous `runtimeConfig.public`.** Le code de
démarrage est fabriqué pendant `nuxt build` et cuit dans la configuration serveur.
Nuxt sérialise `public` dans le bundle du navigateur : l'y déplacer d'une ligne
publierait le code en clair sur la page d'accueil, et l'application marcherait
exactement pareil. `test/unit/demarrage.test.ts` construit le projet et cherche la
valeur dans les fichiers servis.

**Aucun secret dans le dépôt.** Ni dans `.env` (ignoré), ni dans un fichier de notes.
Un dépôt public garde tout dans son historique : effacer le fichier ne répare rien,
seule la régénération des clés répare.

## Comment c'est rangé

```
app.vue                  jetons de design, racine
layouts/default.vue      la coque — en-tête, onglets, feuille de séance, mini-barre
pages/                   un fichier par onglet, rien d'autre que son contenu
error.vue                404 et erreurs serveur
lib/onglets.ts           les cinq onglets : chemin, libellé, titre (AUCUN import)
components/sport/        écrans du suivi d'entraînement
components/nutrition/    écrans du module nutrition
composables/             l'état, persisté dans localStorage (24 fichiers, pas de Pinia)
lib/                     logique pure — aucun DOM, aucun stockage, testée (18 fichiers)
utils/                   auto-importé par Nuxt : uniquement du vocabulaire spécifique
data/                    types et tables de référence — les contenus sont VIDES
data/exemple/            le pack d'exemple → public/exemple.json
server/api/              connecteur MCP, OAuth, passkey, balances (31 routes)
scripts/                 les garde-fous et le générateur d'exemple
test/unit/               logique pure, environnement Node
test/nuxt/               câblage localStorage et composants, happy-dom
```

**`lib/` n'est pas auto-importé, `utils/` l'est.** Nuxt verse tout `utils/` et
`composables/` dans l'espace de noms global. Une fonction nommée `clamp` ou `slugify`
n'a rien à y faire — collision silencieuse au premier renommage.

**Un onglet, une URL, un fichier.** `/`, `/journal`, `/nutrition`, `/progres`,
`/profil`. L'onglet courant se lit dans l'URL, il n'est stocké nulle part. Un chemin
absent de `lib/onglets.ts` garde le rendu serveur, `validate` le refuse, et le
visiteur reçoit un vrai 404 — pas un 200 suivi d'une page qui se ravise.

**Ce qui survit au changement d'onglet vit dans la coque.** La feuille de séance est un
CALQUE au-dessus de l'onglet courant. Son état vit dans `useSeance()`, hors de tout
composant, dans un `effectScope` détaché — sinon le chrono et la sauvegarde
automatique mourraient avec l'écran qui les a créés.

## Le modèle de données

Trois couches, et elles partent toutes du livré :

1. `data/` — vide, mais c'est la BASE sur laquelle tout s'empile.
2. `localStorage` — uniquement les ÉCARTS : patches, ajouts, retraits, ordre.
3. `mergeProgram` / `mergeFoods` / `mergeRecipes` — la fusion, à la lecture.

Conséquence directe : une sauvegarde ne contient que la couche 2. C'est pourquoi
`useRestauration` reconnaît les sauvegardes d'avant le vidage de `data/` (celles sans
`programme.sessions`) et remet le pack d'exemple dessous. Sans ce rattrapage, elles
restauraient une application vide en affichant « importé ✓ ».

## L'authentification

Une instance appartient à une personne, et le seul moment délicat est le premier :
prouver qu'on est celui qui a déployé le site. Trois pièces s'articulent.

**Le coffre tient une LISTE de passkeys** (`server/utils/vault.ts`). Il n'en tenait
qu'un, et c'est ce qui imposait un secret permanent : sans second passkey, perdre son
téléphone fermait le coffre, donc il fallait un double valide indéfiniment. L'ancienne
forme — un objet à la racine de `credential.json` — est migrée **à la lecture**, jamais
au déploiement : on ne touche pas à l'authentification en écriture pendant que
personne ne regarde.

**Le passkey de secours** se pose depuis un second appareil sans aucun code : une
session valide prouve déjà qu'on tient le coffre. `challenge.post` l'autorise quand
`session(event)` répond, `register.post` n'exige alors ni code ni coffre vide. La
révocation vient avec, sauf le dernier — se verrouiller dehors d'un tap est un geste
qu'aucune confirmation ne rattrape.

**Le code de démarrage est fabriqué au build** (`nuxt.config.ts`) et imprimé dans le
journal de déploiement, lisible du seul propriétaire du site. Il n'y a donc rien à
configurer, il tourne à chaque build, et il se **brûle à l'usage** : on range son
empreinte dans le coffre, jamais sa valeur. Le réarmer, c'est redéployer — autrement
dit, se rouvrir la porte exige l'accès au déploiement, qui est la vraie racine de
confiance ici. `NUXT_VAULT_BOOTSTRAP` reste acceptée et l'emporte (Nuxt écrase de
lui-même la clé de `runtimeConfig` qui porte le nom de la variable) ; c'est l'option
la plus faible, elle redevient un secret permanent.

Verrou de quinze minutes après cinq échecs, **le bon code compris** : sinon il
suffirait d'essayer jusqu'à tomber juste. Et « code déjà consommé » se distingue de
« code invalide », parce que le premier dit quoi faire et le second envoie chercher
une faute de frappe qui n'existe pas.

Tout ça est couvert par `test/unit/passkeys.test.ts`, en comportement et non en
lecture de source : un code qui redeviendrait valide après usage ne se remarquerait
jamais autrement.

## Le connecteur

JSON-RPC sur `POST /api/mcp`, OAuth 2.1 + PKCE, jetons HMAC sans état. Il ne modifie
**jamais** : il dépose dans une boîte de propositions que l'utilisateur valide.

Deux invariants tenus par des tests :

- `test/unit/mcpCoherence.test.ts` confronte la description de l'outil au code : un
  geste que le code accepte sans qu'il soit annoncé est invisible, et une op annoncée
  que le code refuse produit des dépôts rejetés sans qu'on comprenne pourquoi.
- `test/unit/sauvegarde.test.ts` scanne les constantes `*_KEY` des composables et
  exige que chacune atteigne l'export, ou figure dans `HORS_SAUVEGARDE` avec une
  raison écrite. Une clé oubliée, c'est une donnée qui ne revient pas d'un import.

## Les tests

1063 tests, 48 fichiers, deux projets. La plupart tournent sur le **pack d'exemple**,
déclaré fichier par fichier (`vi.mock('../../data/nutritionProgram', …)`, voir
`test/exemple.ts`) : vérifier que la modulation des féculents ne touche pas aux
protéines demande des aliments aux vraies macros, pas trois objets fabriqués.

`test/unit/livreVide.test.ts` et `test/nuxt/restauration.test.ts` sont les seuls sans
mock : ils voient `data/` tel qu'il est livré, donc vide — le cas d'une installation
neuve.

Un test qui ne peut pas échouer ne sert à rien. Les commentaires disent ce que le test
protège, pas ce qu'il fait.

## Conventions

**Les commentaires sont en français, et ils disent POURQUOI.** Le code dit déjà quoi.
Un commentaire qui paraphrase la ligne suivante est du bruit ; un commentaire qui
raconte le bug évité est ce qui empêche de le réintroduire.

**Les messages de commit** suivent [Conventional Commits](https://www.conventionalcommits.org/fr/) :
`feat:`, `fix:`, `refactor:`, `test:`, `docs:`, `chore:`, `perf:`. Sujet à
l'impératif, 72 caractères maximum, en français. Le corps explique le pourquoi quand
le sujet ne suffit pas.

**Pas de dépendance ajoutée sans raison écrite.** Le projet tient sur Nuxt, Vue et
deux bibliothèques de passkey. C'est délibéré.
