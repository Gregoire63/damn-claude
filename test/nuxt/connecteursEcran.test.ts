import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerEndpoint } from '@nuxt/test-utils/runtime'
import Sources from '../../components/sport/Sources.vue'

// ─────────────────────────────────────────────────────────────────────────────
// L'écran des connecteurs ne doit JAMAIS être un cul-de-sac.
// ─────────────────────────────────────────────────────────────────────────────
//
// L'étape du parcours affichait quatre marques grisées, « à configurer », et aucun
// geste possible. Rien n'était cassé — le formulaire existait, dans les réglages, à un
// endroit qu'on ne pouvait pas deviner depuis là. Vu de l'utilisateur, c'était une
// application incomplète.
//
// La règle que ce fichier tient : chaque ligne propose quelque chose. Brancher,
// configurer, ou au minimum dire pourquoi c'est impossible.

const SOURCES = {
  disponibles: [
    { id: 'withings', label: 'Withings', icone: '⚖️', capabilities: ['poids'], note: 'Balances.', console: 'https://developer.withings.com/' },
  ],
  indisponibles: [
    { id: 'fitbit', label: 'Fitbit', icone: '⌚', capabilities: ['poids', 'pas'], note: 'Montres.', console: 'https://dev.fitbit.com/', raison: 'Non configuré.', configurable: true },
    { id: 'garmin', label: 'Garmin', icone: '🧭', capabilities: ['pas'], note: '', console: '', raison: 'Programme suspendu.', configurable: false },
  ],
}

registerEndpoint('/api/sources', () => SOURCES)
// 401 : le cas du parcours, où aucune clé d'accès n'a encore été créée.
registerEndpoint('/api/connect/config', () => { throw createError({ statusCode: 401 }) })

const attendre = () => new Promise(r => setTimeout(r, 60))

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
  document.body.querySelectorAll('.sport-portal').forEach(n => n.remove())
})

describe('la liste compacte, dans le parcours d’installation', () => {
  it('propose un geste sur CHAQUE ligne', async () => {
    const w = mount(Sources, { props: { compact: true }, attachTo: document.body })
    await attendre(); await attendre()

    const lignes = w.findAll('.conn > li')
        expect(lignes).toHaveLength(3)
    for (const li of lignes) {
      const texte = li.text()
      const geste = li.find('button').exists() || /connecté/.test(texte)
      expect(geste, `aucun geste possible sur « ${texte.slice(0, 40)} »`).toBe(true)
    }
    w.unmount()
  })

  it('ouvre une fenêtre qui dit quoi faire, marque par marque', async () => {
    const w = mount(Sources, { props: { compact: true }, attachTo: document.body })
    await attendre(); await attendre()

    const fitbit = w.findAll('.conn > li').find(li => li.text().includes('Fitbit'))!
    await fitbit.get('button').trigger('click')
    await attendre(); await attendre()

    const txt = document.body.textContent ?? ''
    // Les trois choses qu'on ne peut pas deviner : où créer l'application, quelle URL
    // de retour déclarer, et pourquoi le formulaire ne répond pas encore.
    expect(txt).toContain('/api/connect/fitbit/callback')
    expect(document.body.querySelector('a[href="https://dev.fitbit.com/"]')).toBeTruthy()
    expect(txt).toMatch(/Clé d'accès requise/)
    w.unmount()
  })

  it('explique aussi une marque que personne ne peut brancher', async () => {
    // Garmin n'a pas de formulaire : la fenêtre doit quand même s'ouvrir et dire
    // pourquoi. Une ligne morte sans explication se lit comme un bogue.
    const w = mount(Sources, { props: { compact: true }, attachTo: document.body })
    await attendre(); await attendre()

    const garmin = w.findAll('.conn > li').find(li => li.text().includes('Garmin'))!
    expect(garmin.get('button').text()).toBe('Pourquoi ?')
    await garmin.get('button').trigger('click')
    await attendre(); await attendre()

    expect(document.body.textContent).toContain('Programme suspendu.')
    // …et surtout aucun champ à remplir, qui ne mènerait nulle part.
    expect(document.body.querySelectorAll('.popup-card input, .conn-popup input')).toHaveLength(0)
    w.unmount()
  })
})
