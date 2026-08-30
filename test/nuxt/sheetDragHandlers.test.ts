import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSheetDrag } from '../../composables/useSheetDrag'

// Les gestionnaires de pointeur du geste « tirer pour fermer ».
//
// La décision elle-même est testée dans test/unit/sheetDrag.test.ts, sans navigateur.
// Ici on vérifie le pilotage : suivre le bon doigt, ignorer les autres, ne pas rester
// bloqué si le geste est interrompu — c'est là que se logent les feuilles qui restent
// coincées à mi-écran.
beforeEach(() => { vi.resetModules() })

/** Un événement de pointeur crédible, sans dépendre de l'implémentation de happy-dom. */
function ev(pointerId: number, clientY: number, timeStamp: number, target?: unknown): PointerEvent {
  return { pointerId, clientY, timeStamp, currentTarget: target ?? null } as unknown as PointerEvent
}

describe('suivi du doigt', () => {
  it('la feuille suit vers le bas et revient si le geste est trop court', () => {
    const close = vi.fn()
    const d = useSheetDrag(close)

    d.start(ev(1, 100, 0))
    expect(d.dragging.value).toBe(true)
    d.move(ev(1, 140, 100))
    expect(d.offset.value).toBe(40)

    d.end(ev(1, 140, 1500)) // 40 px en 1,5 s : ni assez loin, ni assez vif
    expect(close).not.toHaveBeenCalled()
    expect(d.offset.value).toBe(0)
    expect(d.dragging.value).toBe(false)
  })

  it('ferme quand le geste va assez loin', () => {
    const close = vi.fn()
    const d = useSheetDrag(close)
    d.start(ev(1, 100, 0))
    d.move(ev(1, 260, 200))
    d.end(ev(1, 260, 300))
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('ne remonte jamais la feuille au-dessus de son bord', () => {
    // Tirer vers le haut laisserait un vide sous une feuille ancrée en bas d'écran.
    const d = useSheetDrag(vi.fn())
    d.start(ev(1, 200, 0))
    d.move(ev(1, 50, 100))
    expect(d.offset.value).toBe(0)
  })

  it('capture le pointeur une fois le geste engagé', () => {
    // Sans capture, sortir de la photo en cours de geste coupe le suivi en plein
    // milieu et la feuille reste figée où le doigt l'a laissée.
    const setPointerCapture = vi.fn()
    const cible = Object.assign(document.createElement('div'), { setPointerCapture })
    const d = useSheetDrag(vi.fn())
    d.start(ev(1, 100, 0, cible))
    d.move(ev(1, 104, 40, cible)) // 4 px : sous le seuil, pas encore un geste
    expect(setPointerCapture).not.toHaveBeenCalled()
    d.move(ev(1, 160, 120, cible))
    expect(setPointerCapture).toHaveBeenCalledWith(1)
  })

  it('survit à un navigateur qui refuse la capture', () => {
    const cible = Object.assign(document.createElement('div'), {
      setPointerCapture: () => { throw new Error('refusé') },
    })
    const d = useSheetDrag(vi.fn())
    d.start(ev(1, 100, 0, cible))
    expect(() => d.move(ev(1, 200, 120, cible))).not.toThrow()
    expect(d.offset.value).toBe(100) // le geste continue quand même
  })
})

describe('gestes concurrents et interruptions', () => {
  it('ignore un second doigt : à deux, c\'est un zoom, pas une fermeture', () => {
    const d = useSheetDrag(vi.fn())
    d.start(ev(1, 100, 0))
    d.start(ev(2, 500, 10)) // deuxième doigt : ne doit pas reprendre le geste
    d.move(ev(2, 800, 60))
    expect(d.offset.value).toBe(0) // seul le doigt 1 pilote
    d.move(ev(1, 150, 80))
    expect(d.offset.value).toBe(50)
  })

  it('ignore le relâchement d\'un autre doigt', () => {
    const close = vi.fn()
    const d = useSheetDrag(close)
    d.start(ev(1, 100, 0))
    d.move(ev(1, 300, 100))
    d.end(ev(2, 300, 120)) // pas le bon pointeur
    expect(close).not.toHaveBeenCalled()
    expect(d.dragging.value).toBe(true)
  })

  it('un geste annulé remet la feuille en place', () => {
    // Appel entrant, changement d'app, geste système : `pointercancel` arrive et la
    // feuille ne doit pas rester coincée à mi-hauteur.
    const close = vi.fn()
    const d = useSheetDrag(close)
    d.start(ev(1, 100, 0))
    d.move(ev(1, 400, 100))
    expect(d.offset.value).toBe(300)
    d.cancel(ev(1, 400, 110))
    expect(d.offset.value).toBe(0)
    expect(d.dragging.value).toBe(false)
    expect(close).not.toHaveBeenCalled()
  })

  it('un mouvement sans départ ne fait rien', () => {
    const d = useSheetDrag(vi.fn())
    d.move(ev(1, 400, 100))
    expect(d.offset.value).toBe(0)
  })

  it('deux gestes successifs repartent de zéro', () => {
    const close = vi.fn()
    const d = useSheetDrag(close)
    d.start(ev(1, 100, 0))
    d.move(ev(1, 150, 100))
    d.end(ev(1, 150, 1500))
    expect(d.offset.value).toBe(0)

    d.start(ev(2, 300, 2000))
    d.move(ev(2, 340, 2100))
    expect(d.offset.value).toBe(40) // et non 90 : le point de départ est le nouveau
  })
})
