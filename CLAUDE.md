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

**Une page qui joue du son PREND le focus audio du téléphone.** Spotify se fait
interrompre ou baisser, et le seul moyen de le récupérer est d'aller le relancer à la
main. La piste inaudible de veille — celle qui empêche Chrome de geler les minuteurs
d'un onglet en arrière-plan — coûte donc cher, et il a fallu trois passes pour que le
compte y soit :

1. elle ne tourne QUE quand l'onglet est caché. Écran devant les yeux, il n'y a rien
   à empêcher ;
2. elle démarre CINQ SECONDES avant le prochain son à faire entendre, et pas avant.
   Chaque minuteur annonce son échéance (`veilleProchainSon`, et `startKeepAlive`
   pour le repos) ; la piste s'arme sur la plus proche. Sur un repos de
   quatre-vingt-dix secondes, la musique baisse sur les cinq dernières au lieu des
   quatre-vingt-dix ;
3. les QUATRE MINUTES restent, en filet, pour qui n'annonce rien ou vise plus loin.
   Chrome serre la vis en deux temps (« Heavy throttling of chained JS timers »,
   Chrome 88) : sous cinq minutes cachées, les minuteurs sont regroupés à la seconde,
   et au-delà seulement, une fois par minute — là, même l'ordre d'armement arriverait
   en retard. S'armer à quatre minutes protège un minuteur long avant le couperet.

Le délai a d'abord été de quatre minutes POUR TOUT LE MONDE, en pariant qu'un repos
d'une à trois minutes n'aurait jamais besoin de la piste puisque son décompte reste
juste. Le pari portait sur la mauvaise chose : le décompte arrivait bien à zéro à
l'heure, c'est le SON qui manquait — un onglet caché qui ne joue rien voit son
`AudioContext` suspendu. Symptôme rapporté tel quel : « j'ai mis l'app en fond et le
son du chrono ne s'est pas déclenché ». D'où aussi `jouerQuandPret`, qui attend la
reprise du contexte avant de programmer les oscillateurs : sur un contexte suspendu,
`currentTime` est figé et les sons partent en vrac à la reprise.

L'application se déclare en plus `audioSession.type = 'ambient'` (se mélange) et passe
en `'transient'` le temps d'un bip (baisse la musique, puis la rend), là où le
navigateur connaît l'API — Chrome Android ne la connaît pas, d'où les points 2 et 3,
qui eux ne dépendent de rien. Le bip, lui, doit couvrir la musique : c'est le seul son qui ait le
droit de s'imposer, et seulement une seconde.

**Le lest est une DIFFÉRENCE, donc sa référence se fige.** Le stockage garde le TOTAL
(poids de corps + lest) ; le champ montre le lest, calculé en retirant le poids du
jour. Tant que ce poids bouge, tous les lests affichés bougent — et il bouge : la
balance se synchronise à l'ouverture, donc souvent après le démarrage de la séance.
`poidsFige` capture la référence au démarrage et voyage avec le brouillon. Corollaire :
`rebase` refuse un poids DEVINÉ (`weightOn(...).exact`), là où `bodyWeightAt` se rabat
volontiers sur la première pesée du carnet — bon choix pour afficher un ordre de
grandeur, faute ici.

**Un plat supprimé n'est pas effacé : il est MARQUÉ, et le passé ne bouge pas.**
Aucun total de journée n'est stocké — ils se recalculent à chaque affichage depuis le
catalogue ET depuis la semaine type (`buildDay`). Deux conséquences, et la seconde
piège même quand on connaît la première :

- effacer un plat retire ses calories de tous les jours où il a été mangé. D'où les
  pierres tombales (`gr-nutri-plats-supprimes-v1`, `gr-nutri-aliments-supprimes-v1`) et
  le drapeau `deleted`, qui le sort de partout où l'on CHOISIT et le laisse partout où
  l'on REGARDE ;
- **« nettoyer » les semaines types fait exactement le même dégât.** Une semaine type
  n'est pas une intention pour la semaine prochaine : c'est la seule mémoire de ce qui
  a été mangé les jeudis précédents. Vider un créneau les vide tous. Mesuré à l'écran
  avant correction : un jeudi passé tombait de 2 022 à 1 464 kcal. Les créneaux ne sont
  donc PAS touchés — le sélecteur de la semaine y affiche « … — supprimé, à remplacer ».

