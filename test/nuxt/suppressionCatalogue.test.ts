import { beforeEach, describe, expect, it, vi } from 'vitest'
import { poserSemaineExemple } from '../exemple'

// ─────────────────────────────────────────────────────────────────────────────
// Supprimer un plat, et ce que ça ne doit PAS emporter.
// ─────────────────────────────────────────────────────────────────────────────
//
// Il n'y avait qu'une croix, sur la carte d'un plat, sans un mot. Elle retirait le
// plat de la bibliothèque et laissait tout le reste en place : ses créneaux dans les
// semaines types, les jours où on l'avait imposé, les plats qui le servaient en
// sauce. Rien ne cassait — c'est bien le problème. `buildDay` saute un plat
// introuvable, donc le repas disparaissait d'une journée sans laisser de trace, et
// le total baissait de six cents kilocalories qu'on allait chercher ailleurs.
//
// Ce fichier tient les deux bouts d'une contrainte qui se contredit presque :
//
//   · le plat doit CESSER d'exister partout où l'on choisit quoi manger ;
//   · il doit CONTINUER d'exister partout où l'on regarde ce qu'on a mangé.
//
// Les totaux d'une journée passée ne sont stockés nulle part : ils se recalculent
// depuis la bibliothèque et depuis la semaine type. D'où DEUX règles, et la seconde
// s'est payée en la vérifiant dans un navigateur :
//
//  1. le plat est MARQUÉ, pas effacé — sinon un mardi de mars perd son dîner parce
//     qu'on a fait le ménage en septembre ;
//  2. la semaine type n'est PAS nettoyée. Vider ses créneaux semblait être le
//     ménage à faire ; c'est le même défaut, en pire, parce qu'elle sert aussi à
//     reconstruire les jours déjà vécus. Mesuré à l'écran avant correction : un
//     jeudi passé tombait de 2 022 à 1 464 kcal.
//
// Et la sauce, pour la même raison, devient un REFUS : la retirer des plats qui la
// servent les allégerait rétroactivement sans qu'aucune ligne ne bouge.

vi.mock('../../data/nutritionProgram', () => (import('../exemple')).then(m => m.catalogueExemple()))
vi.mock('../../data/sportProgram', () => (import('../exemple')).then(m => m.programmeExemple()))

beforeEach(() => {
  localStorage.clear()
  poserSemaineExemple()
  vi.resetModules()
})

const load = async () => {
  const { useNutrition } = await import('../../composables/useNutrition')
  const n = useNutrition()
  n.hydrate()
  return n
}

const ilYa = (jours: number) => new Date(Date.now() - jours * 86400000).toISOString().slice(0, 10)
const dans = (jours: number) => new Date(Date.now() + jours * 86400000).toISOString().slice(0, 10)

/** Le plan d'une journée, tel que l'écran le construit. */
const jour = (n: Awaited<ReturnType<typeof load>>, iso: string) =>
  n.dayPlanFor(iso, n.dayFor(iso).gym)

