import { describe, expect, it, vi } from 'vitest'
import { planFor } from '../../lib/proposals'
import { FOOD_BY_ID, RECIPE_BY_ID } from '../../data/nutritionProgram'
import { PROGRAM } from '../../data/sportProgram'
import { mergeProgram } from '../../lib/program'
import { restFor } from '../../lib/rest'

// Ces tests tournent sur le PACK D'EXEMPLE : l'application ne livre plus de données.
// Voir test/exemple.ts pour le pourquoi.
vi.mock('../../data/nutritionProgram', () => (import('../exemple')).then(m => m.catalogueExemple()))
vi.mock('../../data/sportProgram', () => (import('../exemple')).then(m => m.programmeExemple()))

// ─────────────────────────────────────────────────────────────────────────────
// Le chemin d'écriture du connecteur, de bout en bout.
// ─────────────────────────────────────────────────────────────────────────────
//
// Claude ne modifie rien : il DÉPOSE une proposition, que Grégoire valide dans
// l'application. `planFor` est le poste de contrôle, et il l'est DEUX FOIS — au
// dépôt côté serveur, pour refuser tout de suite ce qui ne s'appliquera jamais, et
// à la validation côté application, avant d'écrire quoi que ce soit.
//
// C'est donc la fonction qui décide si une conversation a un effet ou non. Une
// régression ici ne casse rien de visible : les propositions arrivent, elles
// s'affichent, et le bouton « Appliquer » ne fait simplement plus rien.
//
// Ces tests couvrent les dix formes, avec les identifiants RÉELS du catalogue —
// pas des doublures. Une forme qui cesserait d'être reconnue ressort en rouge.

/**
 * Le contexte que l'application fournit à `planFor`.
 *
 * `setAt`, `weightAt` et `snapshot` ne sont pas décoratifs : une CORRECTION doit
 * prouver qu'elle sait ce qu'elle remplace. On donne la valeur actuelle dans « de »,
 * et la proposition est refusée si elle ne correspond pas. C'est ce qui empêche une
 * conversation d'écraser une donnée modifiée entre-temps depuis le téléphone.
 */
const ctx = {
  foodKnown: (id: string) => !!FOOD_BY_ID[id],
  recipeKnown: (id: string) => !!RECIPE_BY_ID[id],
  setAt: (ex: string, date: string, i: number) =>
    (ex === 'dc-barre' && date === '2026-08-17' && i === 0 ? { w: 55, r: 10 } : null),
  weightAt: (date: string) => (date === '2026-08-17' ? 91.9 : null),
  snapshot: () => ({ profile: { heightCm: 179 } }) as Record<string, unknown>,
}
const brut = (action: string, patch: Record<string, unknown>) =>
  ({ id: '', at: '', action, summary: 'test', patch, status: 'pending' as const })

const UN_PLAT = Object.keys(RECIPE_BY_ID)[0]
const UN_ALIMENT = Object.keys(FOOD_BY_ID)[0]
const UNE_SEANCE = PROGRAM[0].id
const UN_EXERCICE = PROGRAM[0].exercises[0].id

/** Le contexte du PROGRAMME, tel que le construisent le coffre et le serveur : les
 *  actifs d'un côté, les retirés en plus dans `exerciseKnown`. */
const ctxProg = {
  ...ctx,
  sessionKnown: (id: string) => PROGRAM.some(s => s.id === id),
  exerciseKnown: (id: string) => PROGRAM.some(s => s.exercises.some(e => e.id === id)),
  exercisesOf: (sid: string) => PROGRAM.find(s => s.id === sid)?.exercises.map(e => e.id) ?? [],
  exerciseAt: (id: string) => {
    for (const s of PROGRAM) {
      const e = s.exercises.find(x => x.id === id)
      if (e) return { seance: s.id, seanceNom: s.name, actif: true, ex: e }
    }
    return null
  },
}
const REPOS_ACTUEL = restFor(PROGRAM[0].exercises[0])

