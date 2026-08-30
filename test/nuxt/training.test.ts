import { beforeEach, describe, expect, it, vi } from 'vitest'
import { poserSemaineExemple } from '../exemple'

// Ces tests tournent sur le PACK D'EXEMPLE : l'application ne livre plus de données.
// Voir test/exemple.ts pour le pourquoi.
vi.mock('../../data/nutritionProgram', () => (import('../exemple')).then(m => m.catalogueExemple()))
vi.mock('../../data/sportProgram', () => (import('../exemple')).then(m => m.programmeExemple()))

// Déplacer une séance, c'est déplacer un repas.
//
// La séance et la journée alimentaire vivent dans deux stockages, et doivent y
// rester : l'une dit ce que je soulève, l'autre ce que je mange. Mais elles
// partagent un fait — « ce jour-là je vais à la salle » — qui vaut ~440 kcal de
// dépense, un déjeuner d'après-séance et une heure de repas décalée.
//
// Tout l'objet de `useTraining` est que ce fait ne puisse pas diverger. Ces tests
// vérifient donc systématiquement LES DEUX côtés après chaque geste.
beforeEach(() => {
  localStorage.clear()
  // La semaine type n'a plus de défaut : sans séance posée, il n'y a rien à déplacer.
  poserSemaineExemple()
  vi.resetModules()
})

// Semaine type par défaut : lun s1, mar s2, jeu s3, ven s4 — mercredi, samedi et
// dimanche au repos.
const JEU = '2026-08-13'
const VEN = '2026-08-14'
const SAM = '2026-08-15'
const VEN_SUIVANT = '2026-08-21'

const load = async () => {
  const { useProfile } = await import('../../composables/useProfile')
  const { useNutrition } = await import('../../composables/useNutrition')
  const { useTraining } = await import('../../composables/useTraining')
  const prof = useProfile()
  prof.hydrate()
  const nut = useNutrition()
  nut.hydrate()
  return { prof, nut, tr: useTraining() }
}

describe('planning par date', () => {
  it('part de la semaine type tant qu\'aucune exception n\'est posée', async () => {
    const { tr } = await load()
    expect(tr.plannedFor(VEN)?.id).toBe('s4')
    expect(tr.plannedFor(SAM)).toBeNull()
    expect(tr.isPlanMoved(VEN)).toBe(false)
  })

  it('déplace la séance ET les calories des deux journées', async () => {
    const { nut, tr } = await load()
    expect(nut.dayFor(VEN).gym).toBe(true)
    expect(nut.dayFor(SAM).gym).toBe(false)

    tr.moveTraining(VEN, SAM)

    expect(tr.plannedFor(VEN)).toBeNull()
    expect(tr.plannedFor(SAM)?.id).toBe('s4')
    // Le vendredi redescend en repos, le samedi passe en jour de salle : c'est ce
    // couple-là qui fait bouger la cible calorique et l'heure du déjeuner.
    expect(nut.dayFor(VEN).gym).toBe(false)
    expect(nut.dayFor(SAM).gym).toBe(true)
  })

  it('échange les deux séances quand le jour d\'arrivée est déjà pris', async () => {
    // Écraser aurait perdu la séance jambes sans rien dire — et « je décale jeudi
    // et vendredi » est justement le cas où l'on vise un jour occupé.
    const { nut, tr } = await load()
    tr.moveTraining(JEU, VEN)

    expect(tr.plannedFor(JEU)?.id).toBe('s4')
    expect(tr.plannedFor(VEN)?.id).toBe('s3')
    expect(nut.dayFor(JEU).gym).toBe(true)
    expect(nut.dayFor(VEN).gym).toBe(true)
  })

  it('annule une séance et fait retomber la journée en repos', async () => {
    const { nut, tr } = await load()
    tr.cancelTraining(VEN)

    expect(tr.plannedFor(VEN)).toBeNull()
    expect(tr.isPlanMoved(VEN)).toBe(true)
    expect(nut.dayFor(VEN).gym).toBe(false)
  })

  it('ne touche que la date visée, pas les vendredis suivants', async () => {
    // C'est toute la différence avec l'ancien planning « adaptatif » : un
    // empêchement d'une semaine ne doit pas réécrire toutes les autres.
    const { nut, tr } = await load()
    tr.cancelTraining(VEN)

    expect(tr.plannedFor(VEN_SUIVANT)?.id).toBe('s4')
    expect(nut.dayFor(VEN_SUIVANT).gym).toBe(true)
  })

  it('reprend le planning type, calories comprises', async () => {
    const { nut, tr } = await load()
    tr.cancelTraining(VEN)
    tr.resetTraining(VEN)

    expect(tr.isPlanMoved(VEN)).toBe(false)
    expect(tr.plannedFor(VEN)?.id).toBe('s4')
    expect(nut.dayFor(VEN).gym).toBe(true)
  })

  it('laisse en place le télétravail déclaré sur la même date', async () => {
    // Les deux exceptions cohabitent sur une même journée : reprendre le planning
    // de séance ne doit pas effacer « ce jour-là je bosse de chez moi », qui pèse
    // lui aussi sur la cible.
    const { nut, tr } = await load()
    nut.setOverride(VEN, { tt: true })
    tr.cancelTraining(VEN)
    expect(nut.dayFor(VEN).tt).toBe(true)

    tr.resetTraining(VEN)
    expect(nut.dayFor(VEN).tt).toBe(true)
    expect(nut.dayFor(VEN).gym).toBe(true)
  })

  it('survit à un rechargement', async () => {
    const { tr } = await load()
    tr.moveTraining(VEN, SAM)

    vi.resetModules()
    const again = await load()
    expect(again.tr.plannedFor(SAM)?.id).toBe('s4')
    expect(again.tr.plannedFor(VEN)).toBeNull()
    expect(again.nut.dayFor(SAM).gym).toBe(true)
    expect(again.nut.dayFor(VEN).gym).toBe(false)
  })
})
