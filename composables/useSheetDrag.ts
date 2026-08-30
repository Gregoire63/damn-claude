import { ref } from 'vue'

// Fermer une feuille en la tirant vers le bas.
//
// Le geste ne s'attrape que sur une zone désignée — la photo du plat — et jamais sur
// le corps de la feuille : celui-ci défile, et deux gestes verticaux concurrents sur
// la même surface, c'est la garantie qu'aucun des deux ne marche. La photo, elle, ne
// défile pas sous le doigt : c'est une poignée naturelle.

/** Au-delà de cette distance, on ferme même si le geste était lent. */
export const DRAG_CLOSE_PX = 110
/** Au-delà de cette vitesse (px/ms), on ferme même sur un geste court : c'est un « jeté ». */
export const DRAG_CLOSE_VELOCITY = 0.5
/** En dessous, le geste n'est pas considéré comme intentionnel. */
export const DRAG_MIN_PX = 6

/**
 * Faut-il fermer, au relâchement ?
 *
 * Deux chemins parce qu'un geste se juge de deux façons : la distance parcourue
 * (« je l'ai vraiment tirée en bas ») et la vitesse au lâcher (« je l'ai jetée »).
 * N'en garder qu'un rend la fermeture soit poussive, soit imprévisible.
 *
 * Fonction pure : c'est ici qu'est toute la décision, le reste n'est que des
 * écouteurs d'événements.
 */
export function shouldClose(dy: number, elapsedMs: number): boolean {
  if (dy < DRAG_MIN_PX) return false
  if (dy >= DRAG_CLOSE_PX) return true
  const v = elapsedMs > 0 ? dy / elapsedMs : 0
  return v >= DRAG_CLOSE_VELOCITY
}

/**
 * Ce que le doigt donne, la feuille le suit — mais amorti vers le haut.
 *
 * Tirer vers le haut ne doit pas décoller la feuille de son bord : on ne remonte
 * donc jamais au-dessus de zéro, et un geste vers le haut est simplement ignoré.
 */
export function dragOffset(dy: number): number {
  return dy > 0 ? dy : 0
}

export function useSheetDrag(onClose: () => void) {
  /** Décalage courant, en px. Lu par le style inline de la feuille. */
  const offset = ref(0)
  /** Vrai pendant le geste : sert à couper la transition CSS, sinon la feuille traîne. */
  const dragging = ref(false)

  let startY = 0
  let startAt = 0
  let pointerId: number | null = null

  function start(e: PointerEvent) {
    // Un seul doigt : à deux, c'est un pincement pour zoomer la photo, pas une fermeture.
    if (pointerId !== null) return
    pointerId = e.pointerId
    startY = e.clientY
    startAt = e.timeStamp
    dragging.value = true
  }

  function move(e: PointerEvent) {
    if (pointerId !== e.pointerId || !dragging.value) return
    const dy = e.clientY - startY
    offset.value = dragOffset(dy)
    // Au-delà du seuil de déclenchement, on capture le pointeur : sans ça, sortir de
    // la photo en cours de geste interrompt le suivi en plein milieu.
    if (offset.value > DRAG_MIN_PX && e.currentTarget instanceof Element) {
      try { e.currentTarget.setPointerCapture(e.pointerId) }
      catch { /* capture refusée : le geste continue sans, simplement plus fragile */ }
    }
  }

  function end(e: PointerEvent) {
    if (pointerId !== e.pointerId) return
    const dy = offset.value
    const elapsed = e.timeStamp - startAt
    pointerId = null
    dragging.value = false
    if (shouldClose(dy, elapsed)) {
      // On laisse la feuille là où le doigt l'a laissée : l'animation de sortie
      // repart de cette position, ce qui donne un mouvement continu au lieu d'un saut.
      onClose()
      return
    }
    offset.value = 0
  }

  function cancel(e: PointerEvent) {
    if (pointerId !== e.pointerId) return
    pointerId = null
    dragging.value = false
    offset.value = 0
  }

  return { offset, dragging, start, move, end, cancel }
}
