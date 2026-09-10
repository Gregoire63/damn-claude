import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Exercise, Session } from '../../data/sportProgram'

// ─────────────────────────────────────────────────────────────────────────────
// Un échauffement supprimé ne revient pas.
// ─────────────────────────────────────────────────────────────────────────────
//
// L'échauffement automatique était reproposé à chaque démarrage, quoi qu'on en
// fasse : on le supprimait, il revenait la séance suivante, on le resupprimait. Un
// geste qu'on refait tous les lundis n'est pas un réglage — c'est une négociation
// perdue d'avance. Et il n'a pas de sens partout : sur un rowing léger en fin de
// séance, tout est déjà chaud.
//
// Ce que ces tests protègent, et qui ne se voit qu'à la séance SUIVANTE :
//
//   · le refus survit au rechargement (il est persisté, pas en mémoire) ;
//   · il est par EXERCICE — refuser au squat ne doit rien changer au développé ;
//   · il se lève en réajoutant un échauffement à la main, sinon la décision est
//     irréversible et on ne peut plus revenir en arrière qu'en vidant le stockage ;
//   · supprimer une série de TRAVAIL ne vaut pas refus. C'est le défaut qu'on
//     introduirait en réparant trop large, et il serait invisible : l'échauffement
//     disparaîtrait un beau jour sans qu'on sache lequel de nos gestes l'a tué.

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

const ex = (id: string, name: string): Exercise => ({
  id, name, sets: 3, reps: '6-8', muscles: ['quadris'], cues: [], machine: '',
})

const SEANCE: Session = {
  id: 's3', name: 'Jambes', tag: 'Jeudi', color: '#b07d2e', sprint: null,
  exercises: [ex('squat', 'Squat'), ex('presse', 'Presse à cuisses')],
}

const charger = async () => (await import('../../composables/useSeance')).useSeance()

/** Les lignes d'échauffement d'un exercice dans le brouillon en cours. */
const echauffements = (rows: { warm: boolean }[] | undefined) => (rows ?? []).filter(r => r.warm)

/**
 * Une séance passée, avec de vraies charges.
 *
 * Sans historique, `prefillRows` ne suggère aucun poids, et `warmupLoad(0)` rend
 * `null` : il n'y aurait aucun échauffement à supprimer, et les tests passeraient en
 * ne prouvant rien. C'est le piège de ce fichier — il faut de quoi s'échauffer avant
 * de pouvoir refuser de s'échauffer.
 */
function semerHistorique() {
  localStorage.setItem('gr-workout-logs-v1', JSON.stringify({
    squat: [{ date: '2026-09-01', sets: [{ w: 100, r: 6 }, { w: 100, r: 6 }, { w: 100, r: 6 }] }],
    presse: [{ date: '2026-09-01', sets: [{ w: 140, r: 8 }, { w: 140, r: 8 }] }],
  }))
}

describe('le refus d’échauffement', () => {
  /** Le point de départ, sans lequel le reste du fichier ne prouverait rien. */
  it('propose bien un échauffement au départ', async () => {
    semerHistorique()
    const s = await charger()
    s.startSession(SEANCE)
    expect(echauffements(s.draft.squat)).toHaveLength(1)
    expect(echauffements(s.draft.presse)).toHaveLength(1)
  })

  it('ne le repropose plus après une suppression, même après rechargement', async () => {
    semerHistorique()
    const s = await charger()
    s.startSession(SEANCE)
    s.removeSet('squat', s.draft.squat!.findIndex(r => r.warm))

    // Rechargement complet de l'application : nouveau module, stockage relu.
    vi.resetModules()
    const s2 = await charger()
    s2.startSession(SEANCE)
    expect(echauffements(s2.draft.squat)).toHaveLength(0)
  })

  it('ne refuse que l’exercice touché', async () => {
    semerHistorique()
    const s = await charger()
    s.startSession(SEANCE)
    s.removeSet('squat', s.draft.squat!.findIndex(r => r.warm))

    const { useProgram } = await import('../../composables/useProgram')
    const p = useProgram()
    expect(p.echauffementRefuse('squat')).toBe(true)
    expect(p.echauffementRefuse('presse')).toBe(false)
    // Et la presse en garde bien un, elle.
    expect(echauffements(s.draft.presse)).toHaveLength(1)
  })

  it('se lève quand on en rajoute un à la main', async () => {
    semerHistorique()
    const { useProgram } = await import('../../composables/useProgram')
    const p = useProgram()
    p.refuserEchauffement('squat')

    const s = await charger()
    s.startSession(SEANCE)
    expect(echauffements(s.draft.squat)).toHaveLength(0)

    s.addWarmup('squat')
    expect(p.echauffementRefuse('squat')).toBe(false)
    expect(echauffements(s.draft.squat)).toHaveLength(1)
  })

  /** Le défaut qu'on introduirait en réparant trop large. */
  it('ne prend pas la suppression d’une série de travail pour un refus', async () => {
    semerHistorique()
    const s = await charger()
    s.startSession(SEANCE)
    s.removeSet('squat', s.draft.squat!.findIndex(r => !r.warm))

    const { useProgram } = await import('../../composables/useProgram')
    expect(useProgram().echauffementRefuse('squat')).toBe(false)
    expect(echauffements(s.draft.squat)).toHaveLength(1)
  })

  it('part dans la sauvegarde et en revient', async () => {
    const { useProgram } = await import('../../composables/useProgram')
    const p = useProgram()
    p.refuserEchauffement('squat')

    const snap = p.snapshot()
    expect(snap.echauffementsRefuses).toEqual(['squat'])

    p.rendreEchauffement('squat')
    p.restore(snap as Record<string, unknown>)
    expect(p.echauffementRefuse('squat')).toBe(true)
  })

  /** Une sauvegarde d'avant ce réglage ne doit rien casser. */
  it('encaisse une sauvegarde qui ne connaît pas ce champ', async () => {
    const { useProgram } = await import('../../composables/useProgram')
    const p = useProgram()
    p.refuserEchauffement('squat')
    p.restore({ programme: { patches: {}, added: {}, disabled: [], order: {}, variants: {}, sessions: [] } })
    expect(p.echauffementRefuse('squat')).toBe(true)
  })
})