describe('le plat supprimé et l’histoire déjà écrite', () => {
  /**
   * LE test du fichier. Tout le reste n'est que ménage.
   */
  it('ne retire pas ses calories des journées déjà passées', async () => {
    const n = await load()
    // Le cycle d'exemple alterne sur quatorze jours : on CHERCHE une journée passée
    // qui sert vraiment ce plat plutôt que de parier sur hier.
    const cible = [...Array(14).keys()]
      .map(i => ilYa(i + 1))
      .find(iso => jour(n, iso).meals.some(m => m.recipeId === 'din-poisson'))
    expect(cible, 'aucune journée passée ne sert ce plat').toBeDefined()

    const avant = jour(n, cible!)
    const repas = avant.meals.find(m => m.recipeId === 'din-poisson')!

    n.supprimerPlat('din-poisson')

    const apres = jour(n, cible!)
    expect(apres.total.kcal).toBe(avant.total.kcal)
    expect(apres.meals.find(m => m.recipeId === 'din-poisson')?.name).toBe(repas.name)
  })

  /** L'autre moitié de la règle : à venir, il ne se propose plus. */
  it('disparaît des journées à venir', async () => {
    const n = await load()
    // Une date future qui porte bien ce plat au dîner — le cycle d'exemple alterne,
    // on cherche donc plutôt que de parier sur un jour précis.
    const cible = [...Array(14).keys()]
      .map(i => dans(i + 1))
      .find(iso => jour(n, iso).meals.some(m => m.recipeId === 'din-poisson'))
    expect(cible, 'aucune journée à venir ne sert ce plat').toBeDefined()

    const avant = jour(n, cible!).total.kcal
    n.supprimerPlat('din-poisson')

    const apres = jour(n, cible!)
    expect(apres.meals.some(m => m.recipeId === 'din-poisson')).toBe(false)
    expect(apres.total.kcal).toBeLessThan(avant)
  })

  it('sort de la bibliothèque tout en restant calculable', async () => {
    const n = await load()
    n.supprimerPlat('din-poisson')
    // Marqué, pas effacé : c'est ce qui permet à la journée d'hier de le nommer.
    expect(n.library.value.recipes['din-poisson']!.deleted).toBe(true)
    expect(n.library.value.recipes['din-poisson']!.name).toBeTruthy()
    expect(n.estSupprime('din-poisson')).toBe(true)
  })

  it('ne se propose plus au planning', async () => {
    const n = await load()
    const { activeRecipes } = await import('../../lib/nutritionStats')
    expect(activeRecipes(n.library.value, 'diner').map(r => r.id)).toContain('din-poisson')
    n.supprimerPlat('din-poisson')
    expect(activeRecipes(n.library.value, 'diner').map(r => r.id)).not.toContain('din-poisson')
  })

  it('survit au rechargement', async () => {
    const n = await load()
    n.supprimerPlat('din-poisson')
    vi.resetModules()
    const encore = await load()
    expect(encore.estSupprime('din-poisson')).toBe(true)
  })

  it('refuse de supprimer deux fois, ou un plat qui n’existe pas', async () => {
    const n = await load()
    expect(n.supprimerPlat('din-poisson').ok).toBe(true)
    expect(n.supprimerPlat('din-poisson').ok).toBe(false)
    expect(n.supprimerPlat('plat-qui-n-existe-pas').ok).toBe(false)
  })
})

describe('ce que la suppression NE touche pas', () => {
  /**
   * LA leçon de ce fichier, et elle a coûté une vérification dans un navigateur.
   *
   * Vider les créneaux d'une semaine type paraissait être le ménage à faire. C'est
   * en réalité le même défaut que la suppression sauvage, en pire : une semaine type
   * n'est pas une intention pour la semaine prochaine, c'est la seule mémoire de ce
   * qui a été mangé, puisque aucun total de journée n'est stocké.
   */
  it('ne vide pas les créneaux des semaines types', async () => {
    const n = await load()
    const id = n.duplicateMenu('Ma semaine')!
    n.setMenuSlot(0, 'dinner', 'din-poisson')

    n.supprimerPlat('din-poisson')

    expect(n.menus.value.find(m => m.id === id)!.days[0]!.slots.dinner).toBe('din-poisson')
  })

  it('ne touche pas une exception de planning déjà passée', async () => {
    const n = await load()
    n.setOverride(ilYa(3), { dinner: 'din-poisson' })
    n.supprimerPlat('din-poisson')
    // Elle dit ce qui a été mangé ce jour-là. La couper réécrirait le journal.
    expect(n.overrides.value[ilYa(3)]).toEqual({ dinner: 'din-poisson' })
  })

  it('ne touche pas un plat déjà pris à la place du plat prévu', async () => {
    const n = await load()
    n.setPicked(ilYa(4), 'dinner', 'din-poisson')
    n.supprimerPlat('din-poisson')
    expect(n.pickedFor(ilYa(4), 'dinner')).toBe('din-poisson')
  })

  /**
   * Une sauce entre dans les macros des plats qui la servent sans apparaître dans
   * leur liste. La retirer de force les allégerait rétroactivement — même règle que
   * pour un aliment encore utilisé : on refuse, et on nomme.
   */
  it('refuse de supprimer une sauce encore servie, et nomme les plats', async () => {
    const n = await load()
    const res = n.supprimerPlat('sauce-blanche')
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.plats.map(p => p.id)).toContain('din-poisson')
    expect(n.estSupprime('sauce-blanche')).toBe(false)
  })

  it('laisse supprimer la sauce dès que plus aucun plat ne la sert', async () => {
    const n = await load()
    const sauce = n.addRecipe({ name: 'Sauce test', kind: 'sauce', batch: false, steps: '', items: [] })
    const plat = n.addRecipe({ name: 'Plat test', kind: 'diner', batch: false, steps: '', items: [], sauce } as never)
    expect(n.supprimerPlat(sauce).ok).toBe(false)

    n.patchRecipe(plat, { sauce: undefined })
    expect(n.supprimerPlat(sauce).ok).toBe(true)
  })
})

