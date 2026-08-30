import { beforeEach, describe, expect, it, vi } from 'vitest'

// Ces tests tournent sur le PACK D'EXEMPLE : l'application ne livre plus de données.
// Voir test/exemple.ts pour le pourquoi.
vi.mock('../../data/nutritionProgram', () => (import('../exemple')).then(m => m.catalogueExemple()))
vi.mock('../../data/sportProgram', () => (import('../exemple')).then(m => m.programmeExemple()))

// Ce fichier ne teste pas un calcul, il teste une PROMESSE : un repas hors plan ne
// touche jamais au catalogue.
//
// C'est la seule garantie qui compte vraiment ici. Une variante — 211 g de saumon au
// lieu de 150, sans la vinaigrette — décrit un repas et un jour. Si elle se mettait à
// modifier la recette, le plat deviendrait faux pour tous les autres jours de la
// semaine, et rien à l'écran ne le dirait : les courses, le stock du frigo et les
// sessions de cuisine continueraient à tourner sur des grammages qu'on n'a jamais
// voulu changer. Une erreur silencieuse et durable, à partir d'un geste qui se veut
// ponctuel.
//
// L'autre promesse : les repas déjà enregistrés, qui n'ont pas de composition,
// continuent de se relire tels quels.

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

const load = async () => {
  const { useNutrition } = await import('../../composables/useNutrition')
  const n = useNutrition()
  n.hydrate()
  return n
}

/** Une empreinte du catalogue : si elle bouge, quelque chose l'a écrit. */
const empreinte = (n: Awaited<ReturnType<typeof load>>) => JSON.stringify({
  recettes: Object.keys(n.library.value.recipes).sort(),
  items: Object.fromEntries(Object.entries(n.library.value.recipes).map(([k, r]) => [k, r.items])),
  steps: Object.fromEntries(Object.entries(n.library.value.recipes).map(([k, r]) => [k, r.steps])),
})

describe('un repas hors plan et le catalogue', () => {
  it('enregistre une composition sans rien changer aux recettes', async () => {
    const n = await load()
    const base = Object.keys(n.library.value.recipes)[0]
    const ingredient = Object.keys(n.library.value.foods)[0]
    const avant = empreinte(n)

    const ok = n.setFreeMeal('2026-08-17', 'dinner', {
      label: 'Variante renforcée',
      kcal: 700, p: 50, g: 40, l: 30,
      base,
      items: [{ food: ingredient, g: 211 }],
      steps: 'Sans vinaigrette.',
    })

    expect(ok).toBe(true)
    expect(empreinte(n)).toBe(avant)
  })

  it('relit la composition après rechargement', async () => {
    const n = await load()
    const ingredient = Object.keys(n.library.value.foods)[0]
    n.setFreeMeal('2026-08-17', 'dinner', {
      label: 'Variante', kcal: 700, items: [{ food: ingredient, g: 211 }], steps: 'À la poêle.',
    })

    vi.resetModules()
    const relu = await load()
    expect(relu.freeMealFor('2026-08-17', 'dinner')).toMatchObject({
      label: 'Variante',
      items: [{ food: ingredient, g: 211 }],
      steps: 'À la poêle.',
    })
  })

  /**
   * MIGRATION SILENCIEUSE. Un repas écrit par une version antérieure n'a ni `items`,
   * ni `base`, ni `steps`. Il doit se relire à l'identique — et surtout ne pas
   * gagner de clés vides, qui feraient diverger la sauvegarde de son miroir sans
   * qu'aucune donnée n'ait changé.
   */
  it('relit un repas d’avant la composition, sans lui ajouter de clés', async () => {
    localStorage.setItem('gr-nutri-libre-v1', JSON.stringify({
      '2026-08-10': { lunch: { label: 'Kebab galette', kcal: 1050, p: 45, g: 95, l: 50, from: 'claude' } },
    }))
    const n = await load()
    const m = n.freeMealFor('2026-08-10', 'lunch')
    expect(m).toEqual({ label: 'Kebab galette', kcal: 1050, p: 45, g: 95, l: 50, from: 'claude' })
    expect(Object.keys(m!)).not.toContain('items')
  })

  it('affiche toujours ces anciens repas dans la journée', async () => {
    localStorage.setItem('gr-nutri-libre-v1', JSON.stringify({
      '2026-08-10': { lunch: { label: 'Kebab galette', kcal: 1050, p: 45, g: 95, l: 50 } },
    }))
    const n = await load()
    const jour = n.dayPlanFor('2026-08-10')
    const midi = jour.meals.find(m => m.slot === 'lunch')
    expect(midi).toMatchObject({ name: 'Kebab galette', free: true })
    expect(midi!.macros.kcal).toBe(1050)
  })

  /** La composition n'entre pas dans le repas de la journée : elle se lit à part,
   *  pour qu'aucun calcul en aval — courses, stock, sessions — ne la voie passer. */
  it('ne fait pas entrer les ingrédients dans le repas de la journée', async () => {
    const n = await load()
    const ingredient = Object.keys(n.library.value.foods)[0]
    n.setFreeMeal('2026-08-17', 'lunch', {
      label: 'Variante', kcal: 700, items: [{ food: ingredient, g: 211 }],
    })
    const midi = n.dayPlanFor('2026-08-17').meals.find(m => m.slot === 'lunch')
    expect(midi!.items).toEqual([])
    expect(n.freeMealFor('2026-08-17', 'lunch')!.items).toHaveLength(1)
  })

  it('retire le repas et rend le créneau au plat prévu', async () => {
    const n = await load()
    n.setFreeMeal('2026-08-17', 'lunch', { label: 'Variante', kcal: 700, items: [] })
    expect(n.freeMealFor('2026-08-17', 'lunch')).not.toBeNull()
    n.setFreeMeal('2026-08-17', 'lunch', null)
    expect(n.freeMealFor('2026-08-17', 'lunch')).toBeNull()
  })
})
