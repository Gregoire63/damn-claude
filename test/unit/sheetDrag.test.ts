import { describe, expect, it } from 'vitest'
import {
  DRAG_CLOSE_PX, DRAG_CLOSE_VELOCITY, DRAG_MIN_PX, dragOffset, shouldClose,
} from '../../composables/useSheetDrag'

// Fermer une feuille en la tirant vers le bas par la photo.
//
// Toute la décision tient dans `shouldClose` et `dragOffset` : deux fonctions pures,
// donc testables sans navigateur. Les écouteurs de pointeur autour ne font que leur
// passer des nombres.

describe('shouldClose — fermer, ou revenir en place ?', () => {
  it('ignore un frôlement', () => {
    // Poser le doigt sur la photo pour la regarder ne doit pas fermer la fiche.
    expect(shouldClose(0, 100)).toBe(false)
    expect(shouldClose(3, 100)).toBe(false)
    expect(shouldClose(DRAG_MIN_PX - 1, 50)).toBe(false)
  })

  it('ferme sur un geste long, même lent', () => {
    // « Je l'ai vraiment tirée en bas » : la distance suffit, quel que soit le temps.
    expect(shouldClose(DRAG_CLOSE_PX, 2000)).toBe(true)
    expect(shouldClose(300, 5000)).toBe(true)
  })

  it('ferme sur un geste court mais vif', () => {
    // « Je l'ai jetée » : 60 px en 100 ms, c'est 0,6 px/ms. Sans ce second chemin,
    // il faudrait tirer la feuille jusqu'en bas de l'écran pour la fermer, ce qui
    // rend le geste poussif.
    expect(shouldClose(60, 100)).toBe(true)
  })

  it('revient en place sur un geste court et mou', () => {
    expect(shouldClose(40, 1000)).toBe(false)
  })

  it('respecte exactement ses deux seuils', () => {
    expect(shouldClose(DRAG_CLOSE_PX, 10_000)).toBe(true)
    expect(shouldClose(DRAG_CLOSE_PX - 1, 10_000)).toBe(false)
    const dy = 50
    expect(shouldClose(dy, dy / DRAG_CLOSE_VELOCITY)).toBe(true)
    expect(shouldClose(dy, dy / DRAG_CLOSE_VELOCITY + 10)).toBe(false)
  })

  it('ne divise pas par zéro sur un geste instantané', () => {
    // Deux événements au même horodatage : ça arrive, et une vitesse infinie ne doit
    // pas fermer une feuille qu'on a seulement effleurée.
    expect(shouldClose(2, 0)).toBe(false)
    expect(shouldClose(200, 0)).toBe(true) // la distance, elle, reste valable
  })

  it('ne ferme jamais sur un geste vers le haut', () => {
    expect(shouldClose(-200, 100)).toBe(false)
  })
})

describe('dragOffset — ce que la feuille suit', () => {
  it('suit le doigt vers le bas, au pixel près', () => {
    expect(dragOffset(0)).toBe(0)
    expect(dragOffset(45)).toBe(45)
    expect(dragOffset(320)).toBe(320)
  })

  it('ne décolle jamais la feuille de son bord', () => {
    // Tirer vers le haut laisserait un vide sous la feuille, ce qui n'a aucun sens
    // pour un panneau ancré en bas d'écran.
    expect(dragOffset(-1)).toBe(0)
    expect(dragOffset(-500)).toBe(0)
  })
})
