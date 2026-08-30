<p align="center">
  <img src="public/logo.png" alt="" width="420">
</p>

<p align="center">
  <a href="https://github.com/Gregoire63/van-claude/actions/workflows/ci.yml"><img src="https://github.com/Gregoire63/van-claude/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/tests-1045-3f7a4f" alt="1045 tests">
  <img src="https://img.shields.io/badge/Nuxt-4-00DC82" alt="Nuxt 4">
  <a href="LICENSE"><img src="https://img.shields.io/badge/licence-AGPL--3.0-8b6f5c" alt="AGPL-3.0"></a>
  <img src="https://img.shields.io/badge/données-sur%20ton%20téléphone-6b6560" alt="Données locales">
</p>

<p align="center"><b>Français</b> · <a href="README.en.md">English</a></p>

# Van Claude

Un suivi d'entraînement et de nutrition qui tient dans un onglet de navigateur, et
que **ton** Claude peut lire — sans jamais écrire tout seul.

Le nom, oui : la seule icône du muscle qui s'appelait déjà Claude.

C'est une application personnelle, au sens strict : une instance, une personne. Elle
n'a pas de compte, pas de serveur central, pas de base de données partagée. Tes
données vivent dans le `localStorage` de ton téléphone ; le serveur ne détient qu'un
miroir, que tu pousses toi-même, pour que le connecteur ait quelque chose à lire et
pour que tu puisses changer d'appareil.

**→ [HEBERGER.md](HEBERGER.md) pour déployer la tienne en dix minutes.**

<p align="center">
  <img src="docs/captures/01-premier-lancement.png" alt="Premier lancement : l'application est vide" width="205">
  <img src="docs/captures/02-accueil.png" alt="Accueil : la journée et les séances" width="205">
  <img src="docs/captures/03-seance.png" alt="Séance en cours : saisie des séries" width="205">
  <img src="docs/captures/04-nutrition.png" alt="Nutrition : semaine, courses, cuisine" width="205">
</p>

---

## Elle démarre vide

Aucune séance, aucun aliment, aucune recette, aucun menu. C'est délibéré : le contenu
livré était le programme et les courses d'une personne, et hériter de ça, ce n'est pas
commencer, c'est effacer.

Le premier écran propose donc deux chemins, et rien d'autre :

- **Faire remplir par Claude.** Un message prêt à coller, avec l'ordre des étapes —
  programme, semaine type, aliments, recettes, menus. Claude pose les questions et
  dépose ses propositions dans l'application ; rien ne s'écrit sans validation.
- **Charger l'exemple.** Quatre séances, cent cinquante-deux aliments, trente-quatre
  recettes, deux semaines de menus. Il arrive par la porte de la restauration, donc
  en contenu **personnel** : modifiable, et surtout supprimable. Un exemple qu'on ne
  peut pas retirer n'est pas un exemple.

Le pack vit dans `data/exemple/`, et `npm run exemple` en fait `public/exemple.json`.
Un test vérifie que le fichier servi est à jour, à l'octet près — modifier l'exemple
sans le régénérer laisserait un exemple périmé en ligne, et rien ne le montrerait.

---

## Ce qu'elle fait

- **Séances** — programme d'entraînement modifiable, saisie des séries pendant la
  séance, minuteur de repos qui fait vibrer la montre, suggestion de charge à la
  série suivante, records et détection de stagnation.
- **Nutrition** — cible calorique recalculée d'après la séance réellement
  enregistrée, plan de repas, courses par rayon, batch cooking, couverture en
  micronutriments.
- **Corps** — pesées (à la main ou depuis une balance connectée), courbe lissée,
  pente hebdomadaire, décomposition gras/muscle, pas.
- **Connecteur** — un serveur MCP à toi, que Claude interroge en lecture, et dans
  lequel il **dépose des propositions**. Tu les vois dans l'app, tu valides d'un tap
  ou tu refuses. Il ne modifie jamais rien directement.

## Le principe qui tient tout

**Le téléphone est la source de vérité.** Le serveur ne fusionne jamais, ne renvoie
jamais de données à réintégrer, ne décide jamais. Il reçoit un miroir et il garde une
boîte de propositions. Conséquence : il n'existe aucun cas où deux versions d'une
même séance doivent être arbitrées — et donc aucun conflit à résoudre, jamais.

C'est aussi ce qui rend l'auto-hébergement simple. Il n'y a rien à mettre à l'échelle,
rien à sauvegarder côté serveur qui n'existe déjà sur ton téléphone.

## Ce qu'elle n'est pas

- Un service. Personne ne l'exploite pour toi.
- Multi-utilisateur. Une instance = une personne. C'est le modèle, pas une limite.
- Un dispositif médical. Les estimations (Mifflin-St Jeor, impédancemétrie) valent ce
  que valent leurs formules, et le disent.

---

## Démarrer en local

```bash
npm install
npm run dev            # http://localhost:3000
```

En développement, des données de démonstration se posent au premier chargement, pour
que les écrans aient quelque chose à montrer. En production, jamais. Elles simulent un
historique **sur le programme en place** : charge d'abord l'exemple (ou crée une
séance), sinon il n'y a rien à simuler et elles attendent.

## Les commandes

| Commande | Ce qu'elle fait |
|---|---|
| `npm run dev` | Serveur de développement |
| `npm run build` | Build de production (**jamais** `nuxt generate`) |
| `npm test` | 1045 tests, 46 fichiers, deux projets Vitest |
| `npm run check` | Trois garde-fous : sélecteurs CSS en double, clés de données en double, balisage Vue invalide |
| `npm run exemple` | Régénère `public/exemple.json` depuis `data/exemple/` |

## Comment c'est rangé

