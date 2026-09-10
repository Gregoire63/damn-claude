import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Exercise, Session } from '../../data/sportProgram'

// ─────────────────────────────────────────────────────────────────────────────
// Regarder une séance sans s'y engager.
// ─────────────────────────────────────────────────────────────────────────────
//
// L'aperçu existait, mais on ne l'atteignait que COINCÉ : en touchant une autre
// séance alors qu'une était déjà en cours. Autrement dit, le seul moyen de lire le
// contenu d'une séance — combien d'exercices, lesquels, quelles machines — était de
// la démarrer. Pour vérifier si on avait le temps, on démarrait puis on annulait, et
// on laissait un brouillon derrière soi.
//
// Ce que ces tests protègent : que l'aperçu s'ouvre sans rien démarrer, et que le
// comportement d'origine (une séance en cours BLOQUE le démarrage d'une autre) reste
// intact — c'est lui qui empêche de perdre un brouillon en cours de saisie.

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

const ex = (id: string, name: string): Exercise => ({
  id, name, sets: 3, reps: '8-10', muscles: ['pectoraux'], cues: [], machine: '',
})

const PUSH: Session = {
  id: 's1', name: 'Pecs & Épaules', tag: 'Lundi', color: '#8b6f5c', sprint: null,
  exercises: [ex('dc-barre', 'Développé couché'), ex('dips', 'Dips')],
}
const JAMBES: Session = {
  id: 's3', name: 'Jambes', tag: 'Jeudi', color: '#b07d2e', sprint: null,
  exercises: [ex('squat', 'Squat')],
}

const charger = async () => (await import('../../composables/useSeance')).useSeance()

describe('l’aperçu, sans séance en cours', () => {
  it('ouvre la séance en lecture sans rien démarrer', async () => {
    const s = await charger()
    s.apercuSession(JAMBES)

    expect(s.previewSession.value?.id).toBe('s3')
    // Le point du test : rien n'a commencé.
    expect(s.activeSession.value).toBeNull()
  })

  /** Sans brouillon créé, rien à ranger : fermer l'aperçu ne doit rien laisser. */
  it('ne laisse aucun brouillon derrière lui', async () => {
    const s = await charger()
    s.apercuSession(JAMBES)
    expect(Object.keys(s.draft)).toHaveLength(0)
  })

  it('démarre ce qu’on vient de regarder, et referme le calque', async () => {
    const s = await charger()
    s.apercuSession(JAMBES)
    s.demarrerApercu()

    expect(s.activeSession.value?.id).toBe('s3')
    expect(s.previewSession.value).toBeNull()
    // Démarrée pour de bon : les lignes de saisie existent.
    expect(s.draft.squat?.length).toBeGreaterThan(0)
  })

  it('ne fait rien quand aucun aperçu n’est ouvert', async () => {
    const s = await charger()
    s.demarrerApercu()
    expect(s.activeSession.value).toBeNull()
  })
})

describe('l’aperçu, avec une séance déjà en cours', () => {
  /**
   * Le comportement d'origine, qu'il ne faut pas casser en ouvrant l'aperçu :
   * toucher une AUTRE séance ne doit jamais remplacer celle qu'on est en train de
   * saisir — les séries tapées et non enregistrées partiraient avec.
   */
  it('montre l’autre séance sans toucher à celle en cours', async () => {
    const s = await charger()
    s.startSession(PUSH)
    s.draft['dc-barre']![0]!.w = '60'

    s.startSession(JAMBES)

    expect(s.previewSession.value?.id).toBe('s3')
    expect(s.activeSession.value?.id).toBe('s1')
    expect(s.draft['dc-barre']![0]!.w).toBe('60')
  })

  it('reprend la séance en cours quand on la retouche', async () => {
    const s = await charger()
    s.startSession(PUSH)
    s.collapseSession()

    s.startSession(PUSH)

    expect(s.previewSession.value).toBeNull()
    expect(s.activeSession.value?.id).toBe('s1')
  })
})
