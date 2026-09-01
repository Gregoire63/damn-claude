import { describe, expect, it } from 'vitest'
import {
  IMPEDANCE_CAVEAT, LEAN_LOSS_ALERT, SMOOTH_DAYS,
  SUSPECT_BASE_KG, SUSPECT_MAX_KG,
  carriedComp, composition, dailySeries, flagOutliers, mergeEntries, parseActivity,
  suspectThreshold, suspectsOf, weeklySlope,
} from '../../lib/mesures'
import type { BodyEntry } from '../../lib/mesures'

// ─────────────────────────────────────────────────────────────────────────────
// Le journal des pesées : le même pour toutes les marques.
// ─────────────────────────────────────────────────────────────────────────────
//
// Ces tests portaient le nom de Withings parce que c'est la balance qui les a fait
// écrire. Rien dedans ne la concerne : une pesée saisie à la main, venue de Fitbit
// ou d'une marque pas encore branchée traverse exactement le même chemin — fusion,
// quarantaine, moyenne glissante, composition.

const EPOCH = Date.UTC(2026, 0, 5, 7, 30) / 1000 // lundi 5 janvier 2026, 07 h 30 UTC
const DAY = 86400

describe('mergeEntries', () => {
  const a: BodyEntry = { date: '2026-01-05', at: '2026-01-05T07:30', kg: 94, source: 'withings' }
  const b: BodyEntry = { date: '2026-01-06', at: '2026-01-06T07:20', kg: 93.7, source: 'withings' }

  it('trie et déduplique par horodatage', () => {
    const out = mergeEntries([b, a], [a])
    expect(out.map(e => e.at)).toEqual(['2026-01-05T07:30', '2026-01-06T07:20'])
  })

  it('la nouvelle mesure écrase l\'ancienne — une re-synchro corrige une valeur révisée', () => {
    const out = mergeEntries([a], [{ ...a, kg: 94.4 }])
    expect(out).toHaveLength(1)
    expect(out[0].kg).toBe(94.4)
  })

  it('conserve une saisie manuelle à côté des pesées de la balance', () => {
    const manual: BodyEntry = { date: '2026-01-07', at: '2026-01-07T07:00', kg: 93.5, source: 'manual' }
    expect(mergeEntries([a], [manual])).toHaveLength(2)
  })
})

describe('parseActivity', () => {
  it('garde les jours avec des pas, arrondit et trie', () => {
    const out = parseActivity([
      { date: '2026-01-06', steps: 7412.6 },
      { date: '2026-01-05', steps: 3200 },
      { date: '2026-01-07' }, // pas de champ steps → ignoré
    ])
    expect(out).toEqual([
      { date: '2026-01-05', steps: 3200, distance: undefined, calories: undefined },
      { date: '2026-01-06', steps: 7413, distance: undefined, calories: undefined },
    ])
  })
})

describe('dailySeries', () => {
  const entries = (kgs: number[]): BodyEntry[] =>
    kgs.map((kg, i) => {
      const date = new Date((EPOCH + i * DAY) * 1000).toISOString().slice(0, 10)
      return { date, at: `${date}T07:00`, kg, source: 'withings' as const }
    })

  it('garde une valeur par jour et calcule la moyenne glissante', () => {
    const pts = dailySeries(entries([94, 93.8, 93.9]))
    expect(pts).toHaveLength(3)
    expect(pts[0].avg).toBe(94)
    expect(pts[2].avg).toBeCloseTo((94 + 93.8 + 93.9) / 3, 2)
  })

  it('la fenêtre ne dépasse pas SMOOTH_DAYS jours', () => {
    // Neuf jours à 100 kg puis un à 98,5 : la moyenne ne doit porter que sur 7 points.
    // (Une chute de 10 kg en un jour partirait en quarantaine — voir plus bas.)
    const pts = dailySeries(entries([...Array(9).fill(100), 98.5]))
    expect(pts.at(-1)!.avg).toBeCloseTo((100 * (SMOOTH_DAYS - 1) + 98.5) / SMOOTH_DAYS, 2)
  })

  it('la dernière pesée du jour l\'emporte', () => {
    const pts = dailySeries([
      { date: '2026-01-05', at: '2026-01-05T07:00', kg: 94, source: 'withings' },
      { date: '2026-01-05', at: '2026-01-05T21:00', kg: 95.2, source: 'withings' },
    ])
    expect(pts).toHaveLength(1)
    expect(pts[0].value).toBe(95.2)
  })

  it('ignore les jours où la mesure demandée manque', () => {
    const pts = dailySeries([
      { date: '2026-01-05', at: '2026-01-05T07:00', kg: 94, fatMass: 25, source: 'withings' },
      { date: '2026-01-06', at: '2026-01-06T07:00', kg: 93.8, source: 'withings' },
    ], 'fatMass')
    expect(pts).toHaveLength(1)
  })
})

