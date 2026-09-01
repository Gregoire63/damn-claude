import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { registerEndpoint } from '@nuxt/test-utils/runtime'
import Propositions from '../../components/sport/Propositions.vue'
import type { RawProposal } from '../../lib/proposals'

// ─────────────────────────────────────────────────────────────────────────────
// Une écriture générique doit se LIRE avant de se valider.
// ─────────────────────────────────────────────────────────────────────────────
//
// Ajouter une pesée oubliée était impossible : le pointeur ne rallongeait pas un
// tableau. C'est désormais un geste comme un autre — mais il arrive sous la forme
// « /bodyWeight » + un objet, et valider ça revient à signer un pointeur JSON si la
// carte ne traduit pas.
//
// Fichier séparé de `vaultProgramme` à dessein : `useVault` garde son état de
// propositions au niveau du module, donc deux jeux de propositions dans le même
// fichier se marchent dessus — le second test lirait la boîte vidée par le premier.

const PROPOSITION: RawProposal = {
  id: 'c1',
  at: '2026-08-19T10:00:00.000Z',
  action: 'correction',
  summary: 'Pesée du 19 août oubliée : 91,2 kg',
  patch: { quoi: 'champ', op: 'ajouter', chemin: '/bodyWeight', vers: { date: '2026-08-19', kg: 91.2 } },
  status: 'pending',
}

registerEndpoint('/api/auth/me', () => ({ connected: true, registered: true, bootstrapReady: true }))
registerEndpoint('/api/vault/health', () => ({ pret: true, env: {}, store: 'local', driver: 'fs' }))
registerEndpoint('/api/vault/pending', () => ({ mirrorAt: '2026-08-19T09:00:00.000Z', pending: [PROPOSITION], recent: [] }))
registerEndpoint('/api/vault/resolve', () => ({ ok: true }))
registerEndpoint('/api/vault/push', () => ({ at: '2026-08-19T10:00:00.000Z' }))

const attendre = () => new Promise(r => setTimeout(r, 60))

describe('une écriture générique dans la boîte de réception', () => {
  it('traduit le chemin en mots, et s’applique d’un tap', async () => {
    localStorage.clear()
    localStorage.setItem('gr-bodyweight-v1', JSON.stringify([{ date: '2026-08-18', kg: 91.5 }]))
    const w = mount(Propositions, { attachTo: document.body, global: { stubs: { transition: false } } })
    await attendre(); await attendre()
    await attendre(); await attendre()

    const txt = document.body.textContent ?? ''
    // Le chemin traduit, pas le pointeur brut : « Pesées », pas « /bodyWeight ».
    expect(txt).toContain('Pesées')
    expect(txt).toContain('Ajouter à la liste')
    // La liste n'est pas dumpée : on dit sa taille, et ce qui s'y ajoute.
    expect(txt).toContain('1 entrées')
    // Et surtout : plus de « l'app ne sait pas appliquer ça toute seule ».
    expect(txt).not.toContain('ne sait pas appliquer')

    const appliquer = [...document.body.querySelectorAll('button')].find(b => b.textContent === 'Appliquer')
    expect(appliquer, 'une écriture générique doit être applicable d\'un tap').toBeTruthy()
    appliquer!.click()
    await attendre(); await attendre()

    const pesees = JSON.parse(localStorage.getItem('gr-bodyweight-v1') ?? '[]') as { date: string, kg: number }[]
    expect(pesees).toHaveLength(2)
    expect(pesees.find(e => e.date === '2026-08-19')?.kg).toBe(91.2)
    w.unmount()
    document.body.querySelectorAll('.sport-portal').forEach(n => n.remove())
  })
})
