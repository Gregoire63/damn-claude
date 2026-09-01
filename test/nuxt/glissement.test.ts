import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Le sens de l'animation, qui n'a que deux valeurs et se trompe en silence.
// ─────────────────────────────────────────────────────────────────────────────
//
// Une transition qui part du mauvais côté ne casse rien : l'écran arrive, la page
// marche. On voit seulement que quelque chose cloche sans pouvoir dire quoi — et
// c'est exactement le genre de détail qu'on n'ouvre jamais de bogue pour signaler.
//
// D'où ce fichier : l'ordre des onglets décide du sens, et il est vérifié.

beforeEach(() => { vi.resetModules() })

const charger = async () => await import('../../composables/useGlissement')

describe('le sens du changement d’onglet', () => {
  it('avancer dans la barre fait entrer l’écran par la droite', async () => {
    const { poserSens, sensNavigation } = await charger()
    poserSens('/', '/journal')
    expect(sensNavigation.value).toBe('gauche')
    poserSens('/journal', '/profil')
    expect(sensNavigation.value).toBe('gauche')
  })

  it('reculer le fait entrer par la gauche', async () => {
    const { poserSens, sensNavigation } = await charger()
    poserSens('/profil', '/nutrition')
    expect(sensNavigation.value).toBe('droite')
  })

  /**
   * Une page qui n'est pas un onglet — un retour d'autorisation, une URL tapée à la
   * main — ne doit pas inventer un sens. Le dernier reste, ce qui vaut mieux qu'un
   * choix arbitraire joué à l'écran.
   */
  it('ne change rien quand la route n’est pas un onglet', async () => {
    const { poserSens, sensNavigation } = await charger()
    poserSens('/', '/journal')
    expect(sensNavigation.value).toBe('gauche')
    poserSens('/journal', '/une-page-inconnue')
    expect(sensNavigation.value).toBe('gauche')
    poserSens('/journal', '/journal')
    expect(sensNavigation.value).toBe('gauche')
  })
})

describe('le décalage pendant le geste', () => {
  it('est nul au repos — sinon la coque poserait un transform en permanence', async () => {
    // Un élément transformé devient le bloc conteneur de ses descendants fixes et
    // déplace le calcul des `sticky` : au repos, l'attribut ne doit pas exister.
    const { decalageGlissement } = await charger()
    expect(decalageGlissement.value).toBe(0)
  })
})

describe('un calque ouvert coupe le geste', () => {
  /**
   * Changer d'onglet sous une feuille ouverte revient à échanger le décor pendant
   * qu'on joue la scène : la feuille reste, l'écran derrière n'est plus le sien.
   */
  it('se lit depuis la pile des calques, pas depuis chaque écran', async () => {
    const { calqueOuvert } = await import('../../composables/useOverlay')
    expect(calqueOuvert.value).toBe(false)
  })
})
