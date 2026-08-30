import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import Popup from '../../components/Popup.vue'
import Sheet from '../../components/Sheet.vue'

// Ce que ces tests protègent n'est pas une apparence, c'est un EMPLACEMENT.
//
// La carte des variantes était écrite au milieu de la feuille de séance. Une feuille
// défile (`overflow-y: auto`), et un enfant en `position: fixed` dont le bloc
// conteneur reste au-dessus d'elle est découpé à ses bords : le panneau s'affichait
// large comme la feuille et non comme l'écran, et remontait avec le défilement. Aucun
// z-index ne répare ça — seule la sortie de l'arbre le fait.
//
// D'où l'assertion centrale : le calque doit être un descendant de <body> et NON du
// conteneur où on l'a écrit. C'est vérifiable en test, contrairement au découpage
// lui-même, et c'est la cause dont le découpage n'était que le symptôme.

/**
 * `stubs.transition: false` est indispensable ici, pas décoratif.
 *
 * @vue/test-utils remplace `<Transition>` par un passe-plat par DÉFAUT : les crochets
 * d'entrée et de sortie ne sont alors jamais appelés. Or c'est précisément
 * `@after-leave` qui déclenche l'émission de « close » — avec le bouchon, la fenêtre
 * s'effacerait sans jamais prévenir personne, et on testerait un composant qui n'est
 * pas celui qui tourne chez l'utilisateur.
 */
const MONTAGE = { attachTo: document.body, global: { stubs: { transition: false } } }

/** Vide ce que les téléportations ont laissé dans <body> entre deux tests. */
afterEach(() => {
  document.body.querySelectorAll('.sport-portal').forEach(n => n.remove())
})

/** Un conteneur qui découpe, comme la feuille de séance. */
const Hote = defineComponent({
  props: { montre: { type: Boolean, default: true } },
  emits: ['close'],
  setup(props, { emit }) {
    return () => h('div', { class: 'boite', style: 'overflow-y: auto' }, [
      props.montre
        ? h(Popup, { title: 'Je ne peux pas le faire ici', onClose: () => emit('close') }, { default: () => h('p', 'contenu') })
        : null,
    ])
  },
})

const presse = async (key: string) => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
  await nextTick()
}

/**
 * Laisse la transition aller à son terme.
 *
 * Vue enchaîne DEUX `requestAnimationFrame` avant de conclure une sortie, et
 * happy-dom les implémente sur de vraies minuteries. Un `nextTick` ne suffit donc
 * pas : sans ce délai, on constaterait l'absence de « close » alors qu'il est
 * simplement en route.
 */
const anime = () => new Promise(r => setTimeout(r, 80))

describe('Popup — hors de tout', () => {
  it('sort du conteneur qui l’a écrit et atterrit dans <body>', async () => {
    const w = mount(Hote, MONTAGE)
    await nextTick()

    const overlay = document.querySelector('.popup-overlay')
    expect(overlay).not.toBeNull()
    // Le point de tout l'exercice : plus rien de l'hôte entre le calque et le document.
    expect(overlay!.closest('.boite')).toBeNull()
    expect(overlay!.closest('.sport-portal')).not.toBeNull()
    // …et l'hôte, lui, ne contient plus le calque.
    expect(w.find('.boite .popup-overlay').exists()).toBe(false)

    w.unmount()
  })

  it('emporte la portée CSS avec lui — sans .sport-app, tout le style tombe', async () => {
    const w = mount(Hote, MONTAGE)
    await nextTick()

    const portail = document.querySelector('.popup-overlay')!.closest('.sport-portal')!
    expect(portail.classList.contains('sport-app')).toBe(true)
    // Le portail est posé directement dans <body> : rien ne peut plus le rogner.
    expect(portail.parentElement).toBe(document.body)

    w.unmount()
  })

  it('affiche le titre et la croix de fermeture', async () => {
    const w = mount(Hote, MONTAGE)
    await nextTick()

    expect(document.querySelector('.popup-title')!.textContent).toContain('Je ne peux pas le faire ici')
    expect(document.querySelector('.popup-close')).not.toBeNull()

    w.unmount()
  })
})

