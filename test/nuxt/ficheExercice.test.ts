import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import ExerciseInfo from '../../components/sport/ExerciseInfo.vue'
import type { Exercise } from '../../data/sportProgram'

// ─────────────────────────────────────────────────────────────────────────────
// La fiche d'un mouvement, et ce qu'elle a libéré dans la carte.
// ─────────────────────────────────────────────────────────────────────────────
//
// Photos, schéma musculaire et consignes d'exécution s'ouvraient AVEC la carte de
// l'exercice, en haut, à chaque fois — donc aussi à la quatrième série du développé
// couché, où l'on sait déjà à quoi il ressemble. Deux écrans de rappel à faire
// défiler pour atteindre le champ de saisie, entre deux séries, le téléphone dans
// une main.
//
// Ce sont deux besoins de fréquences opposées : la saisie revient toutes les
// quatre-vingt-dix secondes, l'exécution se vérifie une fois. Le second n'a rien à
// faire dans le chemin du premier.
//
// Ces tests tiennent les deux bouts : la fiche porte bien tout ce qui a été retiré,
// et la carte ne le reprend pas en douce.

const MONTAGE = { attachTo: document.body, global: { stubs: { transition: false } } }

afterEach(() => { document.body.querySelectorAll('.sport-portal').forEach(n => n.remove()) })

/**
 * La fenêtre naît INVISIBLE et s'affiche au montage (`onMounted` → `shown`), pour que
 * l'ouverture s'anime alors que l'appelant n'écrit qu'un `v-if`. Sans ce tour de
 * boucle, on constaterait un `<body>` vide et on conclurait que la fiche ne rend rien.
 */
const ouvrir = async (ex: Exercise) => {
  const w = mount(ExerciseInfo, { ...MONTAGE, props: { ex } })
  await nextTick()
  return w
}

const ex = (over: Partial<Exercise> = {}): Exercise => ({
  id: 'dc-barre',
  name: 'Développé couché',
  sets: 4,
  reps: '6-8',
  muscles: ['pecs', 'triceps'],
  cues: ['Omoplates serrées', 'Barre au bas des pecs'],
  machine: 'Banc plat, barre olympique',
  ...over,
})

/** Le contenu téléporté dans <body> : la fenêtre n'est pas rendue à son point d'écriture. */
const fenetre = () => document.body.textContent ?? ''

describe('la fiche d’un mouvement', () => {
  it('porte les consignes d’exécution', async () => {
    await ouvrir(ex())
    expect(fenetre()).toContain('Omoplates serrées')
    expect(fenetre()).toContain('Barre au bas des pecs')
  })

  it('nomme le mouvement, son volume et sa machine', async () => {
    await ouvrir(ex())
    const t = fenetre()
    expect(t).toContain('Développé couché')
    expect(t).toContain('4 × 6-8')
    expect(t).toContain('Banc plat, barre olympique')
  })

  /**
   * Les photos ET le schéma, là où la carte devait choisir.
   *
   * `ExerciseMove` se rabattait sur le schéma musculaire faute de photos, parce que
   * les deux ne tenaient pas dans une carte de saisie. Ils ne disent pas la même
   * chose — l'une montre le geste, l'autre ce qui travaille — et ici il y a la place.
   */
  it('montre les photos ET le schéma musculaire quand les deux existent', async () => {
    await ouvrir(ex())
    expect(document.body.querySelectorAll('.exmove-fig img')).toHaveLength(2)
    expect(document.body.querySelector('.muscle-map')).not.toBeNull()
  })

  it('garde le schéma quand le mouvement n’a pas de photos', async () => {
    await ouvrir(ex({ id: 'mouvement-invente' }))
    expect(document.body.querySelectorAll('.exmove-fig img')).toHaveLength(0)
    expect(document.body.querySelector('.muscle-map')).not.toBeNull()
  })

  /** Ce qui ne se voit qu'en ouvrant la fiche doit y être DIT, sinon le champ de la
   *  carte redemande un total là où il attend un lest. */
  it('dit ce qu’un mouvement au poids du corps attend dans le champ', async () => {
    await ouvrir(ex({ bodyweight: true }))
    expect(fenetre()).toContain('lest')
  })

  it('ne parle de machines de remplacement que s’il en existe', async () => {
    await ouvrir(ex({ id: 'mouvement-invente' }))
    expect(fenetre()).not.toContain('à la place')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Le garde-fou : ce qui est sorti de la carte ne doit pas y rentrer.
// ─────────────────────────────────────────────────────────────────────────────
//
// Il lit la SOURCE, ce qui est inhabituel et assumé : la carte d'exercice vit dans
// la coque, au milieu d'une feuille glissable et d'un état de séance — la monter
// pour vérifier une absence coûterait dix fois ce test. Et l'absence est exactement
// ce qui se perd sans bruit : remettre une image « pour aider » est le geste le plus
// naturel du monde, et personne ne le verrait avant la quatrième série.

// Chemin relatif à la racine du projet, comme `test/unit/sauvegarde.test.ts` :
// `import.meta.url` n'est pas une URL `file:` dans l'environnement Nuxt.
const coque = readFileSync('layouts/default.vue', 'utf8')

describe('la carte d’exercice', () => {
  it('n’affiche plus les images ni le schéma par défaut', () => {
    expect(coque).not.toContain('SportExerciseMove')
    expect(coque).not.toContain('SportMuscleMap')
  })

  it('n’affiche plus les consignes par défaut', () => {
    // `sprint.cues` reste : c'est le protocole du sprint, pas la fiche d'un mouvement.
    expect(coque).not.toContain('class="cues"')
  })

  it('porte le « i » qui ouvre la fiche, et une seule fenêtre pour les deux listes', () => {
    // Deux points d'entrée — la séance en cours et l'aperçu — une seule fenêtre.
    expect(coque.match(/class="ex-info-btn"/g)).toHaveLength(2)
    expect(coque.match(/LazySportExerciseInfo/g)).toHaveLength(1)
  })
})