describe('les dix formes de proposition', () => {
  it('plat : remplacer le plat d’un créneau', () => {
    expect(planFor(brut('plat', { date: '2026-08-19', slot: 'dinner', vers: UN_PLAT }), ctx))
      .toEqual({ kind: 'plat', date: '2026-08-19', slot: 'dinner', recipeId: UN_PLAT })
  })

  it('plat : « vers: null » rend le créneau au plan', () => {
    expect(planFor(brut('plat', { date: '2026-08-19', slot: 'dinner', vers: null }), ctx))
      .toMatchObject({ kind: 'plat', recipeId: null })
  })

  it('planning-seance : poser ou retirer une séance', () => {
    expect(planFor(brut('planning-seance', { date: '2026-08-19', vers: UNE_SEANCE }), ctx))
      .toEqual({ kind: 'seance', date: '2026-08-19', sessionId: UNE_SEANCE })
    expect(planFor(brut('planning-seance', { date: '2026-08-19', vers: 'repos' }), ctx))
      .toMatchObject({ kind: 'seance', sessionId: null })
  })

  it('repas-libre : macros brutes', () => {
    expect(planFor(brut('repas-libre', {
      date: '2026-08-19', slot: 'lunch',
      vers: { label: 'Kebab', kcal: 1050, p: 45, g: 95, l: 50 },
    }), ctx)).toMatchObject({ kind: 'repas-libre', repas: { label: 'Kebab', from: 'claude' } })
  })

  it('repas-libre : variante avec composition', () => {
    const plan = planFor(brut('repas-libre', {
      date: '2026-08-19', slot: 'dinner',
      vers: {
        label: 'Variante', kcal: 700, p: 50, g: 40, l: 30,
        base: UN_PLAT, items: [{ food: UN_ALIMENT, g: 150 }], steps: 'Sans sauce.',
      },
    }), ctx)
    expect(plan).toMatchObject({ kind: 'repas-libre', repas: { base: UN_PLAT, steps: 'Sans sauce.' } })
  })

  it('aliment : créer un aliment', () => {
    expect(planFor(brut('aliment', {
      nom: 'Tofu ferme', cat: 'complements', kcal: 145, p: 16, g: 3, l: 8,
    }), ctx)).toMatchObject({ kind: 'aliment', id: null, aliment: { name: 'Tofu ferme' } })
  })

  /**
   * `CATS` acceptait « poissons » et « boissons », deux catégories qui n'existent pas
   * dans le type. L'aliment était accepté, enregistré, puis absent de la liste de
   * courses — accepté et invisible.
   */
  it('aliment : refuse une catégorie qui n’existe pas', () => {
    for (const cat of ['poissons', 'boissons', 'inventée']) {
      expect(planFor(brut('aliment', { nom: 'X', cat, kcal: 100, p: 10, g: 10, l: 2 }), ctx), cat).toBeNull()
    }
  })

  it('recette : créer un plat avec des ingrédients du catalogue', () => {
    expect(planFor(brut('recette', {
      nom: 'Bol express', kind: 'diner',
      items: [{ food: UN_ALIMENT, g: 120 }],
    }), ctx)).toMatchObject({ kind: 'recette', id: null })
  })

  it('recette : refuse un ingrédient inventé', () => {
    expect(planFor(brut('recette', {
      nom: 'Bol', kind: 'diner', items: [{ food: 'aliment-fantome', g: 100 }],
    }), ctx)).toBeNull()
  })

  it('semaine-type : salle et télétravail', () => {
    expect(planFor(brut('semaine-type', {
      salle: [true, true, false, true, true, false, false],
    }), ctx)).toMatchObject({ kind: 'semaine-type' })
  })

  it('correction : une série, une pesée, un champ', () => {
    expect(planFor(brut('correction', {
      quoi: 'serie', exercice: 'dc-barre', date: '2026-08-17', index: 0,
      de: { w: 55, r: 10 }, vers: { w: 60, r: 8 },
    }), ctx)).toMatchObject({ kind: 'correction-serie', vers: { w: 60, r: 8 } })

    expect(planFor(brut('correction', { quoi: 'pesee', date: '2026-08-17', de: 91.9, vers: 91.5 }), ctx))
      .toMatchObject({ kind: 'correction-pesee', vers: 91.5 })

    expect(planFor(brut('correction', {
      quoi: 'champ', chemin: '/profile/heightCm', de: 179, vers: 180,
    }), ctx)).toMatchObject({ kind: 'correction-champ', chemin: '/profile/heightCm', vers: 180 })
  })

  /**
   * La garde qui rend les corrections sûres : sans elle, une conversation pourrait
   * écraser une valeur modifiée entre-temps depuis le téléphone, en croyant corriger
   * autre chose.
   */
  it('correction : refuse quand « de » ne correspond pas à la valeur en place', () => {
    expect(planFor(brut('correction', {
      quoi: 'serie', exercice: 'dc-barre', date: '2026-08-17', index: 0,
      de: { w: 50, r: 10 }, vers: { w: 60, r: 8 },
    }), ctx)).toBeNull()
    expect(planFor(brut('correction', { quoi: 'champ', chemin: '/profile/heightCm', de: 175, vers: 180 }), ctx)).toBeNull()
    // Et un chemin qui n'existe pas ne crée rien.
    expect(planFor(brut('correction', { quoi: 'champ', chemin: '/profile/inexistant', de: 1, vers: 2 }), ctx)).toBeNull()
  })

  it('refuse ce qu’elle ne sait pas appliquer, au lieu de l’interpréter', () => {
    expect(planFor(brut('autre', { nimporte: 'quoi' }), ctx)).toBeNull()
    expect(planFor(brut('plat', { date: 'pas-une-date', slot: 'dinner', vers: UN_PLAT }), ctx)).toBeNull()
    expect(planFor(brut('plat', { date: '2026-08-19', slot: 'brunch', vers: UN_PLAT }), ctx)).toBeNull()
  })
})

