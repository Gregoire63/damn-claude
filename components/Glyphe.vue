<script setup lang="ts">
// ─────────────────────────────────────────────────────────────────────────────
// Les pictogrammes de la coque.
// ─────────────────────────────────────────────────────────────────────────────
//
// La barre d'onglets portait des emoji. Ils ont deux défauts qui ne se voient qu'à
// l'usage : ils arrivent en COULEUR, imposée par le système, donc l'onglet actif ne
// peut pas se distinguer autrement que par son libellé ; et ils ne sont pas les
// mêmes d'un appareil à l'autre — le 🏋️ d'Android n'a rien à voir avec celui d'iOS.
// Une barre de navigation qui change de dessin selon le téléphone se lit comme une
// page web, pas comme une application.
//
// Ceux-ci sont tracés à la main, en `currentColor` : ils prennent la couleur de leur
// onglet, donc l'état actif se voit sans lire. Aucune dépendance, aucune police
// d'icônes à charger.
//
// Les emoji restent partout où ils sont du CONTENU et non du décor — ⚡ pour un
// sprint, 🔴 pour une décharge conseillée, 💬 pour une note. Là, la couleur est le
// message.

const props = withDefaults(defineProps<{ nom: string, taille?: number }>(), { taille: 24 })

const TRACES: Record<string, string> = {
  maison: '<path d="M2.6 11.2 12 3.4l9.4 7.8"/><path d="M5.4 9.6v9.6a1.8 1.8 0 0 0 1.8 1.8h9.6a1.8 1.8 0 0 0 1.8-1.8V9.6"/>',
  calendrier: '<rect x="3.6" y="5" width="16.8" height="15.4" rx="3.2"/><path d="M3.6 9.6h16.8M8.2 2.8v4M15.8 2.8v4"/>',
  couverts: '<path d="M6.6 3v5a2.2 2.2 0 0 0 4.4 0V3"/><path d="M8.8 10.2V21"/><path d="M18.4 3c-2 1.2-3.2 4-2.6 6.2.3 1 1.2 1.6 2.6 1.6z"/><path d="M18.4 10.8V21"/>',
  courbe: '<path d="M4 3.6v15.2a1.6 1.6 0 0 0 1.6 1.6H20"/><path d="m7.6 15.6 3.6-4.3 2.9 2.4 4.7-5.6"/>',
  personne: '<circle cx="12" cy="8" r="3.7"/><path d="M4.8 20.6a7.2 7.2 0 0 1 14.4 0"/>',
  haltere: '<path d="M2.6 9.4v5.2M5.6 7.2v9.6M18.4 7.2v9.6M21.4 9.4v5.2"/><path d="M5.6 12h12.8"/>',
  // La cloche des propositions en attente. Un point d'exclamation aurait dit
  // « attention » ; ici rien n'est cassé, quelque chose ATTEND — ce n'est pas la
  // même chose, et un écran qui crie à tort finit par ne plus être cru.
  cloche: '<path d="M18 8.4a6 6 0 1 0-12 0c0 6-2.4 7.2-2.4 7.2h16.8S18 14.4 18 8.4"/><path d="M13.7 19.2a2 2 0 0 1-3.4 0"/>',
}

const trace = computed(() => TRACES[props.nom] ?? '')
</script>

<template>
  <svg
    class="glyphe" :width="taille" :height="taille" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" stroke-width="1.7"
    stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true" focusable="false"
    v-html="trace"
  />
</template>

<style scoped>
/* `display: block` : en ligne, un SVG s'assoit sur la ligne de base et laisse
   quelques pixels sous lui — la barre d'onglets penchait d'un demi-pixel. */
.glyphe { display: block; flex: 0 0 auto; }
</style>
