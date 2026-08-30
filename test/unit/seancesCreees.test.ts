import { describe, expect, it } from 'vitest'
import { mergeProgram, retiredExercises } from '../../lib/program'
import { planFor, programFor } from '../../lib/proposals'
import type { RawProposal } from '../../lib/proposals'
import type { Session } from '../../data/sportProgram'

// ─────────────────────────────────────────────────────────────────────────────
// Une séance créée se comporte comme une séance livrée.
// ─────────────────────────────────────────────────────────────────────────────
//
// C'est tout l'enjeu de ce champ. Les cinq autres ne savent que MODIFIER le livré —
// `added` lui-même est indexé par séance existante — si bien qu'une installation au
// programme vide restait vide pour toujours : rien à quoi rattacher un exercice,
// donc rien que Claude puisse proposer.
//
// Ce qu'on vérifie ici n'est donc pas « le tableau est concaténé », c'est que la
// séance créée traverse EXACTEMENT le même traitement : patches, retraits, ordre.
// Deux régimes différents auraient produit une application où la moitié des gestes
// marche selon l'origine de la séance, ce qu'aucun utilisateur ne peut deviner.

const ex = (id: string, name: string, muscles: string[], sets = 4): Session['exercises'][number] =>
  ({ id, name, sets, reps: '8-10', rest: 120, muscles, cues: [], machine: '' })

const LIVRE: Session[] = [{
  id: 's1', name: 'Livrée', tag: 'Lundi · Push', color: '#111', sprint: null,
  exercises: [ex('dc', 'Développé couché', ['pecs'])],
}]

const CREEE: Session = {
  id: 'perso', name: 'Ma séance', tag: 'Jeudi · Tirage', color: '#222', sprint: null,
  exercises: [ex('rowing', 'Rowing', ['dos']), ex('curl', 'Curl', ['biceps'], 3)],
}

