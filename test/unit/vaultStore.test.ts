import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Le client Netlify Blobs se reconstruit à chaque opération.
// ─────────────────────────────────────────────────────────────────────────────
//
// Ce test existe à cause d'une panne de dix jours, et il vaut la peine de dire
// laquelle : le client était mémorisé au niveau du module « parce que c'est de la
// configuration, identique d'un appel au suivant ». Cette configuration contient une
// accréditation de courte durée. Passé une vingtaine de minutes d'instance chaude,
// toutes les lectures ET toutes les écritures rendaient « Token expired ».
//
// Ce qu'on vérifie n'est donc pas un détail de performance : c'est que personne ne
// remette un cache ici en croyant optimiser. Le test est ÉCRIT EN COMPORTEMENT et
// non en lecture de source, pour qu'un cache réintroduit sous un autre nom — une
// variable de module, un `memo`, un singleton — soit attrapé quand même.

const getStore = vi.fn(() => ({
  get: vi.fn(async () => null),
  set: vi.fn(async () => {}),
}))

vi.mock('@netlify/blobs', () => ({ getStore }))

describe('le client du coffre', () => {
  beforeEach(() => {
    // Fait croire au module qu'il tourne sur Netlify, pour emprunter cette branche
    // plutôt que le repli sur fichiers locaux.
    process.env.NETLIFY_BLOBS_CONTEXT = 'contexte-de-test'
    process.env.NUXT_VAULT_SECRET = 'un-secret-de-test-de-plus-de-32-caracteres'
    getStore.mockClear()
    vi.resetModules()
  })

  it('est reconstruit à CHAQUE lecture', async () => {
    const { readMirror } = await import('../../server/utils/vault')
    await readMirror()
    await readMirror()
    await readMirror()
    // Trois lectures, trois constructions. Deux ou moins signifient qu'un appel a
    // réutilisé un client — donc un jeton — d'une invocation précédente.
    expect(getStore).toHaveBeenCalledTimes(3)
  })

  it('est reconstruit à CHAQUE écriture', async () => {
    const { writeMirror } = await import('../../server/utils/vault')
    const miroir = { at: '2026-08-24T00:00:00.000Z' } as never
    await writeMirror(miroir)
    await writeMirror(miroir)
    expect(getStore).toHaveBeenCalledTimes(2)
  })

  it('ne partage rien entre une lecture et une écriture', async () => {
    const { readMirror, writeMirror } = await import('../../server/utils/vault')
    await readMirror()
    await writeMirror({ at: '2026-08-24T00:00:00.000Z' } as never)
    // Le cas qui a fait croire à un problème d'écriture : les deux passent par le
    // même chemin, et doivent donc être aussi neuves l'une que l'autre.
    expect(getStore).toHaveBeenCalledTimes(2)
  })

  it('reconstruit le client à la SECONDE tentative, et pas seulement l\u2019opération', async () => {
    // Le piège que ce test existe pour fermer : une reprise qui rejoue l'opération
    // sur le client déjà en main. Si son accréditation a expiré, les deux tentatives
    // échouent à l'identique — et on croit que le correctif n'a rien changé.
    //
    // On simule donc exactement ça : le premier client rend « Token expired », le
    // second fonctionne. La lecture doit aboutir, ce qui n'est possible QUE si un
    // second client a été construit.
    const perime = { get: vi.fn(async () => { throw new Error('Failed to decode token: Token expired') }), set: vi.fn() }
    const neuf = { get: vi.fn(async () => null), set: vi.fn(async () => {}) }
    getStore.mockReturnValueOnce(perime as never).mockReturnValue(neuf as never)

    const { readMirror } = await import('../../server/utils/vault')
    await expect(readMirror()).resolves.toBeNull()

    expect(getStore).toHaveBeenCalledTimes(2)
    expect(perime.get).toHaveBeenCalledTimes(1)
    expect(neuf.get).toHaveBeenCalledTimes(1)
  })

  it('abandonne après deux tentatives, en laissant passer la vraie erreur', async () => {
    // Insister davantage ne ferait qu'allonger le délai que la passerelle nous
    // accorde — et c'est ce qui transforme une erreur lisible en 502 muette.
    const perime = { get: vi.fn(async () => { throw new Error('Failed to decode token: Token expired') }), set: vi.fn() }
    getStore.mockReturnValue(perime as never)

    const { readMirror } = await import('../../server/utils/vault')
    await expect(readMirror()).rejects.toThrow(/Token expired/)
    expect(getStore).toHaveBeenCalledTimes(2)
  })
})