describe('le ménage de ce qui est encore à venir', () => {
  it('coupe une exception à venir sans toucher au reste de la journée', async () => {
    const n = await load()
    n.setOverride('2099-01-05', { dinner: 'din-poisson', gym: false })
    n.setOverride('2099-01-06', { lunch: 'boite-a' })

    n.supprimerPlat('din-poisson')

    // Le dîner imposé saute, « pas de séance ce jour-là » reste : ce sont deux
    // décisions différentes, prises à deux moments différents.
    expect(n.overrides.value['2099-01-05']).toEqual({ gym: false })
    expect(n.overrides.value['2099-01-06']).toEqual({ lunch: 'boite-a' })
  })

  it('oublie l’exception quand il n’en reste rien', async () => {
    const n = await load()
    n.setOverride('2099-01-07', { dinner: 'din-poisson' })
    n.supprimerPlat('din-poisson')
    expect(n.overrides.value['2099-01-07']).toBeUndefined()
  })

  it('oublie les jours à venir où il avait été choisi à la place du plat prévu', async () => {
    const n = await load()
    n.setPicked('2099-02-02', 'dinner', 'din-poisson')
    n.setPicked('2099-02-02', 'lunch', 'boite-a')
    n.setPicked('2099-02-03', 'dinner', 'din-poisson')

    n.supprimerPlat('din-poisson')

    expect(n.pickedFor('2099-02-02', 'dinner')).toBeNull()
    expect(n.pickedFor('2099-02-02', 'lunch')).toBe('boite-a')
    expect(n.pickedFor('2099-02-03', 'dinner')).toBeNull()
    // Le jour n'a plus rien à dire : on ne laisse pas une entrée vide derrière.
    expect(n.picked.value['2099-02-03']).toBeUndefined()
  })

  it('ne le laisse pas « de côté » en plus d’être supprimé', async () => {
    const n = await load()
    n.toggleRecipeActive('din-poisson')
    expect(n.isRecipeActive('din-poisson')).toBe(false)
    n.supprimerPlat('din-poisson')
    // Deux états pour une seule absence, c'est un état qui ressort tout seul le jour
    // où l'on restaure.
    expect(n.disabledRecipes.value).not.toContain('din-poisson')
  })
})

describe('l’annulation', () => {
  /**
   * On remet la PHOTO d'avant, on ne rejoue pas le nettoyage à l'envers. Un rejeu
   * doit deviner ce qui était là, et se trompe dès qu'un créneau était déjà vide
   * pour une autre raison.
   */
  it('remet exactement l’état d’avant', async () => {
    const n = await load()
    n.setOverride('2099-03-01', { dinner: 'din-poisson' })
    n.setPicked('2099-03-02', 'dinner', 'din-poisson')

    const res = n.supprimerPlat('din-poisson')
    expect(res.ok).toBe(true)
    if (res.ok) n.annulerSuppressionPlat(res.annulation)

    expect(n.estSupprime('din-poisson')).toBe(false)
    expect(n.library.value.recipes['din-poisson']!.deleted).toBe(false)
    expect(n.overrides.value['2099-03-01']).toEqual({ dinner: 'din-poisson' })
    expect(n.pickedFor('2099-03-02', 'dinner')).toBe('din-poisson')
  })

  it('remet aussi le « de côté » qu’on avait posé avant', async () => {
    const n = await load()
    n.toggleRecipeActive('din-poisson')
    const res = n.supprimerPlat('din-poisson')
    if (res.ok) n.annulerSuppressionPlat(res.annulation)
    expect(n.isRecipeActive('din-poisson')).toBe(false)
  })
})

