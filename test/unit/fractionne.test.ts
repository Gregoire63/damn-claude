import { describe, expect, it } from 'vitest'
import {
  BORNES, REGLAGE_DEFAUT, bornesDe, borner, dureeTotale, fmtChrono, fmtDuree,
  planDe, segmentA, texteAnnonce,
} from '../../lib/fractionne'

// ─────────────────────────────────────────────────────────────────────────────
// Le plan d'un fractionné.
// ─────────────────────────────────────────────────────────────────────────────
//
// C'est ici que se décide ce qu'on court. Une erreur de plan ne se voit pas à la
// lecture du code — elle se voit sur la piste, au sixième sprint, quand le téléphone
// annonce un repos qui n'aurait pas dû exister, ou qu'il dit « terminé » avec un
// effort d'avance. On la fige donc en test plutôt qu'en relecture.

const R = { ...REGLAGE_DEFAUT, echauffementS: 180, reposApresS: 60, sprintS: 30, reposS: 120, sprints: 3, retourAuCalmeS: 0 }

describe('le plan', () => {
  it('enchaîne échauffement, repos, puis les sprints séparés de repos', () => {
    expect(planDe(R).map(s => `${s.kind}:${s.dureeS}`)).toEqual([
      'echauffement:180', 'repos:60',
      'sprint:30', 'repos:120',
      'sprint:30', 'repos:120',
      'sprint:30',
    ])
  })

  /**
   * Le dernier sprint n'est PAS suivi d'un repos, et c'est le point le plus facile à
   * réintroduire en refactorant la boucle. Deux minutes à attendre que le téléphone
   * dise « terminé » alors qu'on a fini de courir, c'est deux minutes pendant
   * lesquelles on range son téléphone — et on n'entend pas la fin.
   */
  it('ne pose aucun repos après le dernier sprint', () => {
    const p = planDe(R)
    expect(p[p.length - 1].kind).toBe('sprint')
    expect(p[p.length - 1].dernier).toBe(true)
    // Les repos ENTRE sprints portent un numéro ; celui de l'échauffement n'en a pas.
    expect(p.filter(s => s.kind === 'repos' && s.num)).toHaveLength(2) // et non 3
  })

  it('numérote les sprints, ce qui donne le « 3 / 6 » de l’écran', () => {
    expect(planDe(R).filter(s => s.kind === 'sprint').map(s => s.num)).toEqual([1, 2, 3])
  })

  it('omet les phases réglées à zéro plutôt que de créer un segment vide', () => {
    // Un segment de durée nulle est traversé par la recherche de phase sans jamais
    // être annoncé : le bloc « saute » une phase en silence.
    const p = planDe({ ...R, echauffementS: 0, reposApresS: 0 })
    expect(p[0].kind).toBe('sprint')
    expect(p.every(s => s.dureeS > 0)).toBe(true)
  })

  it('ajoute le retour au calme seulement quand il est réglé', () => {
    expect(planDe(R).some(s => s.kind === 'calme')).toBe(false)
    const avec = planDe({ ...R, retourAuCalmeS: 300 })
    expect(avec[avec.length - 1]).toMatchObject({ kind: 'calme', dureeS: 300 })
  })

  it('additionne la durée annoncée avant de lancer', () => {
    // 180 + 60 + 3×30 + 2×120 = 570
    expect(dureeTotale(R)).toBe(570)
    expect(fmtDuree(570)).toBe('9 min 30 s')
  })
})

describe('les bornes du réglage', () => {
  it('refuse un bloc sans le moindre sprint', () => {
    expect(borner({ ...R, sprints: 0 }).sprints).toBe(BORNES.sprints[0])
  })

  it('refuse un sprint de durée nulle', () => {
    expect(borner({ ...R, sprintS: 0 }).sprintS).toBe(BORNES.sprintS[0])
  })

  it('retombe sur le défaut pour ce qui n’est pas un nombre', () => {
    expect(borner({ sprintS: Number.NaN } as never).sprintS).toBe(REGLAGE_DEFAUT.sprintS)
    expect(borner(null)).toEqual(REGLAGE_DEFAUT)
    expect(borner(undefined)).toEqual(REGLAGE_DEFAUT)
  })

  it('arrondit : une durée d’un tiers de seconde n’existe pas', () => {
    expect(borner({ ...R, sprintS: 30.4 }).sprintS).toBe(30)
  })
})

describe('trouver la phase à partir du temps écoulé', () => {
  const p = planDe({ ...R, echauffementS: 10, reposApresS: 5, sprintS: 3, reposS: 4, sprints: 2 })
  // [echauff 10][repos 5][sprint 3][repos 4][sprint 3] → 25 s

  it('pose les bornes en millisecondes, la première à zéro', () => {
    expect(bornesDe(p)).toEqual([0, 10000, 15000, 18000, 22000, 25000])
  })

  /**
   * L'invariant qui tient tout : la phase se DÉDUIT du temps écoulé.
   *
   * Un onglet gelé en arrière-plan par Chrome Android peut ne pas battre pendant
   * trente secondes. Avec un minuteur par segment, on reprendrait la suite avec
   * trente secondes de retard — et le retard s'accumulerait jusqu'à la fin du bloc.
   * Ici, un saut de 20 s tombe directement sur la bonne phase.
   */
  it('retrouve la bonne phase après un saut, sans dérive', () => {
    expect(segmentA(p, 0)).toBe(0)
    expect(segmentA(p, 9999)).toBe(0)
    expect(segmentA(p, 10000)).toBe(1)
    expect(segmentA(p, 20000)).toBe(3) // saut direct au second repos
    expect(segmentA(p, 24999)).toBe(4)
  })

  it('rend la longueur du plan une fois le bloc fini', () => {
    expect(segmentA(p, 25000)).toBe(p.length)
    expect(segmentA(p, 999999)).toBe(p.length)
  })
})

describe('ce qui est annoncé', () => {
  it('nomme le sprint par son numéro', () => {
    expect(texteAnnonce({ kind: 'sprint', dureeS: 30, num: 2 })).toBe('Sprint 2 !')
  })

  /** « Dernier » est ce qui fait tenir le sprint qu'on allait bâcler. */
  it('annonce le dernier comme tel', () => {
    expect(texteAnnonce({ kind: 'sprint', dureeS: 30, num: 6, dernier: true })).toBe('Dernier sprint !')
  })

  it('nomme les phases calmes sans point d’exclamation', () => {
    expect(texteAnnonce({ kind: 'repos', dureeS: 120 })).toBe('Repos')
    expect(texteAnnonce({ kind: 'echauffement', dureeS: 180 })).toBe('Échauffement')
  })
})

describe('les formats', () => {
  it('écrit les durées comme on les dit', () => {
    expect(fmtDuree(30)).toBe('30 s')
    expect(fmtDuree(120)).toBe('2 min')
    expect(fmtDuree(90)).toBe('1 min 30 s')
  })

  it('écrit le chrono en minutes:secondes', () => {
    expect(fmtChrono(0)).toBe('0:00')
    expect(fmtChrono(9)).toBe('0:09')
    expect(fmtChrono(125)).toBe('2:05')
    expect(fmtChrono(-3)).toBe('0:00') // jamais de temps négatif à l'écran
  })
})
