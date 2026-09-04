import { describe, expect, it } from 'vitest'
import { freeMealFrom, withFreeMeals } from '../../lib/freeMeal'
import type { DayPlan } from '../../lib/nutritionStats'

// ─────────────────────────────────────────────────────────────────────────────
// Le repas du dehors
//
// Deux choses peuvent mal tourner ici, et aucune ne se voit à l'œil nu : une saisie
// vide qui occupe le créneau sans rien y compter — l'écran annonce « kebab », le
// compteur ne bouge pas — et un total de journée qui ne correspond plus à la somme
// de ses repas.

const m = (label: string, kcal: number, p = 0, g = 0, l = 0) => ({ label, kcal, p, g, l })

describe('freeMealFrom', () => {
  it('accepte une saisie complète et arrondit les calories', () => {
    expect(freeMealFrom(m('Kebab', 1049.6, 45, 95, 50)))
      .toEqual({ label: 'Kebab', kcal: 1050, p: 45, g: 95, l: 50, from: 'saisie' })
  })

  it('accepte la virgule décimale, comme un clavier français la produit', () => {
    expect(freeMealFrom({ label: 'Salade', kcal: '420', p: '28,5', g: '25', l: '20' }))
      .toMatchObject({ kcal: 420, p: 28.5 })
  })

  it('complète les macros absentes à zéro plutôt que de refuser', () => {
    // Mieux vaut un repas compté en calories seules qu'un repas non enregistré.
    expect(freeMealFrom({ label: 'Restaurant', kcal: 800 }))
      .toEqual({ label: 'Restaurant', kcal: 800, p: 0, g: 0, l: 0, from: 'saisie' })
  })

  it('refuse ce qui occuperait un créneau sans rien y mettre', () => {
    expect(freeMealFrom(m('', 800))).toBeNull() // sans nom
    expect(freeMealFrom(m('   ', 800))).toBeNull()
    expect(freeMealFrom(m('Kebab', 0))).toBeNull() // sans calories
    expect(freeMealFrom({ label: 'Kebab' })).toBeNull()
    expect(freeMealFrom({ label: 'Kebab', kcal: 'beaucoup' })).toBeNull()
  })

  it('refuse les valeurs qui ne peuvent venir que d\'une faute de frappe', () => {
    expect(freeMealFrom(m('Kebab', 90000))).toBeNull()
    expect(freeMealFrom(m('Kebab', -200))).toBeNull()
    expect(freeMealFrom(m('Kebab', 800, 9999))).toMatchObject({ p: 0 }) // macro aberrante → 0
  })

  it('garde la provenance quand elle est connue, et la borne sinon', () => {
    expect(freeMealFrom({ ...m('Pizza', 800), from: 'claude' })).toMatchObject({ from: 'claude' })
    expect(freeMealFrom({ ...m('Pizza', 800), from: 'catalogue' })).toMatchObject({ from: 'catalogue' })
    expect(freeMealFrom({ ...m('Pizza', 800), from: 'n’importe quoi' })).toMatchObject({ from: 'saisie' })
  })

  it('borne un nom à rallonge sans perdre la saisie', () => {
    const long = freeMealFrom(m('x'.repeat(200), 500))
    expect(long?.label.length).toBe(60)
  })
})

const repas = (slot: string, time: string, kcal: number) => ({
  slot, time, label: slot, recipeId: `r-${slot}`, name: `Plat ${slot}`, steps: '',
  items: [], macros: { kcal, p: 10, g: 10, l: 10 },
})
const jour = (): DayPlan => ({
  index: 4,
  trained: true,
  meals: [repas('pdj', '9 h', 400), repas('lunch', '13 h 45', 700), repas('dinner', '20 h 30', 600)],
  total: { kcal: 1700, p: 30, g: 30, l: 30 },
})
const infos = (slot: string) => ({ pdj: { time: '9 h', label: 'Petit-déjeuner' }, snack: { time: '17 h', label: 'Collation' } }[slot] ?? null)