C'est la DATE qui tranche : `buildDay(..., sansSupprimes)` est vrai pour une journée à
venir, faux pour une journée passée. Une semaine type, qui n'a pas de date, l'écarte
toujours — c'est le seul endroit où le laisser passer coûterait de l'argent en courses.
Les exceptions de planning et les plats « pris à la place » ne se coupent qu'à partir
d'aujourd'hui.

Corollaire : une SAUCE encore servie ne se supprime pas, exactement comme un aliment
encore utilisé. Ses ingrédients entrent dans les macros des plats qui la servent, y
compris dans le passé ; la retirer de force les allégerait sans qu'aucune ligne ne
bouge à l'écran. On refuse, et on nomme les fiches à corriger. Voir
`lib/suppression.ts`.

**Deux mouvements peuvent se partager UNE place.** `Exercise.groupe` range un
exercice dans un groupe d'alternance ; les membres d'un même groupe occupent une seule
ligne de la séance, et c'est la semaine du calendrier qui désigne celui du jour
(`lib/rotation.ts`). Trois choix s'y tiennent, et chacun évite une panne silencieuse :

- la semaine CALENDAIRE plutôt que le nombre de séances faites — sinon ce que le
  planning annonce pour la semaine prochaine dépend de ce qui sera fait d'ici là, et
  ne s'explique qu'en ouvrant l'historique ;
- un numéro de semaine CONTINU depuis un lundi fixe, jamais le numéro ISO : celui-ci
  repart à 1 après une année de 52 ou 53 semaines, donc une alternance fondée sur sa
  parité se retourne au Nouvel An une année sur deux, sans que rien n'ait bougé ;
- le rang dans le roulement est l'ORDRE des membres dans la séance, et non un champ
  « semaine A / semaine B » : un champ de plus se désynchroniserait au premier
  `reordonner`, et deux exercices se retrouveraient « semaine A » sans que rien ne le
  signale.

Corollaire qui pique : c'est `useSeance().exercices` — la séance DU JOUR — que lisent
le brouillon, le seuil des 80 % et l'enregistrement, jamais `activeSession.exercises`.
Préremplir les deux membres mettrait le mouvement hors tour au dénominateur des 80 %
et l'écrirait au journal à zéro série, où la progression le lirait « fait, sans
charge ». Et une séance passée se rouvre sur le mouvement que le JOURNAL porte, pas
sur celui du calendrier — sinon la saisie faite sort de l'écran sans sortir du carnet.
Le menu ⚙ d'un mouvement permet d'inverser le tour POUR LA JOURNÉE ; le choix meurt
avec la séance, sinon le roulement se décalerait sans le dire.

**Un nombre de repas n'est PAS un appétit.** Cuisiner pour le lendemain double la
casserole, pas l'assiette. `ConvivesRepas.repas` multiplie donc ce qu'on PÈSE et rien
d'autre : `facteurRepas` le compte, `partDeMoi` l'ignore. Monter l'appétit à 200 %
donnerait exactement les mêmes grammages et tout le reste faux — la fiche annoncerait
une assiette double, et le suivi compterait un dîner de trop. Par personne et non
global, parce que c'est comme ça que ça tombe : deux jours pour soi, un seul pour qui
déjeune dehors demain. Les invités n'en ont pas — un invité est à table ce soir, un
point c'est tout ; qui repart avec une boîte est un convive de plus.

**Une dépense ajoutée est NETTE, sinon on compte deux fois la même heure.** La
dépense de base (`bmr × PAL_SEDENTARY`) couvre déjà les vingt-quatre heures. Tout ce
qu'on ajoute par-dessus — séance, activité hors séance — doit donc soustraire ce que
le repos aurait coûté pendant sa durée : `brut − (bmr / 1440) × minutes`. C'est ce que
`sessionBurn` documente depuis le premier jour, et `estimerKcal` reprend la même
formule. Corollaire : `activitesKcal` est un poste SÉPARÉ de `sessionKcal` dans
`dayEnergy`. Les deux ne se calculent pas pareil, et surtout `sessionKcal` porte une
règle à lui — forfait tant que la journée n'est pas finie, zéro ensuite si rien n'a
été enregistré. Une activité est toujours du réel : on la note après coup. Les fondre
ferait hériter l'une de la règle de l'autre. Et une activité ne bascule PAS la journée
en jour de salle : les féculents et les créneaux dépendent de la séance de
musculation, pas de l'effort en général.

