import { describe, expect, it, vi } from 'vitest'
import { LEGACY_NAMES, allExercises, isTimed, mergeProgram, retiredExercises, sessionOf } from '../../lib/program'
import { programFor, slugify } from '../../lib/proposals'
import type { RawProposal } from '../../lib/proposals'
import { PROGRAM } from '../../data/sportProgram'
import type { Exercise, Session } from '../../data/sportProgram'

// Ces tests tournent sur le PACK D'EXEMPLE : l'application ne livre plus de données.
// Voir test/exemple.ts pour le pourquoi.
vi.mock('../../data/sportProgram', () => (import('../exemple')).then(m => m.programmeExemple()))

// ─────────────────────────────────────────────────────────────────────────────
// Le programme modifiable, et la seule chose qu'il n'a pas le droit de casser.
// ─────────────────────────────────────────────────────────────────────────────
//
// Un programme qu'on peut changer depuis une conversation, c'est un programme qu'on
// peut casser depuis une conversation. Le risque n'est pas d'écrire une bêtise
// visible — 40 séries se voient — mais d'effacer une donnée qu'on ne pourra pas
// reconstituer : les séances enregistrées sont indexées par identifiant d'exercice.
//
// D'où deux invariants, testés en premier parce que ce sont eux qui coûtent cher :
// retirer ne supprime rien, et un identifiant déjà pris n'est jamais réutilisé.

const ex = (id: string, over: Partial<Exercise> = {}): Exercise => ({
  id, name: id, sets: 4, reps: '8-10', muscles: ['pecs'], cues: [], machine: '', ...over,
})
const LIVRE: Session[] = [
  { id: 's1', name: 'Pecs', tag: 'Lun', color: '#a00', sprint: null, exercises: [ex('dc'), ex('ecarte'), ex('dips')] },
  { id: 's2', name: 'Dos', tag: 'Mar', color: '#0a0', sprint: null, exercises: [ex('traction'), ex('rowing')] },
]

const prop = (patch: Record<string, unknown>): RawProposal =>
  ({ id: '1', at: '', action: 'programme', summary: '', patch, status: 'pending' })

