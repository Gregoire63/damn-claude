import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Exercise, Session } from '../../data/sportProgram'

// ─────────────────────────────────────────────────────────────────────────────
// L'alternance vue depuis la séance : ce qui se saisit, et ce qui s'enregistre.
// ─────────────────────────────────────────────────────────────────────────────
//
// `lib/rotation.ts` décide QUI s'affiche ; ce fichier vérifie que le reste de la
// séance suit. C'est là que se logeraient les vraies pannes, et elles seraient
// silencieuses toutes les trois :
//
//  · une ligne de brouillon créée pour le mouvement hors tour — il compterait au
//    dénominateur des 80 %, et une séance faite en entier refuserait de s'enregistrer ;
//  · une entrée à zéro série écrite dans le journal pour ce même mouvement — la
//    progression le verrait « fait, sans charge » et conseillerait une décharge ;
//  · une séance de la semaine dernière rouverte sur l'exercice de CETTE semaine —
//    la saisie faite disparaîtrait de l'écran sans disparaître du journal.

const ex = (id: string, groupe?: string): Exercise => ({
  id, name: id, sets: 3, reps: '10', muscles: [], cues: [], machine: '', ...(groupe ? { groupe } : {}),
})

const SEANCE: Session = {
  id: 's-alt', name: 'Jambes', tag: 'Mardi', color: '#000', sprint: null,
  exercises: [ex('squat'), ex('adducteur', 'adducteurs'), ex('abducteur', 'adducteurs')],
}

/** Un lundi, et le lundi suivant : deux semaines de roulement consécutives. */
const LUNDI = new Date('2026-09-14T10:00:00')
const LUNDI_SUIVANT = new Date('2026-09-21T10:00:00')

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
  vi.useFakeTimers({ toFake: ['Date'] })
})
afterEach(() => { vi.useRealTimers() })

async function ouvrir(quand: Date) {
  vi.setSystemTime(quand)
  const { useJour } = await import('../../composables/useJour')
  useJour().hydrateJour()
  const { useSeance } = await import('../../composables/useSeance')
  const s = useSeance()
  s.startSession(SEANCE)
  return s
}

const ids = (l: readonly { id: string }[]) => l.map(e => e.id)

describe('la séance n’en montre qu’un', () => {
  it('sert l’un cette semaine, l’autre la suivante', async () => {
    const a = ids((await ouvrir(LUNDI)).exercices.value)
    vi.resetModules()
    const b = ids((await ouvrir(LUNDI_SUIVANT)).exercices.value)

    expect(a).toHaveLength(2)
    expect(b).toHaveLength(2)
    expect(a[0]).toBe('squat')
    expect(a[1]).not.toBe(b[1])
  })

  /** Le brouillon ne connaît que la séance du jour : c'est lui que relit le seuil
   *  des 80 % comme l'enregistrement. */
  it('ne prépare aucune ligne pour le mouvement hors tour', async () => {
    const s = await ouvrir(LUNDI)
    const horsTour = SEANCE.exercises.find(e => e.groupe && !ids(s.exercices.value).includes(e.id))!
    expect(s.draft[horsTour.id]).toBeUndefined()
    expect(ids(s.requiredEx.value)).not.toContain(horsTour.id)
  })
})

describe('« fais l’autre à la place »', () => {
  it('échange le mouvement et lui ouvre ses lignes', async () => {
    const s = await ouvrir(LUNDI)
    const duJour = s.exercices.value[1].id
    const autre = s.alternatives(duJour)[0]
    expect(autre).toBeTruthy()

    s.choisirRotation(autre.id)
    expect(ids(s.exercices.value)).toContain(autre.id)
    expect(ids(s.exercices.value)).not.toContain(duJour)
    // Les lignes de saisie sont créées à ce moment-là, pas au démarrage.
    expect(s.draft[autre.id]).toBeTruthy()
    expect(s.openEx.value).toBe(autre.id)
  })

  /** Le remplaçant doit être le seul à partir au journal : l'autre n'a pas été fait. */
  it('n’enregistre que ce qui a été fait', async () => {
    const s = await ouvrir(LUNDI)
    const duJour = s.exercices.value[1].id
    const autre = s.alternatives(duJour)[0]
    s.choisirRotation(autre.id)

    for (const e of s.exercices.value) {
      for (const r of s.draft[e.id]) { r.w = '40'; r.r = '10'; r.done = true }
    }
    expect(s.finishReady.value).toBe(true)
    s.finishSession()

    const { useWorkout } = await import('../../composables/useWorkout')
    const enregistree = useWorkout().sessionLog()[0]
    const dedans = enregistree.entries.map(en => en.exId)
    expect(dedans).toContain(autre.id)
    expect(dedans).not.toContain(duJour)
  })

  /**
   * Et le choix ne DURE pas. Une séance suivante repart du calendrier — sinon le
   * roulement se décalerait sans rien dire, et deux semaines plus tard on ne saurait
   * plus pourquoi c'est toujours le même mouvement qui tombe.
   */
  it('ne survit pas à la séance', async () => {
    const s = await ouvrir(LUNDI)
    const duJour = s.exercices.value[1].id
    s.choisirRotation(s.alternatives(duJour)[0].id)
    s.clearActive()

    s.startSession(SEANCE)
    expect(s.exercices.value[1].id).toBe(duJour)
  })
})

describe('rouvrir une séance déjà enregistrée', () => {
  /**
   * Le cas qui fait perdre de la saisie : on corrige lundi prochain une charge de
   * lundi dernier. Le calendrier dit « abducteur », le journal dit « adducteur » —
   * c'est le journal qui a raison, puisque c'est ce qui a été soulevé.
   */
  it('rouvre le mouvement qui a été fait, pas celui de la semaine en cours', async () => {
    const s = await ouvrir(LUNDI)
    const faitCeJourLa = s.exercices.value[1].id
    for (const e of s.exercices.value) {
      for (const r of s.draft[e.id]) { r.w = '40'; r.r = '10'; r.done = true }
    }
    s.finishSession()

    // Une semaine plus tard : le roulement a tourné.
    vi.setSystemTime(LUNDI_SUIVANT)
    const { useWorkout } = await import('../../composables/useWorkout')
    const rec = useWorkout().sessionLog()[0]
    s.editSession(rec)

    expect(ids(s.exercices.value)).toContain(faitCeJourLa)
    expect(s.draft[faitCeJourLa].some(r => r.done)).toBe(true)
  })
})
