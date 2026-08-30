<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useNutrition } from '~/composables/useNutrition'
import { usePhotos } from '~/composables/usePhotos'
import { isoOf } from '~/utils/sportStats'

// Onglet « Nutrition » : deux destinations, pas plus.
//
// Il y en avait cinq (Jour, Plats, Courses, Cuisine, Corps) et on s'y perdait. Elles
// ne répondaient pourtant qu'à trois besoins, à trois rythmes différents :
//  - tous les jours, manger → parti sur l'accueil, en feuille : c'est une action,
//    pas une destination, exactement comme démarrer une séance ;
//  - avant la semaine, décider ce qu'on cuisine → « Préparer », en trois étapes
//    (plats et portions → courses → conseils de préparation) ;
//  - de temps en temps, régler la bibliothèque → « Plats ».
// Le suivi du corps, lui, est parti dans Rapport.
const props = defineProps<{ todayIso: string | null }>()

const { hydrate } = useNutrition()
// Les photos vivent dans IndexedDB : on ne charge ici que leurs métadonnées,
// jamais les blobs (chaque vignette est lue à la demande par le composant Photo).
const { hydrate: hydratePhotos } = usePhotos()

type Sub = 'cuisine' | 'plats'
const SUBS: { id: Sub, icon: string, label: string, hint: string }[] = [
  { id: 'cuisine', icon: '🛒', label: 'Préparer', hint: 'Plats à cuisiner, courses, préparation' },
  { id: 'plats', icon: '📖', label: 'Plats', hint: 'Recettes, aliments, micros' },
]
const sub = ref<Sub>('cuisine')

const iso = computed(() => props.todayIso ?? isoOf(new Date()))

onMounted(() => {
  hydrate()
  hydratePhotos()
})
</script>

<template>
  <div class="nu-panel">
    <nav class="nu-subnav">
      <button
        v-for="s in SUBS" :key="s.id"
        class="nu-subtab wide" :class="{ active: sub === s.id }"
        @click="sub = s.id"
      >
        <span class="nu-sub-icon">{{ s.icon }}</span>
        <span class="nu-sub-label mono">{{ s.label }}</span>
        <span class="nu-sub-hint">{{ s.hint }}</span>
      </button>
    </nav>

    <NutritionPrep v-if="sub === 'cuisine'" :today-iso="iso" />
    <NutritionLibrary v-else />
  </div>
</template>
