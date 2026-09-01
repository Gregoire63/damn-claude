# Le module nutrition — comment il est fait, et pourquoi

L'onglet « Nutrition » réutilise le profil (taille, sexe, année de naissance) et le
poids de corps déjà saisis dans le suivi de séances : une seule source de vérité,
aucun doublon de données.

Ce document n'est pas un mode d'emploi — l'application se suffit à elle-même. C'est
la trace des décisions : ce qui a été essayé, ce qui a cassé, et pourquoi le code
est comme il est. À lire avant de le modifier, pas avant de s'en servir.

> **Le contenu décrit ici n'est plus livré.** L'application démarre vide : ni
> aliments, ni recettes, ni cycle de menus. Le catalogue de cent cinquante-deux
> aliments et les trente-quatre recettes dont parle ce document vivent dans
> `data/exemple/nutrition.ts`, d'où `npm run exemple` les convertit en
> `public/exemple.json` — le pack qu'on importe au premier lancement si on le veut.
> Tout ce qui suit décrit donc le MODÈLE (les calculs, les créneaux, les règles) et
> le contenu d'exemple qui l'illustre, pas ce que trouve une installation neuve.

Les fichiers concernés : `data/nutritionProgram.ts` (les types, les créneaux de la
journée, les compléments et les références ANSES ; les tableaux d'aliments, de
recettes et le cycle y sont **vides**), `data/exemple/nutrition.ts` (le contenu
d'exemple — **généré**, voir « Régénérer les données »), `lib/nutritionStats.ts`
(toute la logique pure), `composables/useNutrition.ts` (état persisté) et
`components/nutrition/` (les écrans).

## Pourquoi `lib/` et pas `utils/`

Nuxt auto-importe **tout** `utils/` et `composables/`. `sportStats.ts` peut se le
permettre : 44 exports au vocabulaire spécifique à l'entraînement. `nutritionStats`
en expose plus de 130, dont des noms génériques (`clamp`, `slugify`, `hhmm`,
`timelineOf`) — les verser dans l'espace de noms global de l'application crée des
collisions et, pire, des imports fantômes qui cassent au premier renommage
d'export.

Le fichier vit donc dans `lib/`, que Nuxt ne scanne pas, et tous ses imports sont
explicites. L'espace auto-importé du projet passe de 184 à 54 symboles.

⚠️ Six onglets dans la `.bottomnav` (max-width 560 px, `space-around`) : ça tient, mais
surveille `.bn-label` à 10 px sur les petits écrans. Si c'est trop serré, la nutrition
peut passer en sous-onglet du Rapport.

## Clés localStorage

Toutes préfixées `gr-nutri-`, aucune collision avec les clés existantes.

| Clé | Contenu |
|---|---|
| `gr-nutri-prices-v1` | Prix saisis, en € / kg |
| `gr-nutri-shopping-v1` | Aliments cochés dans la liste |
| `gr-nutri-batch-v1` | Tâches de batch cooking cochées, clé `<lundi>:<session>:<index>` |
| `gr-nutri-skipped-v1` | Jours où la séance a été annulée |
| `gr-nutri-eaten-v1` | Repas pris, par date |
| `gr-nutri-baskets-v1` | Historique des paniers payés (24 max) |
| `gr-nutri-prep-v1` | Mode de préparation : `separate` ou `assembled` |
| `gr-nutri-week-v1` | Semaine type : salle et télétravail, 7 cases chacun |
| `gr-nutri-days-v1` | Exceptions par date : salle, télétravail, pas, plats imposés |
| `gr-nutri-extras-v1` | Repas hors plan, par date, avec leur heure |
| `gr-nutri-foods-v1` | Aliments créés |
| `gr-nutri-foodpatch-v1` | Aliments livrés, modifiés |
| `gr-nutri-recipes-v1` | Plats créés |
| `gr-nutri-recipepatch-v1` | Plats livrés, modifiés |
| `gr-nutri-off-v1` | Plats mis de côté |

Les données de la balance ont leur propre préfixe, `gr-withings-` :

| Clé | Contenu |
|---|---|
| `gr-withings-tok-v1` | Jetons OAuth (jamais le `client_secret`) |
| `gr-withings-body-v1` | Pesées : poids, gras, muscle, eau, os, FC |
| `gr-withings-act-v1` | Pas par jour |
| `gr-withings-sync-v1` | `updatetime` de la dernière synchro, pour ne demander que le delta |

## La dépense, en trois postes

Les « facteurs d'activité » forfaitaires ont disparu. La dépense d'une journée est
la somme de trois choses lisibles, affichées telles quelles dans l'interface :

```
métabolisme × 1,20   (activité de fond, hors marche et hors sport)
+ pas × poids × 0,00025   (~235 kcal pour 10 000 pas à 94 kg)
+ coût de la séance       (voir la section suivante)
− déficit                 (20 % de la dépense, borné à 400–700 kcal)
= cible du jour
```

C'est ce découpage qui donne un sens au bouton **télétravail** : ce n'est pas un
coefficient magique, c'est une journée où l'on marche moins. Par défaut 3 500 pas en
télétravail, 7 500 sinon — et dès que les pas réels sont saisis, ils remplacent
l'estimation. Le télétravail et la séance sont **deux axes indépendants** : on peut
télétravailler et aller à la salle le même jour, ce qui est le cas le mardi et le
vendredi.

Le déficit proportionnel remplace les deux forfaits précédents. Sur la semaine type,
il donne ~0,5 kg par semaine, vérifié par un test.

## Les horaires

| | Jour avec séance | Jour sans |
|---|---|---|
| 10 h | Petit-déjeuner | Petit-déjeuner |
| 10 h 05 | Banane (avec le petit-déjeuner) | Créatine |
| 13 h 20 | Après séance (shaker + créatine) | — |
| 13 h 40 | Déjeuner (boîte) | Déjeuner (boîte) |
| 17 h | Collation | Collation |
| 20 h 30 | Dîner | Dîner |
| 22 h 30 | Avant de dormir | Avant de dormir |

Lever 8 h, travail à 9 h, et rien ne passe avant : le petit-déjeuner est à **10 h**, pas
à 7 h 30. Ça laisse 2 h 15 avant la séance de 12 h 15, ce qui est le bon écart — assez
pour digérer, assez peu pour ne pas repartir à jeun. **Aucune raison de se forcer à 9 h.**

Le déjeuner à **13 h 40** est une contrainte, pas un choix : c'est l'heure de la pause.
Il est identique les jours sans séance, pour ne pas avoir faim à contretemps le lendemain
d'un changement.

La banane d'avant-séance est passée **à 10 h 05, avec le petit-déjeuner**. Elle existait
pour combler les 4 h 45 entre un petit-déjeuner de 7 h 30 et la séance ; ce trou n'existe
plus, et une prise de plus à 11 h 15 serait une prise à forcer. Les calories du jour sont
inchangées : c'est la même banane, une heure plus tôt.

## La bibliothèque

`data/nutritionProgram.ts` n'est plus qu'un jeu de valeurs par défaut. Toutes les
fonctions de calcul prennent une `Library` en paramètre :

```ts
interface Library { foods: Record<string, Food>, recipes: Record<string, Recipe> }
```

que `useNutrition` compose à partir des données livrées, des créations et des
modifications. On peut donc créer un aliment (saisie des valeurs pour 100 g depuis
l'emballage, avec un contrôle qui vérifie que les macros expliquent bien les
calories), créer un plat, modifier un plat livré, ou le mettre de côté — il reste
consultable mais ne tombe plus dans le planning.

## Aucun « démarrage » à déclencher

Le cycle de 14 jours se déduit de la date seule (`cycleIndexOf`) : les semaines
paires servent le premier menu, les impaires le second, à partir d'un lundi de
référence fixe. Il n'y a donc rien à lancer, rien à resynchroniser après une pause,
et rien à oublier de lancer — c'est précisément ce qui empêchait le bandeau
d'accueil de s'afficher dans la version précédente.

## Le planning

Une semaine type définie une fois (`gr-nutri-week-v1`), surchargée au jour le jour
par des exceptions (`gr-nutri-days-v1`). Une exception ne porte que ce qui change :
la salle, le télétravail, les pas, ou un plat imposé. Effacer une exception fait
revenir le jour à la semaine type — et une exception vidée de tous ses champs
disparaît d'elle-même au lieu de rester en base.

La semaine type s'édite dans **Profil** (c'est un réglage), les exceptions dans la
feuille de jour du **Journal** (c'est un cas particulier).

## Les écarts et le rattrapage

Le déficit se pilote sur la semaine, pas sur la journée. `weekBalance()` cumule les
écarts des jours **clos** (un jour en cours n'est pas un écart) et étale la
correction sur les jours restants :

- en dessous de 60 kcal d'écart, rien n'est dit ;
- le report est plafonné à **200 kcal par jour**, et la cible ne descend jamais sous
  **85 %** de sa valeur ;
- au-delà de **1 500 kcal** d'écart, le module renonce explicitement au rattrapage et
  le dit : vouloir compenser d'un coup est ce qui déclenche le craquage suivant.

## Le recalage dynamique sur les séances réelles

C'est la partie la plus utile du module, et celle qui justifie de l'avoir mis dans la même
app que le suivi de séances plutôt que dans un coin.

**Le problème du forfait.** « Jour de salle = 2 180 kcal » est une moyenne. Une séance de
40 min expédiée et une séance de 70 min avec des sprints ne coûtent pas la même chose —
l'écart réel est d'environ 200 kcal, soit un tiers du déficit quotidien.

**Ce que fait le module.** `Day.vue` lit `sessionLog()` de `useWorkout`, filtre les séances
du jour, et estime leur coût :

```
densité  = séries de travail / minutes            (échauffement exclu)
MET      = 3,0 → 6,0 selon la densité             (plafonné à 0,45 série/min)
brut     = MET × poids × durée + sprints (12 MET) + échauffement course (7 MET)
au repos = métabolisme de base × durée / 1440
net      = (brut − au repos) × 1,07               (EPOC)
```

Soustraire le métabolisme de base est le point qui change tout : sans ça, on compte deux
fois la même heure et on surestime chaque séance d'environ 80 kcal.

La cible devient alors, et c'est **le seul** modèle du module (`dayEnergy`) :

```
besoin = métabolisme × 1,2 + pas de la journée + dépense mesurée de la séance
cible  = besoin − déficit           déficit = 20 % du besoin, borné à 400-700 kcal
```

`sessionKcal = 0` retombe **exactement** sur la cible d'un jour sans séance : un jour ne
saute pas de cible quand on supprime une séance du journal (c'est verrouillé par un test).

**Il n'y a plus de forfait en parallèle.** `targetOf`, `tdeeOf` et `targetFor` — un modèle
« métabolisme × facteur d'activité − déficit fixe » — ont été supprimés le 11/08. Aucun
écran ne les appelait, mais la calibration du plan, elle, s'y référait : le plan collait à
2 150 kcal pendant que l'app affichait 2 300, et les jours de séance sont restés 80 à
190 kcal sous leur cible sans qu'un test bronche. Deux modèles de cible dans le même
module, c'est un de trop — celui que personne ne regarde est celui qui dérive.

**Sur les 5 séances réelles du journal de juillet**, le modèle donne de 334 à 535 kcal —
soit des cibles de 2 070 à 2 270 kcal là où le forfait disait 2 180 pour tout le monde.

**La consigne concrète.** `dinnerAdjustment()` traduit l'écart en grammes sur le féculent
du dîner : « 165 g de pommes de terre au lieu de 255 g (−69 kcal) ». Un écart en kcal ne se
pilote pas ; une portion sur la balance, si. Garde-fous :

- en dessous de **60 kcal** d'écart, aucun message — c'est dans l'incertitude du modèle ;
- l'ajustement est **plafonné à 300 kcal** et la portion bornée à **40–180 %** de sa taille ;
- il ne touche **qu'aux féculents**, jamais aux protéines ni aux légumes.

**Les six statuts d'une journée** (`dayStatus`) :

| Statut | Quand | Effet |
|---|---|---|
| `pending` | Séance prévue, pas encore enregistrée, avant 15 h | Cible sur une séance moyenne (440 kcal), pas de consigne |
| `done` | Séance enregistrée un jour prévu | Cible sur la dépense réelle |
| `bonus` | Séance enregistrée un jour non prévu | Idem, la journée remonte |
| `missed` | Séance prévue, rien enregistré, après 15 h | Journée en profil repos |
| `skipped` | Marquée annulée à la main | Journée en profil repos |
| `rest` | Pas de séance prévue | Profil repos |

Le seuil de 15 h (`SESSION_CUTOFF_HOUR`) existe pour ne pas afficher « séance ratée » à
10 h du matin alors qu'elle est prévue à midi. Une séance enregistrée prime toujours sur le
marquage manuel « annulée ».

### Quand tout est cuisiné d'un coup

Si les boîtes sont assemblées à l'avance (typiquement le dimanche pour la semaine), la
consigne « 165 g au lieu de 255 g » est inapplicable : la boîte est fermée. Le réglage
`prepMode` (`gr-nutri-prep-v1`) bascule alors la consigne en **retraits** :

| Mode | Consigne produite |
|---|---|
| `separate` — féculents en vrac | « Ce soir : 165 g de pommes de terre au lieu de 255 g » |
| `assembled` — boîtes montées | « Laisse 90 g de pommes de terre dans la boîte (≈ 35 % de la portion) » puis, si ça ne suffit pas, « Saute la collation de l'après-midi » |

`removalSteps()` construit la liste dans l'ordre : fraction du féculent du dîner, puis
celui du déjeuner, puis les repas annexes (collation de l'après-midi avant le fromage
blanc du soir — la caséine nocturne part en dernier). On ne fait jamais laisser plus de
**50 %** d'une portion : au-delà, autant ne pas l'avoir cuisinée. Protéines et légumes
ne sont jamais touchés.

Dans l'autre sens (séance plus coûteuse que prévu, boîte figée), `additionSteps()`
propose un ajout qui ne demande aucune cuisine : du pain complet, ou une banane.

**Conséquence sur le batch cooking**, et c'est la règle la moins évidente du module :
en mode `assembled`, `Batch.vue` affiche les portions **de la version « jour avec
séance »**, la plus grosse. Le week-end on ne sait pas encore quelles séances auront
lieu ; on peut toujours laisser du riz dans une boîte, jamais y ajouter celui qu'on n'a
pas cuit. L'onglet Cuisine affiche aussi le conseil de garder huile, pain et collations
à part — ce sont les seuls leviers qui restent quand le plat est monté, et chacun vaut
70 à 100 kcal.

**Limite à connaître :** l'estimation d'une dépense de musculation a facilement ±20 %
d'incertitude, quel que soit le modèle. Elle sert à orienter une portion, pas à équilibrer
une comptabilité. C'est toujours la moyenne de poids sur 7 jours qui tranche.

## La balance Withings

### Mise en service

1. Crée une application sur <https://developer.withings.com> (type *Public API*).
2. URL de rappel : `https://<ton-domaine>/api/connect/withings/callback` — et, pour le
   développement, `http://localhost:3000/api/connect/withings/callback`. Withings exige
   que l'URL corresponde **exactement**, protocole et barre finale compris. L'écran
   *Profil → Connecteurs* l'affiche, prête à copier.
3. Colle l'identifiant et le secret dans **Profil → Connecteurs → Withings** (ils sont
   chiffrés dans le coffre), ou pose-les chez ton hébergeur — `NUXT_WITHINGS_CLIENT_ID`
   et `NUXT_WITHINGS_CLIENT_SECRET`, qui restent prioritaires.
4. Profil → Connecteurs → **Connecter**. Une seule fois : le jeton de
   rafraîchissement se renouvelle tout seul ensuite.

### Où vit le secret

Le `client_secret` ne quitte jamais le serveur : il vit dans les variables de
l'hébergeur, ou chiffré dans le coffre (AES-256-GCM, clé dérivée de
`NUXT_VAULT_SECRET`), et n'est jamais relu vers le navigateur. Le navigateur ne détient
que les jetons du compte, dans son `localStorage`, comme le reste des données de
l'application. Un jeton volé donne accès aux pesées ; un secret volé donne accès à
l'application entière et à tous ses utilisateurs. Ce n'est pas la même perte.

Corollaire assumé : les jetons transitent une fois par l'URL de retour
(`/?withings=ok&access_token=…`). `adoptWithings()` les range immédiatement puis
réécrit l'URL via `history.replaceState` — laisser un jeton dans la barre d'adresse,
c'est le laisser dans l'historique, les captures d'écran et les partages.

### Deux pièges de l'API

**Withings répond toujours HTTP 200.** Le vrai statut est dans le champ `status` du
corps. Traiter la réponse comme réussie parce que le code HTTP vaut 200 fait passer une
erreur de jeton pour un jeu de données vide — et le bug devient introuvable. `_client.ts`
lève sur `status !== 0`.

**Chaque valeur est encodée `value × 10^unit`.** `74850` avec `unit = −3` vaut 74,85 kg.
Oublier l'exposant donne des poids à cinq chiffres, ce qui se voit tout de suite ; l'oublier
sur la masse grasse donne des pourcentages plausibles mais faux, ce qui ne se voit jamais.

### Pas de webhook

Withings sait notifier un serveur à chaque nouvelle mesure. Sans base de données côté
serveur, cette notification n'a personne à prévenir : le navigateur est fermé. La
synchronisation se fait donc à l'ouverture de l'onglet, au plus une fois par heure. Pour
une pesée par jour, c'est strictement équivalent.

### Ce qui est calculé

| Fonction | Ce qu'elle répond |
|---|---|
| `dailySeries` | Une valeur par jour + moyenne glissante sur 7 jours. |
| `weeklySlope` | Pente en kg/semaine, régression linéaire sur les 14 derniers jours. |
| `composition` | Quelle part de la perte vient du gras, quelle part du muscle. |

Le poids d'un jour ne veut rien dire : sel, glycogène, transit et hydratation le font
varier d'un kilo d'un jour à l'autre. **Seule la moyenne glissante se lit**, et c'est
elle, pas la pesée du matin, qui doit déclencher une décision.

`composition` est le seul apport réel d'une balance à impédancemétrie. En déficit, la
question n'est pas « est-ce que je perds » mais « qu'est-ce que je perds ». En dessous de
65 % de gras dans la perte (`LEAN_LOSS_ALERT`), l'appli conseille de remonter de 150 à
200 kcal plutôt que de descendre encore.

⚠️ Le pourcentage **absolu** d'une balance grand public se trompe couramment de 3 à
5 points. C'est son **évolution** qui est exploitable, et seulement en se pesant toujours
dans les mêmes conditions : le matin, à jeun, après être passé aux toilettes, avant de
boire. `IMPEDANCE_CAVEAT` le rappelle sous le tableau des mesures.

### D'où viennent les pas

La balance ne compte pas les pas. Ils viennent de l'appli Withings, qui doit être
alimentée par une source :

| Téléphone | Source | Où l'activer |
|---|---|---|
| Android Samsung | Samsung Health | Appli Withings → Profil → Apps → Samsung Health → Activer, cocher **Pas** |
| iPhone | Apple Santé | Appli Withings → Profil → Apps → Apple Santé, autoriser Pas et Distance |
| Android autre | — | Google Fit est fermé depuis mai 2024. Reste la saisie manuelle des pas dans le planning. |

Une fois la source reliée, `getactivity` renvoie ces pas comme n'importe quels autres :
côté appli, rien ne distingue un pas venu d'un bracelet d'un pas venu du téléphone.

⚠️ **Le compteur du jour en cours est partiel.** À 9 h il affiche 800 pas. L'écrire tel
quel ferait tomber la cible calorique sous l'estimation — l'appli conseillerait de moins
manger au petit-déjeuner au motif qu'on n'a pas encore marché. `pushToJournal()` ne révise
donc la journée en cours que **vers le haut**, quand le réel dépasse l'estimation
(3 500 pas en télétravail, 7 500 sur site). Les jours passés, complets, sont écrits tels
quels.

Les calories d'activité renvoyées par Withings sont **ignorées** : seul le nombre de pas
est repris, et la dépense est recalculée avec `stepsBurn` à partir du poids du jour. Sinon
la marche serait comptée deux fois — une fois par Withings, une fois par le modèle — et le
déficit affiché serait faux.

### Balance partagée : la quarantaine

Une Body Smart accepte jusqu'à 8 utilisateurs et reconnaît qui monte dessus **au poids**.
Deux garde-fous, à deux niveaux différents.

**Niveau compte (structurel).** Le jeton OAuth est lié à un `userid` Withings :
`getmeas` ne renvoie que les mesures de cet utilisateur. Si l'autre personne a **son
propre compte Withings**, invité à partager la balance, ses pesées ne transitent jamais
par ce jeton — l'isolation est garantie par le protocole, pas par du code. C'est la
configuration à privilégier (un profil secondaire *dans* le même compte partage les
données ; un compte invité, non).

**Niveau donnée (défensif).** Reste le cas que rien ne peut empêcher : la balance
attribue la pesée à la mauvaise personne *avant* de l'envoyer. `flagOutliers()` met en
quarantaine toute pesée qui s'écarte de plus de `suspectThreshold(gap)` de la **médiane
des trois dernières pesées retenues** :

- 3 kg de base — le corps varie de 1 à 2 kg par jour (sel, glycogène, transit,
  hydratation), jamais de trois ;
- +0,15 kg par jour sans pesée, plafonné à 8 kg — trois semaines d'absence, ça bouge
  vraiment ;
- médiane et non valeur précédente : sinon une seule mesure aberrante déplace la
  référence et fait passer toutes les vraies suivantes pour suspectes à leur tour ;
- les saisies manuelles et les pesées confirmées ne sont jamais remises en doute.

Rien n'est supprimé. La pesée est affichée, exclue de la courbe, de la pente, de la
composition et du poids servant au métabolisme de base, avec deux boutons : **C'est moi**
(persiste la confirmation) ou **Supprimer**. Écarter en silence une vraie pesée serait
pire que le problème traité.

Limite assumée : si l'intruse tombe dans les **deux premières** pesées de l'historique,
il n'y a pas encore de tendance à laquelle la comparer, donc elle passe.

### Branchement sur le reste

À chaque synchronisation réussie, `pushToJournal()` reverse les données là où l'appli les
attend déjà : les pas dans `setSteps` (ils entrent dans la dépense du jour, à la place de
l'estimation télétravail / sur site), le poids du jour dans `addBodyWeight` (il alimente
Mifflin-St Jeor, donc la cible calorique). Aucune nouvelle notion : la balance remplit des
champs qui existaient et se saisissaient à la main.

## Les photos de plats

Une photo par plat, prise après cuisson, stockée **sur le téléphone**. La nouvelle
remplace l'ancienne.

Trois points d'entrée, tous sur le même composant `Photo.vue` :

- **Plats** — bouton sur chaque carte de la bibliothèque ;
- **Cuisine** — à côté de chaque recette de la todo de batch cooking, le moment où le
  plat est justement devant toi ;
- **Jour** — sur chaque repas, au-dessus de la coche.

La photo appartient à la **recette**, pas à la date : la reprendre un autre jour
remplace simplement l'ancienne, où qu'on l'ait déclenchée.

### IndexedDB, pas localStorage

Trois raisons, dans l'ordre d'importance :

1. `localStorage` plafonne autour de 5 Mo. Une seule photo d'iPhone en fait 4.
2. `localStorage` ne stocke que du texte : il faudrait passer en base64, soit **+33 %**
   de volume pour rien. IndexedDB stocke un `Blob` tel quel.
3. Surtout : une `QuotaExceededError` sur `localStorage` fait échouer les écritures des
   **autres** clés — planning, repas cochés, liste de courses. Une photo trop lourde ne
   doit pas pouvoir emporter le suivi avec elle.

Base `gr-photos`, magasin `dishes`, clé = identifiant du plat.

### Comment la taille est tenue

| Étape | Règle | Pourquoi |
|---|---|---|
| Décodage | `createImageBitmap(file, { imageOrientation: 'from-image' })` | Sans ça, une photo prise en portrait sur iPhone ressort couchée : le capteur enregistre en paysage et note la rotation en EXIF, que canvas ignore. |
| Plein format | côté long ≤ **1024 px**, WebP **0,72** | La carte la plus large fait ~340 px CSS ; même à 3×, 1020 px suffisent. Au-delà on stocke des pixels que personne ne verra. |
| Vignette | côté long ≤ **192 px**, WebP **0,70** | La bibliothèque affiche quinze plats d'un coup. Décoder quinze images de 1024 px pour des cases de 56 px coûte de la mémoire et un à-coup au défilement. |
| Repli | JPEG si `toBlob` ne rend pas du WebP | WebP fait ~30 % de moins à qualité perçue égale, mais un navigateur qui ne sait pas l'encoder renvoie du PNG (énorme) ou `null`. |

Résultat : une photo d'iPhone de ~4 Mo est stockée en **~90 Ko** (plein + vignette).
Trente plats photographiés tiennent sous 3 Mo. L'onglet Plats affiche le total et
signale les photos orphelines — celles dont le plat a été supprimé — avec un bouton
pour les nettoyer, sinon elles occupent l'espace à vie.

`hydrate()` ne charge que les **métadonnées** (taille, dimensions, date). Les blobs sont
lus à la demande, et chaque URL d'objet est mise en cache puis révoquée au remplacement :
sans ce cache, chaque rendu recrée une URL et l'ancienne fuit jusqu'au rechargement.

### Ce qui est refusé, et pourquoi c'est dit

`rejectReason()` filtre avant tout traitement. Le cas qui compte est le **HEIC** : c'est
le format par défaut de l'iPhone et aucun navigateur ne sait le décoder en canvas. Plutôt
qu'un échec obscur, le message donne le réglage à changer (Réglages → Appareil photo →
Formats → « Le plus compatible »). Note que le partage vers une app web convertit
généralement en JPEG au passage, donc le cas est rare en pratique.

