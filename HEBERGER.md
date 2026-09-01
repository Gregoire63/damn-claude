# Héberger sa propre instance de Damn Claude

Ce suivi est fait pour tourner **chez toi**, sur ton hébergement, avec ton compte
Anthropic. Il n'y a pas de compte à créer chez moi, pas de serveur central, pas de
données qui transitent ailleurs que chez toi.

L'architecture le permet parce qu'elle est mono-utilisateur *par instance* : un
passkey, un miroir, une boîte de propositions. Ce n'est pas une limite qu'on
contourne, c'est le modèle — chacun sa copie.

---

## Ce que tu obtiens

- Un suivi de séances et de nutrition qui vit dans le navigateur de ton téléphone.
  Aucune donnée ne quitte l'appareil tant que tu ne l'y autorises pas.
- Un connecteur MCP que **ton** Claude peut lire, et dans lequel il dépose des
  propositions que tu valides d'un tap. Il n'écrit jamais directement.
- Une sauvegarde côté serveur (le miroir), qui sert aussi à changer de téléphone.

## Ce que ça demande

Un compte Netlify (l'offre gratuite suffit largement), un nom de domaine ou le
sous-domaine `.netlify.app`, et dix minutes.

---

## 1. Déployer

```bash
git clone <ce dépôt> mon-suivi
cd mon-suivi && npm install
npm run dev            # http://localhost:3000
```

Sur Netlify : « Add new site » → « Import an existing project ». La configuration
est déjà dans `netlify.toml` — commande `npm run build`, dossier `dist/`.

> **`npm run build`, jamais `nuxt generate`.** `generate` prérend tout en fichiers
> statiques : il n'y a alors aucun serveur, et les routes `server/api/**` n'existent
> pas. Le connecteur et la sauvegarde disparaissent sans message d'erreur.

L'application vit **à la racine** du domaine. Si tu la montes ailleurs, il faudra
reprendre le `scope` du service worker (`public/sw.js`) et les chemins du manifeste.

## 2. Poser les variables

Dans Netlify → Site configuration → Environment variables. `.env.example` liste les
mêmes, pour le développement local.

### Obligatoires

| Variable | À quoi ça sert | Comment la fabriquer |
|---|---|---|
| `NUXT_VAULT_SECRET` | Signe les jetons de session et du connecteur | `openssl rand -base64 48` |

### Et le code de démarrage ?

**Il n'y a rien à poser.** Il est fabriqué à chaque build et imprimé dans le journal
de déploiement :

```
  ┌─ Code de démarrage de ce déploiement ─────────────
  │  fc09d64f5471eed6
  │  À saisir une fois, pour poser le premier passkey.
  └───────────────────────────────────────────────────
```

Netlify → **Deploys** → le dernier déploiement. Ce journal n'est lisible que par le
propriétaire du site : le canal est déjà authentifié, exactement comme les variables
d'environnement, mais sans rien à configurer.

Le code ne sert **qu'une fois** — il est consommé dès que le premier passkey est
posé. Chaque build en fabrique un neuf, donc l'ancien ne vaut plus rien. « Tout
perdu » se règle par un redéploiement : c'est délibéré, se rouvrir la porte doit
demander l'accès au déploiement.

`NUXT_VAULT_BOOTSTRAP` reste acceptée et **l'emporte**, pour qui préfère tout décrire
dans sa configuration. C'est l'option la plus faible : elle redevient un secret
permanent, qui ne tourne que si on y pense.

> **Si tu as déjà posé cette variable**, aucun code n'est fabriqué et le journal ne
> t'en montrera pas — il te dira pourquoi. Retire-la chez ton hébergeur et
> redéploie : le code apparaîtra dans le journal du build suivant.

**Une fois entré, pose un passkey de secours** sur ton ordinateur (Profil →
Connecteur). Il ne demande aucun code, et c'est lui qui répond à « j'ai perdu mon
téléphone » — sans quoi tu dépends d'un redéploiement.

### Pour le connecteur Claude

| Variable | À quoi ça sert |
|---|---|
| `NUXT_MCP_CLIENT_ID` | Identifiant du client OAuth que tu donneras à Claude |
| `NUXT_MCP_CLIENT_SECRET` | Son secret |

Invente-les — ce sont **tes** identifiants, pas ceux d'un service tiers.
`openssl rand -hex 16` fait très bien l'affaire pour les deux.

### Facultative

| Variable | À quoi ça sert |
|---|---|
| `NUXT_OWNER_NAME` | Ton prénom, si tu préfères le décrire ici. **Ce n'est pas nécessaire** : l'application te le demande au moment de poser ton passkey, et tu peux le corriger ensuite depuis le profil sans redéployer. |

> ⚠️ **Aucun secret n'entre dans le dépôt.** Pas dans `.env` (il est ignoré), pas
> dans un fichier de notes, pas dans un README de mise en route. Un dépôt public
> garde tout dans son historique : effacer le fichier ne répare rien, seule la
> régénération des clés répare. Tout se pose dans l'interface de l'hébergeur.

### Et le nom du compte Claude ?

On ne peut pas le récupérer. Le protocole MCP ne transporte **aucune identité
d'utilisateur** : le message `initialize` porte un `clientInfo`, qui est le nom du
*logiciel* client (« Claude »), pas celui de la personne. Le flux OAuth n'en
transporte pas davantage — c'est ton propre serveur qui émet les jetons, et il
décide seul de ce qu'il y met.

C'est donc l'application qui demande le prénom, au moment où l'on pose le passkey.
C'est le bon moment : c'est exactement là qu'on déclare que cette instance est la
sienne, et la fenêtre du système l'affiche dans la seconde qui suit. C'est aussi de
là que viennent les initiales affichées en haut de l'écran.

## 3. Vérifier avant d'aller plus loin

```
https://ton-domaine/api/vault/health
```

Tu dois lire `"pret": true` et `"store": "ok"`. Si une variable manque, elle est
nommée là ; si le stockage ne répond pas, l'erreur est là aussi.

C'est le point de contrôle le plus important : sans lui, une variable oubliée se
manifeste par « Aucun passkey », c'est-à-dire exactement ce qu'affiche une
installation saine où l'on n'a rien fait.

## 4. Poser ton passkey

Ouvre `https://ton-domaine` → onglet **Profil** → carte **Connecteur Claude** →
« Poser un passkey ». On te demandera ton prénom (facultatif) et le code de démarrage
lu dans le journal du déploiement.

Le prénom est rangé à côté du passkey, pas dans la configuration : il s'affiche dans
la fenêtre de ton téléphone, et dans ce que le connecteur raconte à Claude. Tu peux
le changer plus tard depuis la même carte — « renommer ».

**Une seule inscription est possible.** Une fois le passkey posé, la route
d'enregistrement se ferme — sans quoi n'importe qui passant sur le site pourrait s'en
créer un et lire tes données. Pour repartir de zéro (téléphone perdu), la route de
remise à zéro demande le même code de démarrage. Ne le supprime donc pas après
l'installation : c'est ton double des clés.

> Le passkey est lié au **domaine**. Changer de domaine invalide celui que tu as
> posé — il faudra en reposer un avec le code de démarrage.

## 5. Brancher Claude

Dans Claude → Paramètres → Connecteurs → « Ajouter un connecteur personnalisé » :

- URL : `https://ton-domaine/api/mcp`
- Identifiant client : ton `NUXT_MCP_CLIENT_ID`
- Secret client : ton `NUXT_MCP_CLIENT_SECRET`

Claude t'enverra sur une page d'autorisation servie par ton propre site, qui te
demandera ton passkey avant d'accorder quoi que ce soit.

`SKILL.md`, à la racine, est la fiche qui explique à Claude comment se servir des
outils. Installe-la comme compétence : sans elle il découvre les outils un par un,
avec elle il sait par lequel commencer.

> La liste des outils est mise en cache **à la connexion**. Après un déploiement qui
> change les outils, ouvre une nouvelle conversation ou rebranche le connecteur —
> sinon la session en cours continue de voir l'ancienne version.

---

## 6. Poids et pas

L'onglet **Profil** → carte **Poids et pas**.

**Sans aucun objet connecté, ça marche.** Tu saisis ton poids au réveil et tes pas si
tu les connais. C'est ce que faisaient les carnets, et ça suffit à tout calculer : le
métabolisme de base, la dépense du jour, la cible à manger. Laisser les pas vides
retombe sur une estimation tirée de ta semaine type.

### Brancher une balance

| Marque | État | Ce qu'il faut poser |
|---|---|---|
| **Withings** | Fonctionne | `NUXT_WITHINGS_CLIENT_ID`, `NUXT_WITHINGS_CLIENT_SECRET` |
| **Fitbit** | Écrit, **jamais déroulé en vrai** | `NUXT_FITBIT_CLIENT_ID`, `NUXT_FITBIT_CLIENT_SECRET` |
| **Oura** | Écrit, **jamais déroulé en vrai** | `NUXT_OURA_CLIENT_ID`, `NUXT_OURA_CLIENT_SECRET` |
| **Garmin** | **Impossible aujourd'hui** | — |

**Ces variables sont facultatives.** Depuis l'écran *Profil → Connecteurs*, chaque
marque se configure directement dans l'application : tu colles l'identifiant et le
secret donnés par la marque, ils sont chiffrés et rangés dans le coffre, et la marque
apparaît sans redéploiement. Les variables d'hébergement restent possibles, et
**prioritaires** — le secret n'atteint alors ni le navigateur ni le coffre.

Une marque dont les identifiants ne sont posés nulle part s'affiche **en grisé**, avec
« à configurer ». C'est délibéré : un bouton « Connecter » qui rend une erreur se lit
comme une panne, et on cherche pendant dix minutes un problème qui n'existe pas.

Dans les deux cas, il reste une étape que rien ne peut faire à ta place : **déclarer
l'URL de retour dans la console de la marque**.

```
https://<ton-domaine>/api/connect/<marque>/callback
```

L'écran l'affiche, prête à copier. Elle doit correspondre **exactement**, protocole et
barre finale compris.

**Withings** — crée une application sur <https://developer.withings.com> (type *Public
API*). Les jetons de chaque personne restent dans le navigateur de son téléphone ; le
serveur n'en conserve aucun, et ils sont volontairement exclus de l'export JSON comme
du miroir.

