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
// Première règle, donc : la veille ne tourne QUE quand l'onglet est caché.
//
// Elle ne suffisait pas. Symptôme suivant, rapporté tel quel : « la musique se baisse
// quand je mets l'app en fond ». La piste partait dès qu'on quittait l'application,
// c'est-à-dire exactement quand on va lire un message pendant son repos — la musique
// baissait là au lieu de baisser ici.
//
// Or Chrome serre la vis en DEUX temps : sous cinq minutes de fond, les minuteurs
// sont regroupés à la seconde, ce qui suffit à un décompte ; au-delà, une fois par
// minute, et là le bip arrive en retard. Un repos dure une à trois minutes : il
// n'atteint jamais le second palier. La piste est donc ARMÉE pour quatre minutes et
// ne démarre que si l'onglet est toujours caché — un bloc de fractionné la
// déclenche, un repos jamais.

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
  // La veille s'ARME pour quatre minutes : sans minuteurs factices, le fichier
  // entier devrait attendre pour tester une décision prise en une ligne.
  vi.useFakeTimers()
  vi.stubGlobal('Audio', AudioFactice)
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
})

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

const charger = async () => await import('../../composables/useRestTimer')

/** Le délai d'armement, repris du composable : quatre minutes. */
const DELAI = 4 * 60 * 1000

describe('la piste de veille', () => {
  it('ne démarre PAS quand l’écran est devant les yeux', async () => {
    const { veilleAudio } = await charger()
    veilleAudio(true)
    vi.advanceTimersByTime(DELAI * 2)
    expect(joue()).toBe(false)
  })

  /** Le cœur de la seconde correction : passer en arrière-plan ne fait RIEN tout de
   *  suite. C'est ce qui laisse la musique tranquille pendant un repos. */
  it('ne démarre pas non plus dès qu’on quitte l’application', async () => {
    const { veilleAudio } = await charger()
    veilleAudio(true)
    cacher('hidden')
    expect(joue()).toBe(false)
    // Trois minutes plus tard — un repos long — toujours rien.
    vi.advanceTimersByTime(3 * 60 * 1000)
    expect(joue()).toBe(false)
  })

  it('démarre au bout de quatre minutes en arrière-plan', async () => {
    const { veilleAudio } = await charger()
    veilleAudio(true)
    cacher('hidden')
    vi.advanceTimersByTime(DELAI + 10)
    expect(joue()).toBe(true)
  })

  /** Revenir avant l'échéance désarme : c'est le cas normal, et il ne doit rien
   *  coûter du tout. */
  it('ne démarre pas si on revient avant l’échéance', async () => {
    const { veilleAudio } = await charger()
    veilleAudio(true)
    cacher('hidden')
    vi.advanceTimersByTime(DELAI - 1000)
    cacher('visible')
    vi.advanceTimersByTime(DELAI * 2)
    expect(joue()).toBe(false)
  })

  /** Et le minuteur qui se termine pendant l'attente ne doit rien laisser derrière. */
  it('ne démarre pas si le minuteur s’arrête pendant l’attente', async () => {
    const { veilleAudio } = await charger()
    veilleAudio(true)
    cacher('hidden')
    vi.advanceTimersByTime(60_000)
    veilleAudio(false)
    vi.advanceTimersByTime(DELAI * 2)
    expect(joue()).toBe(false)
  })

  it('s’arrête dès qu’on revient sur l’application', async () => {
    const { veilleAudio } = await charger()
    veilleAudio(true)
    cacher('hidden')
    vi.advanceTimersByTime(DELAI + 10)
    expect(joue()).toBe(true)
    cacher('visible')
    expect(joue()).toBe(false)
  })

  it('ne joue rien du tout si plus personne ne la réclame', async () => {
    const { veilleAudio } = await charger()
    veilleAudio(true)
    veilleAudio(false)
    cacher('hidden')
    vi.advanceTimersByTime(DELAI * 2)
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
    vi.advanceTimersByTime(DELAI + 10)
    expect(joue()).toBe(true)

    veilleAudio(false)
    expect(joue()).toBe(true) // le fractionné s'arrête, le repos continue
    veilleAudio(false)
    expect(joue()).toBe(false)
  })

  /**
   * Deux allers-retours en arrière-plan ne doivent ni empiler les lectures, ni —
   * c'est le piège de l'armement — repousser le départ à chaque retour.
   */
  it('repart après un aller-retour, sans s’empiler', async () => {
    const { veilleAudio } = await charger()
    veilleAudio(true)
    cacher('hidden')
    vi.advanceTimersByTime(DELAI + 10)
    cacher('visible')

    const avant = dernier!.lectures
    cacher('hidden')
    cacher('hidden')
    vi.advanceTimersByTime(DELAI + 10)
    expect(joue()).toBe(true)
    // Deux passages en arrière-plan, UNE seule relance.
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
    const audioSession = { type: 'auto' }
    vi.stubGlobal('navigator', Object.assign(Object.create(Object.getPrototypeOf(navigator)), navigator, { audioSession }))
    const { baisserLeSonUnInstant } = await import('../../composables/usePartageAudio')

    baisserLeSonUnInstant(600)
    expect(audioSession.type).toBe('transient')

    vi.advanceTimersByTime(700)
    expect(audioSession.type).toBe('ambient')
  })
})