L'`<input type="file">` est volontairement **sans l'attribut `capture`** : avec, le
téléphone ouvre directement l'appareil photo et interdit de choisir une image existante.
Sans, iOS et Android proposent les deux — et le plat a souvent été photographié avant
qu'on pense à ouvrir l'appli.

### ⚠️ Les photos ne sont pas dans la sauvegarde JSON

C'est délibéré : les inclure imposerait le base64 (+33 %) et ferait passer un export de
80 Ko à plusieurs mégaoctets, à chaque sauvegarde. Les photos sont donc la seule donnée
du module qui ne survit pas à un effacement des données du navigateur. Si tu y tiens,
le plus simple est de les enregistrer aussi dans la pellicule au moment de les prendre.

## Où vit quoi

Trois écrans affichaient le poids (Profil, Rapport, onglet Corps de la nutrition) et
trois vues affichaient la même semaine (calendrier du Journal, liste des séances,
planning nutrition). Chaque chiffre existait en plusieurs exemplaires, avec le calcul
de l'IMC et du métabolisme copié dans trois fichiers.

| Écran | Ce qu'il porte |
|---|---|
| **Accueil** | Séance du jour + bandeau nutrition (camembert, frise, saisie rapide) |
| **Journal** | **Un calendrier, rien d'autre.** Un clic sur un jour ouvre la feuille complète |
| **Progrès** | Trois sections : Corps (pesées, composition, pas, énergie) · Séances (volume par muscle, records, fatigue) · Exercices (courbes de charge) |
| **Nutrition** | Cuisine (courses puis préparation) · Plats |
| **Profil** | Réglages seulement : identité, semaine type, son, montre, sauvegarde |

