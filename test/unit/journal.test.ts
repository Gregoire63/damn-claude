import { describe, expect, it } from 'vitest'
import {
  JOURNAL_JOURS, JOURNAL_MAX, elaguer, libellePoste, lireJournal, noterEchec, oublierEchecs,
} from '../../lib/journal'
import type { Echec } from '../../lib/journal'

const T = (h: number, j = 1) => new Date(Date.UTC(2026, 9, j, h, 0, 0)).toISOString()

describe('journal des échecs', () => {
  it('note un premier échec avec sa date et son compteur', () => {
    const l = noterEchec([], { poste: 'boite', quoi: 'Session requise', http: 401 }, T(18))
    expect(l).toHaveLength(1)
    expect(l[0]).toMatchObject({ poste: 'boite', quoi: 'Session requise', http: 401, fois: 1 })
    expect(l[0].at).toBe(T(18))
    expect(l[0].dernier).toBe(T(18))
  })

  /**
   * Le regroupement est la raison d'être du format : une veille qui échoue toutes
   * les minutes remplissait les cinquante places en une heure et chassait l'erreur
   * unique qu'on cherchait.
   */
  it('regroupe le même échec au lieu d\'empiler des lignes identiques', () => {
    let l = noterEchec([], { poste: 'boite', quoi: 'Failed to fetch' }, T(18))
    l = noterEchec(l, { poste: 'boite', quoi: 'Failed to fetch' }, T(19))
    l = noterEchec(l, { poste: 'boite', quoi: 'Failed to fetch' }, T(20))
    expect(l).toHaveLength(1)
    expect(l[0].fois).toBe(3)
    expect(l[0].at).toBe(T(18)) // le début du silence
    expect(l[0].dernier).toBe(T(20)) // et sa dernière manifestation
  })

  it('ne regroupe pas deux messages différents, ni deux sujets différents', () => {
    let l = noterEchec([], { poste: 'boite', quoi: 'Session requise' }, T(18))
    l = noterEchec(l, { poste: 'boite', quoi: 'Failed to fetch' }, T(18))
    l = noterEchec(l, { poste: 'proposition', quoi: 'Refusée', sujet: 'a1' }, T(18))
    l = noterEchec(l, { poste: 'proposition', quoi: 'Refusée', sujet: 'b2' }, T(18))
    expect(l).toHaveLength(4)
  })

  it('garde au plus cinquante lignes, les plus récemment vues', () => {
    let l: Echec[] = []
    for (let i = 0; i < JOURNAL_MAX + 12; i++) l = noterEchec(l, { poste: 'boite', quoi: `erreur ${i}` }, T(1 + (i % 20)))
    expect(l).toHaveLength(JOURNAL_MAX)
  })

  it('oublie ce qui a plus de quatorze jours', () => {
    const vieux: Echec = { at: T(9, 1), dernier: T(9, 1), poste: 'miroir', quoi: 'vieux', fois: 1 }
    const frais: Echec = { at: T(9, 20), dernier: T(9, 20), poste: 'miroir', quoi: 'frais', fois: 1 }
    const l = elaguer([vieux, frais], T(9, 20))
    expect(l.map(e => e.quoi)).toEqual(['frais'])
  })

  // Une panne ouverte depuis une semaine mais encore active vaut mieux qu'un
  // incident clos d'hier : c'est `dernier` qui classe, pas `at`.
  it('classe sur la dernière occurrence, pas sur la première', () => {
    const ancienMaisActif: Echec = { at: T(9, 15), dernier: T(9, 20), poste: 'boite', quoi: 'actif', fois: 40 }
    const recentMaisClos: Echec = { at: T(9, 19), dernier: T(9, 19), poste: 'miroir', quoi: 'clos', fois: 1 }
    const l = elaguer([ancienMaisActif, recentMaisClos], T(9, 20))
    expect(l.at(-1)!.quoi).toBe('actif')
  })

  it('n\'oublie rien au bord exact des quatorze jours', () => {
    const pile: Echec = { at: T(9, 6), dernier: T(9, 6), poste: 'boite', quoi: 'pile', fois: 1 }
    expect(elaguer([pile], T(9, 6 + JOURNAL_JOURS))).toHaveLength(1)
    expect(elaguer([pile], T(10, 6 + JOURNAL_JOURS))).toHaveLength(0)
  })

  it('oublie sur demande, par poste', () => {
    const l: Echec[] = [
      { at: T(9), dernier: T(9), poste: 'boite', quoi: 'a', fois: 1 },
      { at: T(9), dernier: T(9), poste: 'miroir', quoi: 'b', fois: 1 },
    ]
    expect(oublierEchecs(l, ['boite']).map(e => e.quoi)).toEqual(['b'])
    expect(oublierEchecs(l, ['boite', 'miroir'])).toHaveLength(0)
  })

  it('n\'oublie que ce qui précède la date donnée', () => {
    const l: Echec[] = [
      { at: T(9, 1), dernier: T(9, 1), poste: 'boite', quoi: 'réglé', fois: 1 },
      { at: T(9, 5), dernier: T(9, 5), poste: 'boite', quoi: 'encore là', fois: 1 },
    ]
    expect(oublierEchecs(l, ['boite'], T(9, 3)).map(e => e.quoi)).toEqual(['encore là'])
  })

  // Un journal illisible n'a jamais empêché l'application de démarrer, et ce n'est
  // pas le registre des pannes qui doit en provoquer une.
  it('lit sans jamais lever, même sur du n\'importe quoi', () => {
    expect(lireJournal(null)).toEqual([])
    expect(lireJournal('{}')).toEqual([])
    expect(lireJournal([{ poste: 'boite' }, 42, null])).toEqual([])
    const vieuxFormat = lireJournal([{ at: T(9), poste: 'boite', quoi: 'a' }])
    expect(vieuxFormat[0]).toMatchObject({ dernier: T(9), fois: 1 })
  })

  it('nomme les postes en français, une seule fois pour l\'écran et pour Claude', () => {
    expect(libellePoste('boite')).toContain('boîte')
    expect(libellePoste('miroir')).toContain('coffre')
  })
})
