<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useOverlay } from '~/composables/useOverlay'

// ─────────────────────────────────────────────────────────────────────────────
// LA fenêtre de l'application. Posée sur tout, jamais dans quelque chose.
// ─────────────────────────────────────────────────────────────────────────────
//
// Une carte rendue à l'endroit où on l'écrit dans le gabarit est prisonnière de ce
// qui l'entoure. La feuille de séance défile (`overflow-y: auto`) : une carte née
// dedans est DÉCOUPÉE à ses bords, quoi qu'en dise `position: fixed`. Sur le
// téléphone, ça donnait un panneau collé en haut, large comme la feuille et non
// comme l'écran, qui repartait vers le haut dès qu'on faisait défiler derrière.
// Ce n'est pas un réglage de z-index qui répare ça : tant que le nœud est dans
// l'arbre de la feuille, il est rogné par elle.
//
// La seule sortie est de ne pas y être. Le contenu est donc TÉLÉPORTÉ dans <body> :
// il ne dépend plus alors que du document, plus jamais de son point d'écriture.
//
// L'enveloppe `.sport-app` n'est pas décorative. Tout le CSS de /sport et du module
// nutrition est imbriqué sous cette classe ; un nœud téléporté hors de cet arbre
// perd la totalité de son habillage — la carte s'affiche en HTML brut, les
// `<input type="file">` censés être masqués réapparaissent, les lignes flex se
// replient en texte collé. `.sport-portal` neutralise la mise en page de
// `.sport-app` (fond, largeur, marges) : il ne reste qu'une portée de style.
//
// L'ouverture ET la fermeture s'animent alors que l'appelant n'écrit qu'un `v-if`.
// C'est le rôle de `shown` : le calque naît invisible, s'affiche au montage, et à
// la fermeture il s'efface D'ABORD ; `close` n'est émis qu'une fois l'animation
// terminée (`@after-leave`), donc au moment où l'appelant peut démonter sans rien
// couper. Aucune durée n'est recopiée en JavaScript : c'est le navigateur qui dit
// quand la transition CSS est finie.

withDefaults(defineProps<{
  title?: string
  subtitle?: string
  /** Classe ajoutée à la carte, pour les styles propres à un écran. */
  popupClass?: string
  /** Désactive la fermeture au clic à côté. À réserver aux formulaires en cours de saisie. */
  persistent?: boolean
}>(), { persistent: false })

const emit = defineEmits<{ close: [] }>()

const shown = ref(false)
onMounted(() => { shown.value = true })

let leaving = false
/** Ferme en douceur. Idempotent : Échap pendant l'effacement ne doit pas le relancer. */
function dismiss() {
  if (leaving) return
  leaving = true
  shown.value = false
}

// Verrou de défilement, place dans la pile des calques, sortie au clavier.
useOverlay(dismiss)

// Pour qu'un parent puisse fermer en douceur lui aussi, au lieu de couper le `v-if`.
defineExpose({ dismiss })
</script>

<template>
  <Teleport to="body">
    <div class="sport-app sport-portal">
      <transition name="popup" @after-leave="emit('close')">
        <div v-if="shown" class="popup-overlay" @click.self="persistent || dismiss()">
          <div class="popup" :class="popupClass" role="dialog" aria-modal="true">
            <div class="popup-head">
              <slot name="head">
                <div>
                  <div class="popup-title">
                    {{ title }}<slot name="title-extra" />
                  </div>
                  <div v-if="subtitle" class="muted mono">{{ subtitle }}</div>
                </div>
              </slot>
              <button class="popup-close" aria-label="Fermer" @click="dismiss">×</button>
            </div>

            <div class="popup-body">
              <slot />
            </div>

            <slot name="after" />
          </div>
        </div>
      </transition>
    </div>
  </Teleport>
</template>