**Fitbit** — crée une application sur <https://dev.fitbit.com/apps/new>. Type
« Personal » (le seul qui donne accès aux données détaillées de ton propre compte), et
coche les autorisations **`weight`** et **`activity`** — sans elles l'API répond 403, et
réautoriser n'y changera rien.

> **Ce chemin n'a jamais été déroulé sur un vrai compte.** Les points d'entrée et les
> formats viennent de la documentation officielle, et le trajet reprend celui de
> Withings, éprouvé lui. Attends-toi à corriger un détail au premier essai. Les
> messages d'erreur sont écrits pour ça — ils distinguent « pas configuré » (501),
> « autorisations manquantes dans le portail » (403), « autorisation expirée » (401)
> et « marque injoignable » (502).

Un piège vérifié au passage : Fitbit décide des **unités** d'après l'en-tête
`Accept-Language`. Sans lui, les poids arrivent en livres — 91,5 kg devient 201,7, et
rien dans la réponse ne le signale. L'adaptateur force `fr_FR`.

**Oura** — crée une application sur <https://cloud.ouraring.com/oauth/applications>.
La bague ne pèse pas : elle ne remonte que les **pas**, et c'est la seule portée
demandée (`daily`). Le poids visible dans l'application Oura est une valeur de profil
saisie à la main, sans date — l'enregistrer comme une pesée fabriquerait une mesure qui
n'a jamais eu lieu.

