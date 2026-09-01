import { describe, expect, it } from 'vitest'
import { urlDuServiceWorker } from '~/composables/useMaj'

describe('mise à jour : l\'URL porte la version', () => {
  it('accroche la version du build au script', () => {
    expect(urlDuServiceWorker('58debfa')).toBe('/sw.js?v=58debfa')
  })

  /*
   * Le tout est là : deux builds = deux URL. Si elles étaient identiques, le
   * navigateur considérerait qu'il n'y a rien de neuf à installer, et rien ne
   * purgerait le cache de la version d'avant — la panne exacte qu'on répare.
   */
  it('donne une URL différente à deux builds différents', () => {
    expect(urlDuServiceWorker('aaa1111')).not.toBe(urlDuServiceWorker('bbb2222'))
  })

  it('échappe ce qui viendrait d\'une variable d\'environnement', () => {
    expect(urlDuServiceWorker('a b&c')).toBe('/sw.js?v=a%20b%26c')
  })
})
