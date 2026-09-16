import { describe, expect, it } from 'vitest'
import {
  MINUTES_MAX, TYPES_ACTIVITE, activitesDe, bornerMinutes, estimerKcal,
  ficheActivite, fmtDureeActivite, kcalActivites, nomActivite, normaliserActivite,
} from '../../lib/activites'
import { dayEnergy } from '../../lib/nutritionStats'

// ─────────────────────────────────────────────────────────────────────────────
// Le sport qui n'est pas une séance.
// ─────────────────────────────────────────────────────────────────────────────
//
// L'application ne connaissait que deux dépenses : les pas et la séance de
// musculation. Un foot du samedi n'existait nulle part — la journée s'affichait donc
// à sa cible de repos, plusieurs centaines de calories en dessous de ce qui avait
// vraiment été brûlé, et le déficit de la semaine devenait illisible.

const foot = {
  id: 'a1', type: 'foot' as const, nom: '', date: '2026-09-12',
  heure: '18:30', minutes: 90, kcal: 620, estime: true,
}

describe('l’estimation d’une dépense', () => {
  /**
   * LA règle, et c'est celle des séances : on soustrait ce que le repos aurait coûté
   * pendant le même temps. La dépense de base de la journée (`baseKcal`) compte déjà
   * ces heures-là — ajouter le coût BRUT compterait deux fois la même heure.
   */
  it('est NETTE : le métabolisme de repos est déduit', () => {
    // 80 kg, BMR 1800, une heure de foot à 7 MET.
    // Brut : 7 × 80 × 1 = 560. Au repos pendant 60 min : 1800/1440 × 60 = 75.
    expect(estimerKcal('foot', 60, 80, 1800)).toBe(560 - 75)
  })

  it('suit la durée et l’intensité', () => {
    const uneHeure = estimerKcal('course', 60, 80, 1800)!
    expect(estimerKcal('course', 120, 80, 1800)).toBe(uneHeure * 2)
    // La course coûte plus que la marche, à durée égale.
    expect(estimerKcal('course', 60, 80, 1800)!).toBeGreaterThan(estimerKcal('marche', 60, 80, 1800)!)
  })

  /**
   * Sans poids ni profil, on ne rend PAS un nombre calculé sur un corps inventé :
   * l'écran demande alors le chiffre, ce qui est la seule réponse honnête.
   */
  it('rend null plutôt qu’un chiffre inventé', () => {
    expect(estimerKcal('foot', 90, null, 1800)).toBe(null)
    expect(estimerKcal('foot', 90, 80, null)).toBe(null)
    expect(estimerKcal('foot', 0, 80, 1800)).toBe(null)
  })

  /** Une activité très douce ne doit jamais rendre une dépense NÉGATIVE. */
  it('ne descend pas sous zéro', () => {
    // 3 MET pendant 10 min sur un métabolisme énorme : le repos dépasse le brut.
    expect(estimerKcal('marche', 10, 50, 9000)).toBe(0)
  })

  it('retombe sur « autre » pour un type inconnu', () => {
    expect(ficheActivite('parapente').id).toBe('autre')
    expect(ficheActivite(undefined).met).toBeGreaterThan(0)
  })

  /**
   * La musculation n'est PAS dans la liste, et c'est délibéré : elle a déjà sa
   * dépense, calculée sur ce qui a vraiment été fait. L'y ajouter donnerait deux
   * dépenses pour la même heure.
   */
  it('n’offre pas la musculation', () => {
    expect(TYPES_ACTIVITE.map(t => t.id)).not.toContain('muscu')
    expect(TYPES_ACTIVITE.every(t => t.met > 0)).toBe(true)
  })
})

describe('relire une activité venue d’ailleurs', () => {
  it('exige une date : sans elle, elle ne pèse sur aucune journée', () => {
    expect(normaliserActivite({ minutes: 60, kcal: 300 })).toBe(null)
    expect(normaliserActivite({ date: '12/09/2026' })).toBe(null)
    expect(normaliserActivite('nawak')).toBe(null)
  })

  /** Une heure illisible est un détail de TRI, pas une donnée de calcul : elle ne
   *  doit pas faire perdre l'activité. */
  it('remplace une heure illisible plutôt que de jeter l’activité', () => {
    const a = normaliserActivite({ date: '2026-09-12', heure: '25:99', minutes: 60, kcal: 300 })!
    expect(a.heure).toBe('12:00')
    expect(a.kcal).toBe(300)
  })

  it('borne la durée et les calories', () => {
    const a = normaliserActivite({ date: '2026-09-12', minutes: 99999, kcal: -50 })!
    expect(a.minutes).toBe(MINUTES_MAX)
    expect(a.kcal).toBe(0)
    expect(bornerMinutes('nawak')).toBe(30)
  })

  it('range un type inconnu dans « autre » sans rien perdre', () => {
    const a = normaliserActivite({ date: '2026-09-12', type: 'parapente', nom: 'Vol libre', minutes: 40, kcal: 200 })!
    expect(a.type).toBe('autre')
    expect(nomActivite(a)).toBe('Vol libre')
  })

  it('retombe sur le libellé du type quand le nom est vide', () => {
    expect(nomActivite(foot)).toBe('Football')
  })
})

describe('la journée', () => {
  const liste = [
    foot,
    { ...foot, id: 'a2', heure: '08:00', type: 'course' as const, kcal: 400 },
    { ...foot, id: 'a3', date: '2026-09-11', kcal: 999 },
  ]

  it('ne retient que le bon jour, dans l’ordre où ça s’est passé', () => {
    expect(activitesDe(liste, '2026-09-12').map(a => a.id)).toEqual(['a2', 'a1'])
  })

  it('additionne les dépenses de la journée', () => {
    expect(kcalActivites(liste, '2026-09-12')).toBe(1020)
    expect(kcalActivites(liste, '2026-01-01')).toBe(0)
  })

  it('écrit les durées comme on les dit', () => {
    expect(fmtDureeActivite(45)).toBe('45 min')
    expect(fmtDureeActivite(90)).toBe('1 h 30')
    expect(fmtDureeActivite(120)).toBe('2 h')
  })
})

describe('la dépense du jour', () => {
  const base = { bmr: 1800, kg: 80, tt: false, steps: 7500, sessionKcal: 0 }

  it('compte les activités dans le besoin, donc dans la cible', () => {
    const sans = dayEnergy(base)
    const avec = dayEnergy({ ...base, activitesKcal: 500 })
    expect(avec.activitesKcal).toBe(500)
    expect(avec.need).toBe(sans.need + 500)
    expect(avec.target).toBeGreaterThan(sans.target)
  })

  /**
   * Un poste À PART de la séance. Les deux ne se calculent pas pareil — la séance
   * sur ce qui a vraiment été fait, l'activité sur une durée — et surtout la séance
   * porte une règle à elle : forfait tant que la journée n'est pas finie, zéro
   * ensuite. Une activité est toujours du réel. Les fondre ferait hériter l'une de
   * la règle de l'autre.
   */
  it('les garde séparées de la séance', () => {
    const e = dayEnergy({ ...base, sessionKcal: 440, activitesKcal: 300 })
    expect(e.sessionKcal).toBe(440)
    expect(e.activitesKcal).toBe(300)
    expect(e.need).toBe(e.baseKcal + e.stepsKcal + 440 + 300)
  })

  it('vaut zéro quand rien n’est dit, sans rien changer d’autre', () => {
    expect(dayEnergy(base).activitesKcal).toBe(0)
    expect(dayEnergy({ ...base, activitesKcal: -50 }).activitesKcal).toBe(0)
  })
})
