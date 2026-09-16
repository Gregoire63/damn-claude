import { beforeEach, describe, expect, it, vi } from 'vitest'
import { convivesFor } from '../../lib/proposals'
import { facteurRepas } from '../../lib/foyer'

// ─────────────────────────────────────────────────────────────────────────────
// La proposition du connecteur et le stockage de l'écran doivent s'emboîter.
// ─────────────────────────────────────────────────────────────────────────────
//
// `convivesFor` valide une phrase dictée ; `useRepasConvives` range ce que la fiche
// de recette écrit. Les deux sont testés séparément et pourraient très bien passer
// chacun de leur côté en ne parlant pas la même langue : une clé de plus, un « Moi »
// oublié, un compte rangé ailleurs.
//
// Ce fichier ferme la boucle sur la seule chose qui compte au bout — le facteur par
// lequel on multiplie les grammages. Il tient les deux extrémités : ce qui est EN
// PLACE nourrit la proposition (`convivesAt`), et ce qu'elle produit repart dans le
// même magasin.

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

const FOYER = [
  { id: 'moi', nom: 'Moi', appetit: 1, actif: true },
  { id: 'camille', nom: 'Camille', appetit: 0.6, actif: true },
]

async function magasin() {
  localStorage.setItem('gr-foyer-v1', JSON.stringify([FOYER[1]]))
  const { useRepasConvives } = await import('../../composables/useRepasConvives')
  const r = useRepasConvives()
  r.hydrate()
  return r
}

const brut = (patch: Record<string, unknown>) =>
  ({ id: '', at: '', action: 'convives', summary: 'test', patch, status: 'pending' as const })

/** Le chemin complet : proposer → valider → ranger → relire le facteur. */
async function appliquer(patch: Record<string, unknown>) {
  const r = await magasin()
  const plan = convivesFor(brut(patch), {
    membreKnown: (id: string) => FOYER.some(c => c.id === id),
    convivesAt: (d: string, c: string) => r.pour(d, c),
  })
  expect(plan, 'la proposition doit être valide').not.toBeNull()
  if (plan!.convives) r.definir(plan!.date, plan!.creneau, plan!.convives)
  else r.oublier(plan!.date, plan!.creneau)
  return r
}

describe('une proposition de convives, jusqu’au facteur', () => {
  /** LE cas : « prépare-moi le double demain midi ». */
  it('double la casserole sans qu’on ait dit qui est à table', async () => {
    const r = await appliquer({ date: '2026-09-17', creneau: 'dinner', repas: 2 })
    // (1 + 0,6) × 2 = 3,2
    expect(facteurRepas(r.pour('2026-09-17', 'dinner'), FOYER)).toBe(3.2)
    // Et seul CE repas bouge : le lendemain reste ordinaire.
    expect(facteurRepas(r.pour('2026-09-18', 'dinner'), FOYER)).toBe(1.6)
  })

  it('traite l’asymétrie, deux jours pour l’un et un seul pour l’autre', async () => {
    const r = await appliquer({ date: '2026-09-17', creneau: 'dinner', repas: { moi: 2 } })
    // 1 × 2 + 0,6 = 2,6
    expect(facteurRepas(r.pour('2026-09-17', 'dinner'), FOYER)).toBe(2.6)
  })

  /**
   * Deux propositions de suite, et la seconde ne connaît que ce qu'elle change.
   * C'est tout l'intérêt de `convivesAt` : sans lui, retirer Camille effacerait le
   * ×2 posé la veille sans que personne ne l'ait demandé.
   */
  it('s’empile sans effacer ce que la précédente avait posé', async () => {
    await appliquer({ date: '2026-09-17', creneau: 'dinner', repas: { moi: 2 } })
    const r = await appliquer({ date: '2026-09-17', creneau: 'dinner', membres: ['moi'] })
    const c = r.pour('2026-09-17', 'dinner')
    expect(c.membres).toEqual(['moi'])
    expect(c.repas).toEqual({ moi: 2 })
    expect(facteurRepas(c, FOYER)).toBe(2)
  })

  it('efface l’exception et rend le repas au foyer courant', async () => {
    await appliquer({ date: '2026-09-17', creneau: 'dinner', repas: 3 })
    const r = await appliquer({ date: '2026-09-17', creneau: 'dinner', vers: null })
    // Effacée, pas figée en copie de l'ordinaire : changer le foyer plus tard doit
    // toucher ce repas-là comme les autres.
    expect(r.exception('2026-09-17', 'dinner')).toBeNull()
    expect(facteurRepas(r.pour('2026-09-17', 'dinner'), FOYER)).toBe(1.6)
  })

  it('compte un invité une fois, même quand on cuisine pour deux jours', async () => {
    const r = await appliquer({
      date: '2026-09-17', creneau: 'dinner',
      repas: { moi: 2 }, invites: [{ nom: 'Léa', appetit: 1 }],
    })
    // 1 × 2 + 0,6 + 1 = 3,6 — l'invité est à table ce soir, un point c'est tout.
    expect(facteurRepas(r.pour('2026-09-17', 'dinner'), FOYER)).toBe(3.6)
  })

  it('survit au rechargement, comme tout le reste', async () => {
    await appliquer({ date: '2026-09-17', creneau: 'dinner', repas: 2 })
    vi.resetModules()
    const { useRepasConvives } = await import('../../composables/useRepasConvives')
    const encore = useRepasConvives()
    encore.hydrate()
    expect(facteurRepas(encore.pour('2026-09-17', 'dinner'), FOYER)).toBe(3.2)
  })
})
