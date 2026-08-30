// ─────────────────────────────────────────────────────────────────────────────
// Le pack d'exemple, transformé en sauvegarde importable.
// ─────────────────────────────────────────────────────────────────────────────
//
// L'application ne livre plus rien : `PROGRAM`, `FOODS`, `RECIPES` et `CYCLE` sont
// vides. Le contenu qui s'y trouvait — quatre séances, cent cinquante-deux aliments,
// trente-quatre recettes, un cycle de quatorze jours — a été déplacé dans
// `data/exemple/`, d'où ce script le convertit en sauvegarde.
//
// Ce n'est pas un détail de rangement, c'est ce qui rend le vidage RÉVERSIBLE. Les
// trois couches de l'application partent du livré : `mergeProgram` itère dessus,
// `mergeFoods` et `mergeRecipes` en font leur base. Le `localStorage`, lui, ne
// contient que les ÉCARTS — patches, ajouts, retraits, ordre. Vider `data/` sans
// filet n'aurait donc pas seulement retiré du contenu : les journaux, indexés par
// identifiant d'exercice, d'aliment et de recette, seraient devenus illisibles.
//
// Le fichier produit arrive dans `restore()` comme n'importe quelle sauvegarde :
// tout devient du contenu PERSONNEL, donc modifiable et supprimable. C'est la
// différence qui compte — un exemple qu'on ne peut pas retirer n'est pas un exemple,
// c'est le programme de quelqu'un d'autre.
//
// Trois détails décident du succès :
//
//  · Les séances passent dans `programme.sessions`, le champ ajouté pour ça. Sans
//    lui, il n'existait aucune place pour une séance complète.
//  · Les deux semaines de menus sont découpées ICI dans le cycle d'exemple, et pas
//    lues depuis `builtinWeeks()` : cette fonction part du `CYCLE` livré, désormais
//    vide, et rendrait donc zéro semaine.
//  · Elles ne portent PAS le drapeau `builtin`. `restore()` filtre `!w.builtin` —
//    le laisser les ferait silencieusement jeter à l'import, et on ne s'en
//    apercevrait qu'en cherchant ses menus.
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const { PROGRAM_EXEMPLE } = await import('../data/exemple/programme.ts')
const { FOODS_EXEMPLE, RECIPES_EXEMPLE, CYCLE_EXEMPLE } = await import('../data/exemple/nutrition.ts')

/** Les deux semaines du cycle d'exemple, au format d'une semaine de menus perso. */
const semaines = ['Semaine A', 'Semaine B'].map((name, w) => ({
  id: `exemple-built-${w + 1}`,
  name,
  days: Array.from({ length: 7 }, (_, d) => {
    const tpl = CYCLE_EXEMPLE[(w * 7 + d) % CYCLE_EXEMPLE.length]
    return { off: false, slots: { lunch: tpl.lunch, dinner: tpl.dinner } }
  }),
}))

/**
 * Le pack emporte aussi le RYTHME, pas seulement le contenu.
 *
 * Sans lui, on chargeait l'exemple et l'application restait muette : quatre séances
 * dans une semaine où aucun jour n'en portait, deux semaines de menus dont aucune
 * n'était active. On voyait un catalogue, pas une application qui marche — ce qui
 * est exactement l'inverse de ce qu'un exemple doit montrer.
 *
 * Le profil (taille, année de naissance, sexe) n'y est PAS, et c'est délibéré : ce
 * sont les seules données du pack qui seraient fausses pour tout le monde sauf une
 * personne, et elles décident du métabolisme de base, donc de toute la cible.
 */
const sauvegarde = {
  _apropos: 'Contenu d’exemple — programme, semaine type, aliments, recettes et menus. '
    + 'Import depuis Profil → Données. Rien n’est écrasé : tout arrive comme du contenu personnel, modifiable.',
  programme: { sessions: PROGRAM_EXEMPLE },
  // Lundi, mardi, jeudi, vendredi ; mercredi, samedi et dimanche au repos.
  weekPlan: ['s1', 's2', null, 's3', 's4', null, null],
  nutrition: {
    userFoods: FOODS_EXEMPLE,
    userRecipes: RECIPES_EXEMPLE,
    menus: semaines,
    // Une semaine ACTIVE, sinon les créneaux « déjeuner » et « dîner » restent vides.
    activeMenu: semaines[0].id,
    // Les mêmes jours que `weekPlan`, plus le télétravail : c'est ce couple qui donne
    // la dépense de la journée et l'heure des repas.
    week: {
      gym: [true, true, false, true, true, false, false],
      tt: [false, true, false, false, true, false, false],
    },
  },
}

const sortie = process.argv[2] ?? 'public/exemple.json'
mkdirSync(dirname(sortie), { recursive: true })
writeFileSync(sortie, JSON.stringify(sauvegarde, null, 2), 'utf8')

console.log(`${sortie} — ${PROGRAM_EXEMPLE.length} séances, ${FOODS_EXEMPLE.length} aliments, `
  + `${RECIPES_EXEMPLE.length} recettes, ${semaines.length} semaines`)
