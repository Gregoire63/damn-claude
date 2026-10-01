import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { registerEndpoint } from '@nuxt/test-utils/runtime'
import Propositions from '../../components/sport/Propositions.vue'
import { useVault } from '../../composables/useVault'
import { useJournal } from '../../composables/useJournal'

// ─────────────────────────────────────────────────────────────────────────────
// Une boîte vide et une boîte injoignable ne doivent pas s'afficher pareil.
// ─────────────────────────────────────────────────────────────────────────────
//
// Le 1er octobre, trois propositions ont passé la soirée dans le coffre pendant que
// l'écran annonçait « Rien en attente ». Le relevé échouait, l'erreur était avalée
// par un `catch` muet, et `pending` restait sur sa dernière valeur — vide, puisque
// tout venait d'être appliqué. Rien, nulle part, ne laissait voir la différence.
//
// Deux conséquences sont testées ici : l'écran le dit, et le journal le garde pour
// que Claude puisse l'expliquer après coup — ce que personne ne pouvait faire ce
// soir-là.

registerEndpoint('/api/auth/me', () => ({ connected: true, registered: true, bootstrapReady: true }))
registerEndpoint('/api/vault/health', () => ({ pret: true, env: {}, store: 'local', driver: 'fs' }))
registerEndpoint('/api/vault/push', () => ({ at: '2026-10-01T18:00:00.000Z' }))
// Le relevé échoue : exactement le 401 qu'une session expirée renvoie.
registerEndpoint('/api/vault/pending', () => {
  throw createError({ statusCode: 401, statusMessage: 'Session requise' })
})

const attendre = () => new Promise(r => setTimeout(r, 60))

describe('la boîte de réception quand le relevé échoue', () => {
  it('le dit à l\'écran au lieu d\'annoncer le calme', async () => {
    localStorage.clear()
    const v = useVault()
    await v.loadPending()
    await attendre()

    expect(v.releveKo.value).toBe(true)

    // La feuille passe par un portail : c'est le document qu'on lit, pas le wrapper.
    const w = mount(Propositions, { attachTo: document.body, global: { stubs: { transition: false } } })
    await attendre(); await attendre(); await attendre()

    const txt = document.body.textContent ?? ''
    expect(txt).toContain('Je n’ai pas pu relever la boîte')
    // Et surtout : la phrase rassurante a disparu.
    expect(txt).not.toContain('Rien en attente. Ce que Claude propose')
    w.unmount()
    document.body.querySelectorAll('.sport-portal').forEach(n => n.remove())
  })

  it('note l\'échec dans le journal, avec son code HTTP', async () => {
    localStorage.clear()
    const journal = useJournal()
    journal.viderJournal()
    const v = useVault()
    await v.loadPending()
    await attendre()

    const e = journal.echecsDe('boite')
    expect(e).toHaveLength(1)
    expect(e[0]).toMatchObject({ poste: 'boite', http: 401, fois: 1 })
    expect(e[0].quoi).toContain('Session requise')
  })

  // La répétition est le cas normal : la veille retente toutes les minutes. Elle ne
  // doit pas remplir le journal — sinon la ligne unique et parlante qu'on cherchait
  // se fait pousser dehors avant qu'on la lise.
  it('regroupe les relevés ratés successifs sur une seule ligne', async () => {
    localStorage.clear()
    const journal = useJournal()
    journal.viderJournal()
    const v = useVault()
    await v.loadPending()
    await v.loadPending()
    await v.loadPending()
    await attendre()

    const e = journal.echecsDe('boite')
    expect(e).toHaveLength(1)
    expect(e[0].fois).toBe(3)
  })

  it('part dans le miroir, puisque c\'est là que Claude le lit', async () => {
    localStorage.clear()
    const journal = useJournal()
    journal.viderJournal()
    const v = useVault()
    await v.loadPending()
    await attendre()

    const { buildSnapshot } = useSnapshot()
    const snap = buildSnapshot() as { erreurs?: { poste: string }[] }
    expect(snap.erreurs).toHaveLength(1)
    expect(snap.erreurs![0].poste).toBe('boite')
  })
})
