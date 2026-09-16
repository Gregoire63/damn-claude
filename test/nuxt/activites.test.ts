import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Le rangement du sport hors séance, et son effet sur la dépense.
// ─────────────────────────────────────────────────────────────────────────────
//
// Le calcul est dans lib/activites.ts, testé sans navigateur. Ici : le câblage —
// stockage, relecture, sauvegarde — et LA question qui justifie tout le reste : est-ce
// qu'un foot du samedi fait vraiment monter la cible de la journée ?

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

const charger = async () => {
  const { useActivites } = await import('../../composables/useActivites')
  const a = useActivites()
  a.hydrate()
  return a
}

const FOOT = { type: 'foot' as const, nom: 'Match', date: '2026-09-12', heure: '18:30', minutes: 90, kcal: 620, estime: false }

describe('ranger une activité', () => {
  it('l’ajoute, la retrouve dans sa journée, et la retrouve après rechargement', async () => {
    const a = await charger()
    const id = a.ajouter(FOOT)!
    expect(id).toBeTruthy()
    expect(a.duJour('2026-09-12').map(x => x.nom)).toEqual(['Match'])
    expect(a.kcalDuJour('2026-09-12')).toBe(620)

    vi.resetModules()
    const encore = await charger()
    expect(encore.kcalDuJour('2026-09-12')).toBe(620)
  })

  it('ne mélange pas les journées', async () => {
    const a = await charger()
    a.ajouter(FOOT)
    a.ajouter({ ...FOOT, date: '2026-09-11', kcal: 300 })
    expect(a.kcalDuJour('2026-09-12')).toBe(620)
    expect(a.kcalDuJour('2026-09-11')).toBe(300)
  })

  it('modifie sans toucher au reste', async () => {
    const a = await charger()
    const id = a.ajouter(FOOT)!
    expect(a.modifier(id, { minutes: 120 })).toBe(true)
    const apres = a.duJour('2026-09-12')[0]!
    expect(apres.minutes).toBe(120)
    expect(apres.nom).toBe('Match')
    expect(apres.kcal).toBe(620)
  })

  it('refuse de modifier ou de retirer ce qui n’existe pas', async () => {
    const a = await charger()
    expect(a.modifier('act-fantome', { minutes: 30 })).toBe(false)
    expect(a.retirer('act-fantome')).toBe(false)
  })

  it('retire', async () => {
    const a = await charger()
    const id = a.ajouter(FOOT)!
    expect(a.retirer(id)).toBe(true)
    expect(a.kcalDuJour('2026-09-12')).toBe(0)
  })

  /** Deux lignes au même identifiant feraient modifier l'une en visant l'autre. */
  it('ne garde jamais deux fois le même identifiant', async () => {
    localStorage.setItem('gr-activites-v1', JSON.stringify([
      { ...FOOT, id: 'a1' },
      { ...FOOT, id: 'a1', nom: 'Doublon' },
    ]))
    const a = await charger()
    const ids = a.activites.value.map(x => x.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(a.activites.value).toHaveLength(2)
  })

  it('jette ce qui n’est rattachable à aucune journée', async () => {
    localStorage.setItem('gr-activites-v1', JSON.stringify([{ id: 'x', minutes: 60, kcal: 300 }]))
    expect((await charger()).activites.value).toEqual([])
  })
})

describe('la sauvegarde', () => {
  it('les emporte et les rend', async () => {
    const a = await charger()
    a.ajouter(FOOT)
    const snap = JSON.parse(JSON.stringify(a.snapshot()))

    vi.resetModules()
    localStorage.clear()
    const neuf = await charger()
    expect(neuf.kcalDuJour('2026-09-12')).toBe(0)
    neuf.restore(snap)
    expect(neuf.kcalDuJour('2026-09-12')).toBe(620)
  })

  /** Une sauvegarde d'avant ce réglage ne doit rien effacer. */
  it('encaisse une sauvegarde qui ne connaît pas cette section', async () => {
    const a = await charger()
    a.ajouter(FOOT)
    a.restore({ profile: {} })
    expect(a.kcalDuJour('2026-09-12')).toBe(620)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// LA question : est-ce que ça change la cible du jour ?
// ─────────────────────────────────────────────────────────────────────────────

describe('la dépense de la journée', () => {
  /**
   * Il faut un corps pour que la dépense existe : sans pesée ni profil, `energyOn`
   * rend `null` plutôt qu'une cible calculée sur un corps inventé. `useProfile`
   * s'hydrate à la demande — sans l'appel, le profil reste à ses valeurs par défaut
   * et la cible est indisponible, ce qui ressemble beaucoup à un bug du test.
   */
  async function poserUnCorps() {
    localStorage.setItem('gr-profile-v1', JSON.stringify({ heightCm: 179, birthYear: 1995, sex: 'h' }))
    localStorage.setItem('gr-bodyweight-v1', JSON.stringify([{ date: '2026-09-12', kg: 80 }]))
    const { useProfile } = await import('../../composables/useProfile')
    useProfile().hydrate()
  }

  it('monte quand on note une activité, et la compte à part de la séance', async () => {
    await poserUnCorps()
    const { useEnergy } = await import('../../composables/useEnergy')
    const a = await charger()
    const e = useEnergy()

    const avant = e.energyOn('2026-09-12')!
    expect(avant.activitesKcal).toBe(0)

    a.ajouter(FOOT)
    const apres = e.energyOn('2026-09-12')!
    expect(apres.activitesKcal).toBe(620)
    expect(apres.need).toBe(avant.need + 620)
    expect(apres.target).toBeGreaterThan(avant.target)
    // Le poste « séance » n'a pas bougé : ce sont deux dépenses différentes.
    expect(apres.sessionKcal).toBe(avant.sessionKcal)
  })

  /**
   * Et elle ne fait PAS de la journée un jour de salle : les féculents ne sont pas
   * modulés, les créneaux de repas ne changent pas. Ce sont des réglages liés à la
   * séance de musculation, pas à l'effort en général — et les déplacer bougerait ce
   * qui a déjà été mangé et coché.
   */
  it('ne transforme pas la journée en jour de salle', async () => {
    await poserUnCorps()
    const { useNutrition } = await import('../../composables/useNutrition')
    const nutrition = useNutrition()
    nutrition.hydrate()
    const avant = nutrition.dayFor('2026-09-12').gym

    const a = await charger()
    a.ajouter({ ...FOOT, minutes: 180, kcal: 1200 })
    expect(nutrition.dayFor('2026-09-12').gym).toBe(avant)
  })
})
