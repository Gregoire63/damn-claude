import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Exercise, Session } from '../../data/sportProgram'

// ─────────────────────────────────────────────────────────────────────────────
// Ajouter une série pendant la séance.
// ─────────────────────────────────────────────────────────────────────────────
//
// Le geste le plus fréquent de toute l'application, et le plus mal servi : la
// nouvelle ligne reprenait la charge mais laissait les répétitions vides. En double
// progression on refait le même nombre de reps série après série jusqu'à toucher le
// haut de la fourchette — le champ à re-saisir portait donc, presque à chaque fois,
// le chiffre qu'on venait de taper. À la barre, une main sur le téléphone.
//
// Ce que le test protège : la valeur reprise vient de la dernière série VALIDÉE, pas
// de la dernière ligne. Les deux se confondent tant qu'on ne laisse pas traîner une
// ligne à moitié remplie — et c'est exactement ce qui arrive quand on ajoute une
// série puis qu'on change d'avis.

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

const EX: Exercise = {
  id: 'dev-couche', name: 'Développé couché', sets: 3, reps: '8-10',
  muscles: ['pectoraux'], cues: [], machine: 'Banc + barre',
}
const SEANCE: Session = {
  id: 's-test', name: 'Test', tag: 'Push', color: '#000', sprint: null, exercises: [EX],
}

const ouvrir = async () => {
  const { useSeance } = await import('../../composables/useSeance')
  const s = useSeance()
  s.startSession(SEANCE)
  return s
}

/** Les lignes de travail (l'échauffement automatique est en tête et ne compte pas). */
const travail = (rows: { warm: boolean }[]) => rows.filter(r => !r.warm)

describe('ajouter une série', () => {
  it('reprend la charge ET les répétitions de la dernière série validée', async () => {
    const s = await ouvrir()
    const rows = s.draft[EX.id]
    const w = travail(rows)
    w[0].w = '60'
    w[0].r = '10'
    w[0].done = true

    s.addSet(EX.id)
    const ajoutee = travail(s.draft[EX.id]).at(-1)!
    expect(ajoutee.w).toBe('60')
    expect(ajoutee.r).toBe('10')
    expect(ajoutee.done).toBe(false) // rien n'est fait tant qu'on ne l'a pas cochée
  })

  /**
   * Le cas qui distingue « dernière ligne » de « dernière série faite ».
   *
   * On ajoute une série, on commence à taper, on se ravise et on en ajoute une
   * autre : reprendre la ligne du bas recopierait une saisie abandonnée. On remonte
   * donc à la dernière ligne réellement cochée.
   */
  it('ignore une ligne ajoutée puis laissée en plan', async () => {
    const s = await ouvrir()
    const w = travail(s.draft[EX.id])
    w[0].w = '60'; w[0].r = '10'; w[0].done = true
    w[1].w = '62.5'; w[1].r = '' // commencée, jamais validée

    s.addSet(EX.id)
    const ajoutee = travail(s.draft[EX.id]).at(-1)!
    expect(ajoutee.w).toBe('60')
    expect(ajoutee.r).toBe('10')
  })

  /** Aucune série cochée : on reprend la dernière ligne, qui porte le préremplissage. */
  it('retombe sur la dernière ligne quand rien n’est encore validé', async () => {
    const s = await ouvrir()
    const w = travail(s.draft[EX.id])
    w.at(-1)!.w = '55'
    w.at(-1)!.r = '9'

    s.addSet(EX.id)
    const ajoutee = travail(s.draft[EX.id]).at(-1)!
    expect(ajoutee.w).toBe('55')
    expect(ajoutee.r).toBe('9')
  })

  it('ajoute bien une ligne de travail, pas un échauffement', async () => {
    const s = await ouvrir()
    const avant = travail(s.draft[EX.id]).length
    s.addSet(EX.id)
    expect(travail(s.draft[EX.id])).toHaveLength(avant + 1)
    expect(s.draft[EX.id].at(-1)!.warm).toBe(false)
  })
})
