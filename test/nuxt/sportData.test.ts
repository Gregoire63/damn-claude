import { describe, it, expect, beforeEach, vi } from 'vitest'

// Ces tests tournent sur le PACK D'EXEMPLE : l'application ne livre plus de données.
// Voir test/exemple.ts pour le pourquoi.
vi.mock('../../data/nutritionProgram', () => (import('../exemple')).then(m => m.catalogueExemple()))
vi.mock('../../data/sportProgram', () => (import('../exemple')).then(m => m.programmeExemple()))

// Ces tests couvrent le CÂBLAGE (localStorage, migrations, aller-retour d'écriture),
// pas les calculs — ceux-là sont dans test/unit/sportStats.test.ts.
// Les composables gardent leur état au niveau du module : on réimporte à neuf à
// chaque test pour repartir d'une hydratation propre.
beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

describe('planning hebdo', () => {
  /**
   * Le planning stocké est LA vérité, sans exception.
   *
   * Il a existé un nettoyage unique, qui repartait une fois du planning par défaut
   * pour réparer la dérive de l'ancien planning « adaptatif ». Il a été retiré avec
   * les données livrées : le défaut est devenu une semaine vide, si bien que la
   * réparation effaçait la semaine sur tout navigateur qui n'avait pas encore vu le
   * drapeau — une machine neuve, un profil restauré depuis une sauvegarde.
   *
   * Ce test tient la place : plus rien ne doit réécrire ce qui est stocké.
   */
  it('relit le planning stocké sans jamais le réécrire', async () => {
    const custom = ['s2', null, 's1', null, 's3', null, 's4']
    localStorage.setItem('gr-weekplan-v1', JSON.stringify(custom))

    const { useProfile } = await import('../../composables/useProfile')
    const { weekPlan, hydrate } = useProfile()
    hydrate()

    expect(weekPlan.value).toEqual(custom)
    expect(JSON.parse(localStorage.getItem('gr-weekplan-v1')!)).toEqual(custom)
  })

  it('ignore un planning stocké corrompu', async () => {
    localStorage.setItem('gr-weekplan-v1', '{pas du json')

    const { useProfile, DEFAULT_PLAN } = await import('../../composables/useProfile')
    const { weekPlan, hydrate } = useProfile()
    hydrate()

    expect(weekPlan.value).toEqual(DEFAULT_PLAN)
  })
})

describe('enregistrement d\'une séance', () => {
  it('mémorise le ressenti et la note, et les relit', async () => {
    const { useWorkout } = await import('../../composables/useWorkout')
    const { recordSession, lastEffort, sessionLog, logs } = useWorkout()

    recordSession(
      [{ exId: 'dc-barre', sets: [{ w: 40, r: 10, warm: true }, { w: 60, r: 8 }], effort: 'hard' }],
      52,
      { sessionId: 's1', name: 'Pecs, Épaules & Triceps', note: 'Épaule droite sensible' },
    )

    expect(lastEffort('dc-barre')).toBe('hard')
    expect(logs.value['dc-barre']).toHaveLength(1)
    const rec = sessionLog()[0]
    expect(rec.note).toBe('Épaule droite sensible')
    expect(rec.entries[0].effort).toBe('hard')
    expect(rec.durationMin).toBe(52)
  })

  it('n\'écrit pas de note vide', async () => {
    const { useWorkout } = await import('../../composables/useWorkout')
    const { recordSession, sessionLog } = useWorkout()

    recordSession([{ exId: 'dc-barre', sets: [{ w: 60, r: 8 }] }], 45, { sessionId: 's1', name: 'S', note: '   ' })
    expect(sessionLog()[0].note).toBeUndefined()
  })

  it('remonte les records battus, en distinguant charge et reps', async () => {
    const { useWorkout } = await import('../../composables/useWorkout')
    const { recordSession } = useWorkout()

    // 1re séance : pas de record (rien à battre)
    expect(recordSession([{ exId: 'squat', sets: [{ w: 80, r: 8 }] }], 50, { sessionId: 's3', name: 'Jambes' })).toEqual([])
    // 2e séance : même charge, plus de reps → PR de reps
    const prs = recordSession([{ exId: 'squat', sets: [{ w: 80, r: 11 }] }], 50, { sessionId: 's3', name: 'Jambes' })
    expect(prs).toHaveLength(1)
    expect(prs[0].kinds).toContain('reps')
    expect(prs[0].kinds).not.toContain('charge')
  })

  it('auto-régule la charge conseillée d\'après le ressenti', async () => {
    const { useWorkout } = await import('../../composables/useWorkout')
    const { recordSession, suggestWeight } = useWorkout()
    const { ALL_EXERCISES } = await import('../../data/sportProgram')
    const ex = ALL_EXERCISES.find(e => e.id === 'dc-barre')!

    // Séance notée « facile » sans avoir atteint le haut de la fourchette
    recordSession([{ exId: 'dc-barre', sets: Array.from({ length: ex.sets }, () => ({ w: 60, r: 8 })), effort: 'easy' }], 50, { sessionId: 's1', name: 'S' })
    const easy = suggestWeight(ex)
    expect(easy.reason).toBe('progress')
    expect(easy.weight).toBeGreaterThan(60)
  })
})

