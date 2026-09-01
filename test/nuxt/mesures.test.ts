import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Le journal des mesures : ce qui décide du contenu de l'assiette.
// ─────────────────────────────────────────────────────────────────────────────
//
// Ce fichier existe parce que ce composable pilote DEUX chiffres qui décident de ce
// qu'on mange : la cible calorique (via les pas) et la cible protéique (via la masse
// maigre). Les calculs purs sont testés dans test/unit/mesures.test.ts ; ici on teste
// les fils — persistance, report de composition, miroir vers le journal des séances.
//
// L'état vit au niveau du module : on réimporte à neuf à chaque test.
beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

const load = async () => {
  const { useMesures } = await import('../../composables/useMesures')
  const m = useMesures()
  m.hydrate()
  return m
}

const TODAY = '2026-08-10'

describe('saisie manuelle et composition', () => {
  it('une pesée sans impédance reste une pesée utile', async () => {
    const m = await load()
    m.addManual(92.6, TODAY)
    expect(m.entries.value).toHaveLength(1)
    expect(m.entries.value[0].kg).toBe(92.6)
    expect(m.entries.value[0].fatRatio).toBeUndefined()
    expect(m.entries.value[0].leanMass).toBeUndefined()
  })

  it('déduit masse grasse et masse maigre du seul pourcentage', async () => {
    // Trois champs à remplir pour une seule information, ce serait deux de trop.
    const m = await load()
    m.addManual(92.6, TODAY, undefined, 26.5)
    const e = m.entries.value[0]
    expect(e.fatRatio).toBe(26.5)
    expect(e.fatMass).toBeCloseTo(24.54, 1)
    expect(e.leanMass).toBeCloseTo(68.06, 1)
    // Les deux doivent se recomposer en le poids : sinon on affiche une contradiction.
    expect(e.fatMass! + e.leanMass!).toBeCloseTo(92.6, 1)
  })

  it('refuse un taux de masse grasse impossible plutôt que de le stocker', async () => {
    const m = await load()
    m.addManual(92.6, TODAY, undefined, 1)
    expect(m.entries.value[0].fatRatio).toBeUndefined()
    m.addManual(90, '2026-08-11', undefined, 95)
    expect(m.entries.value.at(-1)!.fatRatio).toBeUndefined()
  })

  it('survit à un rechargement', async () => {
    const m = await load()
    m.addManual(92.6, TODAY, undefined, 26.5)
    vi.resetModules()
    const encore = await load()
    expect(encore.entries.value).toHaveLength(1)
    expect(encore.entries.value[0].fatRatio).toBe(26.5)
  })
})

describe('bodyComp — ce qui nourrit la cible protéique', () => {
  it('prend tout de la dernière pesée quand elle mesure la composition', async () => {
    const m = await load()
    m.addManual(93.4, '2026-08-01', undefined, 26.8)
    m.addManual(92.6, TODAY, undefined, 26.5)
    expect(m.bodyComp.value).toMatchObject({ kg: 92.6, fatRatio: 26.5, carried: false })
  })

  it('reporte le dernier taux connu quand la dernière pesée n\'a pas d\'impédance', async () => {
    // LE cas de régression : sans report, la cible protéique bondirait d'une
    // vingtaine de grammes du jour au lendemain pour un corps qui n'a pas bougé.
    const m = await load()
    m.addManual(92.6, '2026-08-08', undefined, 26.5)
    m.addManual(92.1, TODAY)
    const c = m.bodyComp.value!
    expect(c.kg).toBe(92.1) // le poids d'aujourd'hui
    expect(c.fatRatio).toBe(26.5) // le taux d'avant-hier
    expect(c.carried).toBe(true)
    // Et surtout : pas de kilos recopiés, ils appartiennent à l'autre pesée.
    expect(c.fatMass).toBeUndefined()
    expect(c.leanMass).toBeUndefined()
  })

  it('rend un poids exploitable même sans aucune mesure de composition', async () => {
    const m = await load()
    m.addManual(92.6, TODAY)
    expect(m.bodyComp.value).toMatchObject({ kg: 92.6, measuredOn: null, carried: false })
  })

  it('rend null tant qu\'on ne s\'est jamais pesé', async () => {
    expect((await load()).bodyComp.value).toBeNull()
  })
})

describe('miroir vers le journal des séances', () => {
  it('recopie le poids là où le métabolisme de base va le chercher', async () => {
    const m = await load()
    m.addManual(92.6, TODAY, undefined, 26.5)
    const { useWorkout } = await import('../../composables/useWorkout')
    expect(useWorkout().bodyWeight.value.some(e => e.date === TODAY && e.kg === 92.6)).toBe(true)
  })
})

