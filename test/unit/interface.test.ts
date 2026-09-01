import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const lire = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')

/*
 * Deux réglages d'interface qui ne se voient dans aucun test de composant, et dont
 * la disparition ne casserait rien — elle rendrait juste l'application désagréable
 * sans que personne sache dire pourquoi.
 */
describe('l\'interface ne se pince pas', () => {
  it('le viewport interdit le zoom', () => {
    const cfg = lire('nuxt.config.ts')
    expect(cfg).toMatch(/viewport: '[^']*maximum-scale=1[^']*'/)
    expect(cfg).toMatch(/viewport: '[^']*user-scalable=no[^']*'/)
    // `viewport-fit=cover` doit survivre : c'est lui qui donne les encoches à
    // `env(safe-area-inset-*)`, dont dépendent la barre d'onglets et les feuilles.
    expect(cfg).toMatch(/viewport: '[^']*viewport-fit=cover[^']*'/)
  })

  it('le double-tap ne zoome pas non plus', () => {
    expect(lire('app.vue')).toMatch(/touch-action: manipulation/)
  })
})

describe('le message de confirmation se voit', () => {
  /*
   * Il vivait dans le flux, en haut de la coque. On déclenche ce qu'il confirme
   * depuis le BAS d'un écran long — importer une sauvegarde est en fin de réglages —
   * et il s'affichait six cents pixels plus haut, six secondes, puis disparaissait.
   */
  it('est fixé à l\'écran, pas posé en haut du document', () => {
    const css = lire('assets/css/sport.css')
    const bloc = css.slice(css.indexOf('\n.flash {'), css.indexOf('\n.flash {') + 400)
    expect(bloc).toMatch(/position: fixed/)
    expect(bloc).toMatch(/bottom:/)
  })
})
