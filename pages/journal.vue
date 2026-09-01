<script setup lang="ts">
import { useJour } from '~/composables/useJour'
import { useSeance } from '~/composables/useSeance'

// Le calendrier. Rouvrir une séance enregistrée passe par `editSession`, qui vit
// dans la coque : c'est elle qui porte la feuille.
const { todayISO } = useJour()
const { editSession } = useSeance()
</script>

<template>
  <div>
    <!-- Ce <div> n'est pas décoratif. <NuxtPage> enveloppe la page dans une
         <Transition> (le glissement d'onglet), et une transition anime UN nœud du DOM :
         `<Suspense>` seul à la racine n'en est pas un, Vue renonce alors à l'animation.
         Le commentaire est DEDANS et non au-dessus : à la racine il compterait comme un
         second nœud, et Nuxt refuse une page à plusieurs racines (NUXT_E4004). -->
    <Suspense>
      <LazySportHistory :today-iso="todayISO" @edit="editSession" />
      <template #fallback><SportSkeleton :cards="2" /></template>
    </Suspense>
  </div>
</template>
