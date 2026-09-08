import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Le chrono de fractionné, déroulé dans le temps.
// ─────────────────────────────────────────────────────────────────────────────
//
// Le plan lui-même est couvert par `test/unit/fractionne.test.ts`. Ce qui se joue
// ici est l'autre moitié : le passage d'une phase à la suivante, la pause, le saut,
// et le bilan de fin qui remplit le journal. Rien de tout ça ne se vérifie à l'œil —
// il faudrait courir quinze minutes pour voir une erreur au dernier sprint.
//
// Le son, la voix et la vibration sont volontairement hors champ : ils sont déjà
// défensifs (try/catch, repli silencieux) et ne se jugent qu'à l'oreille, sur un
// vrai téléphone, dans une vraie salle.

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

const charger = async () => {
  const { useFractionne } = await import('../../composables/useFractionne')
  return useFractionne()
}

/**
 * Un bloc court, pour que le test reste lisible : 10 s + 5 s + 2 × (5 s / 5 s).
 *
 * Les cinq secondes de sprint et de repos sont le PLANCHER de `BORNES` — écrire 3 s
 * ici donnait un test qui se trompait tout seul : le réglage était relevé à 5 s en
 * silence et la moitié des attentes tombaient à côté. La première version de ce
 * fichier s'y est fait prendre.
 */
const COURT = { echauffementS: 10, reposApresS: 5, sprintS: 5, reposS: 5, sprints: 2, retourAuCalmeS: 0 }
// Bornes du plan : [0 échauff 10][repos 15][sprint 1 → 20][repos 25][sprint 2 → 30]

describe('l’enchaînement des phases', () => {
  it('démarre sur l’échauffement', async () => {
    const f = await charger()
    f.definir(COURT)
    f.lancer()
    expect(f.enCours.value).toBe(true)
    expect(f.phase.value).toBe('echauffement')
    expect(f.resteS.value).toBe(10)
  })

  it('passe au repos, puis au premier sprint, à l’heure dite', async () => {
    const f = await charger()
    f.definir(COURT)
    f.lancer()

    vi.advanceTimersByTime(10_000)
    expect(f.phase.value).toBe('repos')

    vi.advanceTimersByTime(5_000)
    expect(f.phase.value).toBe('sprint')
    expect(f.position.value).toBe('1 / 2')
  })

  /**
   * L'invariant qui justifie toute l'architecture du composable.
   *
   * Chrome Android gèle un onglet en arrière-plan : la boucle ne bat pas pendant
   * plusieurs dizaines de secondes, puis reprend. Un chrono qui décrémente à chaque
   * battement reprendrait la suite avec tout ce retard, et l'accumulerait jusqu'à la
   * fin du bloc. Ici l'heure de départ est absolue : un seul battement tardif suffit
   * à retomber sur la bonne phase.
   */
  it('retombe sur la bonne phase après un gel de l’onglet', async () => {
    const f = await charger()
    f.definir(COURT)
    f.lancer()

    // Un seul saut de 22 s : on doit être dans le repos qui SUIT le premier sprint.
    vi.advanceTimersByTime(22_000)
    expect(f.phase.value).toBe('repos')
    expect(f.position.value).toBe('1 / 2')
    expect(f.resteS.value).toBe(3)
  })

  it('termine sur le dernier sprint, sans repos derrière', async () => {
    const f = await charger()
    f.definir(COURT)
    f.lancer()

    vi.advanceTimersByTime(25_000)
    expect(f.phase.value).toBe('sprint')
    expect(f.segment.value?.dernier).toBe(true)

    vi.advanceTimersByTime(5_000)
    expect(f.enCours.value).toBe(false)
  })
})

describe('le bilan de fin', () => {
  /**
   * C'est ce bilan qui remplit « Ce que tu as fait ». Le chrono est le seul à
   * connaître le compte exact : après coup, essoufflé, on écrit « cinq ou six ».
   */
  it('rend ce qui a été couru une fois le bloc fini', async () => {
    const f = await charger()
    f.definir(COURT)
    f.lancer()
    expect(f.bilan.value).toBeNull()

    vi.advanceTimersByTime(30_000)
    expect(f.bilan.value).toEqual({ sprints: 2, sprintS: 5, echauffementS: 10 })
  })

  it('ne rend rien quand on arrête en cours de route', async () => {
    const f = await charger()
    f.definir(COURT)
    f.lancer()
    vi.advanceTimersByTime(12_000)
    f.arreter()
    expect(f.enCours.value).toBe(false)
    expect(f.bilan.value).toBeNull()
  })
})

describe('la pause', () => {
  /** Le temps en pause ne compte pas : sinon on rate la reprise du sprint. */
  it('fige le décompte et repart d’où il en était', async () => {
    const f = await charger()
    f.definir(COURT)
    f.lancer()

    vi.advanceTimersByTime(4_000)
    expect(f.resteS.value).toBe(6)

    f.basculerPause()
    vi.advanceTimersByTime(30_000)
    expect(f.enPause.value).toBe(true)
    expect(f.resteS.value).toBe(6) // rien n'a bougé

    f.basculerPause()
    expect(f.enPause.value).toBe(false)
    expect(f.phase.value).toBe('echauffement')
    expect(f.resteS.value).toBe(6)
  })
})

describe('passer une phase', () => {
  it('saute directement à la suivante', async () => {
    const f = await charger()
    f.definir(COURT)
    f.lancer()
    expect(f.phase.value).toBe('echauffement')

    f.passer()
    expect(f.phase.value).toBe('repos')

    f.passer()
    expect(f.phase.value).toBe('sprint')
    expect(f.position.value).toBe('1 / 2')
  })

  it('termine le bloc si on passe la dernière phase', async () => {
    const f = await charger()
    f.definir({ ...COURT, echauffementS: 0, reposApresS: 0, sprints: 1 })
    f.lancer()
    expect(f.phase.value).toBe('sprint')
    f.passer()
    expect(f.enCours.value).toBe(false)
    expect(f.bilan.value?.sprints).toBe(1)
  })
})

describe('le réglage', () => {
  it('se mémorise, et se relit au chargement suivant', async () => {
    const f = await charger()
    f.definir({ sprints: 8, sprintS: 45 })
    expect(localStorage.getItem('gr-fractionne-v1')).toContain('"sprints":8')

    vi.resetModules()
    const g = await charger()
    expect(g.reglage.value.sprints).toBe(8)
    expect(g.reglage.value.sprintS).toBe(45)
  })

  /** Même leçon que les réglages du minuteur : ce qui n'est pas dans l'instantané
   *  ne revient pas d'un import, et on s'en aperçoit sur la piste. */
  it('part dans la sauvegarde et en revient', async () => {
    const f = await charger()
    f.definir({ sprints: 5, reposS: 90 })
    const snap = f.snapshot()
    expect(snap).toEqual({ fractionne: expect.objectContaining({ sprints: 5, reposS: 90 }) })

    f.definir({ sprints: 2, reposS: 30 })
    f.restore(snap as Record<string, unknown>)
    expect(f.reglage.value.sprints).toBe(5)
    expect(f.reglage.value.reposS).toBe(90)
  })

  it('encaisse une sauvegarde d’avant ce réglage sans broncher', async () => {
    const f = await charger()
    const avant = { ...f.reglage.value }
    f.restore({ logs: {} })
    expect(f.reglage.value).toEqual(avant)
  })
})
