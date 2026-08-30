<script setup lang="ts">
// Trois niveaux, et chacun a une raison d'être.
//
//   app.vue        les jetons de design et la racine — ne change jamais
//   layouts/       la coque : en-tête, onglets, feuille de séance, mini-barre.
//                  Nuxt la CONSERVE d'une route à l'autre, et c'est ce qui permet à
//                  une séance ouverte de traverser un changement d'onglet.
//   pages/         un fichier par onglet, et rien d'autre que son contenu.
//
// La liste des onglets vit dans `lib/onglets.ts` : c'est aussi ce que lit
// `nuxt.config.ts` pour ses règles de route.
//
// <NuxtLayout> n'est pas décoratif : sans lui, <NuxtPage> se monte seul et la coque
// n'existe pas — plus d'en-tête, plus de barre d'onglets, plus de feuille.
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
</template>

<style>
/*
 * Les jetons de design.
 *
 * Ils vivaient dans le `app.vue` du portfolio, et c'était le SEUL lien réel entre
 * les deux applications : `sport.css` et `nutrition.css` en consomment seize, sans
 * jamais les définir. Extraire l'app sans les emporter aurait donné une interface en
 * noir et blanc, sans erreur nulle part — le pire genre de panne.
 *
 * Ce qui n'a PAS suivi, et délibérément : le `cursor: none !important` du portfolio.
 * Il existait pour laisser la place à un curseur dessiné en JavaScript, qui n'est pas
 * ici. Recopié tel quel, il aurait simplement fait disparaître le curseur.
 */
:root {
  --bg-primary: #fefcf8;
  --bg-secondary: #f5f0e8;
  --bg-accent: #e8dfd0;
  /*
   * Le fond de l'application, un cran sous les cartes.
   *
   * iOS pose ses listes groupées sur un fond LÉGÈREMENT plus sombre que les cellules
   * elles-mêmes : c'est ce décalage qui fait flotter les cartes sans qu'on ait
   * besoin de leur dessiner un contour. Le contour cerné, lui, se lit comme une
   * boîte de formulaire — correct sur un écran large, encombrant sur un téléphone où
   * l'on empile dix cartes.
   */
  --bg-page: #f4efe6;

  --text-primary: #2a2826;
  --text-secondary: #6b6560;
  --text-muted: #9d9691;

  --accent-primary: #8b6f5c;
  /* Variante foncée pour petit texte sur fond beige (contraste WCAG AA). */
  --accent-strong: #6e5747;
  --accent-secondary: #c9b299;
  --accent-tertiary: #e5dbc8;

  --font-display: 'Playfair Display', serif;
  --font-mono: 'Space Mono', monospace;
  --font-body: 'DM Sans', sans-serif;

  --ease-smooth: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-bounce: cubic-bezier(0.68, -0.55, 0.265, 1.55);
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);
  /* La courbe des feuilles modales d'iOS : elle part vite et s'arrête sans rebond.
     Un `ease-out` classique traîne à l'arrivée, et une feuille qui traîne donne
     l'impression que l'appareil rame. */
  --ease-feuille: cubic-bezier(0.32, 0.72, 0, 1);
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html {
  /*
   * `clip` et non `hidden`, et ce n'est pas un synonyme.
   *
   * `overflow-x: hidden` fait de <html> un CONTENEUR DE DÉFILEMENT. Tout
   * `position: sticky` à l'intérieur se cale alors sur lui et non sur la fenêtre :
   * l'en-tête cessait de coller dès qu'on faisait défiler, sans que rien ne le
   * signale. `clip` rogne le débordement sans créer de conteneur.
   */
  overflow-x: clip;
}

body {
  font-family: var(--font-body);
  background: var(--bg-page);
  /* Coupe le « tiré pour rafraîchir » d'Android : dans une application, tirer vers
     le bas en haut d'une liste doit rebondir, pas recharger la page et perdre la
     saisie en cours. */
  overscroll-behavior-y: none;
  color: var(--text-primary);
  /* `clip` ici aussi : <body> en `overflow-x: hidden` devient un conteneur de
     défilement, et l'en-tête collant se cale dessus au lieu de la fenêtre. */
  overflow-x: clip;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

::-webkit-scrollbar { width: 8px; height: 8px; }
::-webkit-scrollbar-track { background: var(--bg-secondary); }
::-webkit-scrollbar-thumb { background: var(--accent-secondary); border-radius: 4px; }
::-webkit-scrollbar-thumb:hover { background: var(--accent-primary); }

/* Utilisée par le verrou de défilement des feuilles — voir composables/useScrollLock.ts. */
.no-scroll {
  overflow: hidden !important;
  height: 100dvh;
}
</style>
