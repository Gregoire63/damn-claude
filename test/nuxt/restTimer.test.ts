import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// Le chrono de repos entre deux séries.
//
// Il était à 0 % de couverture alors que c'est l'élément le plus regardé de toute
// l'application : en salle, on ne fait que ça entre deux séries. Ses pannes sont
// aussi les plus pénibles — un décompte qui dérive, un chrono qui ne s'arrête pas,
// un « + 30 s » qui ne fait rien.
//
// Ce qui est testé ici, c'est la LOGIQUE de décompte. Le son, la vibration et les
// notifications sont volontairement laissés de côté : ils sont déjà défensifs
// (try/catch, repli silencieux) et ne se vérifient qu'à l'oreille sur un vrai
// téléphone.
beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

const load = async () => {
  const { useRestTimer } = await import('../../composables/useRestTimer')
  return useRestTimer()
}

describe('décompte', () => {
  it('démarre sur la durée demandée', async () => {
    const t = await load()
    t.start(90)
    expect(t.totalSeconds.value).toBe(90)
    expect(t.secondsLeft.value).toBe(90)
  })

  it('descend avec le temps réel, pas avec le nombre de battements', async () => {
    // Le chrono se recale sur une heure de fin absolue à chaque battement. C'est ce
    // qui le rend juste au retour de veille : sur un téléphone verrouillé, les
    // minuteurs sont ralentis ou suspendus, et un décompte qui soustrait 1 à chaque
    // battement finirait par afficher n'importe quoi.
    const t = await load()
    t.start(120)
    vi.advanceTimersByTime(30_000)
    expect(t.secondsLeft.value).toBe(90)
    vi.advanceTimersByTime(60_000)
    expect(t.secondsLeft.value).toBe(30)
  })

  it('s\'arrête à zéro sans passer en négatif', async () => {
    const t = await load()
    t.start(5)
    vi.advanceTimersByTime(20_000)
    expect(t.secondsLeft.value).toBe(0)
    // Et il reste à zéro : un chrono qui repart en négatif après la série suivante
    // serait pire qu'un chrono absent.
    vi.advanceTimersByTime(20_000)
    expect(t.secondsLeft.value).toBe(0)
  })

  it('stop remet tout à plat', async () => {
    const t = await load()
    t.start(90)
    vi.advanceTimersByTime(10_000)
    t.stop()
    expect(t.secondsLeft.value).toBe(0)
    expect(t.totalSeconds.value).toBe(0)
    // Plus aucun battement ne doit courir en arrière-plan.
    vi.advanceTimersByTime(60_000)
    expect(t.secondsLeft.value).toBe(0)
  })

  it('un nouveau départ remplace le précédent au lieu de s\'y ajouter', async () => {
    // Régression classique du minuteur : deux `setInterval` qui tournent en parallèle
    // et font descendre le compteur deux fois plus vite.
    const t = await load()
    t.start(120)
    vi.advanceTimersByTime(10_000)
    t.start(60)
    expect(t.secondsLeft.value).toBe(60)
    vi.advanceTimersByTime(10_000)
    expect(t.secondsLeft.value).toBe(50)
  })
})

describe('« + 30 s »', () => {
  it('rallonge le repos en cours', async () => {
    const t = await load()
    t.start(60)
    vi.advanceTimersByTime(20_000)
    expect(t.secondsLeft.value).toBe(40)
    t.addTime(30)
    expect(t.secondsLeft.value).toBe(70)
  })

  it('pousse le total quand le repos dépasse la durée prévue', async () => {
    // Sinon la barre de progression se retrouverait remplie à plus de 100 %.
    const t = await load()
    t.start(60)
    t.addTime(30)
    expect(t.totalSeconds.value).toBe(90)
  })

  it('ne relance pas un chrono déjà terminé', async () => {
    // Appuyer sur « + 30 s » après la fin doit être sans effet : le repos est fini,
    // on est reparti sur la série. Le contraire ferait réapparaître un décompte au
    // milieu d'un mouvement.
    const t = await load()
    t.start(5)
    vi.advanceTimersByTime(10_000)
    expect(t.secondsLeft.value).toBe(0)
    t.addTime(30)
    expect(t.secondsLeft.value).toBe(0)
  })

  it('raccourcit aussi, sans descendre sous une seconde', async () => {
    const t = await load()
    t.start(120)
    t.addTime(-300)
    expect(t.secondsLeft.value).toBe(1)
  })
})

describe('réglages', () => {
  it('retient le son et la vibration d\'une session à l\'autre', async () => {
    const t = await load()
    t.soundEnabled.value = false
    t.vibrationLevel.value = 'off'
    t.soundVolume.value = 0.4

    vi.resetModules()
    const again = await load()
    expect(again.soundEnabled.value).toBe(false)
    expect(again.vibrationLevel.value).toBe('off')
    expect(again.soundVolume.value).toBeCloseTo(0.4, 2)
  })

  it('propose des durées de son et de vibration cohérentes', async () => {
    const t = await load()
    expect(t.SOUND_OPTIONS.length).toBeGreaterThan(0)
    expect(t.VIBRATION_OPTIONS.length).toBeGreaterThan(0)
    // Chaque option doit avoir une valeur ET un libellé : une liste déroulante avec
    // des entrées vides est un bug qu'aucun type ne rattrape.
    for (const o of [...t.SOUND_OPTIONS, ...t.VIBRATION_OPTIONS]) {
      expect(o.key).toBeTruthy()
      expect(o.label.trim()).not.toBe('')
    }
    // Et pas deux fois la même clé : un doublon rendrait un choix inatteignable.
    const keys = t.SOUND_OPTIONS.map(o => o.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
