<script setup lang="ts">
import { useJour } from '~/composables/useJour'

const { todayISO } = useJour()
</script>

<template>
  <div>
    <!-- Ce <div> n'est pas décoratif. <NuxtPage> enveloppe la page dans une
         <Transition> (le glissement d'onglet), et une transition anime UN nœud du DOM :
         `<Suspense>` seul à la racine n'en est pas un, Vue renonce alors à l'animation.
         Le commentaire est DEDANS et non au-dessus : à la racine il compterait comme un
         second nœud, et Nuxt refuse une page à plusieurs racines (NUXT_E4004). -->
    <Suspense>
      <LazyNutritionPanel :today-iso="todayISO" />
      <template #fallback><SportSkeleton :cards="3" /></template>
    </Suspense>
  </div>
</template>
