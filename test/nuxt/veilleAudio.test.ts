import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// La veille audio ne doit pas couper la musique.
// ─────────────────────────────────────────────────────────────────────────────
//
// Symptôme vécu : valider une série arrêtait Spotify. Le son ne revenait qu'en
// allant mettre en pause puis relancer dans Spotify — donc en comprenant d'abord
// que c'était l'application de sport qui avait pris le son.
//
// La cause : une page qui joue de l'audio prend le focus audio du système. La piste
// inaudible de veille — celle qui empêche Chrome Android de geler les minuteurs en
// arrière-plan — démarrait avec le repos, écran allumé, alors qu'il n'y avait
// justement rien à empêcher.
//
// D'où la règle figée ici : la veille ne tourne QUE quand l'onglet est caché. C'est
// le seul moment où elle sert, et le seul où le vol de focus est un prix acceptable.

/**
 * Chaque instance porte son propre état, et on ne regarde que la DERNIÈRE créée.
 *
 * `vi.resetModules()` donne un module neuf à chaque test, mais l'écouteur
 * `visibilitychange` que le module précédent a posé sur `document` reste branché : il
 * continue de piloter SON élément audio à lui. Un compteur partagé entre les
 * instances additionnait donc les lectures de tous les tests déjà passés — et le
 * test échouait pour une raison qui n'avait rien à voir avec le code testé.
 */
let dernier: AudioFactice | null = null

class AudioFactice {
  loop = false
  preload = ''
  currentTime = 0
  enCours = false
  lectures = 0
  constructor() { dernier = this }
  get paused() { return !this.enCours }
  play() { this.enCours = true; this.lectures++; return Promise.resolve() }
  pause() { this.enCours = false }
}

/** L'élément du module en cours de test. */
const joue = () => !!dernier?.enCours

function cacher(etat: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => etat })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
  dernier = null
  vi.stubGlobal('Audio', AudioFactice)
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
})

afterEach(() => { vi.unstubAllGlobals() })

const charger = async () => await import('../../composables/useRestTimer')

describe('la piste de veille', () => {
  it('ne démarre PAS quand l’écran est devant les yeux', async () => {
    const { veilleAudio } = await charger()
    veilleAudio(true)
    expect(joue()).toBe(false)
  })

  it('démarre quand l’onglet passe en arrière-plan', async () => {
    const { veilleAudio } = await charger()
    veilleAudio(true)
    cacher('hidden')
    expect(joue()).toBe(true)
  })

  it('s’arrête dès qu’on revient sur l’application', async () => {
    const { veilleAudio } = await charger()
    veilleAudio(true)
    cacher('hidden')
    cacher('visible')
    expect(joue()).toBe(false)
  })

  it('ne joue rien du tout si plus personne ne la réclame', async () => {
    const { veilleAudio } = await charger()
    veilleAudio(true)
    veilleAudio(false)
    cacher('hidden')
    expect(joue()).toBe(false)
  })

  /**
   * Le compteur, et pourquoi il existe : le repos entre séries et le fractionné
   * peuvent réclamer la veille en même temps. Le second à s'arrêter ne doit pas
   * couper la piste du premier — sinon le repos gèle en arrière-plan et son bip ne
   * sonne jamais.
   */
  it('tient tant qu’il reste un demandeur', async () => {
    const { veilleAudio } = await charger()
    veilleAudio(true)
    veilleAudio(true)
    cacher('hidden')
    expect(joue()).toBe(true)

    veilleAudio(false)
    expect(joue()).toBe(true) // le fractionné s'arrête, le repos continue
    veilleAudio(false)
    expect(joue()).toBe(false)
  })

  /** Cachée, revenue, recachée : la piste suit. Et deux passages en arrière-plan
   *  d'affilée ne relancent pas la lecture deux fois — elle joue déjà. */
  it('repart après un aller-retour en arrière-plan, sans s’empiler', async () => {
    const { veilleAudio } = await charger()
    veilleAudio(true)
    cacher('hidden')
    cacher('visible')

    const avant = dernier!.lectures
    cacher('hidden')
    cacher('hidden')
    expect(joue()).toBe(true)
    // Deux passages en arrière-plan, UNE seule relance : elle jouait déjà.
    expect(dernier!.lectures - avant).toBe(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// La session audio déclarée.
// ─────────────────────────────────────────────────────────────────────────────

describe('la session audio', () => {
  it('ne casse rien quand le navigateur ne connaît pas l’API', async () => {
    const { partagerLeSon, baisserLeSonUnInstant, partageAudioDisponible } = await import('../../composables/usePartageAudio')
    expect(partageAudioDisponible()).toBe(false)
    // Le point du test : aucune exception, et donc aucun son perdu là où l'API manque.
    expect(() => { partagerLeSon(); baisserLeSonUnInstant(500) }).not.toThrow()
  })

  it('se déclare « ambient » pour se mélanger, jamais « playback »', async () => {
    const audioSession = { type: 'auto' }
    vi.stubGlobal('navigator', Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, { audioSession }))
    const { partagerLeSon } = await import('../../composables/usePartageAudio')
    partagerLeSon()
    expect(audioSession.type).toBe('ambient')
  })

  /** Baisser, puis RENDRE. Un état transitoire qu'on oublie de rendre devient
   *  permanent — c'est le vol de focus repris par la porte de service. */
  it('baisse le temps d’un bip, puis remet le partage', async () => {
    vi.useFakeTimers()
    const audioSession = { type: 'auto' }
    vi.stubGlobal('navigator', Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, { audioSession }))
    const { baisserLeSonUnInstant } = await import('../../composables/usePartageAudio')

    baisserLeSonUnInstant(600)
    expect(audioSession.type).toBe('transient')

    vi.advanceTimersByTime(700)
    expect(audioSession.type).toBe('ambient')
    vi.useRealTimers()
  })
})