« Rapport » et « Progrès » ont fusionné : les deux répondaient à la même question —
est-ce que ça avance — pour trois objets différents (le corps, le volume
d'entraînement, la charge par exercice). Deux onglets voisins obligeaient à comparer
de tête ce qui appartient au même bilan. La barre du bas passe de six onglets à cinq.

### Le Journal

Le calendrier porte quatre repères par case : point de couleur (séance faite), cercle
creux (séance prévue), carré ambre (télétravail), trait bleu (pesée). **Toutes** les
cases sont cliquables, y compris les jours à venir — le calendrier porte le planning
autant que l'historique.

La feuille de jour (`DaySheet.vue`) répond d'un coup à « qu'est-ce qui s'est passé ce
jour-là, et qu'est-ce que je dois manger » : bascules salle/télétravail, cible calorique
décomposée, séances enregistrées (cliquables pour modifier), repas avec horaires, choix
des plats, pesée et pas.

Le métabolisme y est calculé avec le **poids connu à cette date-là**, pas le poids
d'aujourd'hui : relire une semaine d'il y a un mois doit montrer la cible qui valait
alors.

### Un seul stockage pour le poids

Le poids vivait dans deux magasins : `gr-bodyweight-v1` (saisie manuelle, module
séances) et `gr-withings-body-v1` (balance). Une pesée notée d'un côté était invisible
de l'autre.

`useWithings.absorbLegacy()` absorbe l'ancien une seule fois, en saisies manuelles, sans
écraser ce que la balance a déjà fourni. Ensuite `mirror()` recopie les pesées retenues
— hors quarantaine — dans la série simple « une date, un poids » du module séances,
après chaque synchro, saisie, confirmation ou suppression.

Pourquoi garder un miroir plutôt que tout brancher sur le magasin riche : le métabolisme
de base, le lest des exercices au poids du corps et l'export lisent tous cette série-là.
Les faire pointer un par un vers le magasin riche multiplierait les endroits à ne pas
oublier. L'import est à sens unique — `useWithings` connaît `useWorkout`, l'inverse est
faux — donc pas de cycle.

## Les écrans, après simplification

Cinq sous-onglets dans la nutrition (Jour, Plats, Courses, Cuisine, Corps), et on s'y
perdait. Ils ne servaient pourtant que **trois rythmes** :

| Rythme | Où c'est maintenant |
|---|---|
| Tous les jours — manger | **Accueil** : camembert + quatre chiffres + un bouton qui ouvre la feuille |
| Toutes les semaines — acheter puis cuisiner | **Nutrition → Cuisine**, dans cet ordre |
| De temps en temps — régler les plats | **Nutrition → Plats** |

Manger est une **action**, pas une destination : ça s'ouvre en feuille depuis l'accueil,
exactement comme on démarre une séance. Un onglet permanent pour un geste répété cinq
fois par jour obligeait à naviguer avant chaque bouchée.

Courses et préparation sont empilées dans l'ordre où on les fait — on achète samedi, on
cuisine dimanche. Deux sous-onglets auraient coupé en deux un geste qui n'en est qu'un.

### Le bandeau d'accueil

Un camembert (kcal restantes, consommé/cible en dessous), le **prochain repas** en gros
avec son bouton « Mangé », et quatre chiffres : protéines sur cible, repas pris, séance,
pas. Les protéines passent au vert quand la cible est atteinte — c'est le garde-fou de la
masse maigre en déficit, contrairement aux glucides qui ne se pilotent pas.

La frise complète des repas a quitté l'accueil pour la feuille : elle faisait défiler
l'écran qu'on regarde le plus souvent.

### Le calendrier : que du réel

Il n'affiche **que ce qui a eu lieu** — séances enregistrées, télétravail confirmé le
jour même. Le prévisionnel en a été retiré : relire son historique à travers ses
intentions ne dit rien de ce qui s'est passé, et une grille pleine de « prévu » se lit
comme une grille pleine de fait.

Séance et télétravail sont indépendants (un mardi peut être les deux), ils ont donc
chacun leur canal plutôt qu'une ligne de repères illisible à 44 px :

| Signal | Ce qu'il dit |
|---|---|
| **Pastille pleine** (couleur de la séance) | séance enregistrée |
| **Fond ambre** | télétravail confirmé ce jour-là (`ttConfirmed`, pas la semaine type) |
| Chiffre du bas | cible calorique du jour |

Le numéro du jour vit **dans** la pastille : un cercle et un chiffre côte à côte
faisaient deux objets pour une seule information.

Les jours des **mois voisins** sont affichés en gris et ne font que **changer de mois**
au clic. La grille fait toujours 42 cases, donc sa hauteur ne saute plus d'un mois à
l'autre et une semaine qui commence un jeudi n'a plus de trous.

### La feuille de jour

Elle **montre**, elle ne règle plus rien. Les bascules salle/télétravail et le choix des
plats en sont sortis : c'était un deuxième endroit pour régler ce qui se règle déjà
ailleurs, et ça transformait une page de consultation en formulaire. Restent la cible
décomposée, les séances (cliquables pour les rouvrir), les repas avec ceux déjà cochés,
et un bouton « Compléter les repas » qui ouvre la feuille du jour. Les repas ne se
cochent que le jour même.

### Ce qui a disparu de la vue nutrition

- **La bascule « salle »** : la déclarer le matin ne servait à rien, puisque la séance
  enregistrée le midi le dit d'elle-même. Jusque-là, la semaine type suffit comme
  hypothèse — et c'est elle qui porte la portion haute, celle qu'on peut retirer.
- **La saisie des pas** : ils viennent de la balance. Les taper à la main était un
  travail pour rien.

Reste le lieu de travail, seul réglage que rien d'autre ne peut deviner.

### Les plats

Grille qui se réorganise seule (`auto-fill`, colonnes de 178 px minimum) plutôt qu'une
carte par ligne : on reconnaît un plat à son image bien avant de lire son nom, et seize
lignes pleine largeur, c'était seize écrans à faire défiler.

Chaque plat livré a une **illustration de repli** dans `public/plats-demo/`. Ce sont des
visuels générés, volontairement flous et abstraits : ils situent le plat sans prétendre
le montrer, et sont légèrement désaturés pour ne pas se faire passer pour une photo de
ce qui a réellement été cuisiné. Une vraie photo les remplace ; un plat créé à la main
n'en a pas (`@error` masque l'image absente et le bouton appareil revient). ~2 Ko pièce,
33 Ko au total.