describe('les cibles annoncées au connecteur existent toutes', () => {
  /**
   * La description de l'outil énumère les cibles acceptables. Si l'une d'elles n'est
   * plus reconnue par `planFor`, Claude la proposera en toute confiance et le bouton
   * « Appliquer » restera muet.
   */
  it('chaque cible applicable produit bien un plan', () => {
    const cas: [string, Record<string, unknown>][] = [
      ['plat', { date: '2026-08-19', slot: 'dinner', vers: UN_PLAT }],
      ['planning-seance', { date: '2026-08-19', vers: UNE_SEANCE }],
      ['repas-libre', { date: '2026-08-19', slot: 'lunch', vers: { label: 'X', kcal: 500 } }],
      ['aliment', { nom: 'Y', cat: 'legumes', kcal: 30, p: 2, g: 4, l: 0.2 }],
      ['recette', { nom: 'Z', kind: 'diner', items: [{ food: UN_ALIMENT, g: 100 }] }],
      ['semaine-type', { salle: [true, false, false, false, false, false, false] }],
      ['correction', { quoi: 'pesee', date: '2026-08-17', de: 91.9, vers: 91.5 }],
      ['programme', { op: 'modifier', seance: UNE_SEANCE, exercice: UN_EXERCICE, de_repos_s: REPOS_ACTUEL, patch: { repos_s: 150 } }],
    ]
    const muettes = cas.filter(([action, patch]) => planFor(brut(action, patch), ctxProg) === null).map(c => c[0])
    expect(muettes, `cibles sans effet : ${muettes.join(', ')}`).toEqual([])
  })
})

describe('le programme, modifié depuis une conversation', () => {
  /**
   * Sur les VRAIES séances, parce que c'est là que ça compte : un identifiant
   * d'exercice mal orthographié dans une proposition ne casse rien de visible, il
   * produit une proposition qui ne s'applique pas et qu'on relit trois fois avant
   * de comprendre.
   */
  it('modifie séries, reps et repos d’un exercice réel', () => {
    const ex = PROGRAM[0].exercises[0]
    const plan = planFor(brut('programme', {
      op: 'modifier', seance: UNE_SEANCE, exercice: UN_EXERCICE,
      de_series: ex.sets, de_reps: ex.reps, de_repos_s: REPOS_ACTUEL,
      patch: { series: 5, reps: '5', repos_s: 180 },
    }), ctxProg)
    expect(plan).toMatchObject({ kind: 'programme', op: 'modifier', exercice: UN_EXERCICE, patch: { sets: 5, reps: '5', rest: 180 } })
  })

  it('refuse un exercice qui n’est pas au programme', () => {
    expect(planFor(brut('programme', { op: 'modifier', seance: UNE_SEANCE, exercice: 'squat-du-futur', patch: { nom: 'X' } }), ctxProg)).toBeNull()
  })

  it('retire un exercice sans toucher à l’historique', () => {
    const plan = planFor(brut('programme', { op: 'retirer', seance: UNE_SEANCE, exercice: UN_EXERCICE }), ctxProg)
    expect(plan).toEqual({ kind: 'programme', seance: UNE_SEANCE, op: 'retirer', exercice: UN_EXERCICE })
    // Le geste appliqué DÉSACTIVE : la fiche reste, donc les séances passées
    // continuent d'afficher un nom plutôt qu'un identifiant.
    const apres = mergeProgram(PROGRAM, { disabled: [UN_EXERCICE] })
    expect(apres[0].exercises.some(e => e.id === UN_EXERCICE)).toBe(false)
    expect(PROGRAM[0].exercises.some(e => e.id === UN_EXERCICE)).toBe(true)
  })
})
