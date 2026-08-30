import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { phraseBilan } from '../../composables/useRestauration'

// ─────────────────────────────────────────────────────────────────────────────
// Charger le pack d'exemple, c'est restaurer une sauvegarde.
// ─────────────────────────────────────────────────────────────────────────────
//
// L'application ne livre plus rien. Le contenu d'origine est servi en statique
// (`public/exemple.json`) et rentre par la porte de la restauration, ce qui lui donne
// la seule propriété qui compte : il arrive en contenu PERSONNEL, donc modifiable et
// SUPPRIMABLE. Un exemple qu'on ne peut pas retirer n'est pas un exemple.
//
// Ces tests ne posent AUCUN mock de données : ils partent d'une application vide,
// exactement comme une installation neuve, et vérifient qu'elle se remplit.

const PACK = JSON.parse(readFileSync('public/exemple.json', 'utf8'))

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(PACK), { status: 200 })))
})

const charger = async () => {
  const { useRestauration } = await import('../../composables/useRestauration')
  return useRestauration()
}

describe('le pack d’exemple', () => {
  it('remplit une application vide, et son contenu devient personnel', async () => {
    const { useProgram } = await import('../../composables/useProgram')
    const { useNutrition } = await import('../../composables/useNutrition')
    const prog = useProgram(); prog.hydrate()
    const nut = useNutrition(); nut.hydrate()

    expect(prog.program.value).toEqual([])
    expect(nut.userFoods.value).toEqual([])

    expect((await (await charger()).chargerExemple()).ok).toBe(true)

    expect(prog.program.value).toHaveLength(4)
    expect(nut.userFoods.value.length).toBeGreaterThan(100)
    expect(nut.userRecipes.value.length).toBeGreaterThan(30)
    // Deux semaines de menus, et PERSONNELLES : `restore()` jette celles qui portent
    // encore le drapeau `builtin`, et on ne s'en apercevrait qu'en cherchant ses menus.
    expect(nut.menus.value.filter(m => !m.builtin)).toHaveLength(2)
  })

  /**
   * Un exemple qui n'affiche rien n'est pas un exemple.
   *
   * Le pack a d'abord porté le seul contenu : quatre séances, un catalogue, deux
   * semaines de menus. Chargé, l'application restait muette — aucune séance dans la
   * semaine, aucune semaine de menus active, donc aucun déjeuner ni dîner. On voyait
   * un catalogue, pas une application qui marche.
   */
  it('apporte le rythme, pas seulement le contenu', async () => {
    const { useProfile } = await import('../../composables/useProfile')
    const { useNutrition } = await import('../../composables/useNutrition')
    const prof = useProfile(); prof.hydrate()
    const nut = useNutrition(); nut.hydrate()
    expect((await (await charger()).chargerExemple()).ok).toBe(true)

    expect(prof.weekPlan.value).toEqual(['s1', 's2', null, 's3', 's4', null, null])
    expect(nut.week.value.gym).toEqual([true, true, false, true, true, false, false])
    expect(nut.activeWeek.value).not.toBeNull()
    // Et la journée se remplit vraiment : un déjeuner, un dîner, des calories.
    expect(nut.dayFor('2026-08-03').gym).toBe(true)
  })

  /**
   * Le profil ne s'importe PAS avec l'exemple.
   *
   * Taille, année de naissance et sexe décident du métabolisme de base, donc de toute
   * la cible calorique. Les livrer avec l'exemple donnerait à chacun le métabolisme
   * d'une autre personne — et une cible fausse ne se voit pas, elle se mange.
   */
  it('ne prétend pas connaître la taille ni l’âge de qui l’importe', async () => {
    const { useProfile } = await import('../../composables/useProfile')
    const p = useProfile(); p.hydrate()
    expect((await (await charger()).chargerExemple()).ok).toBe(true)
    expect(p.profile.value.heightCm).toBeNull()
    expect(p.profile.value.birthYear).toBeNull()
  })

  it('survit au rechargement — il a bien été écrit, pas seulement affiché', async () => {
    expect((await (await charger()).chargerExemple()).ok).toBe(true)
    vi.resetModules()
    const { useProgram } = await import('../../composables/useProgram')
    const p = useProgram(); p.hydrate()
    expect(p.program.value).toHaveLength(4)
  })

  it('se retire : une séance chargée s’enlève comme n’importe quelle séance créée', async () => {
    expect((await (await charger()).chargerExemple()).ok).toBe(true)
    const { useProgram } = await import('../../composables/useProgram')
    const p = useProgram(); p.hydrate()
    expect(p.removeSession('s1')).toBe(true)
    expect(p.program.value.map(s => s.id)).not.toContain('s1')
  })

  /**
   * Le piège qui a réellement cassé l'écran.
   *
   * `restoreData` prenait tout fichier SANS clé `logs` pour l'ancien format d'export,
   * où le fichier n'était QUE le journal des charges. Le pack d'exemple n'a pas de
   * `logs` : il devenait donc le journal, et la première lecture de charges tombait
   * sur `{ _apropos: "…", programme: {…} }`. L'accueil disparaissait derrière un
   * « Cannot read properties of undefined ».
   */
  it('ne touche PAS au journal des charges', async () => {
    const { useWorkout } = await import('../../composables/useWorkout')
    const w = useWorkout()
    w.setAt('squat', '2026-08-01', [{ w: 100, r: 5 }])
    const avant = JSON.parse(JSON.stringify(w.logs.value))

    expect((await (await charger()).chargerExemple()).ok).toBe(true)
    expect(w.logs.value).toEqual(avant)
  })

  it('reconnaît quand même l’ancien format, où le fichier n’était que le journal', async () => {
    const { useWorkout } = await import('../../composables/useWorkout')
    const w = useWorkout()
    w.restoreData({ squat: [{ at: '2026-08-01', sets: [{ w: 100, r: 5 }] }] } as never)
    expect(Object.keys(w.logs.value)).toEqual(['squat'])
  })

  it('dit non plutôt que de casser quand le fichier n’est pas là', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })))
    const b = await (await charger()).chargerExemple()
    expect(b.ok).toBe(false)
    expect(b.erreur).toMatch(/indisponible/)
  })
})

