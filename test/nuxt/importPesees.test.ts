import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * Un export qui contient des pesées mais pas d'historique de charges les perdait
 * TOUTES, en silence, et l'écran annonçait « Import réussi ✓ ». On croit avoir
 * récupéré ses données, on efface l'ancienne application, et on découvre le trou des
 * semaines plus tard — quand il n'y a plus de source pour le combler.
 *
 * C'est la pire forme de perte de données : celle qui s'annonce comme une réussite.
 */
beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

const PESEES = [
  { date: '2026-06-01', kg: 93.4 },
  { date: '2026-06-08', kg: 92.8 },
  { date: '2026-06-15', kg: 92.1 },
]

describe('import : chaque section revient, même seule', () => {
  it('rend les pesées d’un export SANS historique de charges', async () => {
    const { useWorkout } = await import('../../composables/useWorkout')
    useWorkout().restoreData({ bodyWeight: PESEES })
    expect(useWorkout().bodyWeight.value).toHaveLength(3)
    expect(useWorkout().bodyWeight.value[0]).toEqual(PESEES[0])
  })

  it('rend les séances enregistrées d’un export sans charges non plus', async () => {
    const { useWorkout } = await import('../../composables/useWorkout')
    const seances = [{ at: '2026-06-01T10:00', sessionId: 's1', name: 'Push', sets: [] }]
    useWorkout().restoreData({ sessions: seances } as never)
    expect(useWorkout().sessionHistory.value).toHaveLength(1)
  })

  it('rend tout d’un coup quand l’export est complet', async () => {
    const { useWorkout } = await import('../../composables/useWorkout')
    useWorkout().restoreData({ logs: { squat: [] }, bodyWeight: PESEES, sessions: [] } as never)
    expect(useWorkout().bodyWeight.value).toHaveLength(3)
    expect(Object.keys(useWorkout().logs.value)).toContain('squat')
  })

  /*
   * La prudence d'origine est conservée : un fichier qui n'a pas la forme d'une
   * section ne doit pas l'écraser. Importer un catalogue de recettes n'efface pas
   * des mois de pesées.
   */
  it('ne touche à rien quand la section n’a pas la bonne forme', async () => {
    const { useWorkout } = await import('../../composables/useWorkout')
    const w = useWorkout()
    w.restoreData({ bodyWeight: PESEES })
    w.restoreData({ nutrition: { recipes: {} }, bodyWeight: 'nawak' } as never)
    expect(w.bodyWeight.value).toHaveLength(3)
  })
})
