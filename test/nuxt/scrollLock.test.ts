import { beforeEach, describe, expect, it, vi } from 'vitest'

// Le verrou de défilement, pendant qu'une feuille est ouverte.
//
// Testé parce que c'est un compteur global : un `unlock` de trop et la page se
// débloque sous une feuille encore ouverte ; un `lock` orphelin et la page reste
// figée pour de bon, sans qu'aucune erreur ne soit levée. Les deux pannes sont
// silencieuses et ne se voient qu'au doigt, sur un téléphone.
beforeEach(() => {
  vi.resetModules()
  document.body.style.cssText = ''
  window.scrollTo(0, 0)
})

const load = async () => {
  const { useScrollLock } = await import('../../composables/useScrollLock')
  return useScrollLock()
}

const locked = () => document.body.style.position === 'fixed'

describe('useScrollLock', () => {
  it('fige la page à l\'ouverture et la rend à la fermeture', async () => {
    const { lock, unlock } = await load()
    expect(locked()).toBe(false)
    lock()
    expect(locked()).toBe(true)
    unlock()
    expect(locked()).toBe(false)
    expect(document.body.style.top).toBe('')
  })

  it('compte les feuilles imbriquées au lieu de basculer un booléen', async () => {
    // Une fiche de plat s'ouvre par-dessus la feuille des repas. Avec un booléen,
    // fermer la première rendrait le défilement à la page alors que la seconde est
    // encore là — et la page se mettrait à bouger derrière.
    const { lock, unlock } = await load()
    lock()
    lock()
    expect(locked()).toBe(true)
    unlock()
    expect(locked()).toBe(true) // la seconde feuille est toujours ouverte
    unlock()
    expect(locked()).toBe(false)
  })

  it('restaure la position de lecture, et ne renvoie pas en haut de page', async () => {
    // Sans ça, fermer une feuille ramène en haut : on perd l'endroit où l'on lisait,
    // et c'est le genre de détail qui fait refermer l'app.
    const { lock, unlock } = await load()
    Object.defineProperty(window, 'scrollY', { value: 640, configurable: true })
    const scrollTo = vi.spyOn(window, 'scrollTo')

    lock()
    expect(document.body.style.top).toBe('-640px')
    unlock()
    expect(scrollTo).toHaveBeenCalledWith(0, 640)
  })

  it('un unlock de trop ne casse pas le compteur', async () => {
    // Un composant démonté deux fois, une double fermeture : le compteur ne doit pas
    // partir en négatif, sinon le lock suivant n'aurait plus d'effet.
    const { lock, unlock } = await load()
    unlock()
    unlock()
    lock()
    expect(locked()).toBe(true)
    unlock()
    expect(locked()).toBe(false)
  })
})
