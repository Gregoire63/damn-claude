import { afterEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { useBackGuard } from '../../composables/useBackGuard'
import { resetBackStack } from '../../composables/useBackStack'

// Le geste « retour » ne se teste pas à l'œil : il n'a pas d'apparence. Ce qui se
// teste, c'est QUI est prévenu, DANS QUEL ORDRE, combien de fois, et ce qu'il reste
// dans l'historique.
//
// Deux bugs vécus sont figés ici.
//
// Le premier : refermer un calque désarme la garde, et désarmer appelle
// `history.back()` — qui déclenche un second `popstate`. Sans garde, ce second
// passage rappelait l'action, qui refermait, qui désarmait… La feuille se repliait
// bien, et la carte de confirmation restait plantée par-dessus, impossible à fermer.
//
// Le second, plus insidieux : une pile par composant. Chaque calque se croyait seul,
// donc au sommet, et le retour fermait celui du dessous.

const MARK = 'gr-back'
const scopes: ReturnType<typeof effectScope>[] = []

/** Monte une garde dans une portée jetable, comme le ferait un composant. */
function monte(active: ReturnType<typeof ref<boolean>>, onBack: () => void) {
  const scope = effectScope()
  scopes.push(scope)
  scope.run(() => useBackGuard(active as never, onBack))
  return scope
}

/** Un vrai `popstate`, celui que le système envoie au balayage arrière. */
const retour = async () => {
  window.dispatchEvent(new PopStateEvent('popstate', { state: history.state }))
  await nextTick()
}

afterEach(() => {
  while (scopes.length) scopes.pop()!.stop()
  resetBackStack()
  history.replaceState(null, '')
})

describe('la garde de retour', () => {
  it('empile une entrée factice dès que la condition est vraie', async () => {
    monte(ref(true), () => {})
    await nextTick()

    expect(history.state?.[MARK]).toBe(true)
  })

  it('n’empile rien tant qu’il n’y a rien à refermer', async () => {
    monte(ref(false), () => {})
    await nextTick()

    expect(history.state?.[MARK]).toBeUndefined()
  })

  it('délègue le geste à l’appelant, une seule fois', async () => {
    const onBack = vi.fn()
    monte(ref(true), onBack)
    await nextTick()

    await retour()

    expect(onBack).toHaveBeenCalledTimes(1)
  })

  /**
   * LA régression. L'action referme le calque ; le désarmement qui suit provoque un
   * second `popstate`. Il ne doit rien relancer.
   */
  it('ne se rappelle pas elle-même quand l’action referme', async () => {
    const active = ref(true)
    const onBack = vi.fn(() => { active.value = false })
    monte(active, onBack)
    await nextTick()

    await retour()
    await retour()
    await retour()

    expect(onBack).toHaveBeenCalledTimes(1)
  })

  /**
   * Le cas modification : l'action ouvre une confirmation et LAISSE la feuille
   * ouverte. Le geste suivant doit être intercepté lui aussi — sinon la deuxième
   * pression sort de l'application, ce que la garde était censée empêcher.
   */
  it('se réarme quand l’action ne referme rien', async () => {
    const onBack = vi.fn()
    monte(ref(true), onBack)
    await nextTick()

    await retour()
    expect(history.state?.[MARK]).toBe(true)

    await retour()
    expect(onBack).toHaveBeenCalledTimes(2)
  })

  it('laisse partir le geste quand il n’y a plus rien d’ouvert', async () => {
    const active = ref(true)
    const onBack = vi.fn()
    monte(active, onBack)
    await nextTick()

    active.value = false
    await nextTick()
    await retour()

    expect(onBack).not.toHaveBeenCalled()
  })

  it('se réarme si la condition redevient vraie', async () => {
    const active = ref(true)
    const onBack = vi.fn()
    monte(active, onBack)
    await nextTick()

    active.value = false
    await nextTick()
    active.value = true
    await nextTick()
    await retour()

    expect(onBack).toHaveBeenCalledTimes(1)
  })

  it('lâche le geste quand la portée meurt — plus rien ne doit répondre', async () => {
    const onBack = vi.fn()
    const scope = monte(ref(true), onBack)
    await nextTick()

    scope.stop()
    await retour()

    expect(onBack).not.toHaveBeenCalled()
  })

  /** Un `beforeunload` qui protège d'une perte qui n'arrive pas s'apprend comme du bruit. */
  it('ne pose plus d’avertissement avant fermeture', async () => {
    monte(ref(true), () => {})
    await nextTick()

    const e = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(e)

    expect(e.defaultPrevented).toBe(false)
  })
})

describe('l’ordre des calques', () => {
  /**
   * La cascade réelle de l'application : un onglet ouvert, la feuille de séance
   * par-dessus, une carte de confirmation par-dessus encore. Trois retours doivent
   * les défaire dans cet ordre-là, et le quatrième sortir.
   */
  it('ferme du dessus vers le dessous, jamais l’inverse', async () => {
    const ordre: string[] = []
    const onglet = ref(true)
    const feuille = ref(false)
    const carte = ref(false)

    monte(onglet, () => { ordre.push('onglet'); onglet.value = false })
    await nextTick()
    monte(feuille, () => { ordre.push('feuille'); feuille.value = false })
    monte(carte, () => { ordre.push('carte'); carte.value = false })
    await nextTick()

    // Elles s'ouvrent dans l'ordre où on les rencontre.
    feuille.value = true
    await nextTick()
    carte.value = true
    await nextTick()

    await retour()
    await retour()
    await retour()

    expect(ordre).toEqual(['carte', 'feuille', 'onglet'])
  })

  it('rend le geste au système une fois tout refermé', async () => {
    const ouvert = ref(true)
    monte(ouvert, () => { ouvert.value = false })
    await nextTick()

    // happy-dom ne défait pas vraiment l'historique : on observe donc l'INTENTION,
    // c'est-à-dire le `history.back()` qui reprend l'entrée factice. Sans lui, on
    // reculerait d'un cran de trop au geste suivant et on quitterait quand même.
    const back = vi.spyOn(history, 'back')
    await retour()
    await nextTick()

    expect(back).toHaveBeenCalledTimes(1)
    back.mockRestore()
  })

  it('n’empile qu’UNE entrée factice, quel que soit le nombre de calques', async () => {
    const pushState = vi.spyOn(history, 'pushState')

    const a = ref(true), b = ref(true), c = ref(true)
    monte(a, () => {}); monte(b, () => {}); monte(c, () => {})
    await nextTick()

    // Trois calques, une seule entrée : ce n'est pas le nombre d'entrées que
    // l'utilisateur perçoit, c'est qu'un retour ferme une chose.
    expect(pushState).toHaveBeenCalledTimes(1)

    // Et chaque interception en repose exactement une — celle qui vient d'être
    // consommée. L'historique ne gonfle pas à mesure qu'on insiste sur le geste.
    await retour()
    expect(pushState).toHaveBeenCalledTimes(2)
    await retour()
    expect(pushState).toHaveBeenCalledTimes(3)

    pushState.mockRestore()
  })
})
