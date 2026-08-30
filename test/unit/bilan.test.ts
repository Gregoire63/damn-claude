import { describe, expect, it } from 'vitest'
import { shiftDays, weightNear, weightTrend } from '../../lib/bilan'

// ─────────────────────────────────────────────────────────────────────────────
// La tendance de poids
//
// C'est un chiffre sur lequel on décide de retirer ou d'ajouter des calories. Une
// erreur ici ne fait rien planter : elle produit un conseil confiant et faux, ce
// qui est pire. D'où l'insistance sur les cas où l'on doit rendre `null` plutôt
// qu'un nombre.

const pesees = [
  { date: '2026-07-01', kg: 82.0 },
  { date: '2026-07-15', kg: 81.2 },
  { date: '2026-07-31', kg: 80.4 },
  { date: '2026-08-07', kg: 80.1 },
  { date: '2026-08-14', kg: 79.6 },
]

describe('weightNear', () => {
  it('prend la dernière pesée à cette date ou avant', () => {
    expect(weightNear(pesees, '2026-08-14')).toBe(79.6)
    expect(weightNear(pesees, '2026-08-10')).toBe(80.1)
    expect(weightNear(pesees, '2026-07-31')).toBe(80.4)
  })

  it('rend null AVANT la première pesée, au lieu de se rabattre dessus', () => {
    // Se rabattre sur la première pesée connue fabriquerait un écart qui ne mesure
    // que l'ancienneté du carnet.
    expect(weightNear(pesees, '2026-06-30')).toBeNull()
  })

  it('ignore les entrées mal formées sans tomber', () => {
    const sales = [...pesees, { date: '2026-08-20' }, { kg: 70 }, {}] as never
    expect(weightNear(sales, '2026-08-25')).toBe(79.6)
  })

  it('ne dépend pas de l\'ordre de la liste', () => {
    expect(weightNear([...pesees].reverse(), '2026-08-10')).toBe(80.1)
  })
})

describe('shiftDays', () => {
  it('décale sans se faire piéger par les mois ni les changements d\'heure', () => {
    expect(shiftDays('2026-08-14', -7)).toBe('2026-08-07')
    expect(shiftDays('2026-08-14', -30)).toBe('2026-07-15')
    expect(shiftDays('2026-03-01', -1)).toBe('2026-02-28')
    // Passage à l'heure d'été en France, nuit du 28 au 29 mars 2026.
    expect(shiftDays('2026-03-30', -7)).toBe('2026-03-23')
  })
})

describe('weightTrend', () => {
  it('rend les variations et le rythme sur trente jours', () => {
    const t = weightTrend(pesees, '2026-08-14')
    expect(t.dernier).toEqual({ date: '2026-08-14', kg: 79.6 })
    expect(t.variation_7j).toBe(-0.5) // 79,6 − 80,1
    expect(t.variation_30j).toBe(-1.6) // 79,6 − 81,2 (pesée du 15/07)
    expect(t.rythme).toEqual({ kg_par_semaine: -0.37, sur_jours: 30 })
  })

  it('préfère la fenêtre longue : c\'est elle qui lisse la rétention d\'eau', () => {
    // Une pesée haute la veille suffirait à faire mentir les sept jours.
    const gonfle = [...pesees.slice(0, 4), { date: '2026-08-13', kg: 80.9 }, { date: '2026-08-14', kg: 79.6 }]
    const t = weightTrend(gonfle, '2026-08-14')
    expect(t.rythme?.sur_jours).toBe(30)
  })

  it('se rabat sur sept jours quand trente ne sont pas couverts', () => {
    const court = pesees.slice(3) // 07/08 et 14/08 seulement
    const t = weightTrend(court, '2026-08-14')
    expect(t.variation_30j).toBeNull()
    expect(t.rythme).toEqual({ kg_par_semaine: -0.5, sur_jours: 7 })
  })

  it('ne conclut rien avec une seule pesée', () => {
    // Se comparer à soi-même donnerait 0 — « stable » — alors qu'on ne sait rien.
    const t = weightTrend([{ date: '2026-08-14', kg: 79.6 }], '2026-08-14')
    expect(t.dernier).toEqual({ date: '2026-08-14', kg: 79.6 })
    expect(t.variation_7j).toBeNull()
    expect(t.variation_30j).toBeNull()
    expect(t.rythme).toBeNull()
  })

  it('ne regarde jamais dans le futur', () => {
    // Le miroir peut contenir une pesée postérieure au jour demandé si l'on
    // interroge une date passée ; elle ne doit pas entrer dans le calcul.
    const t = weightTrend(pesees, '2026-07-31')
    expect(t.dernier).toEqual({ date: '2026-07-31', kg: 80.4 })
    expect(t.variation_7j).toBe(-0.8) // 80,4 − 81,2 (15/07)
  })

  it('rend tout à null sur une liste vide', () => {
    expect(weightTrend([], '2026-08-14')).toEqual({
      dernier: null, variation_7j: null, variation_30j: null, rythme: null,
    })
  })
})
