import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mergeProgram } from '../../lib/program'
import { mergeFoods, mergeRecipes } from '../../lib/nutritionStats'
import { PROGRAM } from '../../data/sportProgram'
import { CYCLE, FOODS, RECIPES } from '../../data/nutritionProgram'
import { PROGRAM_EXEMPLE } from '../../data/exemple/programme'
import { CYCLE_EXEMPLE, FOODS_EXEMPLE, RECIPES_EXEMPLE } from '../../data/exemple/nutrition'

// ─────────────────────────────────────────────────────────────────────────────
// Le contenu retiré de l'application reste récupérable.
// ─────────────────────────────────────────────────────────────────────────────
//
// Ce fichier est le FILET du vidage de `data/`. Les trois couches de l'application
// partent du livré — `mergeProgram` itère dessus, `mergeFoods` et `mergeRecipes` en
// font leur base — et le `localStorage` ne garde que les ÉCARTS. Retirer le contenu
// sans avoir prouvé sa conversion, c'était rendre illisibles des journaux indexés
// par identifiant d'exercice, d'aliment et de recette.
//
// Ce n'est PAS un test qui vérifie qu'un script écrit un fichier. Il vérifie la
// seule propriété qui compte : le contenu converti, relu comme données PERSONNELLES
// sur une base vide, rend exactement ce que l'application affichait avant.
//
// Volontairement, ce fichier ne pose AUCUN mock de données : il est le seul à voir
// `data/` tel qu'il est réellement livré.

describe('l’application ne livre plus aucune donnée', () => {
  /**
   * L'invariant du projet, et il se vérifie ici parce qu'il se casse par accident.
   *
   * Remettre trois aliments « pour l'exemple » dans `data/nutritionProgram.ts` est le
   * geste le plus naturel du monde, et personne ne le verrait : l'application
   * marcherait, les tests passeraient, et chaque nouvelle installation hériterait à
   * nouveau du contenu de quelqu'un d'autre.
   */
  it('livre un programme, un catalogue et un cycle VIDES', () => {
    expect(PROGRAM).toEqual([])
    expect(FOODS).toEqual([])
    expect(RECIPES).toEqual([])
    expect(CYCLE).toEqual([])
  })

  it('garde le pack d’exemple entier, à côté', () => {
    expect(PROGRAM_EXEMPLE).toHaveLength(4)
    expect(FOODS_EXEMPLE.length).toBeGreaterThan(100)
    expect(RECIPES_EXEMPLE.length).toBeGreaterThan(30)
    expect(CYCLE_EXEMPLE).toHaveLength(14)
  })
})

describe('le pack d’exemple converti en sauvegarde', () => {
  it('rend un programme identique sur une base vide', () => {
    // Le cœur du filet. À gauche : rien dans `data/`, tout dans le perso. À droite :
    // ce que l'application affichait quand elle livrait ce programme.
    expect(mergeProgram([], { sessions: PROGRAM_EXEMPLE })).toEqual(mergeProgram(PROGRAM_EXEMPLE))
  })

  it('rend des aliments et des recettes identiques sur une base vide', () => {
    // `mergeFoods` part de `FOOD_BY_ID`, désormais vide : ne restent que les aliments
    // personnels. Chacun doit s'y retrouver à son identifiant — c'est lui qui relie
    // une recette à ses ingrédients et un jour de journal à ce qui a été mangé.
    expect(mergeFoods(FOODS_EXEMPLE)).toEqual(Object.fromEntries(FOODS_EXEMPLE.map(f => [f.id, f])))
    // Les recettes passent par la même porte, à une normalisation près : `mergeRecipes`
    // pose `disabled: false` sur chaque entrée. Comparer au tableau brut ferait échouer
    // un test qui n'a rien à reprocher au code — c'est ce qui s'est produit à la
    // première écriture de ce fichier.
    expect(mergeRecipes(RECIPES_EXEMPLE))
      .toEqual(Object.fromEntries(RECIPES_EXEMPLE.map(r => [r.id, { ...r, disabled: false }])))
  })

  it('produit un fichier que restore() ne jettera pas', () => {
    const chemin = '/tmp/exemple-test.json'
    execFileSync('npx', ['tsx', 'scripts/exporter-exemple.mjs', chemin], { stdio: 'pipe' })
    const j = JSON.parse(readFileSync(chemin, 'utf8'))
    rmSync(chemin, { force: true })

    expect(j.programme.sessions).toEqual(PROGRAM_EXEMPLE)
    expect(j.nutrition.userFoods).toEqual(FOODS_EXEMPLE)
    expect(j.nutrition.userRecipes).toEqual(RECIPES_EXEMPLE)

    // Le piège silencieux : `restore()` filtre `!w.builtin`. Une semaine qui garde
    // le drapeau est jetée à l'import sans un mot, et on ne s'en aperçoit qu'en
    // cherchant ses menus trois jours plus tard.
    expect(j.nutrition.menus).toHaveLength(2)
    for (const w of j.nutrition.menus) expect(w.builtin).toBeUndefined()
    // Et les menus disent bien le cycle : la semaine A commence au lundi 1 du cycle.
    expect(j.nutrition.menus[0].days[0].slots)
      .toEqual({ lunch: CYCLE_EXEMPLE[0].lunch, dinner: CYCLE_EXEMPLE[0].dinner })
    expect(j.nutrition.menus[1].days[6].slots)
      .toEqual({ lunch: CYCLE_EXEMPLE[13].lunch, dinner: CYCLE_EXEMPLE[13].dinner })
  })

  /**
   * Le fichier servi aux utilisateurs est celui du dépôt, pas celui qu'on vient de
   * générer. Modifier `data/exemple/` sans relancer le script laisserait un exemple
   * périmé en ligne — et il n'y a aucun moment où ça se voit.
   */
  it('est à jour dans public/, à l’octet près', () => {
    const chemin = '/tmp/exemple-frais.json'
    execFileSync('npx', ['tsx', 'scripts/exporter-exemple.mjs', chemin], { stdio: 'pipe' })
    const frais = readFileSync(chemin, 'utf8')
    rmSync(chemin, { force: true })
    expect(readFileSync('public/exemple.json', 'utf8')).toBe(frais)
  })
})