**Un nombre calculé s'arrondit à sa SORTIE, jamais au milieu du calcul.**
`lib/nombres.ts` → `arrondi(n)`, au centième. Deux causes fabriquent des nombres à
rallonge, et la seconde surprend : la division qui ne tombe pas juste, et la
représentation binaire des décimaux — `0.1 + 0.2` vaut `0.30000000000000004` sans
qu'aucune division soit en cause. Arrondir en cours de route ferait dériver le
résultat ; arrondir à la sortie ne change que ce qu'on lit. Attention : l'écran n'est
pas la seule sortie — les PHRASES que le connecteur rend à Claude en sont une aussi,
et c'est là que le défaut s'était logé (`lib/repsGap.ts`, « tu en fais 7,625 reps en
médiane »).

**Fermer un calque et en ouvrir un autre dans le même battement.** La pile de
`useBackStack` tient UNE entrée d'historique factice tant qu'il reste quelque chose à
refermer, et la rendre appelle `history.back()`. Quand un calque en remplace un autre
— l'aperçu d'une séance qu'on démarre —, Vue exécute les deux observateurs dans la
même passe, dans l'ordre de DÉCLARATION, qui n'est pas celui des calques à l'écran.
Si le retrait tombe en premier, le `popstate` arrive quand le nouveau calque s'est
déjà inscrit, et c'est lui qui se fait refermer : on démarre la séance, la feuille se
replie toute seule. D'où le désarmement différé d'une micro-tâche dans `sync()` — si
quelque chose s'est réinscrit entre-temps, il n'y a plus rien à rendre.

**Un composable qui fusionne puis réécrit sa clé doit s'hydrater LUI-MÊME.** Le
motif est partout ici : `entries.value = merge(entries.value, neuf)` puis
`write(CLE, entries.value)`. Sur un composable jamais hydraté, la partie gauche vaut
`[]` — la fusion ne conserve rien et l'écriture remplace tout le stockage par ce qui
vient d'arriver. C'est ce qui effaçait l'historique de pesées : la coque lance
`autoSyncTout()` au montage, avant qu'aucun écran n'ait demandé les mesures, et il
suffisait d'une pesée neuve pour que trois mois partent. Sans erreur, sans message, et
seulement les matins où la balance avait quelque chose à donner. La garde va DANS le
composable (`assure()` dans `useMesures`), pas chez l'appelant : un stockage dont le
contenu dépend de qui a appelé en premier est un piège, et le prochain chemin
d'écriture y retombe. `test/nuxt/mesuresDemarrage.test.ts` fige le scénario.

**Aucune photo d'exercice dans le dépôt.** `public/exercises/*.jpg` est ignoré par
git. Ce que télécharge `scripts/fetch-exercise-images.mjs` vient de free-exercise-db,
dont l'Unlicense ne couvre que le JSON : le statut des images n'a jamais été établi
en amont, et ce sont visiblement des photos de commande. Les garder sur son disque
pour son instance est une chose, les redistribuer depuis un dépôt public sous AGPL en
est une autre. Elles y ont été une fois, et les en sortir a coûté une réécriture
d'historique. Sans elles, `ExerciseMove.vue` retombe sur le schéma des muscles
travaillés — c'est l'affichage normal d'un clone frais, pas une panne.

## Comment c'est rangé

```
app.vue                  jetons de design, racine
layouts/default.vue      la coque — en-tête, onglets, feuille de séance, mini-barre
pages/                   un fichier par onglet, rien d'autre que son contenu
error.vue                404 et erreurs serveur
lib/onglets.ts           les cinq onglets : chemin, libellé, titre (AUCUN import)
components/sport/        écrans du suivi d'entraînement
components/nutrition/    écrans du module nutrition
composables/             l'état, persisté dans localStorage (33 fichiers, pas de Pinia)
lib/                     logique pure — aucun DOM, aucun stockage, testée (27 fichiers)
utils/                   auto-importé par Nuxt : uniquement du vocabulaire spécifique
data/                    types et tables de référence — les contenus sont VIDES
data/exemple/            le pack d'exemple → public/exemple.json
server/api/              connecteur MCP, OAuth, passkey, balances (28 routes)
scripts/                 les garde-fous et le générateur d'exemple
test/unit/               logique pure, environnement Node
test/nuxt/               câblage localStorage et composants, happy-dom
```

