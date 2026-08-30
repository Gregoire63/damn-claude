import { describe, expect, it } from 'vitest'
import { planFor } from '../../lib/proposals'
import { createAt, getAt, pushAt, removeAt, setAt } from '../../lib/pointer'

// ─────────────────────────────────────────────────────────────────────────────
// Plus rien ne doit renvoyer « fais-le à la main ».
// ─────────────────────────────────────────────────────────────────────────────
//
// L'application savait faire une cinquantaine de choses qu'aucune conversation ne
// pouvait déclencher. Chacune s'affichait dans la boîte de réception avec « ✋ l'app
// ne sait pas appliquer ça toute seule » — c'est-à-dire qu'elle rendait le travail à
// quelqu'un pendant qu'une machine regardait.
//
// Ce test prend les gestes RÉELS qui manquaient, un par un, et vérifie deux choses :
// qu'une proposition existe pour chacun, et qu'appliquée elle produit bien l'effet
// annoncé sur l'instantané. Le deuxième point est le seul qui compte vraiment — un
// plan qui se valide sans rien changer est pire qu'un refus, parce qu'il s'archive
// en « appliquée ».

/** Un instantané réaliste, avec les sections qui posaient problème. */
const sauvegarde = () => ({
  logs: { squat: [{ date: '2026-08-13', sets: [{ w: 80, r: 8 }] }] },
  bodyWeight: [{ date: '2026-08-17', kg: 91.9 }, { date: '2026-08-18', kg: 91.5 }],
  sessions: [{ at: '2026-08-13T18:30', sessionId: 's3', name: 'Jambes', durationMin: 55 }],
  profile: { heightCm: 179, sex: 'h', birthYear: 1997 },
  weekPlan: ['s1', null, 's2', null, 's3', null, null],
  planDays: { '2026-08-21': 's4' },
  nutrition: {
    extras: { '2026-08-19': [{ id: 'a', label: 'Compote', kcal: 90 }] },
    prices: { poulet: 9.9 },
    eaten: {},
    baskets: [{ at: '2026-08-10', total: 62, days: 7 }],
    disabledRecipes: [],
    freezer: false,
    cookedRatios: {},
  },
  restTimer: { enabled: true, volume: 0.5, type: 'bip', vibration: 'court', watch: false },
  programme: { patches: { squat: { sets: 5 } }, added: {}, disabled: [], order: {}, variants: {} },
})

let snap = sauvegarde()
const ctx = { snapshot: () => snap as unknown as Record<string, unknown> }
const champ = (patch: Record<string, unknown>) =>
  ({ id: '', at: '', action: 'correction', summary: '', patch: { quoi: 'champ', ...patch }, status: 'pending' as const })

/** Rejoue le plan sur l'instantané, exactement comme le fait le coffre. */
function appliquer(plan: { chemin: string, op: string, vers?: unknown }): boolean {
  if (plan.op === 'creer') return createAt(snap, plan.chemin, plan.vers)
  if (plan.op === 'ajouter') return pushAt(snap, plan.chemin, plan.vers)
  if (plan.op === 'supprimer') return removeAt(snap, plan.chemin)
  return setAt(snap, plan.chemin, plan.vers as never)
}

/** Le geste passe-t-il de bout en bout, et change-t-il vraiment quelque chose ? */
function bout(patch: Record<string, unknown>): unknown {
  snap = sauvegarde()
  const plan = planFor(champ(patch), ctx)
  expect(plan, `aucun plan pour ${JSON.stringify(patch)}`).not.toBeNull()
  const p = plan as { kind: string, chemin: string, op: string, vers?: unknown }
  expect(p.kind).toBe('correction-champ')
  expect(appliquer(p), `plan valide mais sans effet : ${p.chemin}`).toBe(true)
  return getAt(snap, p.chemin)
}

