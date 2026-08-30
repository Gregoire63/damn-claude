import { describe, expect, it } from 'vitest'
import { repsGap, repsGapLabel } from '../../lib/repsGap'
import { bottomOfRange, topOfRange } from '../../data/sportProgram'
import { restFor, restFromReps } from '../../lib/rest'

// ─────────────────────────────────────────────────────────────────────────────
// Ce que la fiche promet, ce que le carnet raconte.
// ─────────────────────────────────────────────────────────────────────────────
//
// Les cas ci-dessous ne sont pas inventés : ce sont ses séances réelles au 19 août
// 2026, recopiées telles quelles. C'est ce qui donne au test sa valeur — il ne
// vérifie pas qu'une fonction fait ce qu'elle dit, il vérifie qu'elle aurait attrapé
// ce que personne n'avait vu.

const s = (...reps: number[][]) => reps.map(rs => ({ sets: rs.map(r => ({ r })) }))

describe('l’écart entre les reps prévues et les reps faites', () => {
  it('attrape le face-pull : fiche 15, carnet 10, cinq séances', () => {
    const g = repsGap('15', s([10, 10, 10], [10, 10, 10], [10, 10, 8], [10, 10, 10], [10, 10, 10]))
    expect(g).toMatchObject({ median: 10, bas: 15, haut: null, sens: 'sous', seances: 5 })
  })

  it('attrape l’oiseau : fiche 15, carnet 8', () => {
    expect(repsGap('15', s([10, 8, 8], [12, 8, 7], [10, 8, 8], [10, 8, 8]))?.sens).toBe('sous')
  })

  it('se tait quand le carnet suit la fiche', () => {
    // dc-barre, « 6-8 » : six à huit reps, c'est exactement ce qu'on demande.
    expect(repsGap('6-8', s([8, 7, 6], [8, 8, 7], [8, 8, 8]))).toBeNull()
    // Le haut de la fourchette atteint n'est pas un écart, c'est le signal de monter.
    expect(repsGap('8-10', s([10, 10, 10], [10, 10, 10], [10, 10, 10]))).toBeNull()
  })

  it('signale aussi le débordement vers le haut', () => {
    // Douze reps sur du 6-8 : la charge est trop légère pour la fourchette visée.
    expect(repsGap('6-8', s([12, 12, 12], [12, 12, 11], [12, 12, 12]))?.sens).toBe('sur')
  })

  /**
   * Le détecteur a crié au loup sur `curl-21` au premier essai, sur ses vraies
   * séances. La fiche dit « 7+7+7 (21) », il enregistre le total — 21 —, et la
   * lecture naïve prend le premier nombre, 7. La fiche et le carnet disent pourtant
   * la même chose. Une alerte fausse une fois sur quatre ne se lit plus du tout.
   */
  it('se tait sur un protocole composé, qui n’est pas une fourchette', () => {
    expect(repsGap('7+7+7 (21)', s([21, 21, 21], [21, 21, 21], [21, 21, 21]))).toBeNull()
    expect(repsGap('12+12', s([12, 12, 12], [12, 12, 12], [12, 12, 12]))).toBeNull()
    expect(repsGap('10/j', s([10, 9], [10, 10], [10, 10]))).toBeNull()
  })

  /**
   * Trois garde-fous de plus, et chacun ferme une façon de crier au loup : trop peu
   * de séances pour qu'une médiane veuille dire quelque chose, une fiche sans chiffre
   * à confronter, et l'échauffement qui tirerait la médiane vers le haut.
   */
  it('se tait faute de matière', () => {
    expect(repsGap('15', s([10, 10, 10], [10, 10, 10]))).toBeNull() // deux séances
    expect(repsGap('max', s([12], [11], [10], [9]))).toBeNull() // rien à confronter
    expect(repsGap('15', [])).toBeNull()
  })

  it('ignore les séries d’échauffement', () => {
    const avec = [
      { sets: [{ r: 20, warm: true }, { r: 8 }, { r: 8 }] },
      { sets: [{ r: 20, warm: true }, { r: 8 }, { r: 8 }] },
      { sets: [{ r: 20, warm: true }, { r: 8 }, { r: 8 }] },
    ]
    expect(repsGap('15', avec)?.median).toBe(8)
  })

  it('met des mots sur l’écart, avec la conséquence', () => {
    const g = repsGap('15', s([10, 10, 10], [10, 10, 10], [10, 10, 10]))!
    const phrase = repsGapLabel('face-pull', '15', g)
    expect(phrase).toContain('15 reps')
    expect(phrase).toContain('10')
    expect(phrase).toContain('décharge')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// L'asymétrie des deux bornes, épinglée pour qu'on ne la « corrige » pas.
// ─────────────────────────────────────────────────────────────────────────────
//
// « topOfRange('15') rend null alors que bottomOfRange('15') rend 15 » se lit comme
// un oubli, et j'ai failli le corriger. Ses données disent que ce serait une faute :
// curl-21 est un protocole où les 21 reps sont là par construction — trois séances
// sur trois —, donc « objectif atteint » serait vrai à chaque fois et la charge
// monterait indéfiniment.

describe('les deux bornes ne servent pas à la même chose', () => {
  it('un nombre fixe a un plancher, pas de plafond', () => {
    expect(bottomOfRange('15')).toBe(15)
    expect(topOfRange('15')).toBeNull()
    expect(bottomOfRange('12')).toBe(12)
    expect(topOfRange('12')).toBeNull()
  })

  it('une vraie fourchette a les deux', () => {
    expect(bottomOfRange('8-10')).toBe(8)
    expect(topOfRange('8-10')).toBe(10)
  })

  it('« max » n’a ni l’un ni l’autre', () => {
    expect(bottomOfRange('max')).toBeNull()
    expect(topOfRange('max')).toBeNull()
  })
})

describe('le repos déduit', () => {
  it('se déduit des reps quand il n’est pas donné', () => {
    expect(restFor({ reps: '6-8' })).toBe(180)
    expect(restFor({ reps: '8-10' })).toBe(120)
    expect(restFor({ reps: '12-15' })).toBe(75)
  })

  it('ne se déduit JAMAIS d’une durée d’effort', () => {
    // « 30-40 s » ressortait à 75 secondes — le repos d'une série légère, après avoir
    // porté lourd pendant quarante secondes. On prend le défaut prudent.
    expect(restFromReps('30-40 s')).toBe(75) // ce que ferait la lecture naïve…
    expect(restFor({ reps: '30-40 s', mesure: 'temps' })).toBe(120) // …et ce qu'on rend
  })

  it('le repos explicite gagne toujours', () => {
    expect(restFor({ reps: '30-40 s', mesure: 'temps', rest: 90 })).toBe(90)
    expect(restFor({ reps: '6-8', rest: 200 })).toBe(200)
  })
})
