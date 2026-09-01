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

describe('la pastille se ferme, et revient', () => {
  it('se ferme à la main, mais l\'état « à jour » ne change pas', async () => {
    const { majDisponible, majMasquee, majVisible, useMaj } = await import('~/composables/useMaj')
    majDisponible.value = true
    majMasquee.value = false
    expect(majVisible.value).toBe(true)

    useMaj().masquer()
    expect(majVisible.value).toBe(false)
    // La mise à jour est toujours là : on l'a écartée, pas appliquée.
    expect(majDisponible.value).toBe(true)
  })

  /*
   * LE comportement demandé : fermer ne décide que pour cette fois. Rouvrir
   * l'application la fait revenir — sur un téléphone, « rouvrir » ne recharge pas
   * forcément la page, donc rien d'autre ne la ramènerait.
   */
  it('revient quand l\'application repasse au premier plan', async () => {
    const { auRetourEnAvantPlan, majDisponible, majMasquee, majVisible } = await import('~/composables/useMaj')
    majDisponible.value = true
    majMasquee.value = true
    expect(majVisible.value).toBe(false)

    auRetourEnAvantPlan()
    expect(majVisible.value).toBe(true)
  })

  it('ne montre rien quand il n\'y a pas de nouvelle version', async () => {
    const { auRetourEnAvantPlan, majDisponible, majMasquee, majVisible } = await import('~/composables/useMaj')
    majDisponible.value = false
    majMasquee.value = false
    auRetourEnAvantPlan()
    expect(majVisible.value).toBe(false)
  })
})
