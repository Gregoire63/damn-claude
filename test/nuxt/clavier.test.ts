import { beforeEach, describe, expect, it, vi } from 'vitest'
import { doitRemonter } from '../../composables/useClavier'

// ─────────────────────────────────────────────────────────────────────────────
// Le champ que le clavier cache.
// ─────────────────────────────────────────────────────────────────────────────
//
// Le clavier virtuel ne fait pas défiler la page, il se pose dessus. Un champ de la
// moitié basse disparaît derrière, et on tape à l'aveugle — la recherche de plats,
// le poids d'une série, le prénom d'un convive.
//
// Ce qui est testé ici est la DÉCISION, parce que c'est elle qui peut être fausse
// dans les deux sens : ne pas remonter un champ caché (le défaut qu'on répare), et
// faire défiler un champ parfaitement visible (le défaut qu'on introduirait, plus
// désagréable encore — l'écran saute à chaque focus).

describe('faut-il remonter le champ ?', () => {
  const MARGE = 24

  it('laisse tranquille un champ largement au-dessus du clavier', () => {
    // Champ à 300 px, zone visible jusqu'à 500 px : rien à faire.
    expect(doitRemonter(300, 500, MARGE)).toBe(false)
  })

  it('remonte un champ passé sous la limite visible', () => {
    expect(doitRemonter(620, 500, MARGE)).toBe(true)
  })

  /**
   * La marge n'est pas cosmétique : collé à la limite, on voit le champ mais pas la
   * ligne en dessous — et sur un champ de recherche, cette ligne est le premier
   * résultat. On remonte donc AVANT que ce soit strictement nécessaire.
   */
  it('remonte aussi un champ qui touche la limite', () => {
    expect(doitRemonter(490, 500, MARGE)).toBe(true)   // dans la marge
    expect(doitRemonter(475, 500, MARGE)).toBe(false)  // juste au-dessus
  })

  it('sans clavier, la zone visible vaut tout l’écran : rien ne bouge', () => {
    expect(doitRemonter(700, 900, MARGE)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Le branchement, avec un viewport visible simulé.
// ─────────────────────────────────────────────────────────────────────────────
//
// happy-dom n'a pas de `visualViewport` : on le pose à la main, ce qui est aussi le
// cas d'un vieux navigateur de bureau. Le composable doit alors NE RIEN FAIRE plutôt
// que de faire défiler au hasard — c'est le comportement qu'on fige ici.

beforeEach(() => {
  vi.resetModules()
  document.body.innerHTML = ''
  // @ts-expect-error — on remet le navigateur dans son état d'origine entre deux tests
  delete window.visualViewport
})

const charger = async () => (await import('../../composables/useClavier')).useClavier

describe('le rattrapage, branché sur la page', () => {
  it('ne fait rien quand le navigateur n’expose pas de viewport visible', async () => {
    const champ = document.createElement('input')
    document.body.appendChild(champ)
    const scroll = vi.fn()
    champ.scrollIntoView = scroll

    ;(await charger())()
    champ.dispatchEvent(new Event('focusin', { bubbles: true }))
    await new Promise(r => setTimeout(r, 420))

    expect(scroll).not.toHaveBeenCalled()
  })

  it('remonte le champ focalisé quand le clavier le recouvre', async () => {
    const champ = document.createElement('input')
    document.body.appendChild(champ)
    const scroll = vi.fn()
    champ.scrollIntoView = scroll
    champ.getBoundingClientRect = () => ({ bottom: 700 }) as DOMRect
    champ.focus()

    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: { offsetTop: 0, height: 420, addEventListener: () => {}, removeEventListener: () => {} },
    })

    ;(await charger())()
    champ.dispatchEvent(new Event('focusin', { bubbles: true }))
    await new Promise(r => setTimeout(r, 420))

    expect(scroll).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' })
  })

  /** Une case à cocher n'ouvre aucun clavier : la faire défiler serait un saut gratuit. */
  it('ignore les champs qui n’ouvrent pas de clavier', async () => {
    const champ = document.createElement('input')
    champ.type = 'checkbox'
    document.body.appendChild(champ)
    const scroll = vi.fn()
    champ.scrollIntoView = scroll
    champ.getBoundingClientRect = () => ({ bottom: 700 }) as DOMRect
    champ.focus()

    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: { offsetTop: 0, height: 420, addEventListener: () => {}, removeEventListener: () => {} },
    })

    ;(await charger())()
    champ.dispatchEvent(new Event('focusin', { bubbles: true }))
    await new Promise(r => setTimeout(r, 420))

    expect(scroll).not.toHaveBeenCalled()
  })
})
