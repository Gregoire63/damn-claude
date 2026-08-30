import { describe, expect, it, vi } from 'vitest'
import { FREE_MEAL_TOLERANCE, checkFreeMeal, freeMealFrom } from '../../lib/freeMeal'
import { planFor } from '../../lib/proposals'
import type { Food } from '../../data/nutritionProgram'

// Ces tests tournent sur le PACK D'EXEMPLE : l'application ne livre plus de données.
// Voir test/exemple.ts pour le pourquoi.
vi.mock('../../data/nutritionProgram', () => (import('../exemple')).then(m => m.catalogueExemple()))

// ─────────────────────────────────────────────────────────────────────────────
// La composition ad hoc d'un repas hors plan
// ─────────────────────────────────────────────────────────────────────────────
//
// Le cas à couvrir n'est pas le kebab — celui-là marchait déjà. C'est la VARIANTE :
// même recette que le catalogue, 211 g de saumon au lieu de 150, sans la
// vinaigrette. Trois choses peuvent mal tourner, et deux sont silencieuses :
//
//   • le catalogue se fait modifier au passage, et le plat d'origine devient faux
//     pour tous les autres jours ;
//   • un repas déjà enregistré, sans composition, cesse de s'afficher ;
//   • un ingrédient inventé passe et s'affiche en identifiant brut dans la fiche.
//
// Les trois ont leur test ci-dessous.

const aliment = (id: string, kcal: number, p: number, g: number, l: number): Food =>
  ({ id, name: id, cat: 'viandes', kcal, p, g, l } as Food)

/** De quoi calculer : 100 g de saumon, 100 g de patate douce. */
const FOODS: Record<string, Food> = {
  saumon: aliment('saumon', 208, 20, 0, 13),
  'patate-douce': aliment('patate-douce', 86, 1.6, 20, 0.1),
  epinards: aliment('epinards', 23, 2.9, 3.6, 0.4),
}

const ctx = {
  foodKnown: (id: string) => !!FOODS[id],
  recipeKnown: (id: string) => id === 'din-saumon',
}

const brut = (patch: Record<string, unknown>) =>
  ({ id: '', at: '', action: 'repas-libre', summary: 'test', patch, status: 'pending' as const })

describe('freeMealFrom — la composition', () => {
  it('retient les items, la base et la préparation adaptée', () => {
    const r = freeMealFrom({
      label: 'Saumon renforcé', kcal: 700, p: 50, g: 40, l: 30,
      base: 'din-saumon',
      items: [{ food: 'saumon', g: 211 }, { food: 'patate-douce', g: 180 }],
      steps: 'Four 200 °C, 18 min. Sans vinaigrette.',
    })
    expect(r).toMatchObject({
      base: 'din-saumon',
      items: [{ food: 'saumon', g: 211 }, { food: 'patate-douce', g: 180 }],
      steps: 'Four 200 °C, 18 min. Sans vinaigrette.',
    })
  })

  /**
   * LA garantie de rétrocompatibilité. Les repas déjà enregistrés n'ont aucun de ces
   * champs ; ils ne doivent pas en gagner un, même à `undefined`. Une clé vide
   * suffirait à faire diverger la sauvegarde de son miroir sans qu'aucune donnée
   * n'ait changé, et à faire échouer les comparaisons d'égalité stricte existantes.
   */
  it('n’ajoute AUCUNE clé à un repas sans composition', () => {
    const r = freeMealFrom({ label: 'Kebab', kcal: 1050, p: 45, g: 95, l: 50 })
    expect(Object.keys(r!).sort()).toEqual(['from', 'g', 'kcal', 'l', 'label', 'p'])
  })

  it('accepte une composition PARTIELLE — un gigot n’a pas d’identifiant', () => {
    const r = freeMealFrom({
      label: 'Gigot + patate douce', kcal: 900, p: 60, g: 45, l: 50,
      items: [{ food: 'patate-douce', g: 200 }],
    }, { foodKnown: ctx.foodKnown })
    expect(r?.items).toHaveLength(1)
  })

  it('refuse un aliment inconnu quand le catalogue est fourni', () => {
    expect(freeMealFrom({
      label: 'Variante', kcal: 700,
      items: [{ food: 'saumon', g: 200 }, { food: 'truite-fumee', g: 50 }],
    }, { foodKnown: ctx.foodKnown })).toBeNull()
  })

  /**
   * Sans catalogue sous la main, on ne refuse pas : c'est le chemin qu'emprunte la
   * relecture d'un repas déjà enregistré. Un aliment renommé depuis ne doit pas
   * rendre invalide un repas d'il y a six mois — on ne réécrit pas le passé pour lui
   * faire respecter les règles d'après.
   */
  it('laisse passer les items quand aucun catalogue n’est fourni', () => {
    expect(freeMealFrom({
      label: 'Variante', kcal: 700, items: [{ food: 'aliment-disparu', g: 50 }],
    })?.items).toEqual([{ food: 'aliment-disparu', g: 50 }])
  })

  it('refuse une ligne sans grammes plutôt que de la compter pour zéro', () => {
    expect(freeMealFrom({ label: 'X', kcal: 500, items: [{ food: 'saumon' }] })).toBeNull()
    expect(freeMealFrom({ label: 'X', kcal: 500, items: [{ food: 'saumon', g: 0 }] })).toBeNull()
  })

  it('ignore une composition vide au lieu d’en faire un refus', () => {
    // `items: []` veut dire « je n'en sais rien », pas « ce plat n'a rien dedans ».
    expect(freeMealFrom({ label: 'X', kcal: 500, items: [] })).toMatchObject({ kcal: 500 })
    expect(freeMealFrom({ label: 'X', kcal: 500, items: [] })).not.toHaveProperty('items')
  })
})

