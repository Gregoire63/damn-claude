<script setup lang="ts">
import { useOverlay } from '~/composables/useOverlay'
import { useSheetDrag } from '~/composables/useSheetDrag'

// LA feuille de l'application. Une seule.
//
// Il y en avait sept copies : même balisage, même verrou de défilement, même bouton
// de fermeture, recopiés à la main. Chaque correction devait donc être faite sept
// fois — et ne l'était jamais complètement. La touche Échap ne fermait qu'une feuille
// sur sept, le geste de glissement une seule, et l'ascenseur qui débordait du coin
// arrondi a été corrigé une première fois sur une seule d'entre elles.
//
// Ce composant porte tout ce qui doit être vrai partout :
//   · le voile, et la fermeture au clic à côté ;
//   · le verrou de défilement de la page derrière, et la touche Échap — partagés
//     avec les cartes via `useOverlay`, pour que la pile des calques soit UNE seule
//     pile et qu'Échap ferme réellement celui du dessus ;
//   · la poignée, et le glissement vers le bas pour fermer ;
//   · l'en-tête collant avec titre, sous-titre et croix.
//
// Ce qu'il ne porte PAS : le contenu, évidemment, mais aussi tout en-tête qui sort de
// « titre + sous-titre ». Le slot `head` est là pour ça. Et plus la carte centrée :
// une fenêtre POSÉE SUR l'application est un objet différent d'une feuille qui monte
// du bas — elle vit dans components/Popup.vue, téléportée dans <body>.
withDefaults(defineProps<{
  title?: string
  subtitle?: string
  /** Classe ajoutée à la feuille, pour les styles propres à un écran (`rs`, `day-sheet`…). */
  sheetClass?: string
  /** Cache la poignée quand un visuel occupe déjà le bord haut — la fiche d'un plat. */
  bare?: boolean
  /** Désactive la fermeture au clic sur le voile. À réserver aux formulaires en cours de saisie. */
  persistent?: boolean
}>(), { bare: false, persistent: false })

const emit = defineEmits<{ close: [] }>()

const close = () => emit('close')

// Verrou de défilement, place dans la pile des calques, sortie au clavier.
useOverlay(close)

/**
 * Glisser vers le bas pour fermer. La zone de préhension est la poignée — ou le slot
 * `cover` quand il y en a un, ce qui donne la photo d'un plat.
 *
 * Jamais le corps : il défile, et deux gestes verticaux concurrents sur la même
 * surface, c'est la garantie qu'aucun des deux ne marche.
 */
const drag = useSheetDrag(close)
</script>

<template>
  <div class="sheet-overlay" @click.self="persistent || close()">
    <div
      class="sheet" :class="[sheetClass, { dragging: drag.dragging.value }]"
      role="dialog" aria-modal="true"
      :style="{ transform: drag.offset.value ? `translateY(${drag.offset.value}px)` : undefined }"
    >
      <!-- Un visuel qui occupe le bord haut : il sert aussi de poignée. -->
      <div
        v-if="$slots.cover" class="sheet-cover"
        @pointerdown="drag.start" @pointermove="drag.move"
        @pointerup="drag.end" @pointercancel="drag.cancel"
      >
        <slot name="cover" />
        <div class="sheet-handle sheet-handle-over" />
      </div>

      <div
        v-else-if="!bare" class="sheet-grip"
        @pointerdown="drag.start" @pointermove="drag.move"
        @pointerup="drag.end" @pointercancel="drag.cancel"
      >
        <div class="sheet-handle" />
      </div>

      <div class="sheet-head">
        <slot name="head">
          <div>
            <div class="sheet-title">
              {{ title }}<slot name="title-extra" />
            </div>
            <div v-if="subtitle" class="muted mono">{{ subtitle }}</div>
          </div>
        </slot>
        <button class="sheet-close" aria-label="Fermer" @click="close">×</button>
      </div>

      <div class="sheet-body">
        <slot />
      </div>

      <slot name="after" />
    </div>
  </div>
</template>
