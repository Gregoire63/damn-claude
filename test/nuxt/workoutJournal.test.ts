import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ALL_EXERCISES } from '../../data/sportProgram'

// Ces tests tournent sur le PACK D'EXEMPLE : l'application ne livre plus de données.
// Voir test/exemple.ts pour le pourquoi.
vi.mock('../../data/nutritionProgram', () => (import('../exemple')).then(m => m.catalogueExemple()))
vi.mock('../../data/sportProgram', () => (import('../exemple')).then(m => m.programmeExemple()))

// Le journal des séances : enregistrement, records, suggestion de charge, poids de
// corps, sauvegarde.
//
// Les calculs purs (e1RM, détection de records, prochaine charge) sont testés dans
// test/unit/sportStats.ts. Ici on teste le CÂBLAGE : ce qui se persiste, ce qui se
// relit, et ce qui se dérive des données stockées.
beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

const load = async () => {
  const { useWorkout } = await import('../../composables/useWorkout')
  return useWorkout()
}

/** Un exercice bien réel du programme : les suggestions dépendent de ses réglages. */
const EX = ALL_EXERCISES[0]
const sets = (w: number, r: number, n = 3) => Array.from({ length: n }, () => ({ w, r }))

describe('enregistrement d\'une séance', () => {
  it('range les séries et les rend au journal', async () => {
    const wk = await load()
    wk.recordSession([{ exId: EX.id, sets: sets(60, 8) }], 55, { sessionId: 's1', name: 'Haut du corps' })

    expect(wk.sessionLog()).toHaveLength(1)
    expect(wk.sessionLog()[0].name).toBe('Haut du corps')
    expect(wk.bestCharge(EX.id)).toBe(60)
  })

  it('ignore un exercice sans aucune série', async () => {
    // Un exercice ouvert puis abandonné ne doit pas créer une ligne vide dans
    // l'historique — elle fausserait ensuite le volume et les moyennes.
    const wk = await load()
    wk.recordSession([{ exId: EX.id, sets: [] }], 40, { sessionId: 's1', name: 'Séance vide' })
    expect(wk.bestCharge(EX.id)).toBe(0)
  })

  it('survit à un rechargement', async () => {
    const wk = await load()
    wk.recordSession([{ exId: EX.id, sets: sets(60, 8) }], 55, { sessionId: 's1', name: 'Haut du corps' })
    vi.resetModules()
    const again = await load()
    expect(again.bestCharge(EX.id)).toBe(60)
    expect(again.sessionLog()).toHaveLength(1)
  })

  it('signale un record quand la charge monte, pas quand elle stagne', async () => {
    const wk = await load()
    wk.recordSession([{ exId: EX.id, sets: sets(60, 8) }], 55, { sessionId: 's1', name: 'A' })
    const rien = wk.recordSession([{ exId: EX.id, sets: sets(60, 8) }], 55, { sessionId: 's1', name: 'B' })
    expect(rien.flatMap(p => p.kinds)).not.toContain('charge')

    const pr = wk.recordSession([{ exId: EX.id, sets: sets(70, 8) }], 55, { sessionId: 's1', name: 'C' })
    expect(pr.flatMap(p => p.kinds)).toContain('charge')
    // Le nom affiché est celui de l'exercice, pas son identifiant technique.
    expect(pr[0].name).toBe(EX.name)
  })
})

