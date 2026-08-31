import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Le parcours d'installation : ce qui se déduit, ce qui se retient, ce qui revient.
// ─────────────────────────────────────────────────────────────────────────────
//
// Ce module décide si l'application est utilisable ou si elle affiche un parcours à
// la place. Se tromper d'un côté rend l'écran inatteignable ; se tromper de l'autre
// laisse entrer dans une application dont la cible calorique est fausse et le dit
// nulle part.
//
// Les tests portent donc sur la seule chose qu'il faut vraiment tenir : « fait » se
// LIT dans l'état réel, et « passé » — c'est-à-dire remis à plus tard — est la seule
// chose écrite quelque part.
beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

const charger = async () => {
  const { useDemarrage } = await import('../../composables/useDemarrage')
  const d = useDemarrage()
  d.hydrate()
  return d
}

/** Un profil complet : c'est la seule étape qui barre la route. */
async function poserProfil() {
  const { useProfile } = await import('../../composables/useProfile')
  const { useWorkout } = await import('../../composables/useWorkout')
  const p = useProfile()
  p.hydrate()
  p.setSex('h')
  p.setHeight(180)
  p.setBirthYear(1995)
  useWorkout().addBodyWeight(78)
}

const etape = (d: Awaited<ReturnType<typeof charger>>, id: string) =>
  d.etapes.value.find(e => e.id === id)!

describe('le parcours d’installation', () => {
  it('déduit « fait » de l’état réel, sans rien cocher', async () => {
    const d = await charger()
    expect(etape(d, 'toi').faite).toBe(false)
    expect(d.bloque.value).toBe(true)

    await poserProfil()
    // Aucune case n'a été touchée : c'est le profil lui-même qui a changé de forme.
    expect(etape(d, 'toi').faite).toBe(true)
    expect(d.bloque.value).toBe(false)
  })

  it('retient qu’une étape a été remise à plus tard, et rien d’autre', async () => {
    const d = await charger()
    d.passer('capteurs')
    expect(etape(d, 'capteurs').passee).toBe(true)
    expect(etape(d, 'capteurs').faite).toBe(false)

    vi.resetModules()
    const encore = await charger()
    expect(etape(encore, 'capteurs').passee).toBe(true)
  })

  /**
   * Le parcours ne revient jamais de lui-même, et il n'existait aucun chemin de
   * retour : une balance achetée après coup, un passkey à poser sur un second
   * navigateur, et il fallait vider le stockage du site à la main.
   */
  it('se rejoue sans rien défaire', async () => {
    await poserProfil()
    const d = await charger()
    d.passer('claude')
    d.passer('capteurs')
    d.passer('remplir')
    expect(d.fini.value).toBe(true)

    d.rejouer()
    expect(d.fini.value).toBe(false)
    expect(d.restantes.value.map(e => e.id)).toEqual(['claude', 'capteurs', 'remplir'])
    // Ce qui est FAIT reste fait : le profil n'a pas bougé, son étape rouvre cochée.
    expect(etape(d, 'toi').faite).toBe(true)
    expect(d.bloque.value).toBe(false)
    // Et la mémoire des reports est bien effacée, pas seulement l'état en cours.
    expect(localStorage.getItem('gr-demarrage-v1')).toBeNull()
  })

  it('ne laisse pas un stockage illisible bloquer l’application', async () => {
    // Un JSON abîmé — extension, quota, écriture concurrente — ne doit pas jeter :
    // le pire acceptable est de reproposer un parcours déjà fait.
    localStorage.setItem('gr-demarrage-v1', '{ pas du json')
    const d = await charger()
    expect(d.etapes.value.every(e => !e.passee)).toBe(true)
  })
})