describe('un relevé, d\'où qu\'il vienne', () => {
  /**
   * `absorber` est le SEUL chemin d'écriture des marques. C'est ce qui garantit qu'une
   * deuxième source n'ouvre pas son propre historique à côté — deux séries du même
   * poids, et la courbe prendrait l'une pendant que le métabolisme de base prend
   * l'autre, avec un écart qu'on découvre des semaines plus tard.
   */
  it('verse les pesées dans le même journal, quelle que soit la source', async () => {
    const m = await load()
    m.addManual(92.6, '2026-08-08')
    m.absorber({
      pesees: [{ date: '2026-08-09', at: '2026-08-09T07:00', kg: 92.2, source: 'fitbit' }],
      pas: [],
    }, TODAY)
    expect(m.entries.value.map(e => e.source)).toEqual(['manual', 'fitbit'])
  })

  it('écrit les pas d\'un jour passé tels quels', async () => {
    const m = await load()
    m.absorber({ pesees: [], pas: [{ date: '2026-08-09', steps: 4200 }] }, TODAY)
    const { useNutrition } = await import('../../composables/useNutrition')
    const n = useNutrition()
    n.hydrate()
    expect(n.stepsFor('2026-08-09')).toBe(4200)
  })

  it('ne révise le jour EN COURS que vers le haut', async () => {
    // Le compteur du matin est partiel : à 9 h il affiche 800 pas. L'écrire ferait
    // tomber la cible sous l'estimation, et l'app conseillerait de moins manger au
    // petit-déjeuner parce qu'on n'a pas encore marché.
    const m = await load()
    m.absorber({ pesees: [], pas: [{ date: TODAY, steps: 800 }] }, TODAY)
    const { useNutrition } = await import('../../composables/useNutrition')
    const n = useNutrition()
    n.hydrate()
    expect(n.stepsFor(TODAY)).toBeNull()
  })

  it('écrit le jour en cours dès que le réel dépasse l\'estimation', async () => {
    const m = await load()
    m.absorber({ pesees: [], pas: [{ date: TODAY, steps: 12_000 }] }, TODAY)
    const { useNutrition } = await import('../../composables/useNutrition')
    const n = useNutrition()
    n.hydrate()
    expect(n.stepsFor(TODAY)).toBe(12_000)
  })

  it('ignore une journée à zéro pas plutôt que de la croire', async () => {
    const m = await load()
    m.absorber({ pesees: [], pas: [{ date: '2026-08-09', steps: 0 }] }, TODAY)
    const { useNutrition } = await import('../../composables/useNutrition')
    const n = useNutrition()
    n.hydrate()
    expect(n.stepsFor('2026-08-09')).toBeNull()
  })
})

describe('sauvegarde', () => {
  it('exporte et restaure les pesées, composition comprise', async () => {
    const m = await load()
    m.addManual(92.6, TODAY, undefined, 26.5)
    const snap = m.snapshot()

    localStorage.clear()
    vi.resetModules()
    const neuf = await load()
    expect(neuf.entries.value).toHaveLength(0)
    neuf.restore(snap as Record<string, unknown>)
    expect(neuf.entries.value).toHaveLength(1)
    expect(neuf.bodyComp.value).toMatchObject({ kg: 92.6, fatRatio: 26.5 })
  })

  it('garde la clé historique « withingsBody », qui est dans tous les exports déjà faits', async () => {
    // Renommer pour faire joli rendrait illisibles des sauvegardes qu'on ne peut pas
    // reconstituer. Un nom de champ ne vaut pas ça.
    const m = await load()
    m.addManual(92.6, TODAY)
    expect(Object.keys(m.snapshot())).toEqual(['withingsBody'])
    expect(JSON.stringify(m.snapshot())).not.toContain('access')
  })
})

describe('quarantaine', () => {
  it('ne reporte jamais le taux de quelqu\'un d\'autre', async () => {
    // Balance partagée. Quelqu'un se pèse au milieu de la série : 64 kg et 18 % de
    // masse grasse. Deux jours plus tard, Grégoire se pèse sur un pèse-personne sans
    // impédance. Si le report allait chercher la mesure la plus récente sans filtrer
    // la quarantaine, il repartirait sur les 18 % — et la cible protéique serait
    // calculée sur le corps d'un autre.
    // Les pesées doivent venir d'une BALANCE : une saisie manuelle est réputée venir
    // de l'utilisateur, donc jamais mise en quarantaine.
    const m = await load()
    m.restore({
      withingsBody: [
        ...[1, 2, 3, 4, 5].map(d => ({
          date: `2026-08-0${d}`, at: `2026-08-0${d}T07:00`, kg: 92.5, fatRatio: 26.5, source: 'withings',
        })),
        { date: '2026-08-06', at: '2026-08-06T07:00', kg: 64, fatRatio: 18, source: 'withings' },
        { date: '2026-08-07', at: '2026-08-07T07:00', kg: 92.4, source: 'withings' },
      ],
    })
    expect(m.suspects.value.map(e => e.kg)).toContain(64)
    const c = m.bodyComp.value!
    expect(c.kg).toBe(92.4)
    expect(c.fatRatio).toBe(26.5)
    expect(c.carried).toBe(true)
  })
})