describe('weeklySlope', () => {
  const series = (kgs: number[]) =>
    dailySeries(kgs.map((kg, i) => {
      const date = new Date((EPOCH + i * DAY) * 1000).toISOString().slice(0, 10)
      return { date, at: `${date}T07:00`, kg, source: 'withings' as const }
    }))

  it('retourne null en dessous de quatre points — une tendance à trois pesées ne veut rien dire', () => {
    expect(weeklySlope(series([94, 93.9, 93.8]))).toBeNull()
  })

  it('mesure une baisse régulière en kg par semaine', () => {
    // −0,1 kg/jour sur 28 jours. On ne régresse que les 14 derniers, quand la
    // moyenne glissante est « chaude » : la pente vaut alors −0,7 kg/semaine.
    const s = weeklySlope(series(Array.from({ length: 28 }, (_, i) => 94 - i * 0.1)))!
    expect(s).toBeCloseTo(-0.7, 2)
  })

  it('sous-estime la pente au tout début de la série, le temps que la moyenne se remplisse', () => {
    // Les 7 premiers jours, la fenêtre est incomplète : la moyenne descend moins
    // vite que le poids réel. C'est attendu — d'où le message « encore quelques
    // pesées » tant qu'il n'y a pas d'historique.
    const s = weeklySlope(series(Array.from({ length: 14 }, (_, i) => 94 - i * 0.1)))!
    expect(s).toBeGreaterThan(-0.7)
    expect(s).toBeLessThan(-0.4)
  })

  it('détecte une reprise de poids', () => {
    expect(weeklySlope(series(Array.from({ length: 14 }, (_, i) => 90 + i * 0.05)))!).toBeGreaterThan(0)
  })

  it('donne zéro sur un poids parfaitement stable', () => {
    expect(weeklySlope(series(Array(14).fill(94)))).toBe(0)
  })
})

describe('composition', () => {
  // 28 jours de pesées : le poids baisse, la répartition gras/maigre est pilotée.
  const build = (fatLost: number, leanLost: number, days = 28): BodyEntry[] =>
    Array.from({ length: days }, (_, i) => {
      const t = i / (days - 1)
      const fat = 25 - fatLost * t
      const lean = 69 - leanLost * t
      const date = new Date((EPOCH + i * DAY) * 1000).toISOString().slice(0, 10)
      return {
        date,
        at: `${date}T07:00`,
        kg: Math.round((fat + lean) * 100) / 100,
        fatMass: Math.round(fat * 100) / 100,
        leanMass: Math.round(lean * 100) / 100,
        source: 'withings' as const,
      }
    })

  it('reste prudent tant qu\'il n\'y a pas assez de mesures de composition', () => {
    const c = composition([
      { date: '2026-01-05', at: '2026-01-05T07:00', kg: 94, source: 'withings' },
      { date: '2026-01-06', at: '2026-01-06T07:00', kg: 93.8, source: 'withings' },
    ])
    expect(c.quality).toBe('unknown')
    expect(c.fatShare).toBeNull()
  })

  it('salue une perte essentiellement grasse', () => {
    const c = composition(build(2.0, 0.1))
    expect(c.fatShare!).toBeGreaterThan(0.9)
    expect(c.quality).toBe('good')
    expect(c.advice).toContain('gras')
  })

  it('alerte quand la masse maigre part avec', () => {
    // Moitié gras, moitié muscle : sous le seuil, donc verdict sévère.
    const c = composition(build(1.0, 1.0))
    expect(c.fatShare!).toBeCloseTo(0.5, 1)
    expect(c.quality).toBe('poor')
    expect(c.advice).toContain('kcal')
  })

  it('marque comme mitigée une perte juste au-dessus du seuil', () => {
    const share = 1 - LEAN_LOSS_ALERT + 0.03 // 68 %
    const c = composition(build(2 * share, 2 * (1 - share)))
    expect(c.quality).toBe('mixed')
  })

  it('ne décompose rien quand le poids ne baisse pas', () => {
    const c = composition(build(-1.0, -0.5)) // prise de poids
    expect(c.fatShare).toBeNull()
    expect(c.quality).toBe('unknown')
  })

  it('rapporte les variations réelles', () => {
    const c = composition(build(2.0, 0.2))
    expect(c.fat!).toBeCloseTo(-2.0, 0)
    expect(c.lean!).toBeCloseTo(-0.2, 0)
    expect(c.kg).toBeLessThan(0)
    expect(c.days).toBe(28)
  })
})

