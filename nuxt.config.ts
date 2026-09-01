import { randomBytes } from 'node:crypto'
import { defineNuxtConfig } from 'nuxt/config'
import { CHEMINS } from './lib/onglets'

/**
 * Le code de démarrage, fabriqué AU BUILD et imprimé dans le journal de déploiement.
 *
 * Il ne servait qu'à répondre une seule question — « es-tu la personne qui a déployé
 * ce site ? » — et une variable d'environnement y répondait avec un SECRET PERMANENT :
 * la pire forme de preuve, celle qui se recopie, se photographie et survit à l'usage.
 *
 * Ce fichier est évalué pendant `nuxt build`. La valeur tirée ici est cuite dans la
 * configuration serveur, jamais dans le bundle du navigateur — elle est hors de
 * `public`, et un test le vérifie. Elle est affichée dans la sortie du build, dont
 * le journal n'est lisible que par le propriétaire du site : le canal de livraison
 * est déjà authentifié, exactement comme les variables d'environnement, mais il n'y
 * a plus rien à configurer.
 *
 * Trois propriétés en découlent, et aucune ne demande un geste :
 *  · chaque build en fabrique un neuf, donc l'ancien ne vaut plus rien ;
 *  · rien de permanent ne traîne — la valeur n'existe que dans un journal privé ;
 *  · « tout perdu » se règle par un redéploiement, ce qui EST la preuve qu'on
 *    cherchait : se rouvrir la porte exige l'accès au déploiement.
 *
 * `NUXT_VAULT_BOOTSTRAP` reste acceptée et l'emporte — Nuxt le fait tout seul, une
 * variable d'environnement écrase la valeur de `runtimeConfig` qui porte son nom.
 * C'est le repli pour qui préfère tout décrire dans sa configuration, et c'est
 * l'option la plus faible : elle redevient un secret permanent.
 */
const codeDeDemarrage = randomBytes(8).toString('hex')

/**
 * La VERSION de ce build, et ce qu'elle répare.
 *
 * Un service worker met l'application en cache pour qu'elle s'ouvre hors ligne. Le
 * revers est connu : tant que RIEN dans son URL ne change, le navigateur considère
 * qu'il n'y a pas de nouveau service worker à installer, donc rien à purger. Le
 * fichier était figé sur `sport-v2` depuis trois déploiements : un appareil qui avait
 * déjà visité le site gardait ses caches d'alors, et « rafraîchir » n'y changeait
 * rien — c'est le propre d'un cache qui ne sait pas qu'il est périmé.
 *
 * La version part donc du COMMIT quand l'hébergeur le donne (Netlify pose
 * `COMMIT_REF`), et d'un horodatage sinon. Elle voyage dans l'URL d'enregistrement —
 * `/sw.js?v=…` —, ce qui fait de chaque déploiement un service worker différent aux
 * yeux du navigateur : il l'installe, et son `activate` jette tous les caches qui ne
 * portent pas cette version.
 *
 * Elle est AFFICHÉE dans les réglages. « Suis-je à jour ? » est la première question
 * qu'on se pose devant une application qui n'a pas changé, et jusqu'ici rien dans
 * l'écran ne permettait d'y répondre.
 */
const version = (process.env.COMMIT_REF || '').slice(0, 7)
  || new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')

/*
 * Le journal DIT ce qu'il fait, y compris quand il ne fait rien.
 *
 * La première version se taisait quand `NUXT_VAULT_BOOTSTRAP` était posée — pour ne
 * pas recopier le secret de l'utilisateur dans un journal, ce qui reste la bonne
 * décision. Mais un journal muet ne se lit pas comme « il n'y avait rien à dire » :
 * il se lit comme une panne. On cherche le code, on ne le trouve pas, on relit le
 * build ligne par ligne, et rien n'explique pourquoi.
 *
 * Le silence est donc remplacé par la raison du silence.
 */
const cadre = (lignes: string[]) =>
  console.log(`\n  ┌${'─'.repeat(56)}\n${lignes.map(l => `  │  ${l}`).join('\n')}\n  └${'─'.repeat(56)}\n`)

if ((process.env.NUXT_VAULT_BOOTSTRAP || '').trim()) {
  cadre([
    'Code de démarrage : fourni par NUXT_VAULT_BOOTSTRAP.',
    'Aucun code n\'est fabriqué ici — la variable l\'emporte, et',
    'la recopier dans ce journal reviendrait à publier ton secret.',
    '',
    'Retire la variable chez ton hébergeur pour qu\'un code neuf',
    'soit fabriqué et imprimé ici à chaque déploiement.',
  ])
}
else {
  cadre([
    'Code de démarrage de ce déploiement :',
    '',
    `    ${codeDeDemarrage}`,
    '',
    'À saisir une fois, pour poser le premier passkey.',
  ])
}