describe('les gestes qui renvoyaient « à faire à la main »', () => {
  it('ajouter une pesée oubliée', () => {
    // Impossible avant : le pointeur ne rallongeait pas un tableau, et
    // « correction/pesee » exigeait que la date existe déjà.
    bout({ op: 'ajouter', chemin: '/bodyWeight', vers: { date: '2026-08-19', kg: 91.2 } })
    expect(snap.bodyWeight).toHaveLength(3)
    expect(snap.bodyWeight[2]).toEqual({ date: '2026-08-19', kg: 91.2 })
  })

  it('supprimer une pesée en double', () => {
    bout({ op: 'supprimer', chemin: '/bodyWeight/0', de: { date: '2026-08-17', kg: 91.9 } })
    expect(snap.bodyWeight).toHaveLength(1)
    expect(snap.bodyWeight[0].date).toBe('2026-08-18')
  })

  it('effacer une exception de planning', () => {
    // Écrire `null` n'était PAS équivalent : ça veut dire « repos ce jour-là », pas
    // « pas d'exception ». Les deux états sont distincts dans useProfile.
    bout({ op: 'supprimer', chemin: '/planDays/2026-08-21', de: 's4' })
    expect(Object.hasOwn(snap.planDays, '2026-08-21')).toBe(false)
  })

  it('rendre sa fiche d’origine à un exercice', () => {
    bout({ op: 'supprimer', chemin: '/programme/patches/squat', de: { sets: 5 } })
    expect(Object.hasOwn(snap.programme.patches, 'squat')).toBe(false)
  })

  it('ajouter un extra à un jour qui en a déjà', () => {
    bout({ op: 'ajouter', chemin: '/nutrition/extras/2026-08-19', vers: { id: 'b', label: 'Carré de chocolat', kcal: 55 } })
    expect(snap.nutrition.extras['2026-08-19']).toHaveLength(2)
  })

  it('ajouter un extra à un jour qui n’en a aucun', () => {
    // Deux gestes distincts, et c'est le second qui manquait le plus : il fallait
    // créer la clé du jour avant de pouvoir y ajouter quoi que ce soit.
    bout({ op: 'creer', chemin: '/nutrition/extras/2026-08-20', vers: [{ id: 'c', label: 'Banane', kcal: 90 }] })
    expect(snap.nutrition.extras['2026-08-20']).toHaveLength(1)
  })

  it('supprimer un extra saisi deux fois', () => {
    bout({ op: 'supprimer', chemin: '/nutrition/extras/2026-08-19/0', de: { id: 'a', label: 'Compote', kcal: 90 } })
    expect(snap.nutrition.extras['2026-08-19']).toHaveLength(0)
  })

  it('donner un prix à un aliment qui n’en avait pas', () => {
    bout({ op: 'creer', chemin: '/nutrition/prices/avocat', vers: 4.5 })
    expect(snap.nutrition.prices.avocat).toBe(4.5)
  })

  it('désactiver une recette', () => {
    bout({ op: 'ajouter', chemin: '/nutrition/disabledRecipes', vers: 'din-saumon' })
    expect(snap.nutrition.disabledRecipes).toEqual(['din-saumon'])
  })

  it('retirer une session de courses', () => {
    bout({ op: 'supprimer', chemin: '/nutrition/baskets/0', de: { at: '2026-08-10', total: 62, days: 7 } })
    expect(snap.nutrition.baskets).toHaveLength(0)
  })

  it('changer un réglage du minuteur', () => {
    // Celui-ci PASSAIT déjà la validation, s'archivait « appliqué », et se perdait :
    // le coffre ne réinjectait jamais `useRestTimer`. Le geste est le même, c'est le
    // chemin du retour qui était troué.
    expect(bout({ op: 'remplacer', chemin: '/restTimer/volume', de: 0.5, vers: 0.8 })).toBe(0.8)
  })

  it('enregistrer une séance oubliée', () => {
    const seance = {
      at: '2026-08-19T12:40', sessionId: 's1', name: 'Pecs, Épaules & Triceps', durationMin: 48,
      entries: [{ exId: 'dc-barre', sets: [{ w: 62.5, r: 8 }, { w: 62.5, r: 7 }] }],
    }
    bout({ op: 'ajouter', chemin: '/sessions', vers: seance })
    expect(snap.sessions).toHaveLength(2)
  })

  it('marquer un repas comme mangé un jour vierge', () => {
    bout({ op: 'creer', chemin: '/nutrition/eaten/2026-08-19', vers: ['lunch'] })
    expect(snap.nutrition.eaten).toEqual({ '2026-08-19': ['lunch'] })
  })
})

describe('ce qui reste refusé, et doit le rester', () => {
  const refuse = (patch: Record<string, unknown>) => {
    snap = sauvegarde()
    expect(planFor(champ(patch), ctx), JSON.stringify(patch)).toBeNull()
  }

  it('remplacer un objet ou un tableau entier', () => {
    // La seule vraie ligne rouge : réécrire d'un coup une section dont on ne saurait
    // pas dire ce qu'elle contenait.
    refuse({ op: 'remplacer', chemin: '/profile', de: { heightCm: 179 }, vers: 'x' })
    refuse({ op: 'remplacer', chemin: '/bodyWeight', de: [], vers: 'x' })
  })

  it('créer une branche dont le parent n’existe pas', () => {
    refuse({ op: 'creer', chemin: '/nutriton/prices/avocat', vers: 4.5 })
  })

  it('créer par-dessus ce qui existe', () => {
    refuse({ op: 'creer', chemin: '/profile/heightCm', vers: 180 })
  })

  it('supprimer ou remplacer sans citer la valeur en place', () => {
    refuse({ op: 'supprimer', chemin: '/planDays/2026-08-21' })
    refuse({ op: 'remplacer', chemin: '/profile/heightCm', vers: 180 })
  })

  it('supprimer en se trompant de valeur', () => {
    // Sur un tableau surtout : effacer une entrée sur une description approximative
    // effacerait la voisine.
    refuse({ op: 'supprimer', chemin: '/bodyWeight/0', de: { date: '2026-08-18', kg: 91.5 } })
  })

  it('ajouter ailleurs que dans un tableau', () => {
    refuse({ op: 'ajouter', chemin: '/profile', vers: 1 })
    refuse({ op: 'ajouter', chemin: '/profile/heightCm', vers: 1 })
  })

  it('un geste inventé', () => {
    refuse({ op: 'fusionner', chemin: '/profile/heightCm', de: 179, vers: 180 })
  })
})
