import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BodyEntry } from '../../lib/mesures'

// ─────────────────────────────────────────────────────────────────────────────
// L'historique de pesées effacé par la synchronisation d'ouverture.
// ─────────────────────────────────────────────────────────────────────────────
//
// Symptôme observé : « Tout récupérer » ramène bien deux ans de pesées, elles
// s'affichent, et à la réouverture suivante il n'en reste que la dernière. Il faut
// tout récupérer à chaque fois.
//
// La cause n'est pas dans la récupération, elle est dans l'ORDRE. La coque lance la
// synchronisation automatique au montage (`autoSyncTout`), avant qu'aucun écran
// n'ait demandé les mesures. `adopt()` fusionne donc les nouvelles pesées avec
// `entries.value`, qui vaut encore `[]` faute d'hydratation — et réécrit
// `gr-withings-body-v1` avec ce seul contenu. Deux ans d'historique remplacés par la
// pesée du matin, sans un message, sans une erreur.
//
// Ce qui rend le défaut si discret : il ne se déclenche QUE si la balance a quelque
// chose de neuf à donner (`adopt` sort tout de suite sur une liste vide) et QUE si
// l'on n'est pas passé par l'écran Progrès, qui hydrate avant de synchroniser. Un
// jour sans pesée, ou une visite à la courbe, et tout va bien.
//
// Les tests ci-dessous n'appellent donc JAMAIS `hydrate()` : c'est exactement l'état
// du composable quand la coque déclenche la synchro au démarrage.

const BODY_KEY = 'gr-withings-body-v1'
const MIGRE_KEY = 'gr-withings-migr-v1'

const TODAY = '2026-09-09'

/** Un historique déjà en place, tel que « Tout récupérer » l'a laissé. */
function historique(n: number): BodyEntry[] {
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(2026, 5, 1) + i * 86400000).toISOString().slice(0, 10)
    return { date: d, at: `${d}T07:00`, kg: 78 - i * 0.02, source: 'withings' }
  })
}

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
  // La migration de l'ancienne clé est un chemin à part, testé ailleurs : on la
  // marque comme faite pour que ce fichier ne parle que de l'ordre d'hydratation.
  localStorage.setItem(MIGRE_KEY, '1')
})

const charger = async () => (await import('../../composables/useMesures')).useMesures()

const stocke = (): BodyEntry[] => JSON.parse(localStorage.getItem(BODY_KEY) ?? '[]')

describe('la synchro d’ouverture, avant tout écran', () => {
  it('garde l’historique quand une pesée neuve arrive', async () => {
    const passe = historique(90)
    localStorage.setItem(BODY_KEY, JSON.stringify(passe))

    const m = await charger()
    // Pas de hydrate() : la coque n'en appelle aucun avant `autoSyncTout`.
    m.absorber({ pesees: [{ date: TODAY, at: `${TODAY}T07:12`, kg: 76.4, source: 'withings' }], pas: [] }, TODAY)

    expect(stocke()).toHaveLength(91)
    expect(stocke()[0]!.at).toBe(passe[0]!.at)
  })

  it('compte les mesures VRAIMENT neuves, pas tout ce qu’on lui tend', async () => {
    // `recuperees` alimente le « 3 nouvelles mesures » affiché après une synchro.
    // Sur un composable vide, la réponse était « 90 » à chaque ouverture.
    const passe = historique(90)
    localStorage.setItem(BODY_KEY, JSON.stringify(passe))

    const m = await charger()
    const neuves = m.absorber({ pesees: [...passe.slice(-3), { date: TODAY, at: `${TODAY}T07:12`, kg: 76.4, source: 'withings' }], pas: [] }, TODAY)

    expect(neuves).toBe(1)
  })

  it('n’écrase rien non plus par une saisie à la main', async () => {
    // Même piège, autre porte : le champ « ajouter une pesée » de l'écran Progrès
    // hydrate avant, mais rien ne le garantit pour les appels futurs.
    localStorage.setItem(BODY_KEY, JSON.stringify(historique(40)))

    const m = await charger()
    m.addManual(75.2, TODAY)

    expect(stocke()).toHaveLength(41)
  })

  /**
   * Le cas qui masquait le défaut, et qu'il ne faut pas casser en le réparant : une
   * synchronisation qui ne rapporte rien ne doit toucher à rien.
   */
  it('ne réécrit pas le stockage quand la balance n’a rien de neuf', async () => {
    const passe = historique(12)
    localStorage.setItem(BODY_KEY, JSON.stringify(passe))

    const m = await charger()
    m.absorber({ pesees: [], pas: [] }, TODAY)

    expect(stocke()).toHaveLength(12)
  })

  /** Et l'installation neuve continue de marcher : rien en réserve, tout à prendre. */
  it('accepte la première récupération sur un stockage vide', async () => {
    const m = await charger()
    const neuves = m.absorber({ pesees: historique(5), pas: [] }, TODAY)

    expect(neuves).toBe(5)
    expect(stocke()).toHaveLength(5)
  })
})
