<script setup lang="ts">
import { useJour } from '~/composables/useJour'

const { todayISO } = useJour()
</script>

<template>
  <Suspense>
    <LazyNutritionPanel :today-iso="todayISO" />
    <template #fallback><SportSkeleton :cards="3" /></template>
  </Suspense>
</template>
