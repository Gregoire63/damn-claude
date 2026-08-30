<script setup lang="ts">
import { useJour } from '~/composables/useJour'
import { useFlash } from '~/composables/useFlash'

const { todayISO } = useJour()
const { showFlash } = useFlash()

// Le message d'échec du retour OAuth est porté par la coque : c'est elle qui reçoit
// la redirection du fournisseur, avant que cet écran n'existe.
const withingsError = useState<string | null>('withings-erreur', () => null)
</script>

<template>
  <Suspense>
    <LazySportProfile :today-iso="todayISO" :withings-error="withingsError" @flash="showFlash" />
    <template #fallback><SportSkeleton :cards="5" chart /></template>
  </Suspense>
</template>
