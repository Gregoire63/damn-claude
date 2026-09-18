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
   * La recherche de pesée se rabat sur la plus proche connue quand la date demandée
   * n'en a pas. C'est le bon choix là où elle sert : dans une fiche de séance, un
   * ordre de grandeur vaut mieux qu'un tiret. Ici c'est une faute — on soustrait un
   * poids que ce jour-là n'a jamais vu, et l'écart devient du lest fantôme.
   *
   * Sans pesée du jour même, on ne reconstitue donc RIEN : la ligne repart du poids
   * d'aujourd'hui, champ de lest vide. Symptôme rapporté tel quel : « il marque du
   * lest alors que je n'en mets pas ».
   */
  it('ne devine pas de lest pour une séance sans pesée ce jour-là', async () => {
    // Séance il y a 20 jours ; la première pesée du carnet date d'il y a 5 jours.
    poser([{ date: ilYa(5), kg: 77.5 }, { date: AUJ, kg: 76 }], [{ w: 77, r: 10 }], ilYa(20))
    const s = await charger()
    s.startSession(SEANCE)
    const r = premiereLigne(s)
    // Le total repart du poids du jour, et le champ de lest est VIDE : c'est à lui
    // de dire s'il met une ceinture, pas à l'application de la deviner.
    expect(r.w).toBe('76')
    expect(s.lestOf(r.w)).toBe('')
  })

  /**
   * Et un demi-kilo d'écart entre deux pesées n'est pas une ceinture.
   *
   * Deux séances pesées à un jour d'intervalle suffisent à fabriquer un « +0,3 kg »
   * qu'on croit avoir mis, parce qu'un champ rempli tout seul, on le croit.
   */
  it('ne prend pas le bruit de la balance pour du lest', async () => {
    poser([{ date: ilYa(3), kg: 76.3 }, { date: AUJ, kg: 76 }], [{ w: 76.3, r: 10 }], ilYa(3))
    const s = await charger()
    s.startSession(SEANCE)
    expect(s.lestOf(premiereLigne(s).w)).toBe('')
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

// ─────────────────────────────────────────────────────────────────────────────
// Ce que l'écran doit DIRE du poids employé.
// ─────────────────────────────────────────────────────────────────────────────
//
// « Il ne se base pas forcément sur la pesée du matin » : c'est vrai, et c'est
// assumé — sans pesée aujourd'hui, mieux vaut celle d'avant-hier qu'un champ vide.
// Ce qui ne l'était pas, c'est de le taire : le total affiché sous le champ venait
// d'une pesée dont rien ne donnait la date, et un chiffre sans provenance ne se
// conteste pas.

describe('la provenance du poids', () => {
  it('nomme la date de la pesée quand ce n’est pas celle du jour', async () => {
    poser([{ date: ilYa(3), kg: 76 }], [], AUJ)
    const s = await charger()
    s.startSession(SEANCE)
    expect(s.poidsSource.value).toMatchObject({ kg: 76, memeJour: false })
    expect(s.poidsSource.value!.date).toBe(ilYa(3))
  })

  it('dit « aujourd’hui » quand la pesée est du jour', async () => {
    poser([{ date: ilYa(3), kg: 76.4 }, { date: AUJ, kg: 76 }], [], AUJ)
    // La date du jour n'existe qu'une fois la coque montée : sans elle, la séance
    // n'a pas de date et la pesée ne peut pas être « celle du jour ».
    const { useJour } = await import('../../composables/useJour')
    useJour().hydrateJour()
    const s = await charger()
    s.startSession(SEANCE)
    expect(s.poidsSource.value).toMatchObject({ kg: 76, date: AUJ, memeJour: true })
  })

  /** Le total s'écrit en français : « 91,5 kg » et non « 91.5 kg ». */
  it('affiche le total à la française', async () => {
    poser([{ date: AUJ, kg: 91.5 }], [], AUJ)
    const s = await charger()
    s.startSession(SEANCE)
    expect(s.totalOf('91.5')).toBe('91,5 kg')
  })
})
