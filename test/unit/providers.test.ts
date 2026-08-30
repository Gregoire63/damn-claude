import { describe, expect, it } from 'vitest'
import {
  PROVIDERS, availableProviders, fromFitbitSeries, fromFitbitStepSeries, fromFitbitSteps,
  fromFitbitWeight, providerById, unavailableProviders,
} from '../../lib/providers'

// ─────────────────────────────────────────────────────────────────────────────
// Ce qui s'affiche, et ce qui ne doit surtout pas s'afficher.
// ─────────────────────────────────────────────────────────────────────────────
//
// Le vrai risque de cette liste n'est pas de manquer une marque : c'est d'en proposer
// une qui ne marche pas. Un bouton « Connecter Fitbit » qui rend une 503 se lit comme
// une panne — on réessaie, on regarde sa connexion, on cherche pendant dix minutes une
// erreur qui n'existe pas. Ne rien proposer est une réponse ; proposer dans le vide
// n'en est pas une.

const TOUT = ['NUXT_WITHINGS_CLIENT_ID', 'NUXT_WITHINGS_CLIENT_SECRET', 'NUXT_FITBIT_CLIENT_ID', 'NUXT_FITBIT_CLIENT_SECRET']

describe('ce que l’instance propose', () => {
  it('la saisie manuelle est toujours là, sans rien à configurer', () => {
    // C'est le seul fournisseur qui marche partout, et donc le seul qui garantisse
    // qu'une instance fraîchement déployée soit utilisable.
    const sansRien = availableProviders([])
    expect(sansRien.map(p => p.id)).toEqual(['manual'])
    expect(providerById('manual')!.env).toBeNull()
  })

  it('un fournisseur à moitié configuré ne s’affiche pas', () => {
    // L'identifiant sans le secret est le cas le plus fréquent — une variable
    // oubliée dans l'interface Netlify. Il ne doit pas produire un bouton.
    expect(availableProviders(['NUXT_WITHINGS_CLIENT_ID']).map(p => p.id)).toEqual(['manual'])
    expect(availableProviders(['NUXT_WITHINGS_CLIENT_ID', 'NUXT_WITHINGS_CLIENT_SECRET']).map(p => p.id))
      .toEqual(['manual', 'withings'])
  })

  it('tout configuré donne manuel, Withings et Fitbit — jamais Garmin', () => {
    expect(availableProviders(TOUT).map(p => p.id)).toEqual(['manual', 'withings', 'fitbit'])
  })

  /**
   * Garmin est dans la liste alors qu'il ne marche pas. Sans la fiche, la question
   * « et Garmin ? » se reposerait tous les six mois et il faudrait refaire la
   * recherche. Elle est faite, elle est datée, elle est écrite.
   */
  it('Garmin est montré comme bloqué, avec la raison', () => {
    const g = PROVIDERS.find(p => p.id === 'garmin')!
    expect(g.bloque).toBeTruthy()
    const dehors = unavailableProviders(TOUT)
    expect(dehors.map(d => d.provider.id)).toContain('garmin')
    expect(dehors.find(d => d.provider.id === 'garmin')!.raison).toMatch(/pause/i)
  })

  it('les indisponibles disent quoi poser pour les activer', () => {
    const raison = unavailableProviders([]).find(d => d.provider.id === 'withings')!.raison
    expect(raison).toContain('NUXT_WITHINGS_CLIENT_ID')
    expect(raison).toContain('NUXT_WITHINGS_CLIENT_SECRET')
  })

  it('chaque fiche annonce ce qu’elle sait fournir', () => {
    for (const p of PROVIDERS) {
      expect(p.capabilities.length, p.id).toBeGreaterThan(0)
      expect(p.label.trim(), p.id).not.toBe('')
    }
  })
})