```
app.vue                  les jetons de design, et la racine
layouts/default.vue      la coque — en-tête, onglets, feuille de séance, mini-barre
pages/                   un fichier par onglet, et rien d'autre que son contenu
error.vue                404 et erreurs serveur
lib/onglets.ts           les cinq onglets : chemin, libellé, titre
components/sport/        écrans du suivi d'entraînement
components/nutrition/    écrans du module nutrition
composables/             l'état, persisté dans localStorage (23 fichiers, pas de Pinia)
lib/                     la logique pure — aucun DOM, aucun stockage, testée (18 fichiers)
data/                    les types et les tables de référence — les contenus sont vides
data/exemple/            le pack d'exemple, converti en public/exemple.json
server/api/              le connecteur MCP, OAuth, passkey, balances (31 routes)
```

Deux règles de rangement expliquent le reste :

**`lib/` n'est pas auto-importé, `utils/` l'est.** Nuxt verse tout `utils/` et
`composables/` dans l'espace de noms global. Une fonction nommée `clamp` ou `slugify`
n'a rien à y faire — collision silencieuse au premier renommage. Ce qui est générique
vit donc dans `lib/`, avec des imports explicites.

**Un onglet, une URL, un fichier.** `/`, `/journal`, `/nutrition`, `/progres`,
`/profil`. L'onglet courant n'est stocké nulle part : il se lit dans l'URL. Un chemin
inconnu ne correspond à aucune page, et comme il n'est pas dans les règles `ssr: false`
de `nuxt.config`, il est rendu côté serveur — donc refusé avec un vrai code 404, pas
un 200 suivi d'une page qui se ravise.

**Ce qui survit au changement d'onglet vit dans la coque.** La feuille de séance est
un CALQUE au-dessus de l'onglet courant, pas un morceau d'onglet : on démarre une
séance depuis l'accueil, on la replie, on va vérifier une charge dans le journal, on
la rouvre. Nuxt conserve `layouts/default.vue` tant que le nom de mise en page ne
change pas, et l'état lui-même vit dans `useSeance()` — hors de tout composant, dans
un `effectScope` détaché pour que le chrono et la sauvegarde automatique ne meurent
pas avec l'écran qui les a créés.

**Les tests `unit` tournent sans alias `~`.** Le projet Vitest `unit` est en
environnement Node pur : dans `lib/`, les imports sont relatifs (`../data/…`). Le
projet `nuxt` (happy-dom) monte les composants et connaît l'alias.

## Sous le capot

Quatre choix qui expliquent la forme du code, et qu'on ne devine pas en le lisant.

**Les garde-fous ne sont pas des tests.** `npm run check` lance trois scripts maison
qui lisent les sources et refusent ce qu'aucun test ne verrait : un sélecteur CSS
défini deux fois (la seconde règle gagne, silencieusement), une clé de données en
double, une balise Vue mal fermée. Ils tournent en deux secondes.

**Deux tests protègent des régressions invisibles.** `mcpCoherence` confronte la
description de l'outil MCP au code qui l'applique : un geste accepté mais non annoncé
ne sera jamais appelé, et une op annoncée que le code refuse produit des dépôts
rejetés sans qu'on comprenne pourquoi. `sauvegarde` scanne les constantes `*_KEY` des
composables et exige que chacune atteigne l'export, ou figure dans une liste
d'exclusion **avec une raison écrite** — une clé oubliée, c'est une donnée qui ne
revient pas d'un import.

**Le serveur ne mémorise rien.** Jetons HMAC porteurs de leur propre expiration,
stockage Netlify Blobs reconstruit à chaque opération — le contexte Blobs est injecté
par invocation avec un jeton de courte durée, et le mémoïser fige un jeton qui expire
au bout d'une vingtaine de minutes d'instance chaude. Donc jamais en test, toujours en
production.

**Les commentaires disent pourquoi, pas quoi.** Le dépôt en compte beaucoup, et c'est
délibéré : chacun raconte le bug qu'il empêche de réintroduire. `overflow-x: hidden`
crée un conteneur de défilement et tue `position: sticky` ; le minificateur ne garde
que `-webkit-backdrop-filter`, que Chromium ne supporte plus. Ces deux-là ont coûté
une soirée chacun.

## Documentation

- **[HEBERGER.md](HEBERGER.md)** — déployer, poser les variables, brancher Claude,
  brancher une balance.
- **[SKILL.md](SKILL.md)** — la fiche à installer dans Claude pour qu'il sache se
  servir du connecteur.
- **[docs/NUTRITION.md](docs/NUTRITION.md)** — les décisions derrière le module
  nutrition : ce qui a été essayé, ce qui a cassé, pourquoi le code est comme il est.
- **[CLAUDE.md](CLAUDE.md)** — les repères pour travailler dans le dépôt : la structure,
  les règles qui mordent, les conventions. Écrit pour un agent, utile à un humain.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** · **[SECURITY.md](SECURITY.md)**

## Licence

**GNU AGPL v3** — voir [LICENSE](LICENSE).

En clair, pour les deux cas qui se présentent réellement :

- **Tu héberges ta propre instance, pour toi.** Fais-le, c'est exactement ce pour
  quoi l'application est écrite. Tu ne dois rien à personne, tu n'as rien à publier,
  tu modifies ce que tu veux.
- **Tu la fais tourner comme service pour d'autres.** Alors tes modifications doivent
  être publiques, sous la même licence. L'AGPL ferme la porte que la GPL laisse
  ouverte : rendre un service par le réseau compte comme distribuer.

Une licence commerciale, pour qui veut exploiter le code sans publier ses
modifications, se discute — écris-moi.

Copyright © 2026 Grégoire Raturat.
