import { describe, expect, it, vi } from 'vitest'
import { PROGRAM } from '../../data/sportProgram'
import { WARMUP_REST, fmtRest, restFor, restFromReps } from '../../lib/rest'

// Ces tests tournent sur le PACK D'EXEMPLE : l'application ne livre plus de données.
// Voir test/exemple.ts pour le pourquoi.
vi.mock('../../data/sportProgram', () => (import('../exemple')).then(m => m.programmeExemple()))

// Ce fichier protège deux choses distinctes.
//
// La première est la fonction : un repli qui ne se déclenche que sur des exercices
// non renseignés, donc rarement, donc sans témoin s'il se met à mentir.
//
// La seconde est le PROGRAMME lui-même. Le repos y est une donnée, écrite à la
// main, exercice par exercice. Rien dans le typage n'empêche d'oublier un
// exercice, d'écrire 1800 au lieu de 180, ou de laisser deux minutes de repos sur
// une série d'abdos — c'est exactement l'erreur qu'on vient de corriger. Les tests
// de la seconde moitié sont donc des garde-fous sur les VALEURS, pas sur le code.

describe('repos déduit des reps (repli)', () => {
  it('donne trois minutes aux séries lourdes', () => {
    expect(restFromReps('6-8')).toBe(180)
    expect(restFromReps('5')).toBe(180)
  })

  it('donne deux minutes à la fourchette intermédiaire', () => {
    expect(restFromReps('8-10')).toBe(120)
    expect(restFromReps('10-12')).toBe(120)
  })

  it('donne une minute quinze au-delà de douze reps', () => {
    expect(restFromReps('12-15')).toBe(75)
    expect(restFromReps('20')).toBe(75)
  })

  it('lit le HAUT de la fourchette, pas le bas', () => {
    // « 8-12 » est une série qui peut monter à douze : c'est douze qui décide.
    expect(restFromReps('8-12')).toBe(120)
    expect(restFromReps('6-8')).toBe(180)
  })

  it('suppose une série de travail ordinaire quand il n’y a aucun chiffre', () => {
    // « max » : séries à l'échec, aucun nombre à lire. Deux minutes plutôt qu'un
    // plantage ou zéro — un repos faux est récupérable, un minuteur à 0 non.
    expect(restFromReps('max')).toBe(120)
    expect(restFromReps('')).toBe(120)
  })

  /**
   * Le piège que la règle par les reps ne pouvait pas voir : sur « 7+7+7 (21) »
   * elle attrape le total entre parenthèses, pas une cible de série. C'est
   * justement pour ça que le programme renseigne `rest` à la main.
   */
  it('se laisse tromper par un total entre parenthèses — d’où le champ explicite', () => {
    expect(restFromReps('7+7+7 (21)')).toBe(75)
  })
})

describe('repos effectif', () => {
  it('préfère la valeur du programme à la déduction', () => {
    expect(restFor({ reps: '12', rest: 60 })).toBe(60)
    // Sans le champ, « 12 » donnerait deux minutes : c'est bien la donnée qui gagne.
    expect(restFor({ reps: '12' })).toBe(120)
  })

  it('ignore une valeur absurde plutôt que de lancer un minuteur à zéro', () => {
    expect(restFor({ reps: '8-10', rest: 0 })).toBe(120)
    expect(restFor({ reps: '8-10', rest: -30 })).toBe(120)
  })
})

describe('affichage', () => {
  it('écrit les secondes au format du minuteur', () => {
    expect(fmtRest(180)).toBe('3:00')
    expect(fmtRest(90)).toBe('1:30')
    expect(fmtRest(75)).toBe('1:15')
    expect(fmtRest(60)).toBe('1:00')
    expect(fmtRest(45)).toBe('0:45')
  })

  it('ne produit jamais de temps négatif', () => {
    expect(fmtRest(-10)).toBe('0:00')
  })
})

const EXERCICES = PROGRAM.flatMap(s => s.exercises)

describe('le programme lui-même', () => {
  it('renseigne le repos sur CHAQUE exercice — le repli ne doit jamais servir ici', () => {
    const orphelins = EXERCICES.filter(e => typeof e.rest !== 'number').map(e => e.id)
    expect(orphelins).toEqual([])
  })

  it('reste dans des durées qu’un humain passe entre deux séries', () => {
    for (const e of EXERCICES) {
      expect(restFor(e), e.id).toBeGreaterThanOrEqual(45)
      expect(restFor(e), e.id).toBeLessThanOrEqual(300)
    }
  })

  it('tombe sur des quarts de minute — un minuteur à 97 s ne se lit pas', () => {
    for (const e of EXERCICES) expect(restFor(e) % 15, e.id).toBe(0)
  })

  /**
   * Le cœur de la correction. Trois minutes se justifient par le VOLUME à protéger
   * sur les séries suivantes, pas par l'hypertrophie directe : au-delà de ~90 s,
   * la méta-analyse de 2024 ne trouve plus de différence appréciable. Donc les
   * longues durées vont aux mouvements qui chargent le corps entier, et à eux seuls.
   */
  it('réserve les trois minutes aux mouvements lourds de corps entier', () => {
    const longs = EXERCICES.filter(e => restFor(e) >= 180).map(e => e.id).sort()
    expect(longs).toEqual(['dc-barre', 'sdt-r', 'squat'])
  })

  it('ne fait plus attendre deux minutes entre deux séries d’abdos', () => {
    for (const id of ['releves', 'crunch-cable']) {
      const e = EXERCICES.find(x => x.id === id)!
      expect(restFor(e), id).toBeLessThanOrEqual(60)
    }
  })

  it('donne au soulevé de terre roumain au moins autant qu’au développé couché', () => {
    // C'était l'anomalie la plus nette : la charnière de hanche lourde récupérait
    // moins que le développé couché parce qu'elle affiche une rep de plus.
    const sdt = EXERCICES.find(e => e.id === 'sdt-r')!
    const dc = EXERCICES.find(e => e.id === 'dc-barre')!
    expect(restFor(sdt)).toBeGreaterThanOrEqual(restFor(dc))
  })

  it('ne dépasse pas 90 s sur l’isolation d’un petit muscle', () => {
    for (const id of ['curl-marteau', 'leg-curl', 'elev-lat', 'face-pull', 'oiseau', 'mollets']) {
      const e = EXERCICES.find(x => x.id === id)!
      expect(restFor(e), id).toBeLessThanOrEqual(90)
    }
  })

  it('laisse l’échauffement plus court que la plus courte série de travail', () => {
    const mini = Math.min(...EXERCICES.map(restFor))
    expect(WARMUP_REST).toBeLessThan(mini)
  })

  /**
   * Le budget temps : il s'entraîne entre midi et 14 h. Un programme qui déborde
   * n'est pas un programme, c'est un exercice qu'on saute. On compte le repos de
   * toutes les séries de travail, plus un échauffement par exercice chargé.
   */
  it('tient dans la fenêtre de midi, séance par séance', () => {
    for (const s of PROGRAM) {
      const reposTravail = s.exercises.reduce((t, e) => t + e.sets * restFor(e), 0)
      const reposEchauff = s.exercises.filter(e => !e.bodyweight && !e.superset).length * WARMUP_REST
      const series = s.exercises.reduce((t, e) => t + e.sets, 0)
      // ~40 s par série effectuée, échauffements compris.
      const minutes = (reposTravail + reposEchauff + (series + s.exercises.length) * 40) / 60
      expect(minutes, s.name).toBeLessThan(75)
    }
  })
})
