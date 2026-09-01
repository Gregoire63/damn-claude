<script setup lang="ts">
// Feuille « mes repas ». Même geste que pour une séance : on ouvre, on coche, on
// ferme. L'alimentation du jour n'a pas besoin d'un onglet permanent — c'est une
// action, pas une destination, et elle se déclenche depuis l'accueil.
//
// Elle ne porte QUE les repas : le télétravail se règle dans le planning, et la
// photo d'un plat se prend dans la bibliothèque. Ici on ne fait que manger.
//
// `todayIso` est mal nommé pour ce qu'il fait désormais : c'est LA DATE qu'on
// complète, aujourd'hui ou un jour passé qu'on rattrape depuis le journal.
defineProps<{ todayIso: string, past?: boolean }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <Sheet
    sheet-class="eat-sheet"
    title="Repas"
    :subtitle="past ? 'Rattrapage — coche ce que tu avais mangé' : 'Coche au fur et à mesure'"
    @close="emit('close')"
  >
    <NutritionDay :today-iso="todayIso" :past="past" />
  </Sheet>
</template>