describe('garde-fous', () => {
  it('le rappel sur l\'impédancemétrie parle bien de la tendance', () => {
    expect(IMPEDANCE_CAVEAT).toMatch(/3 à 5 points/)
    expect(IMPEDANCE_CAVEAT).toMatch(/évolution/)
  })
})

describe('quarantaine — balance partagée', () => {
  const at = (i: number) => {
    const date = new Date((EPOCH + i * DAY) * 1000).toISOString().slice(0, 10)
    return { date, at: `${date}T07:00` }
  }
  const run = (kgs: number[], source: 'withings' | 'manual' = 'withings'): BodyEntry[] =>
    kgs.map((kg, i) => ({ ...at(i), kg, source }))

  it('laisse passer une série normale', () => {
    expect(suspectsOf(run([94, 93.8, 94.1, 93.6, 93.9]))).toHaveLength(0)
  })

  it('écarte la pesée de quelqu\'un d\'autre', () => {
    // 68 kg au milieu d'une série à 94 : ce n'est pas la même personne.
    const out = suspectsOf(run([94, 93.8, 94.1, 68.2, 93.9]))
    expect(out).toHaveLength(1)
    expect(out[0].kg).toBe(68.2)
  })

  it('tolère les variations d\'eau et de transit d\'un jour à l\'autre', () => {
    // ±1,8 kg : courant après un repas salé ou un week-end.
    expect(suspectsOf(run([94, 95.8, 93.2, 94.6]))).toHaveLength(0)
  })

  it('ne met pas en doute les deux premières pesées — rien à quoi les comparer', () => {
    expect(suspectsOf(run([94, 68]))).toHaveLength(0)
  })

  it('compare à la MÉDIANE : une intruse ne contamine pas les suivantes', () => {
    // Sans médiane, la référence glisserait vers 68 et les vraies pesées à 94
    // deviendraient suspectes à leur tour.
    const out = suspectsOf(run([94, 93.8, 68.1, 94.2, 93.9, 68.4]))
    expect(out.map(e => e.kg)).toEqual([68.1, 68.4])
  })

  it('ne remet jamais en doute une saisie manuelle', () => {
    const mixed: BodyEntry[] = [
      { ...at(0), kg: 94, source: 'withings' },
      { ...at(1), kg: 93.8, source: 'withings' },
      { ...at(2), kg: 70, source: 'manual' }, // absurde, mais c'est l'utilisateur qui l'a tapé
    ]
    expect(suspectsOf(mixed)).toHaveLength(0)
  })

  it('respecte une confirmation explicite', () => {
    const entries = run([94, 93.8, 94.1, 68.2])
    entries[3].confirmed = true
    expect(suspectsOf(entries)).toHaveLength(0)
  })

  it('élargit la tolérance après une longue absence', () => {
    expect(suspectThreshold(0)).toBe(SUSPECT_BASE_KG)
    expect(suspectThreshold(21)).toBeCloseTo(SUSPECT_BASE_KG + 21 * 0.15, 5)
    expect(suspectThreshold(999)).toBe(SUSPECT_MAX_KG) // plafonné
  })

  it('accepte une vraie perte étalée sur des semaines sans pesée', () => {
    const entries: BodyEntry[] = [
      { ...at(0), kg: 94, source: 'withings' },
      { ...at(1), kg: 93.8, source: 'withings' },
      { ...at(2), kg: 94.1, source: 'withings' },
      { ...at(40), kg: 89.5, source: 'withings' }, // 38 jours plus tard, −4,5 kg
    ]
    expect(suspectsOf(entries)).toHaveLength(0)
  })

  it('flagOutliers renvoie toutes les pesées, marquées — rien n\'est supprimé', () => {
    const out = flagOutliers(run([94, 93.8, 94.1, 68.2]))
    expect(out).toHaveLength(4)
    expect(out.filter(e => e.suspect)).toHaveLength(1)
  })
})

