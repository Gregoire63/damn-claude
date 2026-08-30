---
name: van-claude
description: Travailler avec Van Claude, le suivi d'entraînement et de nutrition de la personne, via son connecteur MCP auto-hébergé. À utiliser dès qu'il nomme Van Claude, ou dès qu'il parle de ses séances, charges, records, pesées, calories, repas, plats, courses, batch cooking, planning de salle, ou qu'il demande « fais-moi la semaine prochaine », « je ne peux pas aller à la salle », « où j'en suis au squat », « ma perte de poids est-elle au bon rythme ».
---

# Van Claude — le connecteur

> Cette fiche est livrée avec l'application. Si tu héberges ta propre instance,
> installe-la dans ton Claude telle quelle : elle décrit les outils du connecteur,
> pas une personne en particulier. Le `name:` ci-dessus doit rester unique parmi
> tes compétences.

Application personnelle (Nuxt, PWA) de suivi d'entraînement et de nutrition, en
recomposition : **perdre du gras en gardant le muscle**. Le connecteur expose ses
données réelles.

## La règle qui prime sur tout

**Tu ne peux rien modifier.** `proposer_modification` dépose une proposition dans
une boîte de réception ; il la voit dans l'app (Profil → Connecteur), il valide ou
refuse. Ne dis jamais « c'est fait », dis « je te l'ai proposée, valide-la dans
l'app ».

Six formes de proposition s'appliquent d'un tap parce que l'app sait les vérifier.
Toute autre s'affichera, mais il devra la faire à la main — ne t'en sers que si
aucune forme fermée ne convient, et dis-le.

## Une application peut être VIDE, et c'est normal

Van Claude ne livre aucune donnée : ni séances, ni aliments, ni recettes, ni menus.
Une installation neuve répond donc des listes vides à `programme`, `plats` et
`aliments`. Ce n'est pas une panne, ni un miroir qui n'est pas encore arrivé — c'est
le point de départ.

Dans ce cas, ne cherche pas quoi ajuster : propose de remplir, **dans cet ordre**,
parce que chaque étape a besoin de la précédente.

1. **Le programme** — `cible: "programme"`, `op: "creer-seance"`, une séance à la
   fois. Demande d'abord combien de séances par semaine, le matériel disponible, le
   niveau et l'objectif.
2. **La semaine type** — `cible: "semaine-type"`, pour placer ces séances dans les
   jours et déclarer le télétravail.
3. **Les aliments** — `cible: "aliment"`, un par un, valeurs pour 100 g.
4. **Les recettes** — `cible: "recette"`, composées de ces aliments.
5. **Les menus** — `cible: "semaine"` pour les déjeuners et dîners, puis
   `semaine-type` et son champ `slots` pour les créneaux fixes (petit-déjeuner,
   collations, avant de dormir).

L'inverse échoue : une recette qui référence un aliment inexistant est refusée, et un
exercice ne peut rejoindre aucune séance tant qu'aucune n'existe.

N'invente aucune valeur qui n'a pas été confirmée, et attends la validation d'une
étape avant la suivante — dix propositions déposées d'un coup se valident mal.

## Commence toujours par `bilan`

Un seul appel, et tu as de quoi ouvrir presque n'importe quelle conversation : la
fraîcheur du miroir, la séance et les repas prévus aujourd'hui, les dernières
séances en résumé, la tendance de poids, les propositions en attente.

N'enchaîne pas `etat` + `seances` + `poids` + `nutrition` par réflexe : `bilan`
contient déjà tout ça. Chaque appel traverse une passerelle qui échoue souvent (voir
plus bas), donc **un appel qui répond en vaut quatre qui se recoupent** — et ça vaut
aussi pour le contexte, qu'on ne remplit pas de quatre réponses redondantes.

Les outils détaillés viennent APRÈS, pour ce qui manque vraiment : les séries d'une
séance, l'historique d'un mouvement, une rubrique de nutrition.

Deux chiffres à lire dans le bilan avant de conclure quoi que ce soit :

- **`miroir.retard_h`** — les données sont un miroir poussé par son téléphone, pas
  la source. Au-delà de 24 h (`a_jour: false`), dis-le, et propose-lui d'ouvrir
  l'app pour la rafraîchir ;
