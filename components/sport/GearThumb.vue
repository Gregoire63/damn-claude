<script setup lang="ts">
import { ref, watch } from 'vue'
import type { Gear } from '~/data/exerciseVariants'
import { usePhotos, gearPhotoId } from '~/composables/usePhotos'

/**
 * À quoi ressemble la machine : la photo prise sur place si elle existe, le
 * pictogramme de la famille de matériel sinon.
 *
 * L'ordre n'est pas neutre. Une photo de catalogue montre le modèle d'un
 * fabricant ; ce qu'on cherche en salle, c'est SA machine à soi, avec sa couleur
 * et sa place dans l'allée. Le pictogramme n'est donc pas un repli au rabais mais
 * un point de départ : il dit la silhouette, assez pour s'orienter la première
 * fois, et il s'efface dès qu'il y a mieux.
 *
 * `has(id)` fait partie de la source surveillée, comme dans la vignette des plats :
 * les métadonnées arrivent d'IndexedDB de façon asynchrone, et sans cette
 * dépendance la vignette resterait vide jusqu'au prochain remontage du composant.
 */
const props = defineProps<{ id: string, gear: Gear, label?: string }>()

const { has, urlOf } = usePhotos()
const url = ref<string | null>(null)

watch(() => [props.id, has(gearPhotoId(props.id))] as const, async ([id, exists]) => {
  url.value = exists ? await urlOf(gearPhotoId(id), 'thumb') : null
}, { immediate: true })
</script>

<template>
  <span class="gear-thumb" :class="{ shot: !!url }">
    <img v-if="url" :src="url" :alt="label ?? ''" loading="lazy">
    <SportGearIcon v-else :gear="gear" />
  </span>
</template>

<style scoped>
.gear-thumb {
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 100%; overflow: hidden;
  border-radius: 9px; background: var(--bg-primary); border: 1px solid var(--bg-accent);
  padding: 6px; box-sizing: border-box;
}
.gear-thumb.shot { padding: 0; }
.gear-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
</style>