describe('checkFreeMeal — contrôler sans remplacer', () => {
  it('ne rend rien sans composition : il n’y a rien à confronter', () => {
    expect(checkFreeMeal(freeMealFrom({ label: 'Kebab', kcal: 1050 })!, FOODS)).toBeNull()
  })

  it('calcule les macros des ingrédients sans toucher aux macros saisies', () => {
    const meal = freeMealFrom({
      label: 'Saumon', kcal: 600, p: 46, g: 36, l: 28,
      items: [{ food: 'saumon', g: 200 }, { food: 'patate-douce', g: 180 }],
    })!
    const c = checkFreeMeal(meal, FOODS)!
    // 2 × 208 + 1,8 × 86 = 570,8
    expect(Math.round(c.calcule.kcal)).toBe(571)
    expect(c.saisi).toEqual({ kcal: 600, p: 46, g: 36, l: 28 })
  })

  it('ne signale rien tant que l’écart reste sous la tolérance', () => {
    const meal = freeMealFrom({
      label: 'Saumon', kcal: 571, p: 43, g: 36, l: 26,
      items: [{ food: 'saumon', g: 200 }, { food: 'patate-douce', g: 180 }],
    })!
    expect(checkFreeMeal(meal, FOODS)!.notable).toBe(false)
    expect(FREE_MEAL_TOLERANCE).toBe(10)
  })

  it('signale un écart franc, dans les deux sens, sans jamais refuser', () => {
    const bas = freeMealFrom({
      label: 'Gigot + patate', kcal: 900,
      items: [{ food: 'patate-douce', g: 200 }],
    })!
    const c = checkFreeMeal(bas, FOODS)!
    expect(c.notable).toBe(true)
    expect(c.ecartPct).toBeLessThan(0) // la composition partielle explique moins que le total
    // Et le repas reste parfaitement valide : c'est un avertissement, pas un rejet.
    expect(bas.kcal).toBe(900)
  })
})

describe('planFor — le dépôt d’une variante', () => {
  it('accepte une variante complète', () => {
    const plan = planFor(brut({
      date: '2026-08-17', slot: 'dinner',
      vers: {
        label: 'Saumon renforcé', kcal: 700, p: 50, g: 40, l: 30,
        base: 'din-saumon',
        items: [{ food: 'saumon', g: 211 }],
        steps: 'Sans vinaigrette.',
      },
    }), ctx)
    expect(plan).toMatchObject({
      kind: 'repas-libre',
      date: '2026-08-17',
      slot: 'dinner',
      repas: { base: 'din-saumon', from: 'claude', items: [{ food: 'saumon', g: 211 }] },
    })
  })

  it('refuse un ingrédient qui n’existe pas', () => {
    expect(planFor(brut({
      date: '2026-08-17', slot: 'dinner',
      vers: { label: 'X', kcal: 700, items: [{ food: 'wagyu', g: 200 }] },
    }), ctx)).toBeNull()
  })

  /** Une base fantôme promettrait une recette et un lien qui n'ouvre rien. */
  it('refuse une base qui ne désigne aucun plat du catalogue', () => {
    expect(planFor(brut({
      date: '2026-08-17', slot: 'dinner',
      vers: { label: 'X', kcal: 700, base: 'plat-inexistant' },
    }), ctx)).toBeNull()
  })

  it('accepte les alias français : ingredients, preparation, plat_origine', () => {
    const plan = planFor(brut({
      date: '2026-08-17', slot: 'lunch',
      vers: {
        label: 'Poulet renforcé', kcal: 700,
        plat_origine: 'din-saumon',
        ingredients: [{ aliment: 'saumon', grammes: 150 }],
        preparation: 'À la poêle.',
      },
    }), ctx)
    expect(plan).toMatchObject({
      repas: { base: 'din-saumon', items: [{ food: 'saumon', g: 150 }], steps: 'À la poêle.' },
    })
  })

  /**
   * NON-RÉGRESSION : le dépôt sans composition, celui qui existe depuis toujours,
   * doit continuer à passer exactement comme avant — y compris le retrait par
   * « vers: null », qui rend le créneau au plat prévu.
   */
  it('laisse intact le dépôt de macros brutes', () => {
    expect(planFor(brut({
      date: '2026-08-17', slot: 'lunch',
      vers: { label: 'Kebab galette', kcal: 1050, p: 45, g: 95, l: 50 },
    }), ctx)).toEqual({
      kind: 'repas-libre', date: '2026-08-17', slot: 'lunch',
      repas: { label: 'Kebab galette', kcal: 1050, p: 45, g: 95, l: 50, from: 'claude' },
    })
  })

  it('laisse intact le retrait par « vers: null »', () => {
    expect(planFor(brut({ date: '2026-08-17', slot: 'lunch', vers: null }), ctx))
      .toEqual({ kind: 'repas-libre', date: '2026-08-17', slot: 'lunch', repas: null })
  })
})
