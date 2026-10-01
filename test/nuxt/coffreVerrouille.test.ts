import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { registerEndpoint } from '@nuxt/test-utils/runtime'
import Propositions from '../../components/sport/Propositions.vue'
import { useVault } from '../../composables/useVault'
import { useJournal } from '../../composables/useJournal'

// ─────────────────────────────────────────────────────────────────────────────
// Coffre fermé : l'application ne DEMANDE rien, et c'était invisible.
// ─────────────────────────────────────────────────────────────────────────────
//
// Le troisième état, découvert après les deux autres et plus coûteux qu'eux. Un
// relevé qui échoue, on finit par le voir ; un relevé qui n'a jamais lieu, non.
// `refresh` saute `loadPending` quand la session est fermée et `relever` sort à sa
// première ligne : rien n'échoue, `releveKo` reste faux, et l'écran affichait
// « Rien en attente » — la phrase la plus rassurante de l'application — pendant que
// quatre propositions attendaient dans le coffre et que le miroir cessait de
// vieillir.
//
// Fichier séparé parce que `useVault` garde son état au niveau du module : une
// session fermée ici contaminerait les tests qui la veulent ouverte.

let appelsPending = 0
registerEndpoint('/api/auth/me', () => ({ connected: false, registered: true, bootstrapReady: true }))
registerEndpoint('/api/vault/health', () => ({ pret: true, env: {}, store: 'local', driver: 'fs' }))
registerEndpoint('/api/vault/pending', () => {
  appelsPending++
  return { mirrorAt: null, pending: [], recent: [] }
})

const attendre = () => new Promise(r => setTimeout(r, 60))

describe('la boîte de réception quand le coffre est verrouillé', () => {
  it('ne relève même pas, et le dit', async () => {
    localStorage.clear()
    appelsPending = 0
    const v = useVault()
    await v.refresh()
    await attendre()

    // Le cœur du défaut : aucun appel, donc aucune panne, donc aucun signe.
    expect(appelsPending).toBe(0)
    expect(v.releveKo.value).toBe(false)
    expect(v.verrouille.value).toBe(true)

    const w = mount(Propositions, { attachTo: document.body, global: { stubs: { transition: false } } })
    await attendre(); await attendre(); await attendre()

    const txt = document.body.textContent ?? ''
    expect(txt).toContain('Le coffre est')
    expect(txt).toContain('verrouillé')
    // La phrase qui mentait, et qui tenait le haut de l'écran.
    expect(txt).not.toContain('Rien en attente. Ce que Claude propose')
    // Et le geste est là, pas trois écrans plus loin dans les réglages.
    const bouton = [...document.body.querySelectorAll('button')].find(b => b.textContent?.includes('Déverrouiller'))
    expect(bouton, 'le déverrouillage doit être à portée de la boîte').toBeTruthy()

    w.unmount()
    document.body.querySelectorAll('.sport-portal').forEach(n => n.remove())
  })

  it('note le verrou dans le journal, sans le confondre avec une panne', async () => {
    localStorage.clear()
    const journal = useJournal()
    journal.viderJournal()
    const v = useVault()
    await v.refresh()
    await attendre()

    const e = journal.echecsDe('session')
    expect(e).toHaveLength(1)
    expect(e[0].quoi).toContain('verrouillé')
    // Pas de code HTTP : rien n'a échoué, c'est un état, pas une erreur.
    expect(e[0].http).toBeUndefined()
    expect(journal.echecsDe('boite')).toHaveLength(0)
  })

  // Une instance neuve n'a rien à déverrouiller : réclamer une empreinte pour une
  // boîte qui n'existe pas serait pire que le silence.
  it('se tait sur une instance jamais configurée', async () => {
    const v = useVault()
    v.state.value = { ...v.state.value, connected: false, registered: false }
    await attendre()
    expect(v.verrouille.value).toBe(false)
  })
})