describe('conversion des charges utiles Fitbit', () => {
  it('lit une pesée', () => {
    expect(fromFitbitWeight({ date: '2026-08-19', time: '07:12:31', weight: 91.53, fat: 22.4 }))
      .toEqual({ date: '2026-08-19', at: '2026-08-19T07:12', kg: 91.53, fatRatio: 22.4, source: 'fitbit' })
  })

  it('garde deux pesées du même jour distinctes', () => {
    // Sans l'heure dans `at`, la seconde écraserait la première — et c'est
    // précisément le jour où l'on se pèse deux fois qu'on veut les deux.
    const a = fromFitbitWeight({ date: '2026-08-19', time: '07:12:00', weight: 91.5 })!
    const b = fromFitbitWeight({ date: '2026-08-19', time: '19:40:00', weight: 92.1 })!
    expect(a.at).not.toBe(b.at)
  })

  it('traite une masse grasse à zéro comme absente', () => {
    // Une balance sans impédancemètre rend 0, pas `undefined`. Enregistré tel quel,
    // ça donnerait 0 % de masse grasse — un chiffre faux, et pas un champ vide.
    expect(fromFitbitWeight({ date: '2026-08-19', weight: 91.5, fat: 0 })!.fatRatio).toBeUndefined()
  })

  it('refuse ce qui n’est pas une pesée', () => {
    expect(fromFitbitWeight({ date: '19/08/2026', weight: 91.5 } as never)).toBeNull()
    expect(fromFitbitWeight({ date: '2026-08-19', weight: 0 })).toBeNull()
    expect(fromFitbitWeight({ date: '2026-08-19', weight: -3 })).toBeNull()
    expect(fromFitbitWeight(null as never)).toBeNull()
  })

  it('lit les pas, et distingue zéro de rien', () => {
    expect(fromFitbitSteps({ summary: { steps: 8421 } })).toBe(8421)
    // Un jour au lit vaut zéro pas ; une donnée absente ne vaut pas zéro.
    expect(fromFitbitSteps({ summary: { steps: 0 } })).toBe(0)
    expect(fromFitbitSteps({ summary: {} })).toBeNull()
    expect(fromFitbitSteps({})).toBeNull()
  })
})

describe('les séries temporelles Fitbit', () => {
  /**
   * Le piège de ces deux endpoints : `value` est une CHAÎNE, y compris pour les pas.
   * Additionner « 8421 » et « 7300 » donne « 84217300 » sans que rien ne proteste,
   * et on ne s'en aperçoit qu'en voyant un total de pas à sept chiffres.
   */
  it('convertit des chaînes en nombres, pour le poids comme pour les pas', () => {
    expect(fromFitbitSeries([{ dateTime: '2026-08-19', value: '91.5' }]))
      .toEqual([{ date: '2026-08-19', at: '2026-08-19T07:00', kg: 91.5, source: 'fitbit' }])
    expect(fromFitbitStepSeries([{ dateTime: '2026-08-19', value: '8421' }]))
      .toEqual([{ date: '2026-08-19', steps: 8421 }])
  })

  it('écarte les jours sans pesée, que Fitbit rend à zéro', () => {
    // Zéro kilo n'est pas un poids, c'est un trou dans la série. Enregistré tel quel,
    // il tirerait la tendance vers le bas et fausserait le métabolisme de base.
    const s = fromFitbitSeries([
      { dateTime: '2026-08-18', value: '0' },
      { dateTime: '2026-08-19', value: '91.5' },
    ])
    expect(s.map(e => e.date)).toEqual(['2026-08-19'])
  })

  it('garde en revanche un jour à zéro pas', () => {
    // Zéro pas est une vraie journée — au lit, malade. La distinction compte : les
    // pas entrent dans la dépense, donc dans la cible à manger.
    expect(fromFitbitStepSeries([{ dateTime: '2026-08-19', value: '0' }]))
      .toEqual([{ date: '2026-08-19', steps: 0 }])
  })

  it('ignore ce qui n’est pas une date ou pas un nombre', () => {
    expect(fromFitbitSeries([{ dateTime: '19/08/2026', value: '91' } as never])).toEqual([])
    expect(fromFitbitSeries([{ dateTime: '2026-08-19', value: 'n/a' }])).toEqual([])
    expect(fromFitbitStepSeries([{ dateTime: '2026-08-19', value: 'n/a' }])).toEqual([])
    expect(fromFitbitSeries(null as never)).toEqual([])
    expect(fromFitbitStepSeries(undefined as never)).toEqual([])
  })

  it('accepte aussi un nombre, si Fitbit change d’avis', () => {
    expect(fromFitbitSeries([{ dateTime: '2026-08-19', value: 91.5 }])[0].kg).toBe(91.5)
    expect(fromFitbitStepSeries([{ dateTime: '2026-08-19', value: 8421 }])[0].steps).toBe(8421)
  })

  it('la série de poids ne prétend pas connaître la masse grasse', () => {
    // Elle ne la porte pas : c'est le journal de pesées qui la donne, et seulement
    // quand la balance sait la mesurer. Inventer un champ vide serait pire.
    expect(fromFitbitSeries([{ dateTime: '2026-08-19', value: '91.5' }])[0]).not.toHaveProperty('fatRatio')
    expect(fromFitbitWeight({ date: '2026-08-19', weight: 91.5, fat: 22.4 })!.fatRatio).toBe(22.4)
  })
})