cadre([
  'Version de ce build :',
  '',
  `    ${version}`,
  '',
  'Affichée dans les réglages, et portée par l\'URL du service',
  'worker : chaque déploiement purge les caches du précédent.',
])

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',

  /**
   * Un seul module, et c'est voulu.
   *
   * Le projet d'origine en chargeait neuf — icônes, images, analytics, sitemap,
   * robots, Pinia, deux VueUse. Aucun n'était utilisé par cette application : ils
   * servaient le portfolio qui l'hébergeait. Les garder aurait allongé chaque
   * installation et chaque build d'un fork pour rien.
   *
   * `@nuxt/fonts` reste parce que les trois familles sont réellement employées :
   * `--font-display`, `--font-mono` et `--font-body` apparaissent 118 fois dans les
   * deux feuilles de style.
   */
  modules: ['@nuxt/fonts'],

  // Écran de chargement du rendu client : HTML statique affiché tout de suite,
  // animation portée par le compositeur — elle survit donc à un gel du JavaScript.
  spaLoadingTemplate: 'spa-loading-template.html',

  devtools: { enabled: true },
  sourcemap: { server: false, client: false },

  runtimeConfig: {
    /**
     * Le code de démarrage. HORS de `public` : il ne doit jamais partir dans le
     * bundle du navigateur, et `test/unit/demarrage.test.ts` le vérifie.
     *
     * Nuxt mappe cette clé sur `NUXT_VAULT_BOOTSTRAP` : poser la variable écrase la
     * valeur fabriquée au build, sans une ligne de code de plus.
     */
    vaultBootstrap: codeDeDemarrage,

    /**
     * À QUI appartient cette instance.
     *
     * Sert au nom affiché par le système au moment du passkey et à ce que le
     * connecteur raconte à Claude. Facultatif : il se saisit dans l'application au
     * moment de poser le passkey, et cette variable n'est qu'un repli pour qui
     * préfère tout décrire dans sa configuration.
     */
    ownerName: '',
    /*
     * Les identifiants des marques ne sont PAS déclarés ici, et c'est délibéré.
     *
     * Ils étaient une paire de clés par marque — `withings: { clientId, clientSecret }`
     * — ce qui obligeait à modifier la configuration de l'application pour brancher un
     * connecteur de plus. La promesse « ajouter une marque = un fichier » était donc
     * fausse d'une ligne, et c'est exactement le genre de ligne qu'on oublie.
     *
     * Ils se lisent maintenant par convention de nommage — NUXT_WITHINGS_CLIENT_ID,
     * NUXT_FITBIT_CLIENT_SECRET… — ou dans le coffre, chiffrés, quand ils ont été
     * saisis depuis l'application. Voir server/utils/connecteurs.ts.
     */
    public: {
      // Données de démonstration : jamais en production sauf demande explicite.
      seedTestData: false,
      // La version de ce build. Lue par `useMaj()` pour l'URL du service worker et
      // par les réglages pour l'afficher. Publique par nature : elle est déjà dans
      // l'URL du service worker, et c'est ce qu'on demande à quelqu'un qui signale
      // un problème.
      version,
    },
  },

  app: {
    head: {
      title: 'Damn Claude',
      charset: 'utf-8',
      viewport: 'width=device-width, initial-scale=1, viewport-fit=cover',
      meta: [
        { name: 'description', content: 'Suivi d\'entraînement et de nutrition : séances, charges, progression, poids de corps.' },
        { name: 'format-detection', content: 'telephone=no' },
        // Une application personnelle n'a rien à faire dans un index de recherche.
        { name: 'robots', content: 'noindex, nofollow' },
        /*
         * Ce qui fait la différence entre une APPLICATION et un raccourci.
         *
         * Le manifeste dit `display: standalone`, et ça suffit à Chrome sur Android.
         * Safari, lui, ne l'a pas toujours lu : sans `apple-mobile-web-app-capable`,
         * « Sur l'écran d'accueil » pose une icône qui ROUVRE Safari — même icône,
         * même adresse, mais la barre d'URL est là, la barre d'onglets du système
         * mange le bas de l'écran, et l'application n'a plus rien d'une application.
         *
         * La balise est officiellement dépréciée au profit de `mobile-web-app-capable`.
         * On déclare les deux : la nouvelle pour ce qui vient, l'ancienne parce que
         * c'est encore elle que lisent les iPhone en circulation.
         *
         * `apple-mobile-web-app-title` est le nom SOUS l'icône. Sans lui, iOS prend
         * le `<title>` de la page, qui change d'un onglet à l'autre.
         */
        { name: 'theme-color', content: '#fefcf8' },
        { name: 'mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
        { name: 'apple-mobile-web-app-title', content: 'Damn Claude' },
      ],
      link: [
        { rel: 'manifest', href: '/manifest.webmanifest' },
        { rel: 'icon', type: 'image/png', href: '/icon-192.png' },
        { rel: 'apple-touch-icon', href: '/icon-192.png' },
      ],
    },
  },

  nitro: {
    compressPublicAssets: { gzip: true, brotli: true },
    routeRules: {
      '/_nuxt/**': { headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } },
      /**
       * Rendu 100 % client — mais SEULEMENT sur les chemins qui existent.
       *
       * Toutes les données vivent dans le navigateur : un rendu serveur n'aurait
       * rien à rendre, et l'hydratation d'un gros HTML vide coûtait un gel visible
       * au démarrage. Les routes `server/api/**` continuent de fonctionner —
       * `ssr: false` ne concerne que les pages.
       *
       * La liste vient de `lib/onglets.ts`, et c'est délibéré : un onglet ajouté
       * là-bas devient servable ici sans qu'on y pense. L'oublier donnerait un
       * rendu serveur d'une page qui lit `localStorage` — écran blanc, sans erreur.
       *
       * Le corollaire est ce qui fait la 404 : un chemin ABSENT de cette liste
       * garde le rendu serveur, `validate` le refuse, et le visiteur reçoit un
       * vrai 404 avec le bon code HTTP — pas une page vide rendue à 200.
       */
      ...Object.fromEntries(CHEMINS.map(c => [c, { ssr: false }])),
      '/**': {
        headers: {
          'X-Content-Type-Options': 'nosniff',
          'X-Frame-Options': 'DENY',
          'Referrer-Policy': 'strict-origin-when-cross-origin',
          'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
        },
      },
    },
  },

  vite: { build: { sourcemap: false } },
})