describe('withFreeMeals', () => {
  it('ne touche à rien quand il n\'y a aucun repas du dehors', () => {
    const d = jour()
    expect(withFreeMeals(d, {}, infos)).toBe(d)
  })

  it('remplace le plat du créneau et recalcule le total', () => {
    const out = withFreeMeals(jour(), { lunch: freeMealFrom(m('Kebab', 1050, 45, 95, 50))! }, infos)
    const midi = out.meals.find(x => x.slot === 'lunch')!
    expect(midi.name).toBe('Kebab')
    expect(midi.macros).toEqual({ kcal: 1050, p: 45, g: 95, l: 50 })
    expect(midi.free).toBe(true)
    // Plus d'identifiant ni d'ingrédients : il n'y a pas de recette derrière.
    expect(midi.recipeId).toBe('')
    expect(midi.items).toEqual([])
    // 400 + 1050 + 600, recalculé et non rapiécé.
    expect(out.total.kcal).toBe(2050)
    expect(out.total.p).toBe(65) // 10 + 45 + 10
  })

  it('garde l\'heure et le libellé du créneau : c\'est bien à midi qu\'on a mangé', () => {
    const out = withFreeMeals(jour(), { lunch: freeMealFrom(m('Kebab', 1050))! }, infos)
    const midi = out.meals.find(x => x.slot === 'lunch')!
    expect(midi.time).toBe('13 h 45')
    expect(midi.label).toBe('lunch')
  })

  it('ajoute un créneau absent du plan, et le range à son heure', () => {
    // Le samedi au restaurant : la journée n'a rien de prévu, et c'est justement
    // celle qu'on veut compter.
    const vide: DayPlan = { index: 5, trained: false, meals: [], total: { kcal: 0, p: 0, g: 0, l: 0 }, off: true }
    const out = withFreeMeals(vide, { snack: freeMealFrom(m('Gâteau', 400))! }, infos)
    expect(out.meals).toHaveLength(1)
    expect(out.meals[0]).toMatchObject({ slot: 'snack', time: '17 h', label: 'Collation', name: 'Gâteau', free: true })
    expect(out.total.kcal).toBe(400)
    expect(out.off).toBe(false) // on a mangé : la journée n'est plus une absence
  })

  it('ignore un créneau qu\'on ne sait pas situer, au lieu de l\'inventer', () => {
    const out = withFreeMeals(jour(), { nawak: freeMealFrom(m('X', 100))! }, infos)
    expect(out.meals).toHaveLength(3)
    expect(out.total.kcal).toBe(1700)
  })

  it('trie les repas par heure après un ajout', () => {
    const out = withFreeMeals(jour(), { snack: freeMealFrom(m('Gâteau', 400))! }, infos)
    expect(out.meals.map(x => x.slot)).toEqual(['pdj', 'lunch', 'snack', 'dinner'])
  })

  it('remplace plusieurs créneaux d\'un coup', () => {
    const out = withFreeMeals(jour(), {
      lunch: freeMealFrom(m('Kebab', 1050))!,
      dinner: freeMealFrom(m('Pizza', 800))!,
    }, infos)
    expect(out.total.kcal).toBe(400 + 1050 + 800)
    expect(out.meals.filter(x => x.free)).toHaveLength(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// « du dehors » ne veut pas dire « pas dans le catalogue ».
// ─────────────────────────────────────────────────────────────────────────────
//
// Trois situations très différentes portaient la même étiquette, et elle n'était
// juste que pour une seule. Un plat adapté — 211 g de saumon au lieu de 150 — se
// lisait comme un repas de restaurant estimé de mémoire : ça abîme la confiance
// qu'on accorde au total du jour, et ça décourage d'ouvrir une fiche qu'on croit
// vide.
describe('la nature d\'un repas hors catalogue', () => {
  it('« du dehors » quand on ne sait pas ce qu\'il y avait dedans', async () => {
    const { natureRepas } = await import('../../lib/freeMeal')
    expect(natureRepas({ label: 'Resto' } as never)).toBe('dehors')
    expect(natureRepas({ items: [] } as never)).toBe('dehors')
    expect(natureRepas(null)).toBe('dehors')
  })

  it('« modifié » quand c\'est la variante d\'un plat connu', async () => {
    const { natureRepas } = await import('../../lib/freeMeal')
    expect(natureRepas({ base: 'din-saumon', items: [{ food: 'saumon', g: 211 }] } as never)).toBe('modifie')
  })

  it('« composé » quand on connaît le contenu sans plat d\'origine', async () => {
    const { natureRepas } = await import('../../lib/freeMeal')
    expect(natureRepas({ items: [{ food: 'oeuf', g: 120 }] } as never)).toBe('compose')
  })
})
