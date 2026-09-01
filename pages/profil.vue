<script setup lang="ts">
import { useJour } from '~/composables/useJour'
import { useFlash } from '~/composables/useFlash'

const { todayISO } = useJour()
const { showFlash } = useFlash()

</script>

<template>
  <div>
    <!-- Ce <div> n'est pas décoratif. <NuxtPage> enveloppe la page dans une
         <Transition> (le glissement d'onglet), et une transition anime UN nœud du DOM :
         `<Suspense>` seul à la racine n'en est pas un, Vue renonce alors à l'animation.
         Le commentaire est DEDANS et non au-dessus : à la racine il compterait comme un
         second nœud, et Nuxt refuse une page à plusieurs racines (NUXT_E4004). -->
    <Suspense>
      <LazySportProfile :today-iso="todayISO" @flash="showFlash" />
      <template #fallback><SportSkeleton :cards="5" chart /></template>
    </Suspense>
  </div>
</template>