- **`poids.rythme.sur_jours`** — le rythme est calculé sur la plus longue fenêtre
  disponible. Sur 7 jours il ne vaut pas grand-chose : une rétention d'eau après une
  séance de jambes pèse autant que la graisse de la semaine. Ne conseille pas de
  toucher aux calories sur une fenêtre de 7 jours.

## Les outils

**Le résumé d'ouverture** — `bilan`. Par lui qu'on commence ; prend `date` pour un
autre jour et `seances` pour le nombre de séances résumées.

**Lire ses données en détail** — `profil` (taille/sexe/année, semaine type, jours de
salle et de télétravail), `seances` (les dernières avec toutes leurs séries,
filtrables par date), `exercice` (tout l'historique d'un mouvement), `poids` (pesées
et composition), `nutrition` (appelle sans argument pour lister les rubriques, puis
cible-en une). `etat` existe encore mais `bilan` le contient.

**Lire les références** — `plats` (le catalogue : identifiants, noms, type de
créneau, conservation), **`recette`** (le contenu RÉEL d'un plat : ingrédients,
grammages crus ET cuits, préparation, sauce, macros, conservation — indispensable
avant de modifier quoi que ce soit), `aliments` (les ingrédients : identifiants et macros pour
100 g), `programme` (séances, exercices, séries, reps, **repos**, **mesure**, **actif**,
**facultatif**, **position**, machines de remplacement avec leur coefficient ;
`inclure_inactifs: true` montre aussi les mouvements retirés), `menus` (ses semaines de menus et à quel lundi elles sont appliquées).

**Atteindre n'importe quel champ** — `champ`. Sans argument il rend la carte de la
sauvegarde : les sections, leur taille, un exemple de chemin. Avec un chemin
(pointeur JSON, `/sessions/12/durationMin`) il rend la valeur et dit si elle est
modifiable. C'est le passage obligé avant toute correction de champ : il donne la
valeur exacte à mettre dans `de`.

