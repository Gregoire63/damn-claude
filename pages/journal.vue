<script setup lang="ts">
import { useJour } from '~/composables/useJour'
import { useSeance } from '~/composables/useSeance'

// Le calendrier. Rouvrir une séance enregistrée passe par `editSession`, qui vit
// dans la coque : c'est elle qui porte la feuille.
const { todayISO } = useJour()
const { editSession } = useSeance()
</script>

<template>
  <Suspense>
    <LazySportHistory :today-iso="todayISO" @edit="editSession" />
    <template #fallback><SportSkeleton :cards="2" /></template>
  </Suspense>
</template>
