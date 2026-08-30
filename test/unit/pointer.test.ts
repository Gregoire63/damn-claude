import { describe, expect, it } from 'vitest'
import { boundedValue, createAt, getAt, isScalar, parsePointer, pushAt, removeAt, setAt } from '../../lib/pointer'

// ─────────────────────────────────────────────────────────────────────────────
// Désigner un endroit dans la sauvegarde, et n'y toucher que là.
//
// C'est le module qui rend « tout le fichier modifiable » acceptable. Ce qu'il
// REFUSE compte donc plus que ce qu'il accepte : chaque interdit ferme une façon
// de perdre une donnée qu'on ne pourra pas reconstituer.
const snap = () => ({
  sessions: [
    { at: '2026-08-13T13:00', name: 'Jambes', durationMin: 50, entries: [{ exId: 'squat', sets: [{ w: 100, r: 8 }] }] },
    { at: '2026-08-14T12:30', name: 'Pecs', durationMin: 45, entries: [] },
  ],
  bodyWeight: [{ date: '2026-08-12', kg: 77.4 }],
  profile: { heightCm: 179, sex: 'h', birthYear: 1997 },
  nutrition: { week: { gym: [true, false] } },
  'clé/bizarre': { 'a~b': 1 },
})

describe('lecture par pointeur', () => {
  it('trouve une valeur simple, à travers listes et objets', () => {
    const s = snap()
    expect(getAt(s, '/sessions/0/durationMin')).toBe(50)
    expect(getAt(s, '/profile/heightCm')).toBe(179)
    expect(getAt(s, '/sessions/0/entries/0/sets/0/w')).toBe(100)
    expect(getAt(s, '/nutrition/week/gym/1')).toBe(false)
  })

  it('résout les échappements de la norme', () => {
    // ~1 vaut « / » et ~0 vaut « ~ » — sans quoi une clé contenant une barre
    // oblique découperait le chemin au mauvais endroit.
    const s = snap()
    expect(parsePointer('/a~1b/c~0d')).toEqual(['a/b', 'c~d'])
    expect(getAt(s, '/cl~é/bizarre'.replace('~é', 'é'))).toBeUndefined()
    expect(getAt(s, '/clé~1bizarre/a~0b')).toBe(1)
  })

  it('ne trouve rien là où il n\'y a rien', () => {
    const s = snap()
    for (const p of ['/sessions/9/durationMin', '/profile/poids', '/sessions/0/durationMin/x', '', 'sessions/0', '/']) {
      expect(getAt(s, p)).toBeUndefined()
    }
  })

  it('ne remonte pas au prototype', () => {
    // `in` aurait laissé passer `/constructor` ou `/__proto__`, qui ne font pas
    // partie des données et ouvrent la porte à des écritures ailleurs.
    const s = snap()
    expect(getAt(s, '/constructor')).toBeUndefined()
    expect(getAt(s, '/profile/__proto__')).toBeUndefined()
    expect(getAt(s, '/profile/toString')).toBeUndefined()
  })
})