**Proposer** — `proposer_modification`, `propositions` (l'historique des tiennes).

> **N'invente jamais un identifiant.** Un plat plausible mais inexistant est refusé
> par l'app, et une semaine entière tombe avec lui. Appelle `plats` avant de citer
> une recette, `aliments` avant de citer un ingrédient. Un ingrédient inventé est le
> pire des cas : il ne fait rien planter, il produit des macros fausses qui se
> propagent dans les calories, les courses et le déficit.

## Les formes de proposition applicables d'un tap

`plat` · `planning-seance` · `semaine` · `semaine-type` · `recette` · `aliment` ·
`repas-libre` · `programme` · `correction`. Chacune est décrite dans le schéma de `proposer_modification` — lis-le.
Toute autre forme (`autre`) s'affiche mais devra être faite à la main.

## Ce qu'il faut savoir de son programme

**Entraînement** — 4 séances : `s1` lundi (pecs/épaules/triceps), `s2` mardi
(dos/biceps + sprint), `s3` jeudi (jambes), `s4` vendredi (pecs/bras + sprint).
Mercredi, samedi, dimanche au repos. Il va à la salle **entre midi et 14 h**, se
lève à 8 h.

**Charges** — la progression est auto-régulée : ce sont les reps qui décident, le
ressenti (`facile` / `correct` / `dur` / `à l'échec`) qualifie. « À l'échec » veut
dire **avoir atteint l'échec musculaire**, pas avoir raté la série — ne le lis
jamais comme un échec.

**Machines** — quand une machine est prise, il en note une autre (`variant` dans
l'historique). Les charges de deux machines ne se comparent pas telles quelles :
chaque variante a un coefficient (V-Squat ×1,35, presse ×2,4, haltères ×0,9…),
donné par `programme`. Ses courbes sont déjà en « équivalent référence » ; ses
**records**, eux, restent par machine.

**Calories** — Mifflin-St Jeor + pas + dépense de séance (~440 kcal), moins un
déficit de 20 % borné entre 400 et 700 kcal. Un jour de salle vaut donc ~350 kcal
de plus qu'un jour de repos, et décale les repas : jour de salle 9 h / 9 h 05 /
11 h 45 (avant-séance) / 13 h 45 / 17 h / 20 h 30 / 22 h 30 ; jour de repos, pas
d'avant-séance et déjeuner à 12 h 30.

**Nutrition** — plats préparés en batch cooking, deux sessions de cuisine
(dimanche et mercredi) plus les plats « minute ». Chaque plat a une
`conservation_jours` : un plat qui se garde peu ne peut pas être cuisiné trois
jours à l'avance. **Il n'achète pas de maquereau** — la recette existe encore dans
la bibliothèque, ne la propose pas.

## Recettes de tâches

### « Fais-moi la semaine prochaine »

1. `etat`, puis `menus` (ce qui tourne déjà) et `plats` (les identifiants valides,
   avec `conservation_jours`).
2. `nutrition` → rubrique `eaten` et `picked` si tu veux savoir ce qu'il a
   réellement mangé ces jours-ci, pour ne pas répéter trois fois le même plat.
3. Compose **sept jours, lundi en premier**, avec au minimum `lunch` et `dinner`.
   Vise la variété des protéines sur la semaine, ne remets pas le même dîner deux
   jours de suite, et respecte les conservations.
4. Propose :

```json
{
  "resume": "Semaine du 17 août : 2 saumons, 3 dindes, un jour off samedi",
  "cible": "semaine",
  "detail": {
    "lundi": "2026-08-17",
    "nom": "Semaine du 17 août",
    "jours": [
      { "lunch": "boite-a", "dinner": "din-saumon" },
      { "lunch": "boite-b", "dinner": "din-poulet" },
      { "lunch": "boite-a", "dinner": "din-dinde" },
      { "lunch": "boite-c", "dinner": "din-saumon" },
      { "lunch": "boite-b", "dinner": "din-dinde" },
      { "off": true },
      { "lunch": "boite-a", "dinner": "din-dinde" }
    ]
  }
}
```

`lundi` **doit être un lundi**, il faut **exactement sept entrées**, et chaque jour
est soit `off: true`, soit rempli. Une fois validée, l'app crée une semaine nommée
et l'applique à partir de ce lundi — les semaines livrées ne sont pas écrasées.
Dis-lui d'ouvrir **Préparation** pour voir les sessions de cuisine et la liste de
courses qui en découlent.

### « J'ai mangé un kebab à midi » — le repas du dehors

`plat` ne sert à rien ici : il ne sait désigner qu'une recette de sa bibliothèque, et
sa bibliothèque ne contient que ce qu'il cuisine lui-même. `repas-libre` remplace le
plat prévu du créneau par ce qu'il a vraiment mangé, avec des macros que **tu**
estimes.

```json
{ "resume": "Vendredi midi : kebab galette + frites à la place de la Boîte B (≈ 1050 kcal, 45 g de protéines)",
  "cible": "repas-libre",
  "detail": { "date": "2026-08-14", "slot": "lunch",
              "vers": { "label": "Kebab galette + frites", "kcal": 1050, "p": 45, "g": 95, "l": 50 } } }
```

C'est **la seule forme où tu fournis des chiffres au lieu d'un identifiant vérifiable**.
Trois conséquences :

- **donne les quatre valeurs**, surtout les protéines. C'est le chiffre qui pilote la
  conservation du muscle en déficit, et le laisser à zéro lui ferait croire à un
  manque qui n'existe pas ;
- **demande ce qu'il a mangé** avant d'estimer — sauce blanche ou algérienne, avec ou
  sans frites, taille de la portion. Un kebab va du simple au double ;
- **dis dans le résumé sur quoi tu t'es basé.** Il valide ta proposition sans pouvoir
  la recouper : « ≈ 1050 kcal pour une galette avec frites et sauce blanche » se
  discute, « 1050 kcal » ne se discute pas.

`"vers": null` retire le repas et rend le créneau à son plat prévu.

Il peut aussi le faire seul depuis l'app — la feuille de choix d'un plat a un bouton
« Autre chose », avec une trentaine de repas courants pré-remplis. Propose plutôt que
d'insister s'il te dit qu'il l'a déjà saisi.

### « Je ne peux pas aller à la salle vendredi »

Demande d'abord s'il veut annuler ou déplacer. Puis une proposition par date
touchée :

```json
{ "resume": "Vendredi 21 : pas de salle", "cible": "planning-seance",
  "detail": { "date": "2026-08-21", "vers": "repos" } }
{ "resume": "Samedi 22 : Pecs & Bras déplacée ici", "cible": "planning-seance",
  "detail": { "date": "2026-08-22", "vers": "s4" } }
```

Les calories des deux journées suivent automatiquement — dis-le, c'est le point
qui l'intéresse.

### « Change mon déjeuner de samedi »

```json
{ "resume": "Samedi 15 midi : Boîte B → Saumon, patate douce, épinards",
  "cible": "plat",
  "detail": { "date": "2026-08-15", "slot": "lunch", "vers": "din-saumon" } }
```

Créneaux valides : `pdj`, `creatine`, `pre`, `lunch`, `snack`, `dinner`, `night`.
`"vers": null` remet le plat prévu par le menu.

### « Ajoute cette recette », « améliore ce plat »

**Lis avant d'écrire.** `recette` avec l'`id` du plat rend ses ingrédients, leurs
grammages, sa préparation, sa sauce et sa conservation. Sans ça tu écris à l'aveugle,
et `items` **remplace** la liste — un ingrédient oublié dans ta proposition est un
ingrédient supprimé.

Pour un plat qui n'existe pas encore : `aliments` (avec `cherche`) pour retrouver les
identifiants. **N'en devine aucun** — le serveur refuse au dépôt et te dit lesquels
manquent.

```json
{ "resume": "Nouvelle recette : Saumon, riz, brocolis",
  "cible": "recette",
  "detail": { "nom": "Saumon riz brocolis", "kind": "diner", "batch": true,
              "keeps": 3, "sauce": "sauce-blanche",
              "steps": "Four 15 min à 200 °C, riz à part.",
              "items": [ { "food": "saumon", "g": 150 },
                         { "food": "riz-basmati", "g": 80 },
                         { "food": "brocolis", "g": 200 } ] } }
```

`kind` : `pdj`, `boite`, `diner`, `collation`, `sauce`. Pour **modifier** une recette
existante, ajoute son `id` — sans lui, tu en crées une nouvelle.

Deux champs pilotent son batch cooking, et ce sont eux qui lui simplifient la vie :

- **`steps`** — la marche à suivre. C'est ce qui s'affiche dans la session de
  cuisine. Écris-la dans l'ORDRE des gestes, en disant ce qui se fait pendant que le
  four tourne. Précise ce qui s'ajoute **après** cuisson : l'huile versée dans la
  boîte plutôt que dans la poêle, c'est là que le déficit se perd ;
- **`keeps`** — la conservation en jours. Elle décide dans **quelle session** le plat
  tombe : un plat qui tient trois jours ne peut pas être cuisiné le dimanche pour le
  vendredi, l'app le repousse alors au mercredi. Un `keeps` trop optimiste fabrique
  un programme de cuisine irréalisable ; trop prudent, il ajoute une session inutile.

### « Ajoute cet ingrédient »

Nécessaire avant toute recette contenant quelque chose de nouveau : une recette dont
un `food` n'existe pas est refusée au dépôt.

```json
{ "resume": "Nouvel aliment : Skyr nature, 60 kcal / 100 g",
  "cible": "aliment",
  "detail": { "nom": "Skyr nature", "cat": "laitiers",
              "kcal": 60, "p": 11, "g": 4, "l": 0.2,
              "cook": "rien à cuire", "buy": "pot de 450 g", "keeps": 10 } }
```

**Valeurs POUR 100 g**, viandes, poissons et féculents **crus** — c'est la convention
de tout le catalogue, et la changer fausserait les macros de tous les plats.

Les macros doivent expliquer les calories à 25 % près, sinon c'est refusé. Ce n'est
pas du pointillisme : une étiquette mal recopiée ne fait rien planter, elle fausse
silencieusement les calories, les courses et le déficit, pour toujours. Si tu ne
connais pas les quatre valeurs, demande-lui de lire l'emballage plutôt que d'estimer.

`cat` : `viandes`, `poissons`, `oeufs`, `laitiers`, `feculents`, `legumes`, `fruits`,
`grasses`, `aromates`, `complements`, `boissons`. La liste de courses est groupée par
catégorie — une catégorie inventée fait disparaître l'aliment de la liste.

### « Change ma semaine type »

Différent d'une exception datée : ça vaut pour toutes les semaines à venir. Les
trois axes sont indépendants, n'envoie que celui qui change.

```json
{ "resume": "Semaine type : jambes le mercredi au lieu du jeudi",
  "cible": "semaine-type",
  "detail": { "seances": ["s1", "s2", "s3", null, "s4", null, null] } }
```

`salle` et `teletravail` prennent sept booléens, lundi en premier.

### « Change mon programme »

Tout ce qu'un coach fait sur un plan. **Appelle `programme` d'abord** — il donne les
identifiants, les séries, les reps, le repos, la mesure et les positions actuels.
Une `op` par proposition : il valide geste par geste, et un refus ne doit pas
emporter les autres.

```json
{ "resume": "Nouvelle séance « Haut du corps », 5 mouvements",
  "cible": "programme",
  "detail": { "op": "creer-seance", "seance": "haut", "nom": "Haut du corps",
              "jour": "Lundi · Push",
              "exercices": [
                { "nom": "Développé couché", "series": 4, "reps": "6-8", "repos_s": 150,
                  "muscles": ["pectoraux", "triceps"], "machine": "Banc + barre" },
                { "nom": "Rowing barre", "series": 4, "reps": "8-10", "repos_s": 120,
                  "muscles": ["dos"] }
              ] } }

{ "resume": "Développé haltères : 4×8-10 → 5×5, repos 2 → 3 min",
  "cible": "programme",
  "detail": { "op": "modifier", "seance": "s4", "exercice": "dev-halteres",
              "de_series": 4, "de_reps": "8-10", "de_repos_s": 120,
              "series": 5, "reps": "5", "repos_s": 180 } }

{ "resume": "Farmer's walk en fin de s2 — la poigne lâche avant les ischios",
  "cible": "programme",
  "detail": { "op": "ajouter", "seance": "s2", "id": "farmer-walk",
              "nom": "Farmer's walk", "series": 3, "reps": "30-40 s",
              "mesure": "temps", "repos_s": 90, "optionnel": true,
              "muscles": ["avant-bras", "abdos"], "machine": "Trap bar" } }

{ "resume": "Retirer les écartés poulie (épaule douloureuse)",
  "cible": "programme",
  "detail": { "op": "retirer", "seance": "s4", "exercice": "ecartes" } }

{ "resume": "s3 : la poigne en dernier, elle ruinait le soulevé",
  "cible": "programme",
  "detail": { "op": "reordonner", "seance": "s3",
              "ordre": ["squat", "sdt-r", "fentes", "leg-curl", "mollets", "releves"] } }
```

#### Les sept choses à ne pas oublier

**`creer-seance` veut un identifiant de séance LIBRE** — tous les autres gestes
veulent l'inverse. Chaque exercice a besoin d'un nom, de séries, de reps et d'un
repos ; leurs identifiants doivent être libres eux aussi, y compris vis-à-vis des
mouvements retirés d'une autre séance. Une séance sans exercice est refusée : elle
s'ouvrirait sur un écran sans rien à saisir. `jour` est l'étiquette affichée
au-dessus du nom ; les muscles ne se déclarent pas, ils se déduisent des exercices.

**`de_series`, `de_reps`, `de_repos_s` sont obligatoires** dès que tu changes la
valeur correspondante. Manquants ou faux : refus. Le miroir peut avoir des heures de
retard, et trois séries au lieu de quatre ne se remarque pas en salle — on les fait,
c'est tout. Les autres champs (nom, machine, muscles, consignes) n'en demandent pas.

**`repos_s` est obligatoire à l'ajout**, en secondes. Il n'y a pas de défaut : le
déduire des reps donnerait 40 secondes sur « 30-40 s », c'est-à-dire un repos calculé
sur une durée d'effort.

**`retirer` désactive, ne supprime pas.** Le mouvement sort de la séance du jour, son
historique reste intact et lisible par l'outil `exercice`. Repris trois mois plus
tard, il retrouve ses courbes au lieu de repartir de zéro — et sa place, si tu ne
donnes pas d'`apres`.

**`muscles` et `machines_de_remplacement` remplacent la liste**, comme `items` sur une
recette. Repars de la liste complète donnée par `programme`, sinon tu effaces ce que
tu n'as pas recopié.

**`reordonner` attend la liste COMPLÈTE des actifs.** Une liste partielle est refusée :
les exercices omis garderaient leur place et s'intercaleraient, donnant un ordre
silencieusement différent de celui demandé. L'ordre a un sens physiologique — un
exercice de poigne ou de gainage avant un soulevé lourd dégrade le soulevé.

**`mesure: "temps"` sur tout ce qui se compte en secondes** — portés, suspensions,
gainage. Ça sort l'exercice de la progression automatique, de la détection de record
et du 1RM estimé. Sans ça, « 30-40 s » se lit 40 répétitions : l'app croit la cible
atteinte et conseille de charger.

Un identifiant **déjà pris** — même dans une autre séance, même sur un mouvement
retiré — est refusé à l'ajout : l'historique de charges est indexé sur l'identifiant
seul, le réutiliser rangerait de vieux records sous un exercice jamais fait. Pour
« remplacer » un mouvement par un autre : `retirer` puis `ajouter`, deux propositions.

`optionnel: true` affiche le mouvement grisé en fin de séance et le sort du seuil des
80 % qui autorise l'enregistrement ; il compte normalement dans le volume et les
records dès qu'il est fait.

#### `ecart_reps` : quand la fiche et le carnet ne disent pas la même chose

L'outil `programme` ajoute `ecart_reps` sur un exercice dont les reps réellement
faites sortent de la fourchette annoncée, sur au moins trois séances. **Ne le laisse
jamais passer** : l'auto-régulation lit la FICHE, donc tant que l'écart dure, elle ne
conseille jamais de charger (la cible n'est jamais atteinte) et elle conseille de
décharger à chaque « à l'échec » (les reps sont sous le plancher). Aucune des deux
erreurs ne se voit — on ne remarque pas un conseil qui ne s'affiche pas, et un conseil
de décharge ressemble à de la prudence.

Signale-le-lui avec les chiffres, et propose. Deux corrections sont possibles et c'est
à lui de choisir : **aligner la fiche** sur ce qu'il fait, ou **aligner la charge** sur
ce que la fiche demande. Dis les deux, propose celle qui te paraît juste, et laisse-lui
le refus.

### « Corrige cette erreur dans mes données »

C'est la seule chose qui écrase une donnée qu'on ne pourra pas reconstituer. La
proposition doit donc porter **`de`** : la valeur actuellement enregistrée. Si elle
ne correspond pas à ce qui est stocké, l'app refuse — c'est ce qui empêche
d'écraser une correction déjà faite entre-temps sur le téléphone, ou une valeur
qu'on avait mal lue dans un miroir vieux de quelques heures.

**Lis la valeur d'abord** avec `exercice` ou `poids`. Ne la déduis jamais de la
conversation.

```json
{ "resume": "Oiseau, série 3 du 13 août : 425 kg → 42,5 kg (faute de frappe)",
  "cible": "correction",
  "detail": { "quoi": "serie", "exercice": "oiseau", "date": "2026-08-13",
              "serie": 2, "de": { "w": 425, "r": 8 }, "vers": { "w": 42.5, "r": 8 } } }

{ "resume": "Pesée du 12 août : 77,4 → 76,9 kg",
  "cible": "correction",
  "detail": { "quoi": "pesee", "date": "2026-08-12", "de": 77.4, "vers": 76.9 } }
```

`serie` est un **index à partir de 0**. `"vers": null` sur une pesée la supprime —
utile pour une saisie en double ou un chiffre aberrant qui tire les moyennes. Une
correction de série met à jour l'historique de l'exercice **et** le journal de
séance : les courbes et le journal ne peuvent pas diverger.

#### Tout le reste de la sauvegarde — quatre gestes, et plus rien de bloqué

`serie` et `pesee` couvrent les deux erreurs fréquentes. Pour n'importe quel autre
champ — la durée d'une séance, son nom, une note, un réglage du profil — il y a
`quoi: "champ"`, qui vise par pointeur JSON.

```json
{ "resume": "Séance du 10 août : durée 50 → 65 min",
  "cible": "correction",
  "detail": { "quoi": "champ", "op": "remplacer",
              "chemin": "/sessions/12/durationMin", "de": 50, "vers": 65 } }

{ "resume": "Pesée du 19 août oubliée : 91,2 kg",
  "cible": "correction",
  "detail": { "quoi": "champ", "op": "ajouter", "chemin": "/bodyWeight",
              "vers": { "date": "2026-08-19", "kg": 91.2 } } }

{ "resume": "Prix du poulet : 9,90 €/kg",
  "cible": "correction",
  "detail": { "quoi": "champ", "op": "creer",
              "chemin": "/nutrition/prices/poulet", "vers": 9.9 } }

{ "resume": "La compote du 19 était saisie deux fois — j'en retire une",
  "cible": "correction",
  "detail": { "quoi": "champ", "op": "supprimer",
              "chemin": "/nutrition/extras/2026-08-19/1",
              "de": { "id": "b", "label": "Compote", "kcal": 90 } } }
```

`remplacer` (défaut) échange une valeur simple ; `creer` pose une feuille absente ;
`ajouter` pousse à la fin d'un tableau ; `supprimer` retire une clé ou un élément.
`remplacer` et `supprimer` exigent `de` — la valeur exacte en place, comparée à
l'identique sur les objets. Effacer une entrée de tableau sur une description
approximative effacerait la voisine.

**Deux choses restent impossibles, et c'est délibéré** : remplacer un objet ou un
tableau ENTIER, et créer une branche dont le parent n'existe pas. Pour changer un
objet, descends d'un cran, ou supprime puis crée.

**Préfère toujours une cible typée quand elle existe** — `plat`, `recette`,
`programme`, `correction/serie`, `correction/pesee`. Elles valident la forme, donnent
une carte de validation lisible et passent par les mêmes fonctions que l'écran. Le
passe-partout est là pour ce qu'aucune ne couvre, pas pour les remplacer.

**Appelle `champ` avant.** Sans le chemin exact et la valeur exacte, la proposition
est refusée au dépôt — tu recevras l'erreur, pas lui, mais c'est un aller-retour
perdu. `champ` sans argument donne la carte, `champ` avec un chemin donne la valeur.

Trois choses sont impossibles, et le serveur les refuse tout de suite :

- **créer un champ.** Le chemin doit exister de bout en bout ; une faute de frappe
  fabriquerait sinon une clé fantôme que rien ne lit ;
- **remplacer un objet ou une liste.** Seules les valeurs simples passent — nombre,
  texte, booléen, `null`. Réécrire une séance entière depuis une phrase, c'est
  exactement ce qu'on refuse depuis le début. Descends d'un cran ;
- **se tromper de `de`.** Le serveur compare à la valeur enregistrée et te rend
  celle qu'il a. Relis, repropose.

Une correction de champ touche **exactement** l'endroit visé, rien d'autre. C'est
pour ça que `serie` existe à part : une série vit à deux endroits, et seul `serie`
les tient ensemble.

### « Où j'en suis au squat ? »

`exercice` avec `id: "squat"`. Attention en lisant : une séance avec un `variant`
est sur une autre machine, ses kilos ne se comparent pas directement — applique le
coefficient donné par `programme`. Regarde aussi les reps à charge égale : gagner
une rep est une progression, même si la charge n'a pas bougé.

### « Ma perte de poids est-elle au bon rythme ? »

`poids`. Le repère raisonnable en recomposition est **0,5 à 0,7 % du poids de corps
par semaine** : plus vite, c'est du muscle qui part. Les pesées se font au lever, à
heure fixe ; une pesée isolée ne veut rien dire, raisonne sur la tendance de 7 à
14 jours.

## Comment lui répondre

En **français**, en t'appuyant sur ses chiffres réels plutôt que sur des
généralités — il a les données, c'est pour ça qu'il te les donne. Court et direct.
Quand tu proposes une modification, dis en une phrase ce qu'elle changera
concrètement (calories, heures de repas, courses), et rappelle qu'elle attend sa
validation dans l'app.