describe('fatigue', () => {
  // Construit un historique daté sur 3 semaines terminées + la semaine en cours.
  async function seedWeeks() {
    const { startOfWeek, shiftIso, isoOf } = await import('../../utils/sportStats')
    const now = new Date()
    const todayIso = isoOf(now)
    const dow = now.getDay()
    const cur = startOfWeek(todayIso, dow)
    // mardi de chaque semaine, pour rester à l'intérieur de la semaine visée
    const day = (weeksBack: number) => shiftIso(shiftIso(cur, -7 * weeksBack), 1)
    const set = (n: number) => Array.from({ length: n }, () => ({ w: 100, r: 10 })) // 1000 kg par série

    const logs = {
      squat: [
        { date: day(3), sets: set(1), durationMin: 50 },
        { date: day(2), sets: set(2), durationMin: 50 },
        { date: day(1), sets: set(3), durationMin: 50, effort: 'hard' },
      ],
    }
    const sessions = [3, 2, 1].map(b => ({ at: day(b) + 'T18:30', sessionId: 's3', name: 'Jambes', durationMin: 50, entries: [] }))
    localStorage.setItem('gr-workout-logs-v1', JSON.stringify(logs))
    localStorage.setItem('gr-sessions-v1', JSON.stringify(sessions))
    return { todayIso, dow, cur }
  }

  it('sépare la semaine en cours (partielle) des semaines terminées', async () => {
    const { todayIso, dow, cur } = await seedWeeks()
    const { useWorkout } = await import('../../composables/useWorkout')
    const { weeklyStats } = useWorkout()
    const { weeks, current } = weeklyStats(todayIso, dow)

    // 3 semaines terminées, les semaines antérieures à la 1re séance sont retirées
    expect(weeks).toHaveLength(3)
    expect(weeks.map(w => w.volume)).toEqual([1000, 2000, 3000])
    // la semaine en cours n'est PAS dans la tendance
    expect(weeks.some(w => w.start === cur)).toBe(false)
    expect(current.start).toBe(cur)
    expect(current.volume).toBe(0)
  })

  it('lit la hausse de volume et ne reste pas « unknown »', async () => {
    const { todayIso, dow } = await seedWeeks()
    const { useWorkout } = await import('../../composables/useWorkout')
    const { fatigue } = useWorkout()
    const v = fatigue(todayIso, dow)

    expect(v.ramp).toBe(2) // 1000 → 2000 → 3000
    expect(v.level).not.toBe('unknown')
    expect(v.advice).toBeTruthy()
  })

  it('compte les exercices bloqués, et ignore ceux qu\'on ne fait plus', async () => {
    const { startOfWeek, shiftIso, isoOf } = await import('../../utils/sportStats')
    const now = new Date()
    const todayIso = isoOf(now)
    const cur = startOfWeek(todayIso, now.getDay())
    const recent = (n: number) => shiftIso(cur, -7 * n + 1)

    // Les logs sont stockés dans l'ordre chronologique (la plus récente en dernier)
    localStorage.setItem('gr-workout-logs-v1', JSON.stringify({
      // 3 séances à la même charge sur les 3 dernières semaines → bloqué
      squat: [3, 2, 1].map(b => ({ date: recent(b), sets: [{ w: 100, r: 8 }] })),
      // même stagnation mais abandonné depuis des mois → ne compte pas
      'leg-curl': [3, 2, 1].map(b => ({ date: shiftIso(cur, -7 * (b + 20)), sets: [{ w: 40, r: 10 }] })),
    }))

    const { useWorkout } = await import('../../composables/useWorkout')
    const { stalledCount } = useWorkout()
    expect(stalledCount(shiftIso(todayIso, -21))).toBe(1)
  })
})

describe('sauvegarde de secours', () => {
  it('écrit un instantané daté et sait le restaurer', async () => {
    const { useWorkout } = await import('../../composables/useWorkout')
    const w1 = useWorkout()
    w1.recordSession([{ exId: 'squat', sets: [{ w: 100, r: 5 }] }], 50, { sessionId: 's3', name: 'Jambes' })

    // Nouvelle « ouverture de l'app » : l'instantané est pris à l'hydratation
    vi.resetModules()
    const { useWorkout: useWorkout2 } = await import('../../composables/useWorkout')
    const w2 = useWorkout2()
    expect(w2.backupDate()).not.toBeNull()

    // On casse les données en cours, puis on restaure
    w2.clearAll()
    expect(Object.keys(w2.logs.value)).toHaveLength(0)
    expect(w2.restoreBackup()).toBe(true)
    expect(w2.logs.value['squat']).toHaveLength(1)
  })
})