describe('écriture par pointeur', () => {
  it('remplace une valeur simple, dans un objet comme dans une liste', () => {
    const s = snap()
    expect(setAt(s, '/sessions/0/durationMin', 65)).toBe(true)
    expect(s.sessions[0].durationMin).toBe(65)
    expect(setAt(s, '/nutrition/week/gym/0', false)).toBe(true)
    expect(s.nutrition.week.gym[0]).toBe(false)
    expect(setAt(s, '/sessions/1/name', 'Pecs & Bras')).toBe(true)
    expect(setAt(s, '/profile/birthYear', null)).toBe(true)
    expect(s.profile.birthYear).toBeNull()
  })

  it('ne crée jamais un champ qui n\'existait pas', () => {
    // Une faute de frappe dans un nom de clé fabriquerait sinon un champ fantôme
    // que rien ne lit — et qui donnerait l'illusion que la correction a marché.
    const s = snap()
    expect(setAt(s, '/profile/poids', 78)).toBe(false)
    expect(setAt(s, '/sessions/0/duree', 65)).toBe(false)
    expect(s.profile).not.toHaveProperty('poids')
  })

  it('ne rallonge pas une liste', () => {
    const s = snap()
    expect(setAt(s, '/bodyWeight/5', 80)).toBe(false)
    expect(s.bodyWeight).toHaveLength(1)
  })

  it('refuse d\'écraser un objet ou une liste', () => {
    // C'est l'interdit central : réécrire une séance entière à partir d'une phrase
    // est exactement ce qu'on refuse depuis le début.
    const s = snap()
    expect(setAt(s, '/sessions/0', 'nawak')).toBe(false)
    expect(setAt(s, '/sessions', 'nawak')).toBe(false)
    expect(setAt(s, '/profile', 'nawak')).toBe(false)
    expect(s.sessions[0].name).toBe('Jambes')
  })

  it('refuse d\'écrire autre chose qu\'une valeur simple', () => {
    const s = snap()
    expect(setAt(s, '/sessions/0/durationMin', { a: 1 } as never)).toBe(false)
    expect(setAt(s, '/sessions/0/durationMin', [1] as never)).toBe(false)
    expect(s.sessions[0].durationMin).toBe(50)
  })

  it('reconnaît ce qui est une valeur simple', () => {
    expect([0, '', false, null, 3.5, 'a'].every(isScalar)).toBe(true)
    expect([{}, [], undefined].some(isScalar)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Créer, ajouter, supprimer — et ce qu'on continue de refuser.
// ─────────────────────────────────────────────────────────────────────────────
//
// Ces trois opérations existent parce que sans elles une cinquantaine de gestes que
// l'application sait faire restaient hors de portée d'une conversation. Elles
// n'ouvrent pas la porte pour autant : on ne crée jamais un CHEMIN, seulement une
// feuille, et on ne remplace jamais un objet existant.

const sauvegarde = () => ({
  profile: { heightCm: 179, sex: 'h' as string | null },
  bodyWeight: [{ date: '2026-08-17', kg: 91.9 }, { date: '2026-08-18', kg: 91.5 }],
  nutrition: { extras: { '2026-08-19': [{ id: 'a', kcal: 200 }] }, prices: {} as Record<string, number> },
})

describe('créer une feuille absente', () => {
  it('crée là où il n’y a rien', () => {
    const d = sauvegarde()
    expect(createAt(d, '/nutrition/prices/avocat', 4.5)).toBe(true)
    expect(d.nutrition.prices.avocat).toBe(4.5)
  })

  it('refuse d’écraser ce qui existe déjà', () => {
    // Confondre créer et remplacer, c'est écraser en croyant ajouter.
    const d = sauvegarde()
    expect(createAt(d, '/profile/heightCm', 180)).toBe(false)
    expect(d.profile.heightCm).toBe(179)
  })

  it('ne fabrique jamais une branche entière', () => {
    // Une faute de frappe dans un nom de section créerait un champ que rien ne lit.
    const d = sauvegarde()
    expect(createAt(d, '/nutriton/prices/avocat', 4.5)).toBe(false)
    expect(createAt(d, '/nutrition/inconnu/profond/cle', 1)).toBe(false)
  })

  it('accepte un objet, dans les bornes', () => {
    const d = sauvegarde()
    expect(createAt(d, '/nutrition/extras/2026-08-20', [{ id: 'b', kcal: 150 }])).toBe(true)
    expect(createAt(d, '/nutrition/prices/trop-profond', { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } })).toBe(false)
  })
})

describe('ajouter à un tableau', () => {
  it('ajoute à la fin', () => {
    const d = sauvegarde()
    expect(pushAt(d, '/bodyWeight', { date: '2026-08-19', kg: 91.2 })).toBe(true)
    expect(d.bodyWeight).toHaveLength(3)
    expect(d.bodyWeight[2].kg).toBe(91.2)
  })

  it('refuse ce qui n’est pas un tableau', () => {
    const d = sauvegarde()
    expect(pushAt(d, '/profile', { x: 1 })).toBe(false)
    expect(pushAt(d, '/profile/heightCm', 1)).toBe(false)
    expect(pushAt(d, '/inexistant', 1)).toBe(false)
  })
})

describe('supprimer', () => {
  it('retire une clé d’objet', () => {
    const d = sauvegarde()
    expect(removeAt(d, '/profile/sex')).toBe(true)
    expect(Object.hasOwn(d.profile, 'sex')).toBe(false)
  })

  it('retire un élément de tableau, et resserre les rangs', () => {
    // Écrire `null` à la place laisserait un trou que tout le monde relit ensuite.
    const d = sauvegarde()
    expect(removeAt(d, '/bodyWeight/0')).toBe(true)
    expect(d.bodyWeight).toHaveLength(1)
    expect(d.bodyWeight[0].date).toBe('2026-08-18')
  })

  it('refuse ce qui n’existe pas', () => {
    const d = sauvegarde()
    expect(removeAt(d, '/profile/inexistant')).toBe(false)
    expect(removeAt(d, '/bodyWeight/9')).toBe(false)
    expect(removeAt(d, '')).toBe(false)
  })
})

describe('remplacer reste ce qu’il était', () => {
  it('n’écrase toujours pas un objet ni un tableau', () => {
    // La seule chose qu'on s'interdit encore, et la plus importante : réécrire d'un
    // coup une section dont on ne saurait pas dire ce qu'elle contenait.
    const d = sauvegarde()
    expect(setAt(d, '/profile', 'x')).toBe(false)
    expect(setAt(d, '/bodyWeight', 'x')).toBe(false)
    expect(setAt(d, '/bodyWeight/0', 'x')).toBe(false)
  })

  it('ne crée toujours rien', () => {
    const d = sauvegarde()
    expect(setAt(d, '/profile/poids', 91)).toBe(false)
  })
})

describe('les bornes d’une valeur composée', () => {
  it('acceptent ce qu’on ajoute vraiment', () => {
    expect(boundedValue({ date: '2026-08-19', kg: 91.2 })).toBe(true)
    expect(boundedValue([{ id: 'a', kcal: 200, p: 12 }])).toBe(true)
    expect(boundedValue(null)).toBe(true)
  })

  it('acceptent une séance oubliée, qui est le plus gros objet légitime', () => {
    // C'est ce cas qui a fixé les bornes : six exercices de quatre séries.
    const seance = {
      at: '2026-08-13T18:30', sessionId: 's3', name: 'Jambes', durationMin: 55,
      entries: Array.from({ length: 6 }, (_, i) => ({
        exId: `ex-${i}`,
        sets: Array.from({ length: 4 }, () => ({ w: 60, r: 8 })),
      })),
    }
    expect(boundedValue(seance)).toBe(true)
  })

  it('refusent ce qu’on ne relirait pas avant de valider', () => {
    // Trop profond : sept niveaux.
    expect(boundedValue({ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } })).toBe(false)
    // Trop gros : le budget est TOTAL, pas par niveau — sinon cent entrées à chaque
    // étage feraient un million de nœuds sans jamais dépasser une seule borne.
    expect(boundedValue(Array.from({ length: 500 }, (_, i) => i))).toBe(false)
    expect(boundedValue(Array.from({ length: 30 }, () => Array.from({ length: 30 }, (_, i) => i)))).toBe(false)
    expect(boundedValue(() => 1)).toBe(false)
  })
})