describe('records dérivés', () => {
  it('rend null tant que l\'exercice n\'a jamais été fait', async () => {
    const wk = await load()
    expect(wk.recordsOf(EX.id)).toBeNull()
  })

  it('retient la charge maximale ET la date où elle a été posée', async () => {
    // Les records sont dérivés des logs, jamais stockés à part : c'est ce qui évite
    // qu'ils se désynchronisent après une correction de séance.
    const wk = await load()
    wk.recordSession([{ exId: EX.id, sets: sets(60, 8) }], 55, { sessionId: 's1', name: 'A' })
    wk.recordSession([{ exId: EX.id, sets: sets(80, 5) }], 55, { sessionId: 's1', name: 'B' })
    const r = wk.recordsOf(EX.id)!
    expect(r.charge).toBe(80)
    expect(r.chargeDate).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('suggestion de charge', () => {
  it('ne suggère rien sans historique', async () => {
    const wk = await load()
    expect(wk.suggestWeight(EX).reason).toBe('none')
    expect(wk.progressionHint(EX)).toBeNull()
  })

  it('propose de monter quand l\'objectif de répétitions est atteint', async () => {
    // Double progression : on monte la charge une fois le haut de la fourchette
    // atteint sur toutes les séries.
    const wk = await load()
    const top = Number.parseInt(String(EX.reps).split('-').at(-1)!, 10)
    wk.recordSession(
      [{ exId: EX.id, sets: sets(60, top, EX.sets), effort: 'facile' }],
      55,
      { sessionId: 's1', name: 'A' },
    )
    const s = wk.suggestWeight(EX)
    expect(s.reason).toBe('progress')
    expect(s.weight).toBeGreaterThan(60)
    expect(wk.progressionHint(EX)).toContain(String(s.weight))
  })
})

describe('poids de corps', () => {
  it('retrouve le poids connu le plus proche, sans jamais regarder l\'avenir', async () => {
    // Sert à retrouver le LEST réellement ajouté sur les tractions et les dips :
    // prendre un poids postérieur à la séance donnerait un record faux.
    const wk = await load()
    wk.setBodyWeightAt('2026-08-01', 93)
    wk.setBodyWeightAt('2026-08-08', 92.6)
    expect(wk.bodyWeightAt('2026-08-05')).toBe(93)
    expect(wk.bodyWeightAt('2026-08-08')).toBe(92.6)
    expect(wk.bodyWeightAt('2026-08-20')).toBe(92.6)
  })

  it('retombe sur la première pesée connue pour une date antérieure à tout', async () => {
    const wk = await load()
    wk.setBodyWeightAt('2026-08-08', 92.6)
    expect(wk.bodyWeightAt('2026-01-01')).toBe(92.6)
  })

  it('remplace le poids du jour au lieu d\'empiler les doublons', async () => {
    const wk = await load()
    wk.setBodyWeightAt('2026-08-08', 92.6)
    wk.setBodyWeightAt('2026-08-08', 92.4)
    expect(wk.bodyWeight.value.filter(e => e.date === '2026-08-08')).toHaveLength(1)
    expect(wk.bodyWeightAt('2026-08-08')).toBe(92.4)
  })

  it('garde la série triée quelle que soit l\'ordre de saisie', async () => {
    // La série est lue par index ailleurs (« la dernière pesée »), donc l'ordre
    // n'est pas cosmétique.
    const wk = await load()
    wk.setBodyWeightAt('2026-08-08', 92.6)
    wk.setBodyWeightAt('2026-08-01', 93)
    const dates = wk.bodyWeight.value.map(e => e.date)
    expect(dates).toEqual([...dates].sort())
  })

  it('refuse un poids absurde plutôt que de polluer la série', async () => {
    const wk = await load()
    wk.setBodyWeightAt('2026-08-08', 0)
    wk.setBodyWeightAt('', 92)
    expect(wk.bodyWeight.value).toHaveLength(0)
  })
})

describe('remise à zéro', () => {
  it('efface tout et ne recharge pas les données de démonstration', async () => {
    const wk = await load()
    wk.recordSession([{ exId: EX.id, sets: sets(60, 8) }], 55, { sessionId: 's1', name: 'A' })
    wk.setBodyWeightAt('2026-08-08', 92.6)
    wk.clearAll()
    expect(wk.sessionLog()).toHaveLength(0)
    expect(wk.bodyWeight.value).toHaveLength(0)
    // Le drapeau « déjà semé » empêche le rechargement automatique de la démo :
    // sans lui, repartir de zéro rendait les fausses séances aussitôt après.
    expect(localStorage.getItem('gr-seeded-v1')).toBe('1')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Commentaire par exercice
//
// La note de séance disait comment allait la journée ; celle-ci dit pourquoi CE
// mouvement-là a bougé. Elle ne sert que si on la retrouve au bon endroit : sur
// l'exercice, la fois suivante — pas au fond d'une séance qu'on ne rouvrira pas.
describe('commentaire par exercice', () => {
  it('se range sur l\'exercice ET dans le journal', async () => {
    const wk = await load()
    wk.recordSession(
      [{ exId: EX.id, sets: sets(60, 8), note: 'Banc occupé, fait à la machine convergente' }],
      55,
      { sessionId: 's1', name: 'Haut du corps', note: 'mal dormi' },
    )
    // Relisible à l'endroit où on recharge la barre…
    expect(wk.lastPerf(EX.id)?.note).toBe('Banc occupé, fait à la machine convergente')
    // …et à l'endroit où on relit la séance.
    expect(wk.sessionLog()[0].entries[0].note).toBe('Banc occupé, fait à la machine convergente')
    // La note de séance reste distincte : deux questions, deux réponses.
    expect(wk.sessionLog()[0].note).toBe('mal dormi')
  })

  it('n\'écrit rien quand le champ est vide ou blanc', async () => {
    // Une clé vide repartirait dans l'export et ferait afficher une pastille de
    // commentaire sur un exercice qui n'en a pas.
    const wk = await load()
    wk.recordSession([{ exId: EX.id, sets: sets(60, 8), note: '   ' }], 55, { sessionId: 's1', name: 'S' })
    expect(wk.lastPerf(EX.id)).not.toHaveProperty('note')
    expect(wk.sessionLog()[0].entries[0]).not.toHaveProperty('note')
  })

  it('survit à un rechargement, et se corrige en modifiant la séance', async () => {
    const wk = await load()
    wk.recordSession([{ exId: EX.id, sets: sets(60, 8), note: 'épaule qui tire' }], 55, { sessionId: 's1', name: 'S' })

    vi.resetModules()
    const again = await load()
    expect(again.lastPerf(EX.id)?.note).toBe('épaule qui tire')

    const rec = again.sessionLog()[0]
    again.updateSession(rec, [{ exId: EX.id, sets: sets(60, 8), note: 'épaule OK finalement' }], 55)
    expect(again.lastPerf(EX.id)?.note).toBe('épaule OK finalement')
    expect(again.sessionLog()[0].entries[0].note).toBe('épaule OK finalement')

    // Effacer la note doit vraiment l'effacer, pas la laisser en place.
    again.updateSession(again.sessionLog()[0], [{ exId: EX.id, sets: sets(60, 8), note: '' }], 55)
    expect(again.lastPerf(EX.id)).not.toHaveProperty('note')
    expect(again.sessionLog()[0].entries[0]).not.toHaveProperty('note')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Changer de machine sans perdre son historique
//
// Avant, cocher « autre matériel » coupait tout : records à zéro, courbe
// interrompue, conseil de charge amnésique. Le câblage à vérifier ici est celui du
// compromis retenu — la COURBE est continue (en équivalent référence), les RECORDS
// restent par machine (un record est un poids qu'on a vraiment soulevé).
describe('variantes de machine', () => {
  const SQUAT = ALL_EXERCISES.find(e => e.id === 'squat')!
  const V = 'squat-vsquat' // coefficient catalogue : ×1,35

  it('retient sur quelle machine la séance a été faite', async () => {
    const wk = await load()
    wk.recordSession([{ exId: 'squat', sets: sets(135, 8), variant: V }], 50, { sessionId: 's3', name: 'Jambes' })
    expect(wk.lastPerf('squat')?.variant).toBe(V)
    expect(wk.sessionLog()[0].entries[0].variant).toBe(V)

    vi.resetModules()
    const again = await load()
    expect(again.lastPerf('squat')?.variant).toBe(V)
  })

  it('ne coupe plus la courbe : la séance sur l\'autre machine y est convertie', async () => {
    const wk = await load()
    wk.recordSession([{ exId: 'squat', sets: sets(100, 8) }], 50, { sessionId: 's3', name: 'Jambes' })
    wk.recordSession([{ exId: 'squat', sets: sets(135, 8), variant: V }], 50, { sessionId: 's3', name: 'Jambes' })

    const d = wk.chartData('squat')
    expect(d).toHaveLength(2)
    // 135 sur la V-Squat ≈ 100 au squat barre : la courbe est plate, elle ne bondit pas.
    expect(d[1].charge).toBe(100)
    // …mais on n'a pas perdu ce qui a vraiment été mis sur la machine.
    expect(d[1].realCharge).toBe(135)
    expect(d[1].variant).toBe(V)
  })

  it('rend le conseil de charge dans les kilos de LA machine choisie', async () => {
    // Sans ça on lirait « passe à 105 kg » devant une V-Squat où l'on met 140.
    const wk = await load()
    wk.recordSession([{ exId: 'squat', sets: sets(100, 8) }], 50, { sessionId: 's3', name: 'Jambes' })

    const ref = wk.suggestWeight(SQUAT)
    const sur = wk.suggestWeight(SQUAT, V)
    expect(ref.reason).toBe('progress')
    expect(sur.weight).toBeGreaterThan(ref.weight)
    expect(sur.weight).toBe(Math.round(ref.weight * 1.35 / 2.5) * 2.5) // arrondi au demi-disque
    expect(sur.ratio).toBe(1.35)
  })

  it('garde les records par machine : aucun record fabriqué par une conversion', async () => {
    const wk = await load()
    wk.recordSession([{ exId: 'squat', sets: sets(100, 8) }], 50, { sessionId: 's3', name: 'Jambes' })
    wk.recordSession([{ exId: 'squat', sets: sets(120, 8), variant: V }], 50, { sessionId: 's3', name: 'Jambes' })

    // Le record de squat barre reste 100 kg : 120 kg sur une autre machine ne le bat pas.
    expect(wk.recordsOf('squat')!.charge).toBe(100)
    // Et la V-Squat a le sien, séparément.
    expect(wk.recordsOf('squat', V)!.charge).toBe(120)
  })

  it('n\'annonce pas un faux record en changeant de machine', async () => {
    const wk = await load()
    wk.recordSession([{ exId: 'squat', sets: sets(90, 8) }], 50, { sessionId: 's3', name: 'Jambes' })
    wk.recordSession([{ exId: 'squat', sets: sets(120, 8), variant: V }], 50, { sessionId: 's3', name: 'Jambes' })

    // 100 kg au squat barre bat bien les 90 kg de squat barre — les 120 kg posés
    // entre-temps sur une autre machine ne comptent pas comme une barre à battre.
    const prsBarre = wk.recordSession([{ exId: 'squat', sets: sets(100, 8) }], 50, { sessionId: 's3', name: 'Jambes' })
    expect(prsBarre.flatMap(p => p.kinds)).toContain('charge')

    // Et 110 kg à la V-Squat ne bat pas les 120 kg déjà faits sur cette machine,
    // même s'ils dépassent tout ce qui a été fait à la barre.
    const prsMachine = wk.recordSession([{ exId: 'squat', sets: sets(110, 8), variant: V }], 50, { sessionId: 's3', name: 'Jambes' })
    expect(prsMachine.flatMap(p => p.kinds)).not.toContain('charge')
  })

  it('remplace le coefficient du catalogue par le rapport réellement mesuré', async () => {
    const wk = await load()
    expect(wk.ratioFor('squat', V).source).toBe('default')

    for (let i = 0; i < 2; i++) {
      wk.recordSession([{ exId: 'squat', sets: sets(100, 8) }], 50, { sessionId: 's3', name: 'Jambes' })
      wk.recordSession([{ exId: 'squat', sets: sets(130, 8), variant: V }], 50, { sessionId: 's3', name: 'Jambes' })
    }
    const r = wk.ratioFor('squat', V)
    expect(r.source).toBe('measured')
    expect(r.ratio).toBe(1.3) // et non le 1,35 du catalogue
    expect(r.sessions).toBe(2)
  })

  it('revient au catalogue quand la mesure est invraisemblable', async () => {
    // Une charge tapée de travers ne doit pas réécrire toute la courbe.
    const wk = await load()
    for (let i = 0; i < 2; i++) {
      wk.recordSession([{ exId: 'squat', sets: sets(100, 8) }], 50, { sessionId: 's3', name: 'Jambes' })
      wk.recordSession([{ exId: 'squat', sets: sets(1000, 8), variant: V }], 50, { sessionId: 's3', name: 'Jambes' })
    }
    expect(wk.ratioFor('squat', V).source).toBe('default')
    expect(wk.ratioFor('squat', V).ratio).toBe(1.35)
  })

  it('sait ce qu\'on a fait sur chaque machine', async () => {
    const wk = await load()
    wk.recordSession([{ exId: 'squat', sets: sets(100, 8) }], 50, { sessionId: 's3', name: 'Jambes' })
    wk.recordSession([{ exId: 'squat', sets: sets(135, 8), variant: V }], 50, { sessionId: 's3', name: 'Jambes' })
    expect(wk.variantsUsed('squat')).toEqual([undefined, V])
    expect(wk.lastOn('squat')!.sets[0].w).toBe(100) // la référence
    expect(wk.lastOn('squat', V)!.sets[0].w).toBe(135) // la machine
  })
})
