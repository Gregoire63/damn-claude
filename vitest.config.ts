import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { defineVitestProject } from '@nuxt/test-utils/config'

export default defineConfig({
  test: {
    /**
     * Seuils de couverture, volontairement placés JUSTE SOUS les valeurs atteintes.
     *
     * Ce n'est pas un objectif de qualité affiché — c'est un cliquet. Les chiffres
     * ici ne servent qu'à faire échouer `npm run test:coverage` le jour où un test
     * disparaît ou qu'une branche entière cesse d'être exercée. Un seuil ambitieux
     * qu'on désactive à la première alerte ne protège de rien ; un seuil qui colle
     * au réel se remarque immédiatement.
     *
     * `lib/` est tenu bien plus haut que `composables/` : c'est là que vivent les
     * calculs qui décident du contenu de l'assiette, et c'est du code pur, donc sans
     * excuse pour ne pas être couvert. Les composables touchent au stockage, au
     * réseau et aux API du navigateur — certaines branches ne se rejouent pas en test.
     *
     * En hausser un après avoir écrit des tests : oui. En baisser un pour faire
     * passer le CI : c'est le signe qu'il manque un test, pas que le seuil est faux.
     */
    coverage: {
      provider: 'v8',
      include: ['lib/**', 'composables/**'],
      thresholds: {
        statements: 72,
        branches: 66,
        functions: 73,
        lines: 76,
        'lib/**': { statements: 92, branches: 82, functions: 93, lines: 96 },
      },
    },
    projects: [
      // Logique pure (calculs de progression, volume, records…) : pas besoin de Nuxt,
      // donc rapide et sans flakiness. Voir utils/sportStats.ts.
      {
        test: {
          name: 'unit',
          include: ['test/unit/*.{test,spec}.ts'],
          environment: 'node',
        },
      },
      await defineVitestProject({
        test: {
          name: 'nuxt',
          include: ['test/nuxt/*.{test,spec}.ts'],
          environment: 'nuxt',
          environmentOptions: {
            nuxt: {
              rootDir: fileURLToPath(new URL('.', import.meta.url)),
              domEnvironment: 'happy-dom',
            },
          },
        },
      }),
    ],
  },
})
