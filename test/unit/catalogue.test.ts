import { describe, expect, it, vi } from 'vitest'
import { CAT_LABELS, CAT_ORDER, FOODS, MICRO_REFS } from '../../data/nutritionProgram'
import { foodFor } from '../../lib/proposals'

// Ces tests tournent sur le PACK D'EXEMPLE : l'application ne livre plus de données.
// Voir test/exemple.ts pour le pourquoi.
vi.mock('../../data/nutritionProgram', () => (import('../exemple')).then(m => m.catalogueExemple()))

// Le catalogue est une TABLE ÉCRITE À LA MAIN, et elle vient de tripler de taille.
// Rien dans le typage n'empêche d'inverser protéines et glucides, d'écrire 1 000
// kcal pour un légume, ou d'inventer une catégorie. Une erreur ici ne plante pas :
// elle se mange, un repas à la fois, et se retrouve six mois plus tard dans une
// courbe de poids qu'on n'explique pas.
//
// D'où ces tests, qui ne testent aucun code : ils tiennent la DONNÉE.
//
// Le contrôle central passe par `foodFor` — le validateur que l'application oppose à
// tout aliment proposé de l'extérieur. Un catalogue livré qui ne passerait pas son
// propre contrôle d'entrée serait une contradiction, et c'était le cas de quatre
// épices avant cette révision.

const ids = FOODS.map(f => f.id)

describe('le catalogue d’aliments', () => {
  it('n’a aucun identifiant en double', () => {
    expect(ids.length).toBe(new Set(ids).size)
  })

  it('n’emploie que des identifiants de la forme attendue', () => {
    const mauvais = ids.filter(id => !/^[a-z0-9][a-z0-9-]{0,39}$/.test(id))
    expect(mauvais).toEqual([])
  })

  it('range chaque aliment dans une catégorie qui existe ET qui s’affiche', () => {
    for (const f of FOODS) {
      expect(CAT_LABELS[f.cat], f.id).toBeTruthy()
      // Une catégorie absente de CAT_ORDER ne sort jamais dans la liste de courses :
      // l'aliment serait acheté par personne.
      expect(CAT_ORDER, f.id).toContain(f.cat)
    }
  })

  /**
   * Le seul contrôle qui attrape une inversion de colonnes. Des protéines écrites à
   * la place des glucides passent tous les autres tests — mêmes bornes, même type —
   * et ne se voient que dans le total du jour.
   */
  it('passe le validateur que l’app oppose aux aliments proposés', () => {
    const refuses = FOODS.filter(f => !foodFor({
      id: '', at: '', action: 'aliment', summary: 'contrôle', status: 'pending',
      patch: { nom: f.name, cat: f.cat, kcal: f.kcal, p: f.p, g: f.g, l: f.l },
    }, {})).map(f => f.id)
    expect(refuses).toEqual([])
  })

  it('ne déclare que des micronutriments connus, et jamais négatifs', () => {
    for (const f of FOODS) {
      for (const [k, v] of Object.entries(f.micro ?? {})) {
        expect(MICRO_REFS[k as keyof typeof MICRO_REFS], `${f.id} · ${k}`).toBeTruthy()
        expect(v, `${f.id} · ${k}`).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('garde des durées de conservation plausibles', () => {
    for (const f of FOODS) {
      if (f.keeps === undefined) continue
      expect(f.keeps, f.id).toBeGreaterThanOrEqual(1)
      expect(f.keeps, f.id).toBeLessThanOrEqual(365)
    }
  })

  /**
   * Ce qui a motivé l'élargissement : composer un repas depuis une conversation
   * demande d'avoir le choix. Un catalogue de cinquante entrées dont dix-neuf épices
   * force à inventer des identifiants — et un identifiant inventé est refusé au
   * dépôt, donc la composition tombe à l'eau.
   */
  it('offre de quoi composer : assez de protéines maigres et de légumes', () => {
    const maigres = FOODS.filter(f => (f.cat === 'viandes' || f.cat === 'oeufs') && f.p >= 15 && f.l <= 10)
    expect(maigres.length).toBeGreaterThanOrEqual(12)
    expect(FOODS.filter(f => f.cat === 'legumes').length).toBeGreaterThanOrEqual(20)
    expect(FOODS.filter(f => f.cat === 'feculents').length).toBeGreaterThanOrEqual(18)
    expect(FOODS.filter(f => f.cat === 'fruits').length).toBeGreaterThanOrEqual(12)
  })

  it('donne un repère d’achat ou de pesée à tout ce qui n’est pas une épice', () => {
    // Sans repère, « 150 g d'avocat » ne dit pas s'il s'agit d'un avocat ou de trois.
    const muets = FOODS.filter(f => f.cat !== 'aromates' && !f.buy && !f.cook).map(f => f.id)
    expect(muets.length, `sans repère : ${muets.join(', ')}`).toBeLessThanOrEqual(12)
  })
})