**Garmin** — le programme développeur Garmin est **en pause** : le formulaire de
demande d'accès a été retiré et aucune date de réouverture n'est annoncée (vérifié en
août 2026). Personne ne peut obtenir d'identifiants, quel que soit le code écrit ici.
La fiche reste dans `lib/providers.ts` pour que la question ne se repose pas tous les
six mois.

### Ajouter une marque

Un fichier, une fiche, une ligne — le chemin complet est dans
**[docs/CONNECTEURS.md](docs/CONNECTEURS.md)**, avec un gabarit commenté à copier
(`server/connecteurs/_gabarit.ts.txt`) et un test qui refuse un adaptateur incomplet.

Le point à ne pas rater : une marque ne garde JAMAIS son propre historique de poids.
Elle rend des pesées, `useMesures().absorber()` les range dans le journal commun —
dédoublonnage, quarantaine des mesures aberrantes et miroir vers le module séances
viennent avec. Deux séries du même chiffre, et la courbe en choisirait une pendant que
le métabolisme de base prend l'autre.

---

## Ce qui reste à toi de régler

**L'application démarre vide.** Ni programme, ni aliments, ni recettes, ni menus : le
premier écran te propose de la faire remplir par Claude (un message prêt à coller) ou
de charger le pack d'exemple. Ce pack — quatre séances, cent cinquante-deux aliments,
trente-quatre recettes, deux semaines de menus — ce sont **mes** données. Il arrive
comme une sauvegarde, donc en contenu personnel : tu le modifies, et tu peux le
retirer entièrement.

Si tu veux plutôt que TA copie livre TON contenu — pour l'installer sur plusieurs
téléphones sans repasser par l'import — remplace `data/exemple/programme.ts` et
`data/exemple/nutrition.ts` par les tiens et relance `npm run exemple`. Un test
vérifie que `public/exemple.json` est à jour, donc tu ne peux pas l'oublier.

Une chose n'est encore réglable que dans le code : l'estimation de pas par défaut
(3 500 en télétravail, 7 500 sur site) correspond à mon rythme — elle est dans
`lib/nutritionStats.ts`.

Les icônes (`public/icon-192.png`, `public/icon-512.png`) et le nom affiché
(`public/manifest.webmanifest`, `nuxt.config.ts`) sont les miens aussi. Remplace-les :
c'est ton application sur ton téléphone.

---

## Et la licence ?

**GNU AGPL v3.** Pour ce que tu es en train de faire — héberger ta copie, pour toi —
elle ne te demande rien du tout. Modifie, remplace le pack d'exemple, garde tout pour
toi : c'est ton instance.

Elle se réveille dans un seul cas : si tu fais tourner une version modifiée **comme
service pour d'autres personnes**, tes modifications doivent être publiques sous la
même licence. C'est la différence entre l'AGPL et la GPL, et c'est délibéré.