describe('les statistiques ignorent les pesées écartées', () => {
  const mk = (kgs: number[]): BodyEntry[] => kgs.map((kg, i) => {
    const date = new Date((EPOCH + i * DAY) * 1000).toISOString().slice(0, 10)
    return { date, at: `${date}T07:00`, kg, source: 'withings' as const }
  })

  it('la moyenne glissante n\'est pas tirée vers le bas par une intruse', () => {
    const propre = dailySeries(mk([94, 93.8, 94.1, 93.9]))
    const pollue = dailySeries(mk([94, 93.8, 94.1, 68.2, 93.9]))
    // La journée de l'intruse disparaît complètement de la série.
    expect(pollue).toHaveLength(4)
    expect(pollue.at(-1)!.avg).toBeCloseTo(propre.at(-1)!.avg!, 2)
  })

  it('la pente reste juste malgré une intruse', () => {
    const kgs = Array.from({ length: 28 }, (_, i) => 94 - i * 0.1)
    const propre = weeklySlope(dailySeries(mk(kgs)))!
    const sale = [...kgs]
    sale[20] = 68.5
    // La journée est retirée, donc la régression perd un point : l'écart résiduel
    // est de l'ordre de 0,02 kg/semaine, sans commune mesure avec le dégât brut.
    expect(weeklySlope(dailySeries(mk(sale)))!).toBeCloseTo(propre, 1)
  })

  it('sans le filtre, la même intruse rendrait la pente ininterprétable', () => {
    const kgs = Array.from({ length: 28 }, (_, i) => 94 - i * 0.1)
    const sale = [...kgs]
    sale[20] = 68.5
    const entries = mk(sale)
    // Confirmer la pesée lève la quarantaine : c'est exactement l'état « non filtré ».
    entries[20].confirmed = true
    const fausse = weeklySlope(dailySeries(entries))!
    expect(Math.abs(fausse - -0.7)).toBeGreaterThan(1) // des kilos par semaine d'erreur
  })
})

describe('carriedComp — le taux de masse grasse survit à une pesée sans impédance', () => {
  const e = (date: string, kg: number, fatRatio?: number): BodyEntry => ({
    date,
    at: `${date}T07:00`,
    kg,
    source: 'manual',
    ...(fatRatio === undefined
      ? {}
      : {
          fatRatio,
          fatMass: Math.round(kg * fatRatio) / 100,
          leanMass: Math.round((kg - Math.round(kg * fatRatio) / 100) * 100) / 100,
        }),
  })

  it('prend tout de la dernière pesée quand elle mesure la composition', () => {
    const c = carriedComp([e('2026-08-01', 93.4, 26.8), e('2026-08-08', 92.6, 26.5)])!
    expect(c.carried).toBe(false)
    expect(c.kg).toBe(92.6)
    expect(c.fatRatio).toBe(26.5)
    expect(c.measuredOn).toBe('2026-08-08')
  })

  it('reporte le dernier taux connu sur le poids du jour', () => {
    // Le cas qui compte : balance d'hôtel, pèse-personne d'un ami, pesée notée à la
    // main. Sans report, la cible protéique bondirait d'une vingtaine de grammes du
    // jour au lendemain pour un corps qui n'a pas bougé.
    const c = carriedComp([e('2026-08-08', 92.6, 26.5), e('2026-08-10', 92.1)])!
    expect(c.carried).toBe(true)
    expect(c.kg).toBe(92.1) // le poids d'aujourd'hui
    expect(c.fatRatio).toBe(26.5) // le taux d'avant-hier
    expect(c.measuredOn).toBe('2026-08-08')
  })

  it('ne recopie JAMAIS la masse grasse ni la masse maigre en kilos lors d\'un report', () => {
    // Elles appartiennent à la pesée qui les a mesurées. Les transporter telles quelles
    // sur un autre poids fabriquerait une composition qui n'a jamais existé ; elles se
    // recalculent depuis le taux et le poids du jour.
    const c = carriedComp([e('2026-08-08', 92.6, 26.5), e('2026-08-10', 88)])!
    expect(c.fatMass).toBeUndefined()
    expect(c.leanMass).toBeUndefined()
  })

  it('cesse de reporter une mesure trop vieille', () => {
    const c = carriedComp([e('2026-01-05', 99, 31), e('2026-08-10', 92.1)])!
    expect(c.carried).toBe(false)
    expect(c.fatRatio).toBeUndefined()
    expect(c.measuredOn).toBeNull()
    expect(c.kg).toBe(92.1) // le poids reste utilisable, lui
  })

  it('respecte la limite d\'âge au jour près', () => {
    const vieux = carriedComp([e('2026-06-11', 95, 28), e('2026-08-10', 92.1)])! // 60 jours
    expect(vieux.carried).toBe(true)
    const trop = carriedComp([e('2026-06-10', 95, 28), e('2026-08-10', 92.1)])! // 61 jours
    expect(trop.carried).toBe(false)
  })

  it('écarte les taux impossibles au lieu de les reporter', () => {
    const c = carriedComp([e('2026-08-08', 92.6, 1), e('2026-08-10', 92.1)])!
    expect(c.measuredOn).toBeNull()
    expect(c.fatRatio).toBeUndefined()
  })

  it('rend null sans aucune pesée', () => {
    expect(carriedComp([])).toBeNull()
  })
})