### L'accueil

Une seule carte, dont l'**ordre change avec la largeur** — c'est une grille nommée
(`grid-template-areas`) et non des `order` en flex, pour que les deux dispositions
restent lisibles l'une à côté de l'autre dans la feuille de style.

**Au-dessus de 620 px** : camembert à gauche, séance du jour à droite, séparés par un
filet — les deux questions du matin sur la même ligne. Puis les compteurs, la note
hebdo et les boutons, sur toute la largeur.

**Sur téléphone** : tout s'empile, et la séance passe **après** le bouton « Remplir mes
repas ». On ouvre l'appli pour manger cinq fois par jour et pour s'entraîner une : au
premier coup d'œil, l'écran doit répondre à la question fréquente, pas à la rare.

La séance est passée en **slot** du bandeau nutrition (`<template #session>`) : c'est
`pages/[[onglet]].vue` qui fournit son contenu, le bandeau ne connaît rien des séances.

### Qui règle quoi

Chaque réglage n'a qu'un seul endroit, choisi selon ce qu'il change :

| Réglage | Où | Pourquoi là |
|---|---|---|
| Semaine type (salle, télétravail) | **Profil** | C'est un cadre, il ne bouge pas |
| Télétravail d'un jour donné | **Journal** → feuille du jour | Ça change la cible de ce jour |
| Photo d'un plat | **Nutrition → Plats** | Elle appartient à la recette, pas au jour |
| Connexion de la balance | **Profil** | C'est un réglage d'appareil, comme la montre |

