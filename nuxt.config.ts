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
// Affiché seulement s'il va réellement servir : imprimer par-dessus une variable
// posée par l'utilisateur reviendrait à recopier SON secret dans le journal.
if (!(process.env.NUXT_VAULT_BOOTSTRAP || '').trim()) {
  console.log(`\n  ┌─ Code de démarrage de ce déploiement ─────────────\n  │  ${codeDeDemarrage}\n  │  À saisir une fois, pour poser le premier passkey.\n  └───────────────────────────────────────────────────\n`)
}

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
    // Withings : NUXT_WITHINGS_CLIENT_ID / NUXT_WITHINGS_CLIENT_SECRET.
    // Hors de `public` : le secret ne doit jamais partir dans le bundle client.
    withings: { clientId: '', clientSecret: '' },
    // Fitbit : NUXT_FITBIT_CLIENT_ID / NUXT_FITBIT_CLIENT_SECRET. Vides, le
    // fournisseur ne s'affiche pas — plutôt que d'offrir un bouton qui échoue.
    fitbit: { clientId: '', clientSecret: '' },
    public: {
      // Données de démonstration : jamais en production sauf demande explicite.
      seedTestData: false,
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
