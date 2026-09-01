<script setup lang="ts">
import { cheminDeVue } from '~/lib/onglets'
import { useJour } from '~/composables/useJour'

// `Body.vue` demande « emmène-moi au profil » sans savoir que le profil vit sur
// /profil : la traduction se fait ici, pas dans le composant.
const router = useRouter()
const { todayISO, todayDow } = useJour()
</script>

<template>
  <div>
    <!-- Ce <div> n'est pas décoratif. <NuxtPage> enveloppe la page dans une
         <Transition> (le glissement d'onglet), et une transition anime UN nœud du DOM :
         `<Suspense>` seul à la racine n'en est pas un, Vue renonce alors à l'animation.
         Le commentaire est DEDANS et non au-dessus : à la racine il compterait comme un
         second nœud, et Nuxt refuse une page à plusieurs racines (NUXT_E4004). -->
    <Suspense>
      <LazySportReport :today-iso="todayISO" :today-dow="todayDow" @navigate="router.push(cheminDeVue($event))" />
      <template #fallback><SportSkeleton :cards="4" chart /></template>
    </Suspense>
  </div>
</template>