La feuille **Mes repas** ne fait donc que cocher des repas : plus de bascule télétravail
(on y déclare ce qu'on mange, pas où l'on travaille), et les photos y sont en lecture
seule via `Thumb.vue` — un composant distinct de `Photo.vue`, qui ouvre lui un sélecteur
de fichier et un aperçu plein écran.

Le Rapport affiche les mesures de la balance et **renvoie vers Profil** quand rien n'est
connecté : lire ses pesées et administrer un compte OAuth sont deux choses différentes.

### L'ajustement ne porte que sur ce qui reste

`adjustRemaining()` remplace le calcul sur la journée entière. Il compare la cible à ce
qui a **déjà** été avalé (repas cochés + extras notés) et ne répartit le solde que sur
les repas à venir.

Sans ça, quelqu'un qui avait allégé son déjeuner de lui-même se voyait retirer autant le
soir : la même correction appliquée deux fois. Un écart déjà encaissé ne se paie plus
qu'une fois — et un déjeuner sauté ne fait plus baisser le dîner.

### Les champs

Les `<select>` natifs sont remplacés par `SportSelect`, le menu déroulant maison déjà
utilisé dans le profil : la liste d'options d'un `<select>` ne peut pas être stylée, et
celle du téléphone tranchait avec tout le reste. L'option « pas de plat imposé » est
nommée `Cycle · <plat>` plutôt que laissée vide — sinon le bouton affiche un tiret et on
ne sait plus si un plat est imposé.

