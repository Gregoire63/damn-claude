import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Exercise, Session } from '../../data/sportProgram'

// ─────────────────────────────────────────────────────────────────────────────
// Le lest des exercices au poids du corps.
// ─────────────────────────────────────────────────────────────────────────────
//
// Le stockage garde le TOTAL — poids de corps + lest — parce que records, courbes et
// conversions de machine raisonnent dessus depuis le premier jour. Le champ, lui,
// demande le LEST : à 77 kg, ajouter dix kilos aux dips se tape « 10 » et non
// « 87 ». La différence entre les deux est le poids de corps, et c'est là que tout
// se joue : dès que ce poids n'est pas le bon, le lest affiché est faux d'autant.
//
// Symptôme vécu : des « −1 kg » sur des dips faits sans ceinture. On corrige en
// tapant 0, et ça revient la séance suivante.
//
// Deux causes distinctes, reproduites séparément ici.

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

const DIPS = {
  id: 'dips', name: 'Dips', sets: 3, reps: '8-12', muscles: ['pectoraux'], cues: [], machine: '', bodyweight: true,
} as unknown as Exercise
const SEANCE: Session = { id: 's1', name: 'Push', tag: 'Lundi', color: '#000', sprint: null, exercises: [DIPS] }

const AUJ = new Date().toISOString().slice(0, 10)
const ilYa = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)

function poser(pesees: { date: string, kg: number }[], sets: { w: number, r: number }[], dateSeance: string) {
  localStorage.setItem('gr-bodyweight-v1', JSON.stringify(pesees))
  localStorage.setItem('gr-workout-logs-v1', JSON.stringify({ dips: [{ date: dateSeance, sets }] }))
}

const charger = async () => (await import('../../composables/useSeance')).useSeance()
const premiereLigne = (s: Awaited<ReturnType<typeof charger>>) => s.draft.dips!.filter(r => !r.warm)[0]!

describe('le lest reconstitué d’une séance à l’autre', () => {
  it('reste vide quand rien n’a été ajouté, même après une perte de poids', async () => {
    // 77 kg il y a dix jours, dips au poids du corps → total enregistré : 77.
    // Aujourd'hui 76 kg : le lest vaut toujours zéro, et le champ doit rester vide.
    poser([{ date: ilYa(10), kg: 77 }, { date: AUJ, kg: 76 }], [{ w: 77, r: 10 }], ilYa(10))
    const s = await charger()
    s.startSession(SEANCE)
    const r = premiereLigne(s)
    expect(s.lestOf(r.w)).toBe('')
    expect(r.w).toBe('76') // le total suit le poids du jour
  })

  it('reporte un vrai lest sans le déformer', async () => {
    poser([{ date: ilYa(10), kg: 77 }, { date: AUJ, kg: 76 }], [{ w: 87, r: 8 }], ilYa(10))
    const s = await charger()
    s.startSession(SEANCE)
    expect(s.lestOf(premiereLigne(s).w)).toBe('10')
  })

  /**
   * PREMIÈRE CAUSE — un poids de corps deviné.
   *
   * `bodyWeightAt` se rabat sur la toute PREMIÈRE pesée du carnet quand la date
   * demandée la précède. C'est le bon choix là où il sert : dans une fiche de séance,
   * un ordre de grandeur vaut mieux qu'un tiret. Ici c'est une faute — on soustrait
   * un poids que ce jour-là n'a jamais vu, et l'écart devient du lest fantôme.
   *
   * Le cas arrive à quiconque a commencé à s'entraîner avant de commencer à se peser.
   */
  it('ne devine pas le poids d’une séance antérieure à la première pesée', async () => {
    // Séance il y a 20 jours ; la première pesée du carnet date d'il y a 5 jours.
    poser([{ date: ilYa(5), kg: 77.5 }, { date: AUJ, kg: 76 }], [{ w: 77, r: 10 }], ilYa(20))
    const s = await charger()
    s.startSession(SEANCE)
    const r = premiereLigne(s)
    // Faute de savoir, on propose la valeur d'origine — visiblement à corriger —
    // plutôt qu'un chiffre calculé sur un poids inventé.
    expect(r.w).toBe('77')
    // Et surtout : pas de « −0,5 » sorti de nulle part.
    expect(s.lestOf(r.w)).not.toBe('-0.5')
  })
})

describe('le poids de référence pendant la séance', () => {
  /**
   * DEUXIÈME CAUSE — le poids de référence qui bouge en cours de route.
   *
   * La balance se synchronise à l'ouverture de l'application, donc souvent APRÈS
   * qu'on a démarré la séance. Le total est figé dans la ligne, le poids du jour
   * change : la différence — le lest affiché — change avec lui. Rien n'a été saisi,
   * rien n'a été enregistré, et l'écran affiche soudain −1 partout.
   */
  it('ne bouge pas quand la pesée du jour arrive en pleine séance', async () => {
    poser([{ date: ilYa(7), kg: 77 }], [{ w: 77, r: 10 }], ilYa(7))
    const s = await charger()
    s.startSession(SEANCE)
    const r = premiereLigne(s)
    expect(s.lestOf(r.w)).toBe('')

    // La balance rend la main : 76 kg ce matin.
    const { useWorkout } = await import('../../composables/useWorkout')
    useWorkout().setBodyWeightAt(AUJ, 76)
    await new Promise(res => setTimeout(res, 20))

    expect(s.lestOf(r.w)).toBe('')
    expect(s.seanceWeight.value).toBe(77)
  })

  /** Et la séance SUIVANTE part bien du nouveau poids : on fige, on ne s'entête pas. */
  it('reprend le poids courant à la séance d’après', async () => {
    poser([{ date: ilYa(7), kg: 77 }], [{ w: 77, r: 10 }], ilYa(7))
    const s = await charger()
    s.startSession(SEANCE)
    const { useWorkout } = await import('../../composables/useWorkout')
    useWorkout().setBodyWeightAt(AUJ, 76)
    s.clearActive()
    await new Promise(res => setTimeout(res, 20))

    s.startSession(SEANCE)
    expect(s.seanceWeight.value).toBe(76)
  })

  /** Un rechargement accidentel ne doit pas déplacer les lests déjà à l'écran. */
  it('survit à un rechargement de la page', async () => {
    poser([{ date: ilYa(7), kg: 77 }], [{ w: 77, r: 10 }], ilYa(7))
    // `restoreDraft` ne rouvre qu'une séance qu'il retrouve dans le programme :
    // `data/` est livré vide, il faut donc que celle-ci y soit vraiment.
    localStorage.setItem('gr-prog-seances-v1', JSON.stringify([SEANCE]))
    const s = await charger()
    s.startSession(SEANCE)
    await new Promise(res => setTimeout(res, 20))

    const { useWorkout } = await import('../../composables/useWorkout')
    useWorkout().setBodyWeightAt(AUJ, 76)
    await new Promise(res => setTimeout(res, 20))

    vi.resetModules()
    const s2 = await charger()
    s2.restoreDraft()
    expect(s2.seanceWeight.value).toBe(77)
    expect(s2.lestOf(premiereLigne(s2).w)).toBe('')
  })
})
