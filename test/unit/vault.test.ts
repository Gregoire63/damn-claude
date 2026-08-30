import { beforeAll, describe, expect, it } from 'vitest'
import { planFor, detailLines, checkFieldFix, twinPath, foodFor, recipeFor } from '../../lib/proposals'
import type { RawProposal } from '../../lib/proposals'

// ─────────────────────────────────────────────────────────────────────────────
// Jetons signés
//
// Il n'y a ni base de sessions ni bibliothèque JWT : la seule chose qui empêche un
// visiteur de se fabriquer un accès au coffre est cette signature. C'est donc le
// morceau à border en premier.
beforeAll(() => { process.env.NUXT_VAULT_SECRET = 'un-secret-de-test-de-plus-de-32-caracteres' })

const vault = async () => import('../../server/utils/vault')

describe('jetons signés', () => {
  it('accepte un jeton qu\'il vient d\'émettre', async () => {
    const { signToken, verifyToken } = await vault()
    const now = Date.parse('2026-08-13T12:00:00Z')
    const t = signToken({ sub: 'gregoire', scope: 'app' }, 3600, now)
    expect(verifyToken(t, now)?.scope).toBe('app')
  })

  it('refuse un jeton dont on a touché le contenu', async () => {
    // Le cas qui compte : quelqu'un décode la charge utile, change la portée pour
    // se donner accès au connecteur, et la renvoie. La signature ne suit pas.
    const { signToken, verifyToken } = await vault()
    const now = Date.now()
    const t = signToken({ sub: 'gregoire', scope: 'app' }, 3600, now)
    const [data, sig] = t.split('.')
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString())
    payload.scope = 'suivi'
    const forged = `${Buffer.from(JSON.stringify(payload)).toString('base64url')}.${sig}`
    expect(verifyToken(forged, now)).toBeNull()
  })

  it('refuse un jeton expiré', async () => {
    const { signToken, verifyToken } = await vault()
    const now = Date.parse('2026-08-13T12:00:00Z')
    const t = signToken({ sub: 'gregoire', scope: 'app' }, 60, now)
    expect(verifyToken(t, now + 59_000)).not.toBeNull()
    expect(verifyToken(t, now + 61_000)).toBeNull()
  })

  it('refuse tout ce qui n\'a pas la forme d\'un jeton', async () => {
    const { verifyToken } = await vault()
    const now = Date.now()
    for (const bad of ['', 'nawak', 'a.b', '.', 'eyJ4IjoxfQ.', undefined, null]) {
      expect(verifyToken(bad as string, now)).toBeNull()
    }
  })

  it('refuse un jeton signé avec un autre secret', async () => {
    const { signToken, verifyToken } = await vault()
    const now = Date.now()
    const t = signToken({ sub: 'x', scope: 'app' }, 60, now)
    process.env.NUXT_VAULT_SECRET = 'un-AUTRE-secret-de-test-de-plus-de-32-car'
    expect(verifyToken(t, now)).toBeNull()
    process.env.NUXT_VAULT_SECRET = 'un-secret-de-test-de-plus-de-32-caracteres'
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Ce qu'une proposition a le droit de changer
//
// C'est la frontière entre du texte venu de l'extérieur et des données qui pilotent
// des calories et une progression. Tout ce qui n'entre pas dans une forme fermée
// doit rendre `null` — pas « au mieux », pas « à peu près ».
const prop = (action: string, patch: Record<string, unknown>): RawProposal => ({
  id: 'x', at: '2026-08-13T12:00:00Z', action, summary: 's', patch, status: 'pending',
})

describe('propositions applicables', () => {
  it('applique un changement de plat bien formé', () => {
    expect(planFor(prop('plat', { date: '2026-08-15', slot: 'lunch', vers: 'din-saumon' })))
      .toEqual({ kind: 'plat', date: '2026-08-15', slot: 'lunch', recipeId: 'din-saumon' })
  })

  it('accepte le retour au plat prévu', () => {
    expect(planFor(prop('plat', { date: '2026-08-15', slot: 'lunch', vers: null })))
      .toEqual({ kind: 'plat', date: '2026-08-15', slot: 'lunch', recipeId: null })
  })

  it('refuse un créneau inconnu', () => {
    expect(planFor(prop('plat', { date: '2026-08-15', slot: 'brunch', vers: 'din-saumon' }))).toBeNull()
  })

  it('refuse une date qui n\'en est pas une', () => {
    for (const date of ['demain', '15/08/2026', '2026-8-15', '', 42]) {
      expect(planFor(prop('plat', { date, slot: 'lunch', vers: 'din-saumon' }))).toBeNull()
    }
  })

  it('refuse un identifiant qui contient autre chose que des mots', () => {
    // Un identifiant est une clé de bibliothèque, pas un texte libre : tout ce qui
    // ressemble à du chemin ou à de l'injection est écarté ici, avant d'atteindre
    // le stockage.
    for (const vers of ['../../etc', 'a b', '<script>', 'x'.repeat(80), 12]) {
      expect(planFor(prop('plat', { date: '2026-08-15', slot: 'lunch', vers }))).toBeNull()
    }
  })

  it('applique un changement de séance, repos compris', () => {
    expect(planFor(prop('planning-seance', { date: '2026-08-15', vers: 's4' })))
      .toEqual({ kind: 'seance', date: '2026-08-15', sessionId: 's4' })
    expect(planFor(prop('planning-seance', { date: '2026-08-15', vers: 'repos' })))
      .toEqual({ kind: 'seance', date: '2026-08-15', sessionId: null })
  })

  it('n\'applique rien automatiquement en dehors de ces deux gestes', () => {
    // Ni une série, ni un poids, ni « autre » : ils s'affichent, ils ne s'écrivent
    // pas. Interpréter une phrase pour réécrire une charge coûterait plus cher
    // qu'un geste manuel.
    for (const action of ['serie', 'poids', 'note-seance', 'autre', '']) {
      expect(planFor(prop(action, { date: '2026-08-15', vers: 's4' }))).toBeNull()
    }
  })

  it('rend le détail lisible, sans jamais déborder', () => {
    const lines = detailLines(prop('plat', Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i]))))
    expect(lines).toHaveLength(8)
    expect(detailLines(prop('plat', { vers: null }))[0]).toEqual({ label: 'vers', value: '—' })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Une semaine entière proposée
//
// C'est la proposition la plus lourde — quatorze repas d'un coup — donc celle qui
// mérite la validation la plus stricte. Le vrai risque n'est pas le format : c'est
// un identifiant de plat plausible mais inexistant, qui donnerait un créneau vide
// le jour où l'on ouvre le frigo.
const CONNUS = new Set(['boite-a', 'boite-b', 'din-saumon', 'din-poulet'])
const connu = { recipeKnown: (id: string) => CONNUS.has(id) }
const jour = (lunch: string, dinner: string) => ({ lunch, dinner })
const semaine = (over: Record<string, unknown> = {}): RawProposal => prop('semaine', {
  lundi: '2026-08-17', // un lundi
  nom: 'Semaine test',
  jours: [
    jour('boite-a', 'din-saumon'), jour('boite-b', 'din-poulet'), jour('boite-a', 'din-saumon'),
    jour('boite-b', 'din-poulet'), jour('boite-a', 'din-saumon'), jour('boite-b', 'din-poulet'),
    jour('boite-a', 'din-saumon'),
  ],
  ...over,
})

describe('semaine proposée', () => {
  it('accepte une semaine complète et bien datée', () => {
    const plan = planFor(semaine(), connu)
    expect(plan?.kind).toBe('semaine')
    expect(plan).toMatchObject({ lundi: '2026-08-17', nom: 'Semaine test' })
    expect((plan as { jours: unknown[] }).jours).toHaveLength(7)
  })

  it('refuse une date qui n\'est pas un lundi', () => {
    // Sinon les jours glissent d'un cran et on ne s'en aperçoit qu'en cuisinant.
    expect(planFor(semaine({ lundi: '2026-08-18' }), connu)).toBeNull()
  })

  it('refuse une semaine qui n\'a pas sept jours', () => {
    expect(planFor(semaine({ jours: [jour('boite-a', 'din-saumon')] }), connu)).toBeNull()
  })

  it('refuse un plat qui n\'existe pas dans sa bibliothèque', () => {
    const j = [...(semaine().patch.jours as Record<string, string>[])]
    j[2] = jour('boite-a', 'din-cassoulet-imaginaire')
    expect(planFor(semaine({ jours: j }), connu)).toBeNull()
    // …et la même semaine passe si le plat existe.
    j[2] = jour('boite-a', 'din-poulet')
    expect(planFor(semaine({ jours: j }), connu)).not.toBeNull()
  })

  it('refuse un créneau inventé', () => {
    const j = [...(semaine().patch.jours as Record<string, string>[])]
    j[0] = { brunch: 'boite-a' } as never
    expect(planFor(semaine({ jours: j }), connu)).toBeNull()
  })

  it('accepte un jour d\'absence, refuse un jour vide', () => {
    const j = [...(semaine().patch.jours as Record<string, unknown>[])]
    j[5] = { off: true }
    expect(planFor(semaine({ jours: j }), connu)).not.toBeNull()
    j[5] = {} // ni absent ni rempli : c'est une ligne oubliée
    expect(planFor(semaine({ jours: j }), connu)).toBeNull()
  })

  it('nomme la semaine toute seule si personne ne l\'a fait', () => {
    const plan = planFor(semaine({ nom: '   ' }), connu)
    expect(plan).toMatchObject({ nom: 'Semaine du 2026-08-17' })
  })

  it('ne valide rien quand la bibliothèque n\'est pas fournie au validateur', () => {
    // Garde-fou : `planFor` sans prédicat accepte tout par défaut, ce qui convient
    // aux autres cibles mais pas ici — l'appelant DOIT passer sa bibliothèque.
    expect(planFor(semaine(), { recipeKnown: () => false })).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Recettes, semaine type, corrections
const ALIMENTS = new Set(['saumon', 'riz', 'brocolis', 'huile-olive'])
const CTX = {
  recipeKnown: (id: string) => CONNUS.has(id),
  foodKnown: (id: string) => ALIMENTS.has(id),
  setAt: (ex: string, date: string, i: number) =>
    (ex === 'squat' && date === '2026-08-13' && i === 2 ? { w: 425, r: 8 } : null),
  weightAt: (date: string) => (date === '2026-08-12' ? 77.4 : null),
}
const recette = (over: Record<string, unknown> = {}): RawProposal => prop('recette', {
  nom: 'Saumon riz brocolis',
  kind: 'diner',
  items: [{ food: 'saumon', g: 150 }, { food: 'riz', g: 80 }, { food: 'brocolis', g: 200 }],
  ...over,
})

describe('recette proposée', () => {
  it('accepte une recette dont tous les ingrédients existent', () => {
    const plan = planFor(recette(), CTX)
    expect(plan?.kind).toBe('recette')
    expect(plan).toMatchObject({ id: null })
    expect((plan as { recette: { items: unknown[] } }).recette.items).toHaveLength(3)
  })

  it('refuse un ingrédient inconnu', () => {
    // C'est l'erreur la plus coûteuse : elle ne fait pas planter l'app, elle produit
    // un plat dont les macros sont fausses — et ça se propage dans les calories.
    expect(planFor(recette({ items: [{ food: 'saumon-fume', g: 150 }] }), CTX)).toBeNull()
  })

  it('refuse un type de plat qui n\'existe pas, et une quantité absurde', () => {
    expect(planFor(recette({ kind: 'brunch' }), CTX)).toBeNull()
    expect(planFor(recette({ items: [{ food: 'riz', g: 99999 }] }), CTX)).toBeNull()
    expect(planFor(recette({ items: [] }), CTX)).toBeNull()
  })

  it('refuse de modifier une recette qui n\'existe pas', () => {
    // Sinon on croit patcher et on crée un doublon sous un identifiant imposé.
    expect(planFor(recette({ id: 'din-inexistant' }), CTX)).toBeNull()
    expect(planFor(recette({ id: 'din-saumon' }), CTX)).not.toBeNull()
  })
})

describe('semaine type', () => {
  it('accepte les trois axes, séparément', () => {
    expect(planFor(prop('semaine-type', { seances: ['s1', 's2', null, 's3', 's4', null, null] }), CTX))
      .toMatchObject({ kind: 'semaine-type', seances: ['s1', 's2', null, 's3', 's4', null, null] })
    expect(planFor(prop('semaine-type', { salle: [true, true, false, true, true, false, false] }), CTX))
      .toMatchObject({ kind: 'semaine-type' })
  })

  it('refuse une séance inconnue, une semaine incomplète, ou rien du tout', () => {
    expect(planFor(prop('semaine-type', { seances: ['s1', 's9', null, 's3', 's4', null, null] }), CTX)).toBeNull()
    expect(planFor(prop('semaine-type', { seances: ['s1'] }), CTX)).toBeNull()
    expect(planFor(prop('semaine-type', { salle: [true, false] }), CTX)).toBeNull()
    expect(planFor(prop('semaine-type', {}), CTX)).toBeNull()
  })
})

describe('correction de donnée', () => {
  it('accepte une correction dont la valeur de départ correspond', () => {
    // Le vrai cas : le 425 kg tapé de travers sur un exercice, qui avait ruiné une
    // régression. On le remplace par 42,5 kg.
    const plan = planFor(prop('correction', {
      quoi: 'serie', exercice: 'squat', date: '2026-08-13', serie: 2,
      de: { w: 425, r: 8 }, vers: { w: 42.5, r: 8 },
    }), CTX)
    expect(plan).toEqual({ kind: 'correction-serie', exercice: 'squat', date: '2026-08-13', index: 2, vers: { w: 42.5, r: 8 } })
  })

  it('REFUSE si la valeur en place n\'est pas celle qu\'on croyait remplacer', () => {
    // C'est la garde qui rend la correction acceptable. Le miroir peut avoir des
    // heures de retard : sans elle, on écraserait une correction déjà faite.
    expect(planFor(prop('correction', {
      quoi: 'serie', exercice: 'squat', date: '2026-08-13', serie: 2,
      de: { w: 100, r: 8 }, vers: { w: 42.5, r: 8 },
    }), CTX)).toBeNull()
  })

  it('refuse une série qui n\'existe pas', () => {
    expect(planFor(prop('correction', {
      quoi: 'serie', exercice: 'squat', date: '2026-08-13', serie: 9,
      de: { w: 425, r: 8 }, vers: { w: 42.5, r: 8 },
    }), CTX)).toBeNull()
    expect(planFor(prop('correction', {
      quoi: 'serie', exercice: 'nawak', date: '2026-08-13', serie: 2,
      de: { w: 425, r: 8 }, vers: { w: 42.5, r: 8 },
    }), CTX)).toBeNull()
  })

  it('corrige ou supprime une pesée, valeur de départ vérifiée', () => {
    expect(planFor(prop('correction', { quoi: 'pesee', date: '2026-08-12', de: 77.4, vers: 76.9 }), CTX))
      .toEqual({ kind: 'correction-pesee', date: '2026-08-12', vers: 76.9 })
    expect(planFor(prop('correction', { quoi: 'pesee', date: '2026-08-12', de: 77.4, vers: null }), CTX))
      .toEqual({ kind: 'correction-pesee', date: '2026-08-12', vers: null })
    // Mauvaise valeur de départ, ou date sans pesée : refus.
    expect(planFor(prop('correction', { quoi: 'pesee', date: '2026-08-12', de: 80, vers: 76.9 }), CTX)).toBeNull()
    expect(planFor(prop('correction', { quoi: 'pesee', date: '2026-08-11', de: 77.4, vers: 76.9 }), CTX)).toBeNull()
  })

  it('refuse un poids qui n\'a pas de sens humain', () => {
    expect(planFor(prop('correction', { quoi: 'pesee', date: '2026-08-12', de: 77.4, vers: 7.7 }), CTX)).toBeNull()
    expect(planFor(prop('correction', { quoi: 'pesee', date: '2026-08-12', de: 77.4, vers: 770 }), CTX)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// La correction de n'importe quel champ
//
// Le passe-partout existe parce que figer une liste de champs modifiables
// condamnait à revenir en ajouter un à chaque besoin — la durée d'une séance, par
// exemple, n'y était pas. Il n'assouplit rien sur la garde : le chemin doit
// exister, la valeur de départ doit correspondre, et on n'écrit qu'un scalaire.
const SNAP = () => ({
  sessions: [{ at: '2026-08-13T13:00', name: 'Jambes', durationMin: 50, entries: [] }],
  bodyWeight: [{ date: '2026-08-12', kg: 77.4 }],
  profile: { heightCm: 179, sex: 'h', birthYear: 1997 },
})
const CTX_CHAMP = { ...CTX, snapshot: SNAP }
const champ = (patch: Record<string, unknown>) => prop('correction', { quoi: 'champ', ...patch })

describe('correction d\'un champ quelconque', () => {
  it('accepte une durée de séance corrigée', () => {
    expect(planFor(champ({ chemin: '/sessions/0/durationMin', de: 50, vers: 65 }), CTX_CHAMP))
      .toEqual({ kind: 'correction-champ', chemin: '/sessions/0/durationMin', op: 'remplacer', vers: 65 })
  })

  it('accepte un texte et un booléen, pas seulement des nombres', () => {
    expect(planFor(champ({ chemin: '/sessions/0/name', de: 'Jambes', vers: 'Jambes (léger)' }), CTX_CHAMP))
      .toMatchObject({ vers: 'Jambes (léger)' })
    expect(planFor(champ({ chemin: '/profile/sex', de: 'h', vers: 'h' }), CTX_CHAMP)).not.toBeNull()
  })

  it('REFUSE si la valeur en place n\'est pas celle qu\'on croyait remplacer', () => {
    expect(planFor(champ({ chemin: '/sessions/0/durationMin', de: 45, vers: 65 }), CTX_CHAMP)).toBeNull()
  })

  it('tolère un nombre écrit en texte dans « de »', () => {
    // « 50 » et 50 désignent la même durée ; refuser pour ça n'aiderait personne.
    expect(planFor(champ({ chemin: '/sessions/0/durationMin', de: '50', vers: 65 }), CTX_CHAMP)).not.toBeNull()
  })

  it('refuse un chemin qui ne mène nulle part', () => {
    for (const chemin of ['/sessions/9/durationMin', '/profile/poids', 'sessions/0', '']) {
      expect(planFor(champ({ chemin, de: 50, vers: 65 }), CTX_CHAMP)).toBeNull()
    }
  })

  it('refuse d\'écraser un objet ou une liste', () => {
    expect(planFor(champ({ chemin: '/sessions/0', de: 'x', vers: 'y' }), CTX_CHAMP)).toBeNull()
    expect(planFor(champ({ chemin: '/sessions', de: 'x', vers: 'y' }), CTX_CHAMP)).toBeNull()
  })

  it('refuse une valeur de remplacement qui n\'est pas simple', () => {
    expect(planFor(champ({ chemin: '/sessions/0/durationMin', de: 50, vers: { a: 1 } }), CTX_CHAMP)).toBeNull()
  })

  it('ne peut rien faire sans instantané : pas de vérification, pas d\'écriture', () => {
    // Sans la valeur en place, « corriger » redeviendrait « écrire par-dessus ».
    expect(planFor(champ({ chemin: '/sessions/0/durationMin', de: 50, vers: 65 }), CTX)).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// La garde côté serveur
//
// `planFor` protège les DONNÉES : elle refuse d'appliquer une proposition
// incohérente. Elle ne protège pas l'ATTENTION — une proposition invalide arrive
// quand même dans la boîte, et c'est Grégoire qui la lit, comprend qu'elle est
// inapplicable et la range. Le serveur a le miroir sous la main au moment du dépôt ;
// s'il se tait, il déplace le coût de mon erreur sur lui.
const DATA = {
  sessions: [{ at: '2026-08-13T13:00', name: 'Jambes', durationMin: 50, entries: [] }],
  logs: { squat: [{ date: '2026-08-13', sets: [{ kg: 60, reps: 8 }], durationMin: 50 }] },
  profile: { heightCm: 179, sex: 'h', birthYear: 1997 },
}
const refuse = (detail: Record<string, unknown>, motif: RegExp) =>
  expect(() => checkFieldFix(detail, DATA)).toThrow(motif)

describe('vérification au dépôt d\'une correction de champ', () => {
  it('laisse passer une correction cohérente', () => {
    expect(() => checkFieldFix({ chemin: '/sessions/0/durationMin', de: 50, vers: 65 }, DATA)).not.toThrow()
  })

  it('rend la valeur réelle quand « de » se trompe, pour que je puisse me corriger', () => {
    refuse({ chemin: '/sessions/0/durationMin', de: 99, vers: 65 }, /vaut 50, pas 99/)
  })

  it('tolère le nombre écrit en texte', () => {
    expect(() => checkFieldFix({ chemin: '/sessions/0/durationMin', de: '50', vers: 65 }, DATA)).not.toThrow()
  })

  it('refuse un chemin absent, un objet, une liste', () => {
    refuse({ chemin: '/sessions/0/nawak', de: 1, vers: 2 }, /Aucune valeur/)
    refuse({ chemin: '/sessions/0', de: 1, vers: 2 }, /un objet/)
    refuse({ chemin: '/sessions', de: 1, vers: 2 }, /une liste/)
    refuse({ chemin: '', de: 1, vers: 2 }, /obligatoire/)
  })

  it('refuse une valeur de remplacement composite, et exige « de »', () => {
    refuse({ chemin: '/sessions/0/durationMin', de: 50, vers: { a: 1 } }, /valeur simple/)
    refuse({ chemin: '/sessions/0/durationMin', vers: 65 }, /« de » est obligatoire/)
  })

  it('détourne vers le champ réellement affiché', () => {
    // La durée est recopiée sur chaque exercice de la séance, et cette copie-là
    // n'est lue nulle part. Corriger la copie « réussirait » sans rien changer à
    // l'écran — c'est le pire des retours possibles.
    expect(twinPath('/logs/squat/0/durationMin', DATA)).toBe('/sessions/0/durationMin')
    refuse({ chemin: '/logs/squat/0/durationMin', de: 50, vers: 65 }, /Corrige \/sessions\/0\/durationMin/)
  })

  it('ne détourne rien quand il n\'y a pas de jumeau', () => {
    expect(twinPath('/sessions/0/durationMin', DATA)).toBeNull()
    expect(twinPath('/logs/squat/0/date', DATA)).toBeNull()
    // Une séance sans journal correspondant : pas de jumeau à désigner.
    expect(twinPath('/logs/squat/0/durationMin', { logs: DATA.logs, sessions: [] })).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Le repas du dehors, proposé depuis une conversation
//
// C'est la seule forme où Claude apporte des CHIFFRES au lieu d'un identifiant à
// vérifier contre un catalogue. Rien ne peut donc l'invalider de l'extérieur — d'où
// les bornes, et d'où le marquage de provenance.
const libre = (detail: Record<string, unknown>) => prop('repas-libre', detail)

describe('proposition de repas du dehors', () => {
  it('accepte un repas complet et marque sa provenance', () => {
    expect(planFor(libre({ date: '2026-08-14', slot: 'lunch', vers: { label: 'Kebab', kcal: 1050, p: 45, g: 95, l: 50 } }), CTX))
      .toEqual({ kind: 'repas-libre', date: '2026-08-14', slot: 'lunch',
                 repas: { label: 'Kebab', kcal: 1050, p: 45, g: 95, l: 50, from: 'claude' } })
  })

  it('accepte les champs à plat, sans enveloppe « vers »', () => {
    expect(planFor(libre({ date: '2026-08-14', creneau: 'dinner', label: 'Pizza', kcal: 800, proteines: 32 }), CTX))
      .toMatchObject({ slot: 'dinner', repas: { label: 'Pizza', kcal: 800, p: 32, g: 0, l: 0 } })
  })

  it('retire le repas sur « vers: null », rendant le créneau au plat prévu', () => {
    expect(planFor(libre({ date: '2026-08-14', slot: 'lunch', vers: null }), CTX))
      .toEqual({ kind: 'repas-libre', date: '2026-08-14', slot: 'lunch', repas: null })
  })

  it('refuse un créneau inconnu et une date qui n\'en est pas une', () => {
    expect(planFor(libre({ date: '2026-08-14', slot: 'gouter', vers: { label: 'X', kcal: 300 } }), CTX)).toBeNull()
    expect(planFor(libre({ date: 'demain', slot: 'lunch', vers: { label: 'X', kcal: 300 } }), CTX)).toBeNull()
  })

  it('refuse un repas qui occuperait le créneau sans rien y compter', () => {
    expect(planFor(libre({ date: '2026-08-14', slot: 'lunch', vers: { label: 'Kebab' } }), CTX)).toBeNull()
    expect(planFor(libre({ date: '2026-08-14', slot: 'lunch', vers: { kcal: 900 } }), CTX)).toBeNull()
  })

  it('impose « claude » comme provenance, même si la proposition prétend autre chose', () => {
    // Sans ça, une valeur estimée pourrait se relire plus tard comme une étiquette lue.
    expect(planFor(libre({ date: '2026-08-14', slot: 'lunch', vers: { label: 'Kebab', kcal: 1050, from: 'catalogue' } }), CTX))
      .toMatchObject({ repas: { from: 'claude' } })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Créer un ingrédient
//
// C'est la brique sous les recettes : sans elle, impossible de proposer un plat
// contenant quoi que ce soit de nouveau. Et c'est celle où une erreur se voit le
// moins — des macros mal recopiées ne font rien planter, elles faussent les
// calories, les courses et le déficit, pour toujours.
const alim = (patch: Record<string, unknown>) => prop('aliment', patch)
const CTX_FOOD = { foodKnown: (id: string) => id === 'riz-basmati', recipeKnown: (id: string) => id === 'sauce-blanche' }

describe('proposition d\'aliment', () => {
  it('accepte un aliment cohérent', () => {
    expect(foodFor(alim({ nom: 'Skyr nature', cat: 'laitiers', kcal: 60, p: 11, g: 4, l: 0.2 }), CTX_FOOD))
      .toEqual({ kind: 'aliment', id: null, aliment: { name: 'Skyr nature', cat: 'laitiers', kcal: 60, p: 11, g: 4, l: 0.2 } })
  })

  it('garde la cuisson, le repère d\'achat et la conservation', () => {
    const out = foodFor(alim({
      nom: 'Chou-fleur', cat: 'legumes', kcal: 25, p: 2, g: 3, l: 0.3,
      cuisson: '7 min vapeur', achat: '1 tête ≈ 800 g', conservation: 5,
    }), CTX_FOOD)
    expect(out?.aliment).toMatchObject({ cook: '7 min vapeur', buy: '1 tête ≈ 800 g', keeps: 5 })
  })

  it('REFUSE des macros qui n\'expliquent pas les calories', () => {
    // 11×4 + 4×4 + 0,2×9 = 62 kcal, pas 300. Une étiquette mal recopiée.
    expect(foodFor(alim({ nom: 'Skyr', cat: 'laitiers', kcal: 300, p: 11, g: 4, l: 0.2 }), CTX_FOOD)).toBeNull()
  })

  it('tolère l\'écart normal d\'une étiquette', () => {
    // Fibres, polyols et arrondis du fabricant en produisent légitimement.
    expect(foodFor(alim({ nom: 'Pain complet', cat: 'feculents', kcal: 250, p: 10, g: 43, l: 3 }), CTX_FOOD)).not.toBeNull()
  })

  it('refuse une catégorie inventée : la liste de courses est groupée par catégorie', () => {
    expect(foodFor(alim({ nom: 'X', cat: 'superaliments', kcal: 60, p: 11, g: 4, l: 0.2 }), CTX_FOOD)).toBeNull()
  })

  it('refuse ce qui ne tient pas dans 100 g, et les valeurs absurdes', () => {
    expect(foodFor(alim({ nom: 'X', cat: 'legumes', kcal: 800, p: 60, g: 60, l: 60 }), CTX_FOOD)).toBeNull()
    expect(foodFor(alim({ nom: 'X', cat: 'legumes', kcal: -5, p: 1, g: 1, l: 1 }), CTX_FOOD)).toBeNull()
    expect(foodFor(alim({ nom: '', cat: 'legumes', kcal: 20, p: 1, g: 3, l: 0 }), CTX_FOOD)).toBeNull()
  })

  it('ne prétend pas corriger un aliment qui n\'existe pas', () => {
    expect(foodFor(alim({ id: 'nawak', nom: 'X', cat: 'legumes', kcal: 20, p: 1, g: 3, l: 0 }), CTX_FOOD)).toBeNull()
    expect(foodFor(alim({ id: 'riz-basmati', nom: 'Riz basmati', cat: 'feculents', kcal: 350, p: 8, g: 78, l: 1 }), CTX_FOOD))
      .toMatchObject({ id: 'riz-basmati' })
  })
})

describe('recette : la sauce et la conservation ne se perdent plus', () => {
  const rec = (patch: Record<string, unknown>) => prop('recette', patch)
  const base = { nom: 'Riz sauce', kind: 'diner', items: [{ food: 'riz-basmati', g: 80 }] }

  it('transmet la sauce et la conservation quand elles sont données', () => {
    const out = recipeFor(rec({ ...base, sauce: 'sauce-blanche', conservation: 4 }), CTX_FOOD)
    expect(out?.recette).toMatchObject({ sauce: 'sauce-blanche', keeps: 4 })
  })

  it('ne les invente pas quand elles sont absentes : la fusion garde l\'existant', () => {
    const out = recipeFor(rec(base), CTX_FOOD)
    expect(out?.recette).not.toHaveProperty('sauce')
    expect(out?.recette).not.toHaveProperty('keeps')
  })

  it('refuse une sauce qui n\'existe pas, plutôt que de casser le lien', () => {
    expect(recipeFor(rec({ ...base, sauce: 'sauce-inventee' }), CTX_FOOD)).toBeNull()
  })
})