La saisie de pesée reprend l'habillage `.field` du profil, avec deux raccourcis
« Aujourd'hui » / « Hier » : neuf pesées sur dix sont l'une des deux.

## Le camembert, découpé par macro

Un anneau d'une seule couleur disait le **combien** sans jamais dire le **quoi** — alors
que c'est le quoi qui décide si la perte vient du gras ou du muscle.

`donutArcs()` renvoie un arc par macro, **bout à bout** et non superposés : leur somme
est la progression totale, donc le cercle répond aux deux questions d'un coup. Vert pour
les protéines, ambre pour les glucides, brun pour les lipides — délibérément neutre, une
couleur d'alerte laisserait croire qu'il faut les fuir alors que c'est un plancher à
atteindre. Les arcs sont tronqués à un tour : au-delà ils se superposeraient.

Toucher le cercle ouvre le détail des écarts.

### Les cibles par macro

`macroTargets(kg, kcalTarget)` :

| Macro | Cible | Statut |
|---|---|---|
| Protéines | `2,1 g/kg` | **plancher** — protège la masse maigre |
| Lipides | `0,8 g/kg` | **plancher** — production hormonale, vitamines A/D/E/K |
| Glucides | ce qui reste | **variable d'ajustement** |

Protéines et lipides sortent du poids de corps et ne se négocient pas quand les calories
baissent. Les glucides absorbent le déficit — c'est exactement pour ça que le plan ne
retire jamais que des féculents.

