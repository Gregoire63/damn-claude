<script setup lang="ts">
import { useJour } from '~/composables/useJour'
import { useFlash } from '~/composables/useFlash'

const { todayISO } = useJour()
const { showFlash } = useFlash()

</script>

<template>
  <Suspense>
    <LazySportProfile :today-iso="todayISO" @flash="showFlash" />
    <template #fallback><SportSkeleton :cards="5" chart /></template>
  </Suspense>
</template>
