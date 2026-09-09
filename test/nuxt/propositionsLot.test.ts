import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'

// ─────────────────────────────────────────────────────────────────────────────
// « Tout accepter » — l'ordre, les sautées, et le miroir poussé une seule fois.
// ─────────────────────────────────────────────────────────────────────────────
//
// Valider sept propositions une par une, c'est vingt taps ; quand elles viennent de
// la même conversation on les a déjà lues dans le fil. Le bouton existe pour ça.
//
// Trois choses peuvent mal tourner, et aucune ne se voit à l'œil :
//
//   · itérer la liste PENDANT qu'elle rétrécit — chaque application réussie retire
//     son élément de `pending`, et une boucle sur le tableau vivant en saute un sur
//     deux. Le bandeau annonce alors « 4 appliquées » sur sept, sans erreur ;
//   · perdre l'ORDRE. Claude dépose l'aliment avant la recette qui s'en sert ;
//   · pousser le miroir à chaque écriture au lieu d'une fois à la fin.

const appliquees: string[] = []
const pousses: number[] = []
let refusApres = -1 // index à partir duquel `apply` échoue (−1 = jamais)

const pending = ref<{ id: string, summary: string, action: string, at: string, detail: unknown }[]>([])

const prop = (id: string) => ({ id, summary: `Proposition ${id}`, action: 'autre', at: '2026-09-09T10:00:00.000Z', detail: {} })

vi.mock('../../composables/useVault', () => ({
  useVault: () => ({
    // « inapplicable » porte son état dans son identifiant : le test reste lisible.
    applicable: (p: { id: string }) => !p.id.startsWith('x'),
    apply: vi.fn(async (p: { id: string }) => {
      if (refusApres >= 0 && appliquees.length >= refusApres) return false
      appliquees.push(p.id)
      pending.value = pending.value.filter(q => q.id !== p.id)
      return true
    }),
    resolve: vi.fn(async () => true),
    push: vi.fn(async () => { pousses.push(appliquees.length); return true }),
    hydrate: vi.fn(async () => {}),
    relever: vi.fn(async () => {}),
    pending,
    recent: ref([]),
    pendingCount: ref(0),
    error: ref(null),
    state: ref({ connected: true, registered: true, bootstrapReady: false, passkeys: 1, appareils: [], ownerName: '' }),
    ctx: {},
  }),
}))

const attendre = () => new Promise(r => setTimeout(r, 30))

beforeEach(() => {
  localStorage.clear()
  appliquees.length = 0
  pousses.length = 0
  refusApres = -1
  document.body.querySelectorAll('.sport-portal').forEach(n => n.remove())
})

const ouvrir = async () => {
  const Propositions = (await import('../../components/sport/Propositions.vue')).default
  const w = mount(Propositions, { attachTo: document.body })
  await attendre()
  return w
}

/** Le bouton vit dans une fenêtre téléportée : on le cherche dans le document. */
const bouton = (texte: string) =>
  [...document.body.querySelectorAll('button')].find(b => (b.textContent || '').includes(texte)) as HTMLButtonElement | undefined

describe('le bouton « Tout accepter »', () => {
  it('n’apparaît pas pour une seule proposition applicable', async () => {
    pending.value = [prop('a')]
    await ouvrir()
    expect(bouton('Tout accepter')).toBeUndefined()
  })

  it('annonce le nombre d’applicables, pas le nombre de propositions', async () => {
    pending.value = [prop('a'), prop('b'), prop('x1'), prop('x2')]
    await ouvrir()
    expect(bouton('Tout accepter')?.textContent).toContain('2')
    // Et il DIT ce qui va rester : sinon on croit que le bouton a échoué.
    expect(document.body.textContent).toContain('2 ne sont plus applicables')
  })

  it('demande confirmation avant d’écrire quoi que ce soit', async () => {
    pending.value = [prop('a'), prop('b')]
    await ouvrir()
    bouton('Tout accepter')!.click()
    await attendre()
    expect(document.body.textContent).toContain('Appliquer les 2 propositions')
    expect(appliquees).toEqual([]) // rien n'est écrit tant qu'on n'a pas confirmé
  })

  it('applique tout, dans l’ordre de dépôt, sans en sauter', async () => {
    pending.value = [prop('a'), prop('b'), prop('c'), prop('d')]
    await ouvrir()
    bouton('Tout accepter')!.click()
    await attendre()
    bouton('Tout appliquer')!.click()
    await attendre()
    expect(appliquees).toEqual(['a', 'b', 'c', 'd'])
  })

  it('saute les inapplicables et laisse la file les garder', async () => {
    pending.value = [prop('a'), prop('x1'), prop('b')]
    await ouvrir()
    bouton('Tout accepter')!.click()
    await attendre()
    bouton('Tout appliquer')!.click()
    await attendre()
    expect(appliquees).toEqual(['a', 'b'])
    expect(pending.value.map(p => p.id)).toEqual(['x1'])
  })

  /** Sept écritures, un seul envoi : le miroir n'a d'intérêt qu'une fois tout posé. */
  it('ne pousse le miroir qu’une fois, à la fin', async () => {
    pending.value = [prop('a'), prop('b'), prop('c')]
    await ouvrir()
    bouton('Tout accepter')!.click()
    await attendre()
    bouton('Tout appliquer')!.click()
    await attendre()
    expect(pousses).toEqual([3])
  })

  it('ne pousse rien quand rien n’a pu être appliqué', async () => {
    refusApres = 0
    pending.value = [prop('a'), prop('b')]
    await ouvrir()
    bouton('Tout accepter')!.click()
    await attendre()
    bouton('Tout appliquer')!.click()
    await attendre()
    expect(appliquees).toEqual([])
    expect(pousses).toEqual([])
  })
})