Deux garde-fous dans `macroGaps()` :

- **`MACRO_BAND` = 12 %** de tolérance avant de signaler quoi que ce soit. Les tables de
  composition se trompent couramment de 10 % : parler d'un écart de 5 g serait présenter
  du bruit comme un signal.
- **Aucun excès de protéines n'est reproché.** Au-delà de la cible le surplus est brûlé
  ou stocké comme le reste, jamais au détriment du muscle — une alerte « trop de
  protéines » en déficit serait un mauvais conseil.

Chaque écart est accompagné de quoi en faire, en aliments concrets : 200 g de fromage
blanc valent 16 g de protéines, une dose de whey 24, une cuillère d'huile d'olive 10 g de
lipides.

## Le cycle de 14 jours n'est qu'un pré-remplissage

Le plan livré couvre 14 jours, mais **l'appli ne les met plus en scène** : plus de
« semaine A / semaine B », plus de position dans le cycle affichée. C'était donner à
voir une mécanique interne, et laisser croire que l'outil impose un programme.

`cycleIndexFrom(startIso, iso)` compte les jours **depuis le démarrage choisi** (le
dimanche où l'on commence) et renvoie `null` au-delà de `PRECONFIG_DAYS = 14`. Passé
les deux semaines, l'appli ne propose plus rien d'elle-même — un plan qui continue
indéfiniment de resservir ce qu'il a calculé une fois finit par proposer à côté.

## Ce qui pilote vraiment : la sélection

`Selection` = `{ plat → portions }`. C'est d'elle que sortent la liste de courses, les
conseils de préparation, et le stock du frigo.

La liste se déduisait avant d'une **fenêtre de 7 ou 14 jours du cycle** : il fallait
accepter le menu tel quel pour obtenir une liste juste, et une semaine à trois plats
était impossible à exprimer. Partir des portions réellement prévues rend la liste vraie
pour trois jours comme pour deux semaines.

### L'onglet « Préparer », en trois étapes

| Étape | Ce qu'on y fait |
|---|---|
| **1. Ce que je cuisine** | On coche les plats et on règle les portions au +/−. Un bouton repart des 14 jours livrés, un autre vide tout. |
| **2. Courses** | `shoppingFromSelection()` additionne les ingrédients × portions et regroupe **par rayon, dans l'ordre des allées** — on remonte le magasin une fois au lieu de suivre l'ordre des recettes. Prix au kilo mémorisés, total, historique des paniers. |
| **3. Préparation** | `prepGroups()` regroupe **par geste et non par recette** : on ne cuit pas le riz de quatre plats en quatre fois. Féculents en vrac → protéines → légumes → mise en boîte → à cuisiner le soir même. |

### Ce qui n'est pas dans la sélection, mais bien dans les courses

La sélection ne porte que les **déjeuners et les dîners** : on ne choisit pas son
porridge, il est le même tous les jours. Mais on l'achète.

`staplesFor(days)` ajoute donc à la liste tout le **quotidien** — petit-déjeuner,
banane d'avant-séance, shaker, collations, créatine — dosé sur le nombre de jours que
la sélection représente (portions ÷ 2). Sans lui, huit aliments manquaient : flocons
d'avoine, fromage blanc, whey, fruits rouges, banane, créatine, pomme, amandes. On
rentrait du magasin sans petit-déjeuner ni collation.

Le dosage suit la **semaine type**, pas le nombre de jours : un jour sans séance n'a
ni banane ni shaker, en acheter autant que de jours reviendrait à en jeter. Un test
vérifie que les 31 aliments des 14 jours livrés se retrouvent bien dans la liste.

⚠️ `seedSelection()` retient **tous** les repas principaux, pas seulement ceux marqués
« se prépare à l'avance ». Un dîner cuisiné le soir même s'achète quand même : ne
garder que les plats *batch* donnait une liste de courses amputée de la moitié des
dîners, et on s'en apercevait devant le frigo. Le moment de la cuisson est une question
de **préparation**, pas de **courses** — d'où le groupe « à cuisiner le soir même », qui
le dit noir sur blanc. Les collations, elles, restent dehors : fromage blanc, banane et
whey s'achètent au paquet, pas à la portion.

Le rappel qui compte est dans le premier groupe : **les féculents ne se portionnent
pas**. C'est ce qui permet d'ajuster une assiette le soir d'une séance annulée — une
portion déjà pesée dans une boîte ne se reprend pas.

### Proposé, jamais imposé

Dans les 14 jours, le plat du créneau vient du menu pré-calculé ; au-delà,
`dayPlanFor()` **pioche dans la sélection** en tournant sur les plats retenus, pour
qu'il reste quelque chose à cocher sans que l'appli invente un programme.

Dans les deux cas, un bouton **⇄** sur chaque repas ouvre le frigo — les plats de la
sélection dont il reste des portions — et un geste suffit à dire « j'ai pris autre
chose ». C'est la réalité du batch cooking : sept boîtes au frigo, on prend celle dont
on a envie. Le plat réellement pris (`picked`) l'emporte alors sur le proposé, et
décrémente le stock.

## Comment le plan se calcule

Les grammages stockés dans `data/nutritionProgram.ts` sont ceux d'un **jour avec séance**.
Tout le reste est calculé à la volée, jamais stocké :

- **jour sans séance** → féculents du midi et du soir × 0,48, et le slot `pre` (banane)
  disparaît ;
- **jour avec séance** → féculents de la boîte du midi **× 1,6**, le dîner intact.

Ce dernier ratio a longtemps été l'inverse (dîner × 0,73, midi intact) et c'était l'erreur :
mesuré sur les quatorze jours du cycle, le plan tombait 80 à 190 kcal **sous** sa cible les
jours de séance pendant qu'il collait à la sienne les jours de repos. Le déficit tombait le
mauvais jour. Le levier est au déjeuner parce que c'est le repas qui suit la séance de vingt
minutes — et parce qu'on cuisine toujours la version « jour avec séance » : on peut laisser
du riz dans une boîte, on ne peut pas y ajouter celui qu'on n'a pas cuit.

- **laitier acheté plus gras que 0 %** → la quantité baisse (jusqu'à -50 %) et la
  protéine en poudre déjà présente dans la recette remonte pour tenir les protéines.

Le dernier point mérite son paragraphe. Le plan sert **730 g de laitier par jour** au
plus fort (fromage blanc + yaourt grec en sauce). Acheté en 3 % au lieu de 0 %, ça fait
**+154 kcal par jour** — le tiers du déficit — et rien ne l'affichait : le 0 % n'est pas
toujours en rayon, et personne ne change d'enseigne pour ça. Le taux se déclare
maintenant par produit (Plats → Aliments), les macros sont redérivées de l'étiquette, et
les grammages du plan suivent. Le rééquilibrage ramène les 154 kcal à 49 ; le reste est
CHIFFRÉ ET AFFICHÉ plutôt que forcé dans l'assiette, parce qu'on ne peut pas faire qu'un
laitier à 3 % se comporte comme du 0 % sans transformer le bol du matin en shaker.

Protéines, légumes et matières grasses ne bougent jamais. C'est ce qui protège la masse
maigre et garde la satiété constante quand les calories baissent.

Conséquence directe : **le bouton « séance annulée » recalcule toute la journée**, sans
qu'aucune donnée dupliquée n'ait à être maintenue. Une séance qui saute retire ~250 kcal.

## La rotation des dîners

Cinq dîners pour quatorze jours, et l'ordre n'est pas décoratif : il sort d'une recherche
sous contraintes, refaite le 12/08 quand le maquereau est sorti du plan.

| | |
|---|---|
| poisson blanc | ×3 |
| poulet | ×3 |
| saumon | ×3 |
| dinde | ×3 |
| omelette | ×2 |

Les règles, toutes verrouillées par un test :

- **jamais deux fois le même dîner à moins de 3 jours** (écart cyclique compris) ;
- **jamais la même protéine midi ET soir** — pas de poulet du soir un jour de Boîte A,
  pas de poisson du soir un jour de Boîte C au thon ;
- **l'omelette uniquement mercredi, samedi ou dimanche.** Ce sont les seuls jours où un
  plat qui se garde deux jours tombe en « à la minute » plutôt que dans la session du
  dimanche. Des œufs cuits trois jours à l'avance, c'est du caoutchouc ;
- **trois types de boîte par semaine maximum**, pour que la session du dimanche ne
  s'allonge pas.

### Le maquereau est sorti

Il avait été ajouté pour la vitamine D (20,7 µg par dîner) et les oméga-3. Il n'était pas
acheté — et un plat qu'on ne cuisine jamais n'est pas un plat, c'est un trou dans la
semaine. **La recette reste dans la bibliothèque**, choisissable à la main.

Sa vitamine D est reprise ailleurs, et mieux : **100 g de champignons exposés aux UV**
ajoutés au poisson blanc et au poulet, les deux dîners qui n'en avaient aucune (1,6 et
0,1 µg). À 10 µg pour 100 g et 22 kcal, c'est la source la moins chère du plan, et elle
était déjà dans la liste de courses pour la dinde et l'omelette.

```
                    avec maquereau      sans, + champignons UV
vitamine D               70 %                   81 %
oméga-3                 244 %                  185 %
```

## Régénérer les données

`data/exemple/nutrition.ts` est né d'un script Python qui servait de source de vérité
unique pour les calculs (le même qui a produit le plan). Si tu veux changer une
recette ou un grammage, l'idéal est de modifier le script et de régénérer, pour que le
fichier TS et l'analyse nutritionnelle ne divergent jamais. Sinon, éditer le TS
directement fonctionne aussi — les tests d'intégrité vérifient qu'aucune recette ne
référence un aliment absent de la table.

**Puis relance `npm run exemple`**, qui reconstruit `public/exemple.json`. C'est ce
fichier-là que l'application sert et importe, pas le TS : oublier l'étape laisserait
un exemple périmé en ligne. Un test le vérifie à l'octet près, donc l'oubli échoue
au lieu de passer inaperçu.

## Tests

```bash
npm test              # les deux projets
npm run test:nuxt     # câblage localStorage uniquement
```

Les deux projets passent en entier — `npm test` les enchaîne. Lance-les avant de
committer.

Presque tous tournent sur le **pack d'exemple**, déclaré fichier par fichier
(`vi.mock('../../data/nutritionProgram', …)`, voir `test/exemple.ts`) : vérifier que
la modulation des féculents ne touche pas aux protéines demande des aliments aux
vraies macros, pas trois objets fabriqués pour l'occasion. `test/unit/livreVide.test.ts`
et `test/nuxt/restauration.test.ts` sont les seuls à ne poser aucun mock — ils voient
`data/` tel qu'il est livré, donc vide, et c'est exactement le cas d'une installation
neuve.

## Précision des données

Valeurs Ciqual/USDA arrondies : compte ±5 % sur les macros et davantage sur les
micronutriments, qui varient beaucoup selon l'origine et la saison. C'est sans importance
tant que l'ajustement se fait sur la balance, pas sur le tableur. La couverture en
micronutriments dit ce que le plan **apporte**, pas ce que le corps **absorbe** ni où en
sont les réserves : seule une prise de sang répond à ça.
