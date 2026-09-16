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

// ─────────────────────────────────────────────────────────────────────────────
// Le sport hors séance, dicté plutôt que saisi.
// ─────────────────────────────────────────────────────────────────────────────
//
// « J'ai fait un foot d'une heure et demie hier soir. » Une phrase, et la dépense de
// la journée devrait suivre — sans qu'on ait à calculer une dépense de tête ni à
// ressortir son poids de ce jour-là.
//
// D'où l'asymétrie qui tient tout ce bloc : sur un AJOUT, l'absence de `kcal` veut
// dire « estime-le », parce que c'est ce qu'on veut en dictant. Sur une
// MODIFICATION, la même absence veut dire « n'y touche pas » — sinon corriger
// l'heure remettrait la dépense à l'estimation et effacerait le chiffre relevé à la
// montre. Un `null` explicite redemande l'estimation dans les deux cas.

describe('une activité hors séance', () => {
  const ctxAct = { ...ctx, activiteKnown: (id: string) => id === 'act-1' }

  it('s’ajoute avec une date et une durée', () => {
    const plan = planFor(brut('activite', { type: 'foot', date: '2026-09-12', heure: '18:30', minutes: 90 }), ctxAct)
    expect(plan).toEqual({
      kind: 'activite', op: 'ajouter', id: null,
      champs: { type: 'foot', nom: '', date: '2026-09-12', heure: '18:30', minutes: 90, kcal: null },
    })
  })

  /** `kcal: null` n'est pas « zéro calorie » : c'est « estime-le toi-même ». */
  it('laisse l’application chiffrer quand aucun nombre n’est donné', () => {
    const plan = planFor(brut('activite', { date: '2026-09-12', minutes: 60 }), ctxAct)
    expect(plan).toMatchObject({ champs: { kcal: null, type: 'autre', heure: '12:00' } })
  })

  it('accepte un chiffre quand on en sait plus', () => {
    const plan = planFor(brut('activite', { type: 'course', date: '2026-09-12', minutes: 45, kcal: 512 }), ctxAct)
    expect(plan).toMatchObject({ champs: { kcal: 512 } })
  })

  it('refuse un ajout sans date ou sans durée', () => {
    expect(planFor(brut('activite', { type: 'foot', minutes: 90 }), ctxAct)).toBeNull()
    expect(planFor(brut('activite', { type: 'foot', date: '2026-09-12' }), ctxAct)).toBeNull()
  })

  it('refuse un type inventé plutôt que de le ranger en silence', () => {
    // `normaliserActivite` sait retomber sur « autre » à la relecture d'un stockage ;
    // une PROPOSITION, elle, doit être refusée : accepter « parapente » en le
    // transformant en « autre » chiffrerait un vol à l'intensité d'un footing.
    expect(planFor(brut('activite', { type: 'parapente', date: '2026-09-12', minutes: 60 }), ctxAct)).toBeNull()
  })

  it('refuse une heure qui n’est pas une heure', () => {
    expect(planFor(brut('activite', { date: '2026-09-12', minutes: 60, heure: '18h30' }), ctxAct)).toBeNull()
  })

  it('modifie une activité qui existe, et seulement les champs envoyés', () => {
    const plan = planFor(brut('activite', { op: 'modifier', id: 'act-1', minutes: 120 }), ctxAct)
    expect(plan).toEqual({ kind: 'activite', op: 'modifier', id: 'act-1', champs: { minutes: 120 } })
  })

  it('redemande l’estimation avec un kcal explicitement nul', () => {
    const plan = planFor(brut('activite', { op: 'modifier', id: 'act-1', kcal: null }), ctxAct)
    expect(plan).toMatchObject({ champs: { kcal: null } })
  })

  /**
   * Une activité effacée depuis le téléphone : la proposition doit être REFUSÉE, pas
   * appliquée dans le vide. Un geste sans effet qui s'archive « appliqué » est le
   * pire des trois états — on croit la correction faite.
   */
  it('refuse de toucher à une activité qui n’existe plus', () => {
    expect(planFor(brut('activite', { op: 'modifier', id: 'act-9', minutes: 30 }), ctxAct)).toBeNull()
    expect(planFor(brut('activite', { op: 'supprimer', id: 'act-9' }), ctxAct)).toBeNull()
  })

  it('supprime une activité par son identifiant', () => {
    expect(planFor(brut('activite', { op: 'supprimer', id: 'act-1' }), ctxAct))
      .toEqual({ kind: 'activite', op: 'supprimer', id: 'act-1' })
  })

  it('refuse une modification qui ne modifie rien', () => {
    expect(planFor(brut('activite', { op: 'modifier', id: 'act-1' }), ctxAct)).toBeNull()
  })

  it('refuse un geste qui n’est pas l’un des trois', () => {
    expect(planFor(brut('activite', { op: 'doubler', id: 'act-1', minutes: 30 }), ctxAct)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Qui est à table, et combien de fois chacun mange ce plat.
// ─────────────────────────────────────────────────────────────────────────────
//
// Ça s'écrivait déjà par le passe-partout — `/repasConvives/<date>/<créneau>/repas/moi`
// — et ça ne se RELISAIT pas : la carte de validation affichait un chemin JSON et
// deux nombres. On valide ce qu'on comprend ; un chemin, on l'approuve sans le lire,
// ce qui est exactement ce que cette boîte sert à éviter.
//
// La forme typée est PARTIELLE par défaut, contrairement aux ingrédients d'une
// recette : « double la portion de demain midi » ne devrait pas obliger à
// ré-énumérer qui est à table, et une liste recopiée de mémoire à chaque fois finit
// toujours par perdre quelqu'un.

describe('les convives d’un repas', () => {
  const EN_PLACE = { membres: ['moi', 'camille'], invites: [] }
  const ctxConv = {
    ...ctx,
    membreKnown: (id: string) => ['moi', 'camille'].includes(id),
    convivesAt: () => EN_PLACE,
  }
  const conv = (patch: Record<string, unknown>) =>
    planFor(brut('convives', { date: '2026-09-17', creneau: 'dinner', ...patch }), ctxConv)

  /** LE cas de la demande, en une phrase et trois champs. */
  it('double la portion sans toucher à qui est à table', () => {
    expect(conv({ repas: 2 })).toEqual({
      kind: 'convives', date: '2026-09-17', creneau: 'dinner',
      convives: { membres: ['moi', 'camille'], invites: [], repas: { moi: 2, camille: 2 } },
    })
  })

  it('traite l’asymétrie, deux jours pour l’un et un seul pour l’autre', () => {
    expect(conv({ repas: { moi: 2 } })).toMatchObject({
      convives: { membres: ['moi', 'camille'], repas: { moi: 2 } },
    })
  })

  /** Revenir à un seul repas doit EFFACER les comptes, pas écrire des 1 partout. */
  it('revient à un seul repas pour tous', () => {
    const plan = conv({ repas: null })
    expect(plan!.convives!.repas).toBeUndefined()
  })

  it('change qui est à table sans toucher au nombre de repas', () => {
    const avec = { membres: ['moi', 'camille'], invites: [], repas: { moi: 2 } }
    const plan = planFor(brut('convives', { date: '2026-09-17', creneau: 'dinner', membres: ['moi'] }), {
      ...ctxConv, convivesAt: () => avec,
    })
    expect(plan).toMatchObject({ convives: { membres: ['moi'], repas: { moi: 2 } } })
  })

  /**
   * Un compte orphelin — Camille n'est plus à table — ferait réapparaître un ×2 le
   * jour où on la recoche. `normaliserRepas` le jette, et la proposition passe par
   * elle comme la saisie à la main : deux validateurs auraient divergé.
   */
  it('jette le compte de quelqu’un qu’on vient de retirer', () => {
    const avec = { membres: ['moi', 'camille'], invites: [], repas: { moi: 2, camille: 3 } }
    const plan = planFor(brut('convives', { date: '2026-09-17', creneau: 'dinner', membres: ['moi'] }), {
      ...ctxConv, convivesAt: () => avec,
    })
    expect(plan!.convives!.repas).toEqual({ moi: 2 })
  })

  it('accepte des invités avec leur appétit', () => {
    expect(conv({ invites: [{ nom: 'Léa', appetit: 0.8 }] })).toMatchObject({
      convives: { invites: [{ nom: 'Léa', appetit: 0.8 }] },
    })
    // Sans nom, « Invité » : un dîner à quatre ne doit pas buter sur un prénom.
    expect(conv({ invites: [{}] })).toMatchObject({ convives: { invites: [{ nom: 'Invité', appetit: 1 }] } })
  })

  /**
   * Un identifiant inventé mettrait à table quelqu'un dont personne ne connaît
   * l'appétit : le facteur de quantités serait faux, et rien ne le dirait.
   */
  it('refuse un membre qui n’est pas du foyer', () => {
    expect(conv({ membres: ['moi', 'belle-soeur'] })).toBeNull()
  })

  it('refuse un créneau et une date qui n’en sont pas', () => {
    expect(planFor(brut('convives', { date: '2026-09-17', creneau: 'gouter', repas: 2 }), ctxConv)).toBeNull()
    expect(planFor(brut('convives', { date: '17/09/2026', creneau: 'dinner', repas: 2 }), ctxConv)).toBeNull()
  })

  it('refuse un nombre de repas hors bornes', () => {
    expect(conv({ repas: 0 })).toBeNull()
    expect(conv({ repas: 99 })).toBeNull()
    expect(conv({ repas: { moi: 'deux' } })).toBeNull()
  })

  /** Une proposition qui ne propose rien s'archiverait « appliquée » sans que rien
   *  n'ait changé — on la croirait faite. */
  it('refuse une proposition qui ne change rien', () => {
    expect(conv({})).toBeNull()
  })

  it('efface l’exception et rend le repas au foyer courant', () => {
    expect(conv({ vers: null })).toEqual({ kind: 'convives', date: '2026-09-17', creneau: 'dinner', convives: null })
  })

  /** « Moi » est l'unité de compte : un repas dont il serait absent n'aurait ni
   *  cible, ni macros, ni sens. Il est réinjecté, pas refusé. */
  it('remet « Moi » à table quoi qu’il arrive', () => {
    expect(conv({ membres: ['camille'] })!.convives!.membres).toContain('moi')
  })
})
