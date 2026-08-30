<script setup lang="ts">
import { ref, computed } from 'vue'
import { hasExerciseImages, exerciseImageLabels } from '~/data/exerciseImages'

// Affiche 2 images : positions départ/fin d'un exercice, ou les 2 mouvements d'un superset.
// Si les images sont absentes (non téléchargées), on rend le contenu du slot (schéma musculaire).
const props = defineProps<{ exId: string }>()
const failed = ref(false)
const has = computed(() => hasExerciseImages(props.exId))
const labels = computed(() => exerciseImageLabels(props.exId))
const base = computed(() => `/exercises/${props.exId}`)
</script>

<template>
  <div v-if="has && !failed" class="exmove">
    <figure class="exmove-fig">
      <img :src="`${base}-1.jpg`" :alt="labels[0]" loading="lazy" @error="failed = true">
      <figcaption><span class="exmove-dot start"></span>{{ labels[0] }}</figcaption>
    </figure>
    <figure class="exmove-fig">
      <img :src="`${base}-2.jpg`" :alt="labels[1]" loading="lazy" @error="failed = true">
      <figcaption><span class="exmove-dot end"></span>{{ labels[1] }}</figcaption>
    </figure>
  </div>
  <slot v-else />
</template>

<style scoped>
.exmove { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.exmove-fig { margin: 0; display: flex; flex-direction: column; gap: 6px; }
.exmove-fig img {
  width: 100%; aspect-ratio: 3 / 2; object-fit: cover; display: block;
  border-radius: 12px; border: 1px solid var(--bg-accent); background: var(--bg-secondary);
}
.exmove-fig figcaption {
  display: flex; align-items: center; gap: 6px;
  font-family: var(--font-mono); font-size: 11px; text-transform: uppercase;
  letter-spacing: 0.06em; color: var(--text-muted);
}
.exmove-dot { width: 8px; height: 8px; border-radius: 50%; }
.exmove-dot.start { background: var(--accent-secondary); }
.exmove-dot.end { background: #b5502f; }
</style>