describe('les séances créées', () => {
  it('s’ajoutent au programme sans toucher au livré', () => {
    const out = mergeProgram(LIVRE, { sessions: [CREEE] })
    expect(out.map(s => s.id)).toEqual(['s1', 'perso'])
    expect(out[0]).toEqual(LIVRE[0])
  })

  it('partent d’un programme VIDE — le cas d’une installation neuve', () => {
    const out = mergeProgram([], { sessions: [CREEE] })
    expect(out).toHaveLength(1)
    expect(out[0].exercises.map(e => e.id)).toEqual(['rowing', 'curl'])
  })

  it('acceptent les patches comme n’importe quelle séance', () => {
    const out = mergeProgram([], { sessions: [CREEE], patches: { curl: { sets: 5 } } })
    expect(out[0].exercises.find(e => e.id === 'curl')?.sets).toBe(5)
  })

  it('acceptent le retrait d’un exercice, et le mouvement reste nommable', () => {
    const out = mergeProgram([], { sessions: [CREEE], disabled: ['curl'] })
    expect(out[0].exercises.map(e => e.id)).toEqual(['rowing'])
    // L'historique référence « curl » : il doit garder son nom, sinon des mois de
    // journal deviennent illisibles.
    expect(retiredExercises([], { sessions: [CREEE], disabled: ['curl'] }).curl?.name).toBe('Curl')
  })

  it('acceptent un ordre imposé', () => {
    const out = mergeProgram([], { sessions: [CREEE], order: { perso: ['curl', 'rowing'] } })
    expect(out[0].exercises.map(e => e.id)).toEqual(['curl', 'rowing'])
  })

  it('ignorent un identifiant déjà pris par le livré', () => {
    // Le laisser passer afficherait la séance deux fois — et l'historique, indexé
    // par exercice, ne saurait plus à laquelle rattacher une performance.
    const sosie: Session = { ...CREEE, id: 's1' }
    const out = mergeProgram(LIVRE, { sessions: [sosie] })
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('Livrée')
  })

  it('ignorent une entrée malformée plutôt que de casser le programme', () => {
    const out = mergeProgram(LIVRE, { sessions: [null as never, { name: 'sans id' } as never] })
    expect(out.map(s => s.id)).toEqual(['s1'])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Le dépôt d'une séance neuve.
// ─────────────────────────────────────────────────────────────────────────────
//
// `creer-seance` inverse la condition de tous les autres gestes : il veut un
// identifiant LIBRE là où « ajouter », « modifier » et les autres exigent qu'il
// existe. C'est la source d'erreur la plus probable du validateur, et celle qui se
// verrait le moins — une séance créée sur un identifiant déjà pris s'afficherait
// deux fois, et l'historique, indexé par exercice, ne saurait plus à laquelle
// rattacher une performance.

const brut = (patch: Record<string, unknown>): RawProposal =>
  ({ id: '', at: '', action: 'programme', summary: '', patch, status: 'pending' })

/** Le contexte d'une installation où « perso » existe déjà, et rien d'autre. */
const CTX = {
  foodKnown: () => true,
  recipeKnown: () => true,
  sessionKnown: (id: string) => id === 'perso',
  exerciseKnown: (id: string) => ['rowing', 'curl'].includes(id),
  exerciseAt: (id: string) => (['rowing', 'curl'].includes(id)
    ? { seance: 'perso', seanceNom: 'Ma séance', actif: id === 'rowing', ex: ex(id, id, []) }
    : null),
}

const SEANCE = {
  op: 'creer-seance',
  seance: 'haut',
  nom: 'Haut du corps',
  jour: 'Lundi · Push',
  exercices: [{ nom: 'Développé militaire', series: 4, reps: '6-8', repos_s: 150 }],
}

describe('proposer une séance neuve', () => {
  it('construit la séance, identifiants déduits des noms', () => {
    const plan = programFor(brut(SEANCE), CTX)
    expect(plan?.op).toBe('creer-seance')
    expect(plan?.seanceNeuve).toEqual({
      id: 'haut',
      name: 'Haut du corps',
      tag: 'Lundi · Push',
      color: '#8b6f5c',
      sprint: null,
      exercises: [expect.objectContaining({ id: 'developpe-militaire', name: 'Développé militaire', sets: 4, reps: '6-8', rest: 150 })],
    })
  })

  it('refuse un identifiant de séance DÉJÀ PRIS — l’inverse de tous les autres gestes', () => {
    expect(programFor(brut({ ...SEANCE, seance: 'perso' }), CTX)).toBeNull()
  })

  it('refuse une séance vide, et une liste invraisemblable', () => {
    // Vide : elle s'ouvrirait sur un écran sans rien à saisir.
    expect(programFor(brut({ ...SEANCE, exercices: [] }), CTX)).toBeNull()
    expect(programFor(brut({ ...SEANCE, exercices: undefined }), CTX)).toBeNull()
    const trop = Array.from({ length: 31 }, (_, i) => ({ nom: `Mouvement ${i}`, series: 3, reps: '10', repos_s: 90 }))
    expect(programFor(brut({ ...SEANCE, exercices: trop }), CTX)).toBeNull()
  })

  it('exige nom, séries, reps et repos sur CHAQUE exercice', () => {
    // Le repos n'a pas de défaut : le déduire des reps donnerait 40 secondes sur
    // « 30-40 s », c'est-à-dire un repos calculé sur une durée d'effort.
    for (const manquant of ['nom', 'series', 'reps', 'repos_s']) {
      const e: Record<string, unknown> = { nom: 'Tirage', series: 4, reps: '8-10', repos_s: 120 }
      delete e[manquant]
      expect(programFor(brut({ ...SEANCE, exercices: [e] }), CTX), manquant).toBeNull()
    }
  })

  it('refuse un exercice dont l’identifiant vit ailleurs, RETIRÉ COMPRIS', () => {
    // « curl » est inactif dans « perso » : son historique de charges existe
    // toujours, et le réutiliser rangerait de vieux records sous un autre mouvement.
    expect(programFor(brut({ ...SEANCE, exercices: [{ id: 'curl', nom: 'Curl', series: 3, reps: '10', repos_s: 90 }] }), CTX)).toBeNull()
    expect(programFor(brut({ ...SEANCE, exercices: [{ id: 'rowing', nom: 'Rowing', series: 3, reps: '10', repos_s: 90 }] }), CTX)).toBeNull()
  })

  it('refuse deux fois le même identifiant DANS la séance déposée', () => {
    const deux = [
      { id: 'dev', nom: 'Développé', series: 4, reps: '8', repos_s: 120 },
      { id: 'dev', nom: 'Développé bis', series: 4, reps: '8', repos_s: 120 },
    ]
    expect(programFor(brut({ ...SEANCE, exercices: deux }), CTX)).toBeNull()
  })

  it('n’invente pas de jour quand il n’est pas donné', () => {
    const { jour: _, ...sansJour } = SEANCE
    expect(programFor(brut(sansJour), CTX)?.seanceNeuve?.tag).toBe('')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Une séance créée est planifiable.
// ─────────────────────────────────────────────────────────────────────────────
//
// La semaine type validait ses identifiants contre une constante `['s1'..'s4']`
// écrite dans le code. Créer une séance et ne pas pouvoir la mettre dans la
// semaine, c'est la moitié du geste — et le refus n'aurait rien expliqué.

describe('la semaine type accepte les séances créées', () => {
  const semaineType = (seances: (string | null)[]): RawProposal =>
    ({ id: '', at: '', action: 'semaine-type', summary: '', patch: { seances }, status: 'pending' })

  it('accepte un identifiant que le programme EFFECTIF connaît', () => {
    expect(planFor(semaineType(['perso', null, null, null, null, null, null]), CTX))
      .toMatchObject({ kind: 'semaine-type', seances: ['perso', null, null, null, null, null, null] })
  })

  it('refuse un identifiant que personne ne connaît', () => {
    expect(planFor(semaineType(['jamais-vue', null, null, null, null, null, null]), CTX)).toBeNull()
  })

  it('sans contexte, retombe sur les quatre séances livrées à l’origine', () => {
    // Le repli existe pour les appels sans contexte. Il ne doit surtout pas
    // décider quand le programme réel est connu : ici « s1 » n'existe plus.
    expect(planFor(semaineType(['s1', null, null, null, null, null, null]), {})).not.toBeNull()
    expect(planFor(semaineType(['s1', null, null, null, null, null, null]), CTX)).toBeNull()
  })
})