describe('les données de démonstration', () => {
  /**
   * `seedDemo` simule dix séances passées pour que les écrans aient quelque chose à
   * montrer en développement. Il tirait sa séance dans `prog.value[k % longueur]` :
   * programme vide, c'est `prog.value[NaN]`, et la ligne suivante lit ses exercices.
   *
   * Le cas est devenu le cas NORMAL — toute installation neuve démarre sans
   * programme — et il tombait à l'ouverture, avant que quoi que ce soit s'affiche.
   */
  it('ne tentent rien tant qu’il n’y a pas de programme', async () => {
    const { useWorkout } = await import('../../composables/useWorkout')
    const w = useWorkout()
    expect(() => w.seedDemo()).not.toThrow()
    expect(w.sessionLog()).toEqual([])
  })

  it('se posent dès qu’une séance existe', async () => {
    expect((await (await charger()).chargerExemple()).ok).toBe(true)
    const { useWorkout } = await import('../../composables/useWorkout')
    const { useProgram } = await import('../../composables/useProgram')
    useProgram().hydrate()
    const w = useWorkout()
    w.seedDemo()
    expect(w.sessionLog().length).toBeGreaterThan(0)
  })
})


// ─────────────────────────────────────────────────────────────────────────────
// Une sauvegarde d'AVANT le vidage de `data/`.
// ─────────────────────────────────────────────────────────────────────────────
//
// C'est le cas qui a cassé pour de vrai, et il n'a rien d'exotique : c'est celui de
// tous ceux qui utilisaient l'application avant. Leur sauvegarde ne contient que les
// ÉCARTS au programme livré — des patches indexés par « squat », un planning qui
// nomme « s3 », un journal de charges indexé par exercice. Restaurée telle quelle
// dans une application qui ne livre plus rien, elle rendait un accueil vide avec le
// texte de premier lancement, et une coche verte « Données importées ✓ ».
//
// Rien n'était perdu : il manquait le SOCLE, c'est-à-dire exactement le contenu que
// l'application livrait quand cette sauvegarde a été faite — le pack d'exemple.

const VIEILLE_SAUVEGARDE = () => ({
  logs: { squat: [{ at: '2026-08-01', sets: [{ w: 100, r: 5 }] }] },
  bodyWeight: [{ date: '2026-08-01', kg: 91.9 }],
  sessions: [{ at: '2026-08-01T18:30', sessionId: 's3', name: 'Jambes', durationMin: 50, entries: [] }],
  profile: { heightCm: 179, sex: 'h', birthYear: 1997 },
  weekPlan: ['s1', 's2', null, 's3', 's4', null, null],
  // Le marqueur : un « programme » SANS « sessions ». Le champ n'existait pas.
  programme: { patches: { squat: { sets: 5 } }, disabled: ['releves'] },
  nutrition: { userFoods: [], userRecipes: [], menus: [] },
})