describe('les aliments', () => {
  /**
   * Le refus n'est pas de la prudence : un plat dont un ingrédient a disparu ne
   * signale rien, il pèse simplement moins. On rend donc la liste à corriger, ce qui
   * transforme un mystère en tâche.
   */
  it('refuse de supprimer un aliment encore utilisé, et nomme les plats', async () => {
    const n = await load()
    const res = n.supprimerAliment('riz-basmati')
    expect(res.ok).toBe(false)
    expect(res.ok === false && res.plats.length).toBeGreaterThan(0)
    expect(n.library.value.foods['riz-basmati']!.deleted).toBeFalsy()
  })

  it('supprime un aliment que rien n’utilise, et le rend sur annulation', async () => {
    const n = await load()
    const id = n.addFood({ name: 'Skyr nature', cat: 'laitiers', kcal: 64, p: 11, g: 4, l: 0.2 })
    expect(n.usagesDeLAliment(id)).toEqual([])

    const res = n.supprimerAliment(id)
    expect(res.ok).toBe(true)
    expect(n.library.value.foods[id]!.deleted).toBe(true)

    if (res.ok) n.annulerSuppressionAliment(res.annulation)
    expect(n.library.value.foods[id]!.deleted).toBeFalsy()
  })

  it('se libère dès que le dernier plat qui l’utilisait est supprimé', async () => {
    const n = await load()
    const id = n.addFood({ name: 'Tempeh', cat: 'viandes', kcal: 190, p: 19, g: 9, l: 11 })
    const plat = n.addRecipe({ name: 'Tempeh sauté', kind: 'diner', batch: false, steps: '', items: [{ food: id, g: 150 }] })
    expect(n.supprimerAliment(id).ok).toBe(false)

    expect(n.supprimerPlat(plat).ok).toBe(true)
    // Un plat supprimé ne se choisit plus : il ne doit plus retenir ses ingrédients
    // en otage. Ses macros, elles, restent calculables — il les porte toujours.
    expect(n.supprimerAliment(id).ok).toBe(true)
  })

  it('survit au rechargement', async () => {
    const n = await load()
    const id = n.addFood({ name: 'Skyr nature', cat: 'laitiers', kcal: 64, p: 11, g: 4, l: 0.2 })
    n.supprimerAliment(id)
    vi.resetModules()
    const encore = await load()
    expect(encore.estSupprimeAliment(id)).toBe(true)
  })
})

describe('la sauvegarde', () => {
  it('emporte les suppressions et les rend', async () => {
    const n = await load()
    n.supprimerPlat('din-poisson')
    const aliment = n.addFood({ name: 'Skyr nature', cat: 'laitiers', kcal: 64, p: 11, g: 4, l: 0.2 })
    n.supprimerAliment(aliment)
    const sauvegarde = JSON.parse(JSON.stringify({ nutrition: n.exportData() }))

    vi.resetModules()
    localStorage.clear()
    poserSemaineExemple()
    const neuf = await load()
    expect(neuf.estSupprime('din-poisson')).toBe(false)

    neuf.restore(sauvegarde)
    expect(neuf.estSupprime('din-poisson')).toBe(true)
    expect(neuf.estSupprimeAliment(aliment)).toBe(true)
  })

  /** Une sauvegarde d'avant ce mécanisme ne doit rien casser. */
  it('encaisse une sauvegarde qui ne connaît pas ces listes', async () => {
    const n = await load()
    n.supprimerPlat('din-poisson')
    n.restore({ nutrition: { prices: {} } })
    expect(n.estSupprime('din-poisson')).toBe(true)
  })
})
