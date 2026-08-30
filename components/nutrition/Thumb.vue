<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { usePhotos } from '~/composables/usePhotos'
import type { PhotoKind } from '~/composables/usePhotos'

// Vignette d'un plat, en lecture seule. Volontairement séparée de `Photo.vue` :
// celui-ci ouvre un sélecteur de fichier et un aperçu plein écran, ce qui n'a rien
// à faire dans un écran où l'on ne fait que cocher des repas.
//
// La taille demandée est un PARAMÈTRE, et ce n'est pas un détail : ce composant
// servait la vignette de 192 px partout, y compris en couverture de carte sur 340 px
// de large. C'était toute l'explication du flou — pas la compression, mais l'image
// servie à la mauvaise taille.
const props = withDefaults(defineProps<{ id: string, label?: string, variant?: PhotoKind }>(), {
  label: '',
  variant: 'thumb',
})

const { has, urlOf } = usePhotos()

const url = ref<string | null>(null)

// Aucune illustration de repli : une image floue « qui situe le plat » se lit comme
// une photo ratée. Une place vide dit la vérité — il n'y a pas encore de photo.
//
// `has(props.id)` fait PARTIE de la source surveillée, et c'est tout l'enjeu.
//
// Sans lui, la vignette ne se calculait qu'au montage. Or les métadonnées des photos
// sont lues dans IndexedDB de façon asynchrone : au premier rendu, `has()` répond
// encore faux, la vignette reste vide — et rien ne la réveille quand les données
// arrivent. Il fallait passer par l'onglet « Plats » puis revenir pour que les
// composants soient remontés APRÈS l'hydratation et voient enfin les photos.
//
// `has` lit `metas`, qui est une ref : l'inclure ici suffit à ce que la vignette se
// recalcule d'elle-même dès que les métadonnées arrivent, ou dès qu'on ajoute ou
// supprime une photo depuis un autre écran.
watch(() => [props.id, props.variant, has(props.id)] as const, async ([id, variant, exists]) => {
  url.value = exists ? await urlOf(id, variant) : null
}, { immediate: true })

const shown = computed(() => url.value)
</script>

<template>
  <div class="nu-thumb">
    <img v-if="shown" :src="shown" :alt="label ?? ''" loading="lazy">
    <span v-else class="nu-thumb-empty">🍽</span>
  </div>
</template>
