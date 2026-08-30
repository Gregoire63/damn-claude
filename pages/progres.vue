<script setup lang="ts">
import { cheminDeVue } from '~/lib/onglets'
import { useJour } from '~/composables/useJour'

// `Body.vue` demande « emmène-moi au profil » sans savoir que le profil vit sur
// /profil : la traduction se fait ici, pas dans le composant.
const router = useRouter()
const { todayISO, todayDow } = useJour()
</script>

<template>
  <Suspense>
    <LazySportReport :today-iso="todayISO" :today-dow="todayDow" @navigate="router.push(cheminDeVue($event))" />
    <template #fallback><SportSkeleton :cards="4" chart /></template>
  </Suspense>
</template>