describe('une sauvegarde d’avant le vidage de data/', () => {
  it('retrouve ses séances : le socle manquant est remis dessous', async () => {
    const { useProgram } = await import('../../composables/useProgram')
    const p = useProgram(); p.hydrate()
    expect(p.program.value).toEqual([])

    const b = await (await charger()).restaurerTout(VIEILLE_SAUVEGARDE())

    expect(b.rebase).toBe(true)
    expect(b.seances).toBe(4)
    expect(p.program.value.map(s => s.id)).toEqual(['s1', 's2', 's3', 's4'])
  })

  it('et ses réglages s’appliquent dessus, au lieu de rester orphelins', async () => {
    const { useProgram } = await import('../../composables/useProgram')
    const p = useProgram(); p.hydrate()
    await (await charger()).restaurerTout(VIEILLE_SAUVEGARDE())

    // Le patch portait sur un exercice du programme livré : il doit mordre.
    expect(p.exerciseById('squat')?.sets).toBe(5)
    // Et le retrait aussi — sinon un mouvement abandonné reviendrait dans la séance.
    expect(p.program.value.flatMap(x => x.exercises).map(e => e.id)).not.toContain('releves')
  })

  it('remet aussi le catalogue, sans quoi les menus ne désignent rien', async () => {
    const { useNutrition } = await import('../../composables/useNutrition')
    const n = useNutrition(); n.hydrate()
    const b = await (await charger()).restaurerTout(VIEILLE_SAUVEGARDE())
    expect(b.aliments).toBeGreaterThan(100)
    expect(b.recettes).toBeGreaterThan(30)
    expect(n.activeWeek.value).not.toBeNull()
  })

  it('ne touche ni au journal ni aux pesées', async () => {
    const { useWorkout } = await import('../../composables/useWorkout')
    const w = useWorkout()
    const b = await (await charger()).restaurerTout(VIEILLE_SAUVEGARDE())
    expect(b.journal).toBe(1)
    expect(b.pesees).toBe(1)
    expect(w.logs.value.squat).toHaveLength(1)
  })

  it('laisse gagner SES données sur celles de l’exemple', async () => {
    // Le rattrapage ajoute, il n'écrase jamais : un aliment personnel qui porte un
    // identifiant du catalogue livré est le sien, pas celui d'origine.
    const { useNutrition } = await import('../../composables/useNutrition')
    const n = useNutrition(); n.hydrate()
    const v = VIEILLE_SAUVEGARDE()
    v.nutrition.userFoods = [{ id: 'pomme', name: 'MA pomme', cat: 'fruits', kcal: 52, p: 0.3, g: 12, l: 0.2 } as never]
    await (await charger()).restaurerTout(v)
    expect(n.library.value.foods.pomme?.name).toBe('MA pomme')
  })

  it('ne se déclenche PAS sur une sauvegarde récente', async () => {
    // Une sauvegarde faite depuis porte « sessions », même vide. Rebaser sur
    // l'exemple lui rendrait quatre séances que son auteur avait supprimées.
    const { useProgram } = await import('../../composables/useProgram')
    const p = useProgram(); p.hydrate()
    const b = await (await charger()).restaurerTout({ programme: { sessions: [] }, nutrition: { userFoods: [] } })
    expect(b.rebase).toBe(false)
    expect(p.program.value).toEqual([])
  })

  it('rejoué deux fois, ne double rien', async () => {
    const { useProgram } = await import('../../composables/useProgram')
    const p = useProgram(); p.hydrate()
    const r = await charger()
    await r.restaurerTout(VIEILLE_SAUVEGARDE())
    await r.restaurerTout(VIEILLE_SAUVEGARDE())
    expect(p.program.value.map(s => s.id)).toEqual(['s1', 's2', 's3', 's4'])
  })
})

describe('le message affiché après un import', () => {
  /**
   * « Données importées ✓ » était affiché quoi qu'il arrive — y compris le jour où
   * l'import a rendu une application vide. Une coche ne se confronte à rien ; des
   * chiffres se confrontent à ce qu'on attendait.
   */
  it('donne des chiffres vérifiables, pas une coche', () => {
    const t = phraseBilan({ ok: true, rebase: false, seances: 4, aliments: 152, recettes: 34, menus: 2, journal: 12, pesees: 60 })
    expect(t).toContain('4 séances')
    expect(t).toContain('34 plats')
    expect(t).toContain('60 pesées')
  })

  it('dit quand le socle a dû être rétabli', () => {
    const t = phraseBilan({ ok: true, rebase: true, seances: 4, aliments: 152, recettes: 34, menus: 2, journal: 0, pesees: 0 })
    expect(t).toMatch(/exemple/)
  })

  it('ne fait pas passer un échec pour une réussite', () => {
    expect(phraseBilan({ ok: false, erreur: 'Fichier illisible.', rebase: false, seances: 0, aliments: 0, recettes: 0, menus: 0, journal: 0, pesees: 0 }))
      .toBe('Fichier illisible.')
  })

  it('ne prétend pas avoir importé quelque chose quand il n’y avait rien', () => {
    expect(phraseBilan({ ok: true, rebase: false, seances: 0, aliments: 0, recettes: 0, menus: 0, journal: 0, pesees: 0 }))
      .toMatch(/rien de reconnaissable/)
  })
})