**`lib/` n'est pas auto-importé, `utils/` l'est.** Nuxt verse tout `utils/` et
`composables/` dans l'espace de noms global. Une fonction nommée `clamp` ou `slugify`
n'a rien à y faire — collision silencieuse au premier renommage.

**Le glissement latéral change d'onglet.** `composables/useGlissement.ts` : le geste
est écouté sur la COQUE (un écran court ou une transition en cours laisserait le doigt
dans le vide), il ne s'arme que s'il commence horizontal, il cède à un défilement
latéral tant que celui-ci a encore de la marge dans ce sens, et il se tait quand un
calque est ouvert — `calqueOuvert` pour les feuilles et fenêtres, `sheetVisible` pour
la séance, qui n'y passe pas. Le sens de l'animation est posé aussi pour les
navigations qui ne viennent pas d'un geste, sinon l'écran part du mauvais côté.

**Les clients OAuth s'inscrivent, et rien n'est stocké.** `/api/oauth/register`
(RFC 7591) rend un `client_id` qui EST un jeton signé portant ses redirections :
aucune table, donc aucun quota ni purge — la même idée que les sessions et les codes.
L'inscription est ouverte parce qu'elle ne donne rien : l'autorisation passe toujours
par la clé d'accès, et la redirection est cuite dans l'identifiant, donc un
identifiant recopié ne peut pas détourner le code. `NUXT_MCP_CLIENT_ID/SECRET`
restent acceptées pour les instances d'avant, mais ne sont plus obligatoires — une
instance neuve n'a plus que `NUXT_VAULT_SECRET` à poser.

**Un refus s'affiche avec le texte du serveur, pas avec son numéro.** `ofetch`
compose son message depuis la ligne de statut HTTP, où HTTP/2 ne transporte plus
aucune phrase : il ne reste que « 403 ». Ce que le serveur explique est dans le corps
de la réponse — `lib/erreurs.ts` va l'y chercher. Et un secret qu'on TAPE (le code de
démarrage) se saisit en clair, majuscule automatique et correcteur coupés : masqué, on
ne peut pas relire ce qu'un clavier de téléphone a fait du texte.

**La version du build purge les caches.** L'application enregistre
`/sw.js?v=<version>` : pour le navigateur, une URL de script différente est un autre
service worker, donc il l'installe et son `activate` jette tout `sport-*` d'une autre
version. La version vient de `COMMIT_REF` (Netlify la pose) ou d'un horodatage, elle
est dans `runtimeConfig.public.version` et s'affiche en bas des réglages. Rien à
incrémenter à la main — c'est justement ce qui avait figé trois déploiements sur
`sport-v2`. Une application installée n'a ni barre d'adresse ni tiré-pour-rafraîchir :
sans ça, il n'existe AUCUN geste pour aller chercher une nouvelle version.

**Une page, un seul nœud à la racine, et c'est un élément HTML.** `<NuxtPage>`
enveloppe chaque page dans une `<Transition>` ; une transition anime UN nœud du DOM.
Une page dont la racine est `<Suspense>` ou `<ClientOnly>` — ou qui porte un
commentaire À CÔTÉ de son élément racine, ce qui fait deux nœuds en développement — ne
s'anime pas : Vue prévient une fois en console, Nuxt émet `NUXT_E4004`, et le
changement d'onglet redevient un remplacement sec. Les commentaires vont donc DANS
l'élément racine. `npm run check` le vérifie à froid sur tout `pages/`.

**Une seule navigation interne.** `.onglets-int > .segmente` : le même contrôle
segmenté dans Progression, dans Plats et partout où l'on bascule entre des vues d'un
même écran. Trois dessins différents cohabitaient ; le même geste doit avoir la même
forme, sinon chaque écran se réapprend.

**Un onglet, une URL, un fichier.** `/`, `/journal`, `/nutrition`, `/progres`,
`/profil`. L'onglet courant se lit dans l'URL, il n'est stocké nulle part. Un chemin
absent de `lib/onglets.ts` garde le rendu serveur, `validate` le refuse, et le
visiteur reçoit un vrai 404 — pas un 200 suivi d'une page qui se ravise.

