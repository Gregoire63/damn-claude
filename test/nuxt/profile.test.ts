import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PLAN } from '../../composables/useProfile'
import { poserSemaineExemple } from '../exemple'

// Ces tests tournent sur le PACK D'EXEMPLE : l'application ne livre plus de données.
// Voir test/exemple.ts pour le pourquoi.
vi.mock('../../data/nutritionProgram', () => (import('../exemple')).then(m => m.catalogueExemple()))
vi.mock('../../data/sportProgram', () => (import('../exemple')).then(m => m.programmeExemple()))

// Profil et planning hebdomadaire.
//
// Petit module, mais il alimente le métabolisme de base : une taille ou une année de
// naissance mal validée et TOUTE la cible calorique part de travers, sans qu'aucune
// erreur ne s'affiche.
beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

const load = async () => {
  const { useProfile } = await import('../../composables/useProfile')
  const p = useProfile()
  p.hydrate()
  return p
}

describe('profil', () => {
  it('retient prénom, taille, sexe et année de naissance', async () => {
    const p = await load()
    p.setPrenom('  Grégoire  ')
    p.setHeight(179)
    p.setSex('h')
    p.setBirthYear(1997)
    // Le prénom vit ICI et pas seulement à côté du passkey : le parcours d'installation
    // le demande AVANT d'en poser un, quand le coffre n'existe pas encore.
    expect(p.profile.value).toEqual({ prenom: 'Grégoire', heightCm: 179, sex: 'h', birthYear: 1997 })

    vi.resetModules()
    const again = await load()
    expect(again.profile.value.heightCm).toBe(179)
    expect(again.profile.value.prenom).toBe('Grégoire')
  })

  it('refuse les valeurs impossibles en les ramenant à « inconnu »', async () => {
    // `null` est un état utile : il fait afficher « renseigne ton profil » au lieu de
    // calculer une cible sur une taille de 0 cm.
    const p = await load()
    p.setHeight(0)
    expect(p.profile.value.heightCm).toBeNull()
    p.setHeight(-5)
    expect(p.profile.value.heightCm).toBeNull()
    p.setBirthYear(1800)
    expect(p.profile.value.birthYear).toBeNull()
  })
})

describe('planning hebdomadaire', () => {
  it('part du planning livré et le garde stable', async () => {
    // L'ancien planning « adaptatif » se réécrivait à chaque séance et finissait par
    // dériver. Il ne bouge plus qu'à la main.
    const p = await load()
    expect(p.weekPlan.value).toEqual(DEFAULT_PLAN)
  })

  it('change un jour sans toucher aux autres', async () => {
    const p = await load()
    p.setDay(2, 's3')
    expect(p.weekPlan.value[2]).toBe('s3')
    expect(p.weekPlan.value[0]).toBe(DEFAULT_PLAN[0])
    expect(p.weekPlan.value).toHaveLength(7)
  })

  it('accepte un jour de repos', async () => {
    const p = await load()
    p.setDay(0, null)
    expect(p.weekPlan.value[0]).toBeNull()
  })

  it('se remet au planning livré sur demande', async () => {
    const p = await load()
    p.setDay(2, 's3')
    p.resetPlan()
    expect(p.weekPlan.value).toEqual(DEFAULT_PLAN)
  })

  it('survit à un rechargement une fois la migration passée', async () => {
    const p = await load()
    p.setDay(2, 's3')
    vi.resetModules()
    const again = await load()
    expect(again.weekPlan.value[2]).toBe('s3')
  })
})

describe('restauration depuis une sauvegarde', () => {
  it('reprend profil et planning', async () => {
    const p = await load()
    p.restore({ profile: { heightCm: 179, sex: 'h', birthYear: 1997 }, weekPlan: ['s1', null, null, null, null, null, null] })
    expect(p.profile.value.heightCm).toBe(179)
    expect(p.weekPlan.value[0]).toBe('s1')
  })

  it('rejette un planning de mauvaise longueur au lieu de le charger à moitié', async () => {
    // Un planning à 5 entrées ferait planter la lecture par index ailleurs, et le
    // symptôme apparaîtrait très loin d'ici.
    const p = await load()
    p.restore({ weekPlan: ['s1', 's2'] })
    expect(p.weekPlan.value).toHaveLength(7)
    expect(p.weekPlan.value).toEqual(DEFAULT_PLAN)
  })

  it('une sauvegarde vide ou partielle passe sans erreur', async () => {
    const p = await load()
    expect(() => p.restore({})).not.toThrow()
    expect(() => p.restore({ profile: { heightCm: 179 } })).not.toThrow()
    expect(p.profile.value.heightCm).toBe(179)
    // Les champs absents ne sont pas écrasés par `undefined`.
    expect(p.weekPlan.value).toEqual(DEFAULT_PLAN)
  })
})

describe('exceptions de planning par date', () => {
  // Une exception se pose PAR RAPPORT à une semaine type : sans séance dedans, il
  // n'y a rien à déplacer et ces tests ne diraient rien. On pose donc la semaine
  // d'exemple, comme le ferait quelqu'un qui a rempli son programme.
  beforeEach(poserSemaineExemple)

  it('n\'écrase pas la semaine type et se retire proprement', async () => {
    const p = await load()
    // 2026-08-14 est un vendredi : « s4 » dans la semaine type.
    expect(p.sessionIdFor('2026-08-14')).toBe('s4')

    p.setDayPlan('2026-08-14', null)
    expect(p.sessionIdFor('2026-08-14')).toBeNull()
    expect(p.isPlanMoved('2026-08-14')).toBe(true)
    // La semaine type, elle, n'a pas bougé — le vendredi suivant reste prévu.
    expect(p.weekPlan.value[4]).toBe('s4')
    expect(p.sessionIdFor('2026-08-21')).toBe('s4')

    p.clearDayPlan('2026-08-14')
    expect(p.isPlanMoved('2026-08-14')).toBe(false)
    expect(p.sessionIdFor('2026-08-14')).toBe('s4')
  })

  it('réinitialiser le planning efface aussi les exceptions', async () => {
    // Sinon « ↺ Réinit. planning » rendait une semaine type propre… toujours
    // contredite par des exceptions invisibles.
    const p = await load()
    p.setDayPlan('2026-08-14', null)
    p.setDay(0, null)
    p.resetPlan()
    expect(p.weekPlan.value).toEqual(DEFAULT_PLAN)
    expect(p.isPlanMoved('2026-08-14')).toBe(false)
    // Le défaut est désormais une semaine SANS séance : réinitialiser rend une page
    // blanche, pas le rythme de quelqu'un d'autre.
    expect(p.sessionIdFor('2026-08-14')).toBeNull()
  })
})