describe('Popup — la fermeture', () => {
  it('s’efface D’ABORD, et n’émet « close » qu’une fois l’animation finie', async () => {
    const w = mount(Hote, MONTAGE)
    await nextTick()

    const close = document.querySelector('.popup-close') as HTMLButtonElement
    close.click()

    // Le calque s'efface AVANT que l'appelant soit prévenu : rien n'est coupé.
    await nextTick()
    expect(w.emitted('close')).toBeFalsy()

    await anime()
    // L'animation finie, l'appelant peut démonter.
    expect(w.emitted('close')).toBeTruthy()

    w.unmount()
  })

  it('ne relance pas la fermeture si on insiste', async () => {
    const w = mount(Hote, MONTAGE)
    await nextTick()

    const close = document.querySelector('.popup-close') as HTMLButtonElement
    close.click()
    close.click()
    await presse('Escape')
    await anime()

    expect(w.emitted('close')).toHaveLength(1)

    w.unmount()
  })

  it('ferme à la touche Échap', async () => {
    const w = mount(Hote, MONTAGE)
    await nextTick()

    await presse('Escape')
    await anime()

    expect(w.emitted('close')).toBeTruthy()

    w.unmount()
  })

  /**
   * `persistent` sert à la fenêtre du commentaire d'exercice : on y tape du texte,
   * sur un téléphone où le clavier occupe la moitié de l'écran. Une pression à côté
   * du champ ne doit pas la refermer — mais la croix et Échap, gestes voulus, si.
   */
  it('avec « persistent », le clic à côté ne ferme pas — Échap si', async () => {
    const Saisie = defineComponent({
      emits: ['close'],
      setup(_, { emit }) {
        return () => h(Popup, { title: 'Commentaire', persistent: true, onClose: () => emit('close') })
      },
    })

    const w = mount(Saisie, MONTAGE)
    await nextTick()

    ;(document.querySelector('.popup-overlay') as HTMLElement).click()
    await anime()
    expect(w.emitted('close')).toBeFalsy()

    await presse('Escape')
    await anime()
    expect(w.emitted('close')).toBeTruthy()

    w.unmount()
  })

  /** Le bouton « Terminé » du parent doit fermer comme la croix, pas couper le `v-if`. */
  it('expose « dismiss » pour qu’un parent ferme en douceur lui aussi', async () => {
    const w = mount(Hote, MONTAGE)
    await nextTick()

    const popup = w.findComponent(Popup)
    ;(popup.vm as unknown as { dismiss: () => void }).dismiss()

    await nextTick()
    expect(w.emitted('close')).toBeFalsy()
    await anime()
    expect(w.emitted('close')).toBeTruthy()

    w.unmount()
  })

  it('ne ferme pas sur une autre touche', async () => {
    const w = mount(Hote, MONTAGE)
    await nextTick()

    await presse('Enter')
    await anime()

    expect(w.emitted('close')).toBeFalsy()

    w.unmount()
  })
})

describe('Pile des calques — une seule, partagée', () => {
  /**
   * Le bug d'origine : la pile vivait dans Sheet.vue. Une carte ouverte par-dessus
   * une feuille n'y figurait pas, donc Échap fermait la FEUILLE du dessous et
   * laissait la carte posée sur un écran qui avait changé sous elle.
   */
  it('Échap ferme la fenêtre du dessus, pas la feuille du dessous', async () => {
    const feuilleFermee = ref(0)
    const fenetreFermee = ref(0)

    const Empile = defineComponent({
      setup() {
        return () => h('div', [
          h(Sheet, { title: 'Séance', onClose: () => feuilleFermee.value++ }),
          h(Popup, { title: 'Variantes', onClose: () => fenetreFermee.value++ }),
        ])
      },
    })

    const w = mount(Empile, MONTAGE)
    await nextTick()

    await presse('Escape')
    await anime()

    expect(fenetreFermee.value).toBe(1)
    expect(feuilleFermee.value).toBe(0)

    w.unmount()
  })
})