**Ce qui survit au changement d'onglet vit dans la coque.** La feuille de séance est un
CALQUE au-dessus de l'onglet courant. Son état vit dans `useSeance()`, hors de tout
composant, dans un `effectScope` détaché — sinon le chrono et la sauvegarde
automatique mourraient avec l'écran qui les a créés.

**Le parcours d'installation barre l'application, et une seule étape barre le
parcours.** `useDemarrage()` porte quatre étapes ; « faite » se DÉDUIT de l'état réel
(profil rempli, passkey posé, programme non vide) et ne se coche jamais — une case
cochée survit à un import qui a tout remplacé. Seules les décisions de reporter sont
écrites (`gr-demarrage-v1`). Le profil est la seule étape bloquante : sans taille,
sexe et année de naissance il n'y a pas de métabolisme de base, donc pas de cible
calorique. `rejouer()` efface ces reports et rouvre le parcours — Profil →
Installation ; rien de fait n'est défait.

**Un minuteur ne décrémente pas, il lit l'heure.** Le repos entre séries
(`useRestTimer`) et le fractionné (`useFractionne`) retiennent une heure de FIN
absolue et en déduisent l'affichage à chaque battement. Chrome Android gèle un onglet
en arrière-plan : un compteur qui soustrait une seconde par battement reprend avec
tout le retard accumulé, et sur un bloc de six sprints le décalage devient une phase
entière. Les deux partagent aussi leur chaîne audio — saturation puis limiteur, c'est
elle qui rend le bip audible en salle. Un second moteur audio écrit à côté ne se
signalerait pas comme tel : on dirait « le bip du sprint est trop faible ».

**Ne jamais poser `interactive-widget=resizes-content` dans le `viewport`.** C'est la
réponse d'un mot au champ que le clavier cache — sur Android seulement, iOS ne
l'implémente pas — et elle casserait au passage la détection de clavier qui pilote le
chrono flottant : celle-ci compare `innerHeight` à la hauteur du viewport visible, et
en `resizes-content` les deux rétrécissent ensemble, l'écart tombe à zéro, le clavier
devient invisible pour le code. `composables/useClavier.ts` mesure donc le viewport
VISIBLE et remonte le champ lui-même, sans rien supposer du clavier.

**Une seule liste de connecteurs, affichée deux fois.** `components/sport/Sources.vue`
sert le parcours (`compact`) et les réglages (dépliable), à partir de `/api/sources`,
qui ne renvoie que des identifiants de marque et un état — jamais une valeur. Une
marque non configurée reste visible, en grisé, avec la raison.

**Ajouter une marque = un fichier, une fiche, une ligne.** `server/connecteurs/<marque>.ts`
déclare l'OAuth et la traduction ; `lib/providers.ts` décide de ce que l'écran raconte ;
`server/connecteurs/index.ts` l'enregistre. Aucun écran, aucune route, aucun composable
à toucher — les routes sont génériques (`/api/connect/[marque]/…`) et le navigateur ne
connaît aucune marque par son nom. Le chemin complet est dans `docs/CONNECTEURS.md`, le
gabarit dans `server/connecteurs/_gabarit.ts.txt`, et `test/unit/connecteurs.test.ts`
refuse un adaptateur incomplet.

**Trois règles qui se paient cher.** Un adaptateur rend des `BodyEntry`, jamais le JSON
de la marque. Il ne lit ni `process.env` ni la configuration : ses identifiants lui sont
donnés — d'où le fait qu'ils puissent venir de l'hébergeur (`NUXT_<MARQUE>_CLIENT_ID`,
prioritaire) ou du coffre, chiffrés, saisis depuis l'application. Et `auth: true`
seulement quand une réautorisation est la SEULE réparation : marquer ainsi un quota ou
une coupure réseau ferait brûler un jeton de rafraîchissement pour rien, et beaucoup de
marques enterrent l'ancien à la seconde où elles en émettent un neuf.

**Les mesures n'appartiennent à aucune marque.** `useMesures()` tient le journal —
fusion, quarantaine, miroir vers le module séances — et `absorber()` est le seul chemin
d'écriture. `useConnecteur(id)` ne fait que la plomberie OAuth. Une marque qui garderait
son propre historique donnerait deux séries du même poids : la courbe prendrait l'une,
le métabolisme de base l'autre.

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

1472 tests, 86 fichiers, deux projets. La plupart tournent sur le **pack d'exemple**,
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
