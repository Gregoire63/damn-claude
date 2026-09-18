import { describe, expect, it } from 'vitest'
import type { Exercise } from '../../data/sportProgram'
import { exercicesDuJour, groupeDe, indexDeLaSemaine, phraseAlternance, semaineDe } from '../../lib/rotation'

// ─────────────────────────────────────────────────────────────────────────────
// Deux mouvements pour une place, une semaine chacun.
// ─────────────────────────────────────────────────────────────────────────────
//
// Ce que ce fichier protège n'est pas « le modulo est juste » — il l'est par
// construction. C'est le reste : que l'alternance ne se retourne pas toute seule au
// Nouvel An, que l'ordre de la séance ne bouge pas d'une semaine à l'autre, et qu'un
// choix ponctuel ne fasse pas disparaître une place entière.

const ex = (id: string, groupe?: string): Exercise => ({
  id, name: id, sets: 3, reps: '10', muscles: [], cues: [], machine: '', ...(groupe ? { groupe } : {}),
})

const SQUAT = ex('squat')
const ADD = ex('adducteur', 'adducteurs')
const ABD = ex('abducteur', 'adducteurs')
const MOLLETS = ex('mollets')
const SEANCE = [SQUAT, ADD, MOLLETS, ABD]

const ids = (l: Exercise[]) => l.map(e => e.id)

describe('la semaine qui sert de compteur', () => {
  it('change le lundi, et pas avant', () => {
    // 14 septembre 2026 est un lundi.
    expect(semaineDe('2026-09-13')).toBe(semaineDe('2026-09-07')) // dimanche : semaine d'avant
    expect(semaineDe('2026-09-14')).toBe(semaineDe('2026-09-13') + 1)
    expect(semaineDe('2026-09-20')).toBe(semaineDe('2026-09-14')) // dimanche suivant : même semaine
  })

  /**
   * Le piège qui a fait écarter le numéro ISO.
   *
   * Il repart à 1 chaque année, après une année de 52 OU 53 semaines. Une alternance
   * fondée sur sa parité se retournerait donc silencieusement un 1er janvier sur
   * deux : deux fois le même exercice d'affilée, sans que rien n'ait été touché.
   * 2026 est une année de 53 semaines ISO — exactement le cas qui casse.
   */
  it('ne se retourne pas au passage d’une année', () => {
    const suite = ['2026-12-21', '2026-12-28', '2027-01-04', '2027-01-11']
      .map(d => indexDeLaSemaine(d, 2))
    expect(suite).toEqual([suite[0], 1 - suite[0], suite[0], 1 - suite[0]])
  })

  it('reste dans les positifs, même pour une date d’avant 1970', () => {
    expect(indexDeLaSemaine('1969-03-04', 2)).toBeGreaterThanOrEqual(0)
    expect(indexDeLaSemaine('1969-03-04', 2)).toBeLessThan(2)
  })

  /** Une date illisible ne doit pas faire disparaître la séance : rang 0, et on avance. */
  it('encaisse une date vide', () => {
    expect(indexDeLaSemaine('', 2)).toBe(0)
    expect(ids(exercicesDuJour(SEANCE, ''))).toEqual(['squat', 'adducteur', 'mollets'])
  })
})

describe('la séance du jour', () => {
  it('ne garde qu’un membre par groupe, et le change chaque semaine', () => {
    const a = ids(exercicesDuJour(SEANCE, '2026-09-14'))
    const b = ids(exercicesDuJour(SEANCE, '2026-09-21'))
    expect(a).toHaveLength(3)
    expect(b).toHaveLength(3)
    expect(a).not.toEqual(b)
    // L'un ou l'autre, jamais les deux, jamais aucun.
    expect(a.filter(id => id === 'adducteur' || id === 'abducteur')).toHaveLength(1)
    expect(b.filter(id => id === 'adducteur' || id === 'abducteur')).toHaveLength(1)
  })

  /**
   * L'ordre d'une séance n'est pas décoratif : on ne met pas les mollets avant le
   * squat. Le membre retenu prend donc la place du PREMIER du groupe, où qu'il soit
   * lui-même dans la liste.
   */
  it('garde la place du groupe, quelle que soit la semaine', () => {
    for (const d of ['2026-09-14', '2026-09-21']) {
      const l = ids(exercicesDuJour(SEANCE, d))
      expect(l[0]).toBe('squat')
      expect(l[2]).toBe('mollets')
    }
  })

  it('laisse intacte une séance sans aucun groupe', () => {
    const simple = [SQUAT, MOLLETS]
    expect(exercicesDuJour(simple, '2026-09-14')).toBe(simple)
  })

  /** Un groupe d'un seul membre n'alterne avec rien : il doit passer tel quel. */
  it('n’escamote pas un groupe resté seul', () => {
    expect(ids(exercicesDuJour([SQUAT, ADD], '2026-09-14'))).toEqual(['squat', 'adducteur'])
    expect(groupeDe([SQUAT, ADD], 'adducteur')).toEqual([])
  })

  it('obéit au choix du jour, sans toucher aux autres semaines', () => {
    const force = ids(exercicesDuJour(SEANCE, '2026-09-14', { adducteurs: 'abducteur' }))
    expect(force).toContain('abducteur')
    expect(force).not.toContain('adducteur')
    // Le calendrier n'a pas bougé pour autant.
    expect(ids(exercicesDuJour(SEANCE, '2026-09-14'))).not.toEqual(force)
  })

  /**
   * Un choix qui ne désigne plus personne — l'exercice a été retiré de la séance
   * depuis — ne doit pas vider la place. Sans ce repli, corriger son programme
   * pendant une séance en cours en ferait disparaître une ligne.
   */
  it('ignore un choix devenu introuvable plutôt que de vider la place', () => {
    const l = ids(exercicesDuJour(SEANCE, '2026-09-14', { adducteurs: 'presse-a-cuisses' }))
    expect(l).toHaveLength(3)
    expect(l.filter(id => id === 'adducteur' || id === 'abducteur')).toHaveLength(1)
  })

  it('sait faire tourner trois mouvements', () => {
    const trio = [ex('a', 'g'), ex('b', 'g'), ex('c', 'g')]
    const vus = ['2026-09-14', '2026-09-21', '2026-09-28'].map(d => ids(exercicesDuJour(trio, d))[0])
    expect(new Set(vus).size).toBe(3)
  })
})

describe('ce que la fiche raconte', () => {
  it('dit le rythme et avec quoi', () => {
    expect(phraseAlternance([ADD, ABD], 'adducteur')).toBe('En alternance une semaine sur deux avec abducteur.')
    expect(phraseAlternance([ex('a', 'g'), ex('b', 'g'), ex('c', 'g')], 'a')).toContain('une semaine sur trois')
  })

  it('ne dit rien quand il n’y a rien à dire', () => {
    expect(phraseAlternance([ADD], 'adducteur')).toBe('')
  })
})