describe('la fusion du programme', () => {
  it('rend le livré tel quel quand rien n’a été modifié', () => {
    expect(mergeProgram(LIVRE)).toEqual(LIVRE)
  })

  it('patche SANS écraser ce que le patch ne mentionne pas', () => {
    const [s1] = mergeProgram(LIVRE, { patches: { dc: { sets: 5, reps: '5', rest: 180 } } })
    const dc = s1.exercises[0]
    expect(dc.sets).toBe(5)
    expect(dc.reps).toBe('5')
    expect(dc.rest).toBe(180)
    // Ce qui n'était pas dans le patch doit être resté : c'est toute la différence
    // entre patcher et réécrire.
    expect(dc.muscles).toEqual(['pecs'])
    expect(dc.name).toBe('dc')
  })

  it('ne laisse pas un patch vide ou absurde effacer une valeur', () => {
    const [s1] = mergeProgram(LIVRE, { patches: { dc: { sets: 0, reps: '   ', name: '' } } })
    expect(s1.exercises[0].sets).toBe(4)
    expect(s1.exercises[0].reps).toBe('8-10')
    expect(s1.exercises[0].name).toBe('dc')
  })

  it('ajoute un exercice à la bonne séance, et à elle seule', () => {
    const p = mergeProgram(LIVRE, { added: { s2: [ex('tirage')] } })
    expect(p[1].exercises.map(e => e.id)).toEqual(['traction', 'rowing', 'tirage'])
    expect(p[0].exercises).toHaveLength(3)
  })

  it('retire du PROGRAMME sans rien supprimer de l’historique', () => {
    const custom = { disabled: ['ecarte'] }
    expect(allExercises(mergeProgram(LIVRE, custom)).map(e => e.id)).not.toContain('ecarte')
    // La fiche reste consultable : sans elle, une séance de mars afficherait
    // « ecarte » en identifiant brut là où elle affichait un nom.
    expect(retiredExercises(LIVRE, custom).ecarte.name).toBe('ecarte')
    // Et le livré n'a pas bougé d'un octet.
    expect(LIVRE[0].exercises.map(e => e.id)).toEqual(['dc', 'ecarte', 'dips'])
  })

  it('réordonne les ACTIFS entre eux, et laisse les inactifs à leur place', () => {
    const [s1] = mergeProgram(LIVRE, { order: { s1: ['dips', 'dc', 'ecarte'] } })
    expect(s1.exercises.map(e => e.id)).toEqual(['dips', 'dc', 'ecarte'])
  })

  /**
   * Le cas qui décide de tout : un exercice retiré ne doit pas dériver.
   *
   * S'il glissait en fin de liste à chaque réordonnancement, le reprendre trois mois
   * plus tard le ferait réapparaître ailleurs que là où il était — et l'ordre a un
   * sens physiologique : un mouvement de poigne remonté avant un soulevé ruine le
   * soulevé. On échange donc les POSITIONS des actifs entre elles, sans toucher au reste.
   */
  it('ne déplace jamais un exercice inactif en réordonnant', () => {
    const custom = { disabled: ['ecarte'], order: { s1: ['dips', 'dc'] } }
    expect(mergeProgram(LIVRE, custom)[0].exercises.map(e => e.id)).toEqual(['dips', 'dc'])
    // Vu avec les inactifs : « ecarte » n'a pas bougé de son index 1.
    expect(mergeProgram(LIVRE, custom, true)[0].exercises.map(e => e.id)).toEqual(['dips', 'ecarte', 'dc'])
  })

  it('rend sa place d’origine à un exercice réactivé', () => {
    const retire = { disabled: ['ecarte'] }
    expect(mergeProgram(LIVRE, retire)[0].exercises.map(e => e.id)).toEqual(['dc', 'dips'])
    // Réactivé — sans rien d'autre —, il retrouve l'index 1.
    expect(mergeProgram(LIVRE, {})[0].exercises.map(e => e.id)).toEqual(['dc', 'ecarte', 'dips'])
  })

  it('distingue un exercice mesuré en temps', () => {
    expect(isTimed({ mesure: 'temps' })).toBe(true)
    expect(isTimed({ mesure: 'reps' })).toBe(false)
    expect(isTimed({})).toBe(false)
    expect(isTimed(null)).toBe(false)
  })

  it('retrouve la séance d’un exercice, et garde les noms d’avant', () => {
    expect(sessionOf(LIVRE, 'rowing')?.id).toBe('s2')
    expect(sessionOf(LIVRE, 'inconnu')).toBeNull()
    expect(LEGACY_NAMES['curl-ez']).toBe('Curl barre EZ')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Les cinq gestes, et surtout les refus.
// ─────────────────────────────────────────────────────────────────────────────
//
// Un geste accepté qui fait la bonne chose est facile à écrire. Ce qui coûte cher,
// c'est le geste accepté qui fait une chose VOISINE de ce qu'on croyait : un ordre
// partiel appliqué comme s'il était complet, une modification bâtie sur un miroir de
// trois heures, un identifiant réutilisé qui range de vieux records sous un mouvement
// jamais fait. Aucun de ces trois-là ne se voit à l'écran ; ils se découvrent en
// salle, ou trois mois plus tard dans une courbe qui ne veut rien dire.
//
// D'où la proportion : un test par geste, et une dizaine pour ce qui doit être refusé.

/** Le contexte que fournissent le coffre et le serveur, avec ses trois niveaux :
 *  les actifs d'une séance, l'existence d'un identifiant partout, et l'état complet
 *  d'un exercice — c'est ce dernier qui permet de refuser utilement. */
const ctxDe = (sessions: Session[], off: string[] = []) => ({
  sessionKnown: (id: string) => sessions.some(s => s.id === id),
  exerciseKnown: (id: string) => sessions.some(s => s.exercises.some(e => e.id === id)),
  exercisesOf: (sid: string) =>
    (sessions.find(s => s.id === sid)?.exercises ?? []).filter(e => !off.includes(e.id)).map(e => e.id),
  exerciseAt: (id: string) => {
    for (const s of sessions) {
      const e = s.exercises.find(x => x.id === id)
      if (e) return { seance: s.id, seanceNom: s.name, actif: !off.includes(id), ex: e }
    }
    return null
  },
})

describe('modifier un exercice', () => {
  const ctx = ctxDe(LIVRE)

  it('change séries, reps et repos quand la proposition sait ce qu’elle remplace', () => {
    const plan = programFor(prop({
      op: 'modifier', seance: 's1', exercice: 'dc',
      de_series: 4, de_reps: '8-10', de_repos_s: 120,
      patch: { series: 5, reps: '5', repos_s: 180 },
    }), ctx)
    expect(plan).toEqual({
      kind: 'programme', seance: 's1', op: 'modifier', exercice: 'dc',
      patch: { sets: 5, reps: '5', rest: 180 },
    })
  })

  /**
   * LE refus qui justifie tout le mécanisme.
   *
   * Le miroir peut avoir des heures de retard. Une proposition écrite ce matin sur
   * « 4 séries » écraserait sans le savoir un passage à 3 fait depuis sur le
   * téléphone — et trois séries au lieu de quatre, on ne le remarque pas en salle,
   * on les fait, c'est tout.
   */
  it('refuse une valeur changée sans son « de_… »', () => {
    expect(programFor(prop({ op: 'modifier', seance: 's1', exercice: 'dc', patch: { series: 5 } }), ctx)).toBeNull()
    expect(programFor(prop({ op: 'modifier', seance: 's1', exercice: 'dc', patch: { reps: '5' } }), ctx)).toBeNull()
    expect(programFor(prop({ op: 'modifier', seance: 's1', exercice: 'dc', patch: { repos_s: 180 } }), ctx)).toBeNull()
  })

  it('refuse un « de_… » qui ne correspond pas à la valeur enregistrée', () => {
    expect(programFor(prop({ op: 'modifier', seance: 's1', exercice: 'dc', de_series: 3, patch: { series: 5 } }), ctx)).toBeNull()
  })

  it('tolère « 4 » pour 4 : c’est la même valeur', () => {
    expect(programFor(prop({ op: 'modifier', seance: 's1', exercice: 'dc', de_series: '4', patch: { series: 5 } }), ctx))
      .toMatchObject({ patch: { sets: 5 } })
  })

  it('n’exige aucun « de_… » sur ce qui n’est pas une valeur chiffrée', () => {
    // Nom, machine, muscles, consignes : les changer n'écrase pas un réglage
    // d'entraînement, et exiger une confirmation les rendrait pénibles pour rien.
    expect(programFor(prop({ op: 'modifier', seance: 's1', exercice: 'dc', patch: { nom: 'Développé couché', machine: 'Barre olympique' } }), ctx))
      .toMatchObject({ patch: { name: 'Développé couché', machine: 'Barre olympique' } })
  })

  it('accepte de vider « machine », qui est du texte libre', () => {
    expect(programFor(prop({ op: 'modifier', seance: 's1', exercice: 'ecarte', patch: { machine: '' } }), ctx))
      .toMatchObject({ patch: { machine: '' } })
  })

  it('accepte mesure et optionnel', () => {
    expect(programFor(prop({ op: 'modifier', seance: 's1', exercice: 'dips', patch: { mesure: 'temps', optionnel: true } }), ctx))
      .toMatchObject({ patch: { mesure: 'temps', optionnel: true } })
    expect(programFor(prop({ op: 'modifier', seance: 's1', exercice: 'dips', patch: { mesure: 'au feeling' } }), ctx)).toBeNull()
  })

  it('refuse un patch vide, un exercice inconnu, une séance inconnue, un geste inventé', () => {
    expect(programFor(prop({ op: 'modifier', seance: 's1', exercice: 'dc', patch: {} }), ctx)).toBeNull()
    expect(programFor(prop({ op: 'modifier', seance: 's1', exercice: 'fantome', patch: { nom: 'X' } }), ctx)).toBeNull()
    expect(programFor(prop({ op: 'modifier', seance: 's9', exercice: 'dc', patch: { nom: 'X' } }), ctx)).toBeNull()
    expect(programFor(prop({ op: 'supprimer', seance: 's1', exercice: 'dc' }), ctx)).toBeNull()
  })

  it('refuse des bornes absurdes', () => {
    // 40 séries et 2 secondes de repos passent le typage et donnent un écran
    // inutilisable qu'il faudrait corriger à la main sans savoir d'où ça vient.
    expect(programFor(prop({ op: 'modifier', seance: 's1', exercice: 'dc', de_series: 4, patch: { series: 40 } }), ctx)).toBeNull()
    expect(programFor(prop({ op: 'modifier', seance: 's1', exercice: 'dc', de_repos_s: 120, patch: { repos_s: 2 } }), ctx)).toBeNull()
  })

  it('accepte l’ancien nom du geste, « action », et l’ancien « ordre »', () => {
    // Une session Claude garde sa liste d'outils en cache pendant des heures :
    // refuser l'ancien vocabulaire ferait échouer des propositions claires.
    expect(programFor(prop({ action: 'modifier', seance: 's1', exercice: 'dc', patch: { nom: 'X' } }), ctx)?.op).toBe('modifier')
    expect(programFor(prop({ action: 'ordre', seance: 's2', ordre: ['rowing', 'traction'] }), ctx)?.op).toBe('reordonner')
  })
})

describe('ajouter un exercice', () => {
  const ctx = ctxDe(LIVRE)
  const NEUF = { nom: 'Farmer\'s walk', series: 3, reps: '30-40 s', mesure: 'temps', repos_s: 90, muscles: ['avant-bras', 'abdos'], machine: 'Haltères lourds ou trap bar' }

  it('crée le mouvement, avec son identifiant déduit du nom', () => {
    const plan = programFor(prop({ op: 'ajouter', seance: 's2', ...NEUF }), ctx)
    expect(plan?.op).toBe('ajouter')
    expect(plan?.nouveau).toEqual({
      id: 'farmer-s-walk', name: 'Farmer\'s walk', sets: 3, reps: '30-40 s', rest: 90,
      muscles: ['avant-bras', 'abdos'], cues: [], machine: 'Haltères lourds ou trap bar', mesure: 'temps',
    })
  })

  it('accepte un identifiant choisi, et une position', () => {
    const plan = programFor(prop({ op: 'ajouter', seance: 's2', id: 'farmer-walk', apres: 'traction', ...NEUF }), ctx)
    expect(plan?.nouveau?.id).toBe('farmer-walk')
    expect(plan?.apres).toBe('traction')
  })

  /**
   * L'historique de charges est indexé sur l'identifiant SEUL, pas sur le couple
   * séance + identifiant. Réutiliser « dc » pour un autre mouvement rangerait des
   * séries réellement soulevées sous un exercice qu'on n'a jamais fait.
   */
  it('refuse un identifiant déjà pris, y compris dans une AUTRE séance', () => {
    expect(programFor(prop({ op: 'ajouter', seance: 's1', id: 'rowing', ...NEUF }), ctx)).toBeNull()
    expect(programFor(prop({ op: 'ajouter', seance: 's1', id: 'dc', ...NEUF }), ctx)).toBeNull()
  })

  it('refuse un identifiant déjà pris par un exercice RETIRÉ', () => {
    // Il est retiré du programme, pas de l'historique : ses courbes existent toujours.
    expect(programFor(prop({ op: 'ajouter', seance: 's1', id: 'ecarte', ...NEUF }), ctxDe(LIVRE, ['ecarte']))).toBeNull()
  })

  it('refuse un ajout sans repos : il n’y a pas de défaut à inventer', () => {
    const { repos_s: _, ...sansRepos } = NEUF
    expect(programFor(prop({ op: 'ajouter', seance: 's2', ...sansRepos }), ctx)).toBeNull()
  })

  it('refuse un ajout sans nom, séries ou reps', () => {
    expect(programFor(prop({ op: 'ajouter', seance: 's1', nouveau: { nom: 'Sans rien' } }), ctx)).toBeNull()
    expect(programFor(prop({ op: 'ajouter', seance: 's1', nouveau: { series: 3, reps: '10', repos_s: 60 } }), ctx)).toBeNull()
  })

  it('refuse une position qui n’existe pas, sans repli silencieux', () => {
    // Un exercice de poigne qui atterrit avant un soulevé ruine le soulevé : mieux
    // vaut refuser que de le poser « en fin de séance » sans le dire.
    expect(programFor(prop({ op: 'ajouter', seance: 's2', apres: 'fantome', ...NEUF }), ctx)).toBeNull()
    expect(programFor(prop({ op: 'ajouter', seance: 's2', apres: 'dc', ...NEUF }), ctx)).toBeNull()
  })
})

describe('retirer et réactiver', () => {
  it('retire, et refuse de retirer deux fois', () => {
    const ctx = ctxDe(LIVRE)
    expect(programFor(prop({ op: 'retirer', seance: 's1', exercice: 'ecarte' }), ctx))
      .toEqual({ kind: 'programme', seance: 's1', op: 'retirer', exercice: 'ecarte' })
    expect(programFor(prop({ op: 'retirer', seance: 's1', exercice: 'ecarte' }), ctxDe(LIVRE, ['ecarte']))).toBeNull()
  })

  it('réactive, et refuse de réactiver ce qui est déjà là', () => {
    const apres = ctxDe(LIVRE, ['ecarte'])
    expect(programFor(prop({ op: 'reactiver', seance: 's1', exercice: 'ecarte' }), apres))
      .toEqual({ kind: 'programme', seance: 's1', op: 'reactiver', exercice: 'ecarte' })
    expect(programFor(prop({ op: 'reactiver', seance: 's1', exercice: 'ecarte' }), ctxDe(LIVRE))).toBeNull()
  })

  it('réactive à une position demandée', () => {
    expect(programFor(prop({ op: 'reactiver', seance: 's1', exercice: 'ecarte', apres: 'dips' }), ctxDe(LIVRE, ['ecarte'])))
      .toMatchObject({ op: 'reactiver', apres: 'dips' })
    // « apres » sur un exercice lui-même inactif : refus.
    expect(programFor(prop({ op: 'reactiver', seance: 's1', exercice: 'ecarte', apres: 'dips' }), ctxDe(LIVRE, ['ecarte', 'dips']))).toBeNull()
  })
})

describe('réordonner', () => {
  const ctx = ctxDe(LIVRE)

  it('accepte la liste complète des actifs', () => {
    expect(programFor(prop({ op: 'reordonner', seance: 's1', ordre: ['dips', 'dc', 'ecarte'] }), ctx)?.ordre)
      .toEqual(['dips', 'dc', 'ecarte'])
  })

  /**
   * Une liste partielle est le refus le plus important des cinq.
   *
   * Elle a l'air correcte, elle s'applique, et l'ordre obtenu n'est pas celui qu'on
   * a demandé : les exercices oubliés gardent leur place et s'intercalent. On croit
   * avoir mis la poigne en dernier, elle est toujours au milieu.
   */
  it('refuse une liste incomplète', () => {
    expect(programFor(prop({ op: 'reordonner', seance: 's1', ordre: ['dips', 'dc'] }), ctx)).toBeNull()
  })

  it('refuse un exercice d’une autre séance, un inactif, un doublon, une liste vide', () => {
    expect(programFor(prop({ op: 'reordonner', seance: 's1', ordre: ['dips', 'dc', 'rowing'] }), ctx)).toBeNull()
    expect(programFor(prop({ op: 'reordonner', seance: 's1', ordre: ['dips', 'dc', 'ecarte'] }), ctxDe(LIVRE, ['ecarte']))).toBeNull()
    expect(programFor(prop({ op: 'reordonner', seance: 's1', ordre: ['dc', 'dc', 'dips'] }), ctx)).toBeNull()
    expect(programFor(prop({ op: 'reordonner', seance: 's1', ordre: [] }), ctx)).toBeNull()
  })

  it('la liste des actifs exclut les retirés', () => {
    expect(programFor(prop({ op: 'reordonner', seance: 's1', ordre: ['dips', 'dc'] }), ctxDe(LIVRE, ['ecarte']))?.ordre)
      .toEqual(['dips', 'dc'])
  })
})

describe('les machines de remplacement', () => {
  const ctx = ctxDe(LIVRE)

  it('remplacent la liste, avec leurs coefficients', () => {
    const plan = programFor(prop({
      op: 'modifier', seance: 's1', exercice: 'dc',
      machines_de_remplacement: [{ id: 'dc-guidee', nom: 'Développé guidé', coefficient: 1.15 }],
    }), ctx)
    expect(plan?.variants).toEqual([{ id: 'dc-guidee', name: 'Développé guidé', ratio: 1.15 }])
  })

  it('refusent un coefficient absurde, un doublon, un identifiant vide', () => {
    const cas = [
      [{ id: 'x', nom: 'X', coefficient: 42 }],
      [{ id: 'x', nom: 'X', coefficient: 1 }, { id: 'x', nom: 'Y', coefficient: 1.2 }],
      [{ id: '', nom: 'X', coefficient: 1 }],
      [{ id: 'x', coefficient: 1 }],
    ]
    for (const v of cas) {
      expect(programFor(prop({ op: 'modifier', seance: 's1', exercice: 'dc', machines_de_remplacement: v }), ctx), JSON.stringify(v)).toBeNull()
    }
  })

  it('une liste vide efface les machines de remplacement, et c’est voulu', () => {
    expect(programFor(prop({ op: 'modifier', seance: 's1', exercice: 'dc', machines_de_remplacement: [] }), ctx)?.variants).toEqual([])
  })
})

describe('le geste proposé se rejoue vraiment sur le programme', () => {
  /** Une proposition validée doit produire l'effet annoncé — pas un effet voisin. */
  it('les cinq gestes aboutissent au programme attendu', () => {
    const ctx = ctxDe(LIVRE)
    const p1 = programFor(prop({ op: 'modifier', seance: 's1', exercice: 'dc', de_series: 4, de_repos_s: 120, patch: { series: 5, repos_s: 180 } }), ctx)!
    const p2 = programFor(prop({ op: 'ajouter', seance: 's1', nom: 'Pec deck', series: 3, reps: '12', repos_s: 60, optionnel: true }), ctx)!
    const p3 = programFor(prop({ op: 'retirer', seance: 's1', exercice: 'ecarte' }), ctx)!
    const p4 = programFor(prop({ op: 'reordonner', seance: 's1', ordre: ['dips', 'dc'] }), ctxDe(LIVRE, ['ecarte']))!

    const apres = mergeProgram(LIVRE, {
      patches: { [p1.exercice!]: p1.patch! },
      added: { s1: [p2.nouveau!] },
      disabled: [p3.exercice!],
      order: { s1: p4.ordre! },
    })
    // « pec-deck » est facultatif : il passe en fin de bloc, quoi qu'en dise l'ordre.
    expect(apres[0].exercises.map(e => e.id)).toEqual(['dips', 'dc', 'pec-deck'])
    expect(apres[0].exercises.find(e => e.id === 'dc')).toMatchObject({ sets: 5, rest: 180, reps: '8-10' })
    expect(apres[0].exercises.find(e => e.id === 'pec-deck')).toMatchObject({ optionnel: true })
    // Et l'autre séance n'a pas bougé.
    expect(apres[1].exercises.map(e => e.id)).toEqual(['traction', 'rowing'])
  })

  it('ne répond qu’aux propositions de programme', () => {
    expect(programFor({ ...prop({ op: 'modifier', seance: 's1', exercice: 'dc', patch: { nom: 'X' } }), action: 'plat' }, ctxDe(LIVRE))).toBeNull()
  })

  it('translittère les accents dans un identifiant déduit', () => {
    expect(slugify('Développé incliné haltères')).toBe('developpe-incline-halteres')
    expect(slugify('  Élévations latérales !  ')).toBe('elevations-laterales')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Non-régression : les vingt-trois mouvements livrés.
// ─────────────────────────────────────────────────────────────────────────────
//
// La migration est « silencieuse » — c'est-à-dire qu'il n'y en a pas. `mesure`,
// `optionnel` et `actif` sont absents des fiches livrées, et leurs défauts sont ceux
// du comportement d'avant. Un test plutôt qu'une affirmation : c'est le genre de
// chose dont on est sûr jusqu'au jour où un champ prend la valeur `false` quelque part.

describe('le programme livré traverse la migration sans bouger', () => {
  /**
   * Le programme livré a maintenant des séries au temps — la suspension à la barre,
   * la tenue menton au-dessus. Ce qui doit rester vrai, ce n'est plus « aucune »,
   * c'est que chacune soit COHÉRENTE : une fiche en secondes doit le déclarer, et
   * réciproquement. Sans quoi « 30-45 s » se lit 45 répétitions.
   */
  it('toute fiche qui compte en secondes le déclare, et l’inverse', () => {
    for (const s of PROGRAM) {
      for (const e of s.exercises) {
        const ditSecondes = /\d\s*s\b|sec/.test(e.reps)
        expect(isTimed(e), `${e.id} : reps « ${e.reps} »`).toBe(ditSecondes)
      }
    }
  })

  /**
   * Un exercice FACULTATIF descend en fin de bloc à la fusion. Écrit ailleurs dans
   * le tableau, l'ordre livré et l'ordre affiché divergeraient en silence — et c'est
   * l'ordre affiché qui compte, puisque c'est celui qu'on fait.
   */
  it('les facultatifs sont déjà écrits en fin de séance', () => {
    for (const s of PROGRAM) {
      const ids = s.exercises.map(e => !!e.optionnel)
      const premierFacultatif = ids.indexOf(true)
      if (premierFacultatif < 0) continue
      expect(ids.slice(premierFacultatif).every(Boolean), s.id).toBe(true)
    }
  })

  it('une série au temps est toujours au poids de corps ou chargée explicitement', () => {
    // Un « 30-45 s » sans poids de corps ni machine serait une durée sans charge :
    // rien à enregistrer dans la colonne des kilos, et une courbe plate à vie.
    for (const s of PROGRAM) {
      for (const e of s.exercises) {
        if (isTimed(e)) expect(!!e.bodyweight || !!e.machine, e.id).toBe(true)
      }
    }
  })

  it('la fusion sans modification rend le programme livré à l’identique', () => {
    expect(mergeProgram(PROGRAM)).toEqual(PROGRAM)
    expect(mergeProgram(PROGRAM, {})).toEqual(PROGRAM)
    // Y compris en demandant les inactifs : il n'y en a aucun.
    expect(mergeProgram(PROGRAM, {}, true)).toEqual(PROGRAM)
  })

  it('l’ordre livré ne change pas', () => {
    const avant = PROGRAM.map(s => s.exercises.map(e => e.id))
    expect(mergeProgram(PROGRAM, {}).map(s => s.exercises.map(e => e.id))).toEqual(avant)
  })

  it('tous les exercices livrés portent un repos explicite', () => {
    // `repos_s` devient obligatoire à l'ajout ; les livrés doivent déjà l'avoir,
    // sinon l'outil « programme » annoncerait une valeur déduite qu'un « de_repos_s »
    // ne pourrait pas confronter de façon stable.
    for (const s of PROGRAM) for (const e of s.exercises) expect(typeof e.rest, e.id).toBe('number')
  })
})
