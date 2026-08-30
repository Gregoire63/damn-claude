import { vi } from 'vitest'
import type * as Nutrition from '../data/nutritionProgram'
import type * as Sport from '../data/sportProgram'

// ─────────────────────────────────────────────────────────────────────────────
// Le jeu de données des tests : l'exemple, explicitement.
// ─────────────────────────────────────────────────────────────────────────────
//
// L'application ne livre plus AUCUNE donnée — ni programme, ni aliments, ni
// recettes, ni cycle de menus. C'était le programme et les courses d'une personne,
// servis à qui installait l'application ; c'est devenu un pack d'exemple qu'on
// importe si on le veut (`data/exemple/`, `public/exemple.json`).
//
// La plupart des tests ont pourtant besoin d'un catalogue réel : vérifier que la
// modulation des féculents ne touche pas aux protéines demande des aliments avec de
// vraies macros, pas trois objets fabriqués pour l'occasion. Deux cents tests
// écrits sur des fixtures inventées ne diraient plus rien du plan réel.
//
// Ils déclarent donc EXPLICITEMENT qu'ils tournent sur l'exemple :
//
//   vi.mock('../../data/nutritionProgram', () => catalogueExemple())
//
// Deux choses en découlent, et c'est tout l'intérêt de le rendre visible :
//  · un test qui n'a pas cette ligne tourne sur le livré, donc sur du vide — c'est
//    exactement ce qu'il faut pour vérifier qu'une installation neuve tient debout
//    (voir test/unit/livreVide.test.ts) ;
//  · on ne peut plus vider `data/` sans s'en apercevoir dans les tests, ni
//    prétendre que l'application « marche avec les données » alors qu'elle n'en a
//    plus.
//
// `vi.importActual` court-circuite le mock : sans lui, le module se remplacerait
// lui-même à l'infini.

/** Le module `data/nutritionProgram`, mais avec le catalogue d'exemple en place. */
export async function catalogueExemple(): Promise<typeof Nutrition> {
  const reel = await vi.importActual<typeof Nutrition>('../data/nutritionProgram')
  const ex = await vi.importActual<typeof import('../data/exemple/nutrition')>('../data/exemple/nutrition')
  return {
    ...reel,
    FOODS: ex.FOODS_EXEMPLE,
    FOOD_BY_ID: Object.fromEntries(ex.FOODS_EXEMPLE.map(f => [f.id, f])),
    RECIPES: ex.RECIPES_EXEMPLE,
    RECIPE_BY_ID: Object.fromEntries(ex.RECIPES_EXEMPLE.map(r => [r.id, r])),
    CYCLE: ex.CYCLE_EXEMPLE,
    CYCLE_LENGTH: ex.CYCLE_EXEMPLE.length,
  }
}

/** Le module `data/sportProgram`, mais avec les quatre séances d'exemple en place. */
export async function programmeExemple(): Promise<typeof Sport> {
  const reel = await vi.importActual<typeof Sport>('../data/sportProgram')
  const ex = await vi.importActual<typeof import('../data/exemple/programme')>('../data/exemple/programme')
  return {
    ...reel,
    PROGRAM: ex.PROGRAM_EXEMPLE,
    ALL_EXERCISES: ex.PROGRAM_EXEMPLE.flatMap(s => s.exercises),
  }
}

/**
 * La semaine type qui allait avec le programme d'exemple : lundi s1, mardi s2, jeudi
 * s3, vendredi s4.
 *
 * Elle était le défaut de `useProfile` — donc le rythme d'une personne imposé à qui
 * installait l'application, sur des identifiants de séances qui n'existent plus au
 * démarrage. Les tests de planning en ont besoin : déplacer une séance suppose
 * qu'il y en ait une à déplacer.
 */
export const PLAN_EXEMPLE = ['s1', 's2', null, 's3', 's4', null, null]

/**
 * La semaine type côté nutrition : les mêmes jours de salle, plus le télétravail.
 *
 * Elle était le défaut de `useNutrition`. Elle ne l'est plus : une installation
 * neuve créditait quatre forfaits de séance par semaine — environ 440 kcal, quatre
 * jours sur sept — à quelqu'un qui n'avait rien planifié. Une cible trop haute ne se
 * voit pas, elle se mange.
 */
export const SEMAINE_EXEMPLE = {
  gym: [true, true, false, true, true, false, false],
  tt: [false, true, false, false, true, false, false],
}

/**
 * Pose le rythme d'exemple dans le stockage, avant d'hydrater les composables.
 *
 * Les deux axes vont ENSEMBLE : le planning dit quelle séance tombe quel jour, la
 * semaine nutrition dit ce que ce jour coûte et à quelle heure on mange. Poser l'un
 * sans l'autre donne un vendredi qui ouvre une séance et une journée alimentaire de
 * repos — la divergence exacte que `useTraining` existe pour empêcher.
 */
export function poserSemaineExemple(): void {
  localStorage.setItem('gr-weekplan-v1', JSON.stringify(PLAN_EXEMPLE))
  localStorage.setItem('gr-nutri-week-v1', JSON.stringify(SEMAINE_EXEMPLE))
}
