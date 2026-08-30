import { describe, expect, it } from 'vitest'
import { PROGRAM } from '../../data/sportProgram'
import { CYCLE_LENGTH } from '../../data/nutritionProgram'
import { mergeProgram, retiredExercises } from '../../lib/program'
import {
  BUILTIN, builtinWeeks, buildDay, dairySwapCost, mergeFoods, mergeRecipes,
} from '../../lib/nutritionStats'

// ─────────────────────────────────────────────────────────────────────────────
// Une installation neuve, c'est-à-dire une application SANS AUCUNE DONNÉE.
// ─────────────────────────────────────────────────────────────────────────────
//
// C'est désormais le cas le plus courant — celui de tous ceux qui installent
// l'application — et c'était jusqu'ici le seul cas que personne n'exécutait jamais.
// Tout le reste de la suite tourne sur le pack d'exemple (voir test/exemple.ts) ;
// ce fichier est le seul à voir `data/` tel qu'il est livré, donc vide.
//
// Ce qu'on cherche n'est pas « ça rend quelque chose de joli ». C'est qu'aucun
// chemin ne produise `NaN`, `undefined` ou une exception là où l'écran attend un
// nombre. Un cycle vide, en particulier, se propage vicieusement : `index % 0` vaut
// `NaN`, `CYCLE[NaN]` vaut `undefined`, et la panne n'apparaît que trois appels plus
// loin, sous la forme d'une cible calorique à « NaN kcal ».

describe('une installation neuve', () => {
  it('n’a ni séance, ni exercice retiré', () => {
    expect(mergeProgram(PROGRAM, {})).toEqual([])
    expect(retiredExercises(PROGRAM, {})).toEqual({})
  })

  it('n’a ni aliment ni recette', () => {
    expect(BUILTIN.foods).toEqual({})
    expect(BUILTIN.recipes).toEqual({})
    expect(mergeFoods()).toEqual({})
    expect(mergeRecipes()).toEqual({})
  })

  it('ne propose aucune semaine livrée, plutôt que deux semaines vides', () => {
    // Deux entrées choisissables qui ne changent rien à l'écran, c'est le genre de
    // bouton qui fait croire à une panne.
    expect(CYCLE_LENGTH).toBe(0)
    expect(builtinWeeks()).toEqual([])
  })

  it('construit une journée sans NaN, même sans cycle', () => {
    // `index % 0` vaut NaN. Le jour rendu doit rester une journée valide : des
    // créneaux, des totaux à zéro, et surtout aucun nombre indéfini.
    for (const index of [0, 3, -1, 13]) {
      const jour = buildDay(index, true, BUILTIN)
      expect(Array.isArray(jour.meals)).toBe(true)
      for (const v of Object.values(jour.total)) expect(Number.isFinite(v)).toBe(true)
      expect(jour.total.kcal).toBe(0)
    }
  })

  it('chiffre à zéro le coût du taux de matière grasse, et pas à NaN', () => {
    // La moyenne se fait sur la longueur du cycle : sans cycle, c'est une division
    // par zéro, et la carte afficherait « NaN kcal » sans que rien n'ait planté.
    const cout = dairySwapCost(BUILTIN, () => true)
    for (const v of Object.values(cout)) expect(Number.isFinite(v)).toBe(true)
    expect(cout.kcal).toBe(0)
  })
})
