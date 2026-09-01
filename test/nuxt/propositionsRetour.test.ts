import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerEndpoint } from '@nuxt/test-utils/runtime'

vi.mock('../../data/nutritionProgram', () => (import('../exemple')).then(m => m.catalogueExemple()))
vi.mock('../../data/sportProgram', () => (import('../exemple')).then(m => m.programmeExemple()))

// ─────────────────────────────────────────────────────────────────────────────
// Défaire une modification acceptée, depuis l'écran qui l'a acceptée.
// ─────────────────────────────────────────────────────────────────────────────
//
// Le retour arrière vivait dans les réglages, à l'autre bout de l'application. C'est
// pourtant le même sujet vu des deux bouts : ce que Claude propose ici s'y applique,
// ce qui a été appliqué s'y défait. Sans ce chemin, annuler une mauvaise idée validée
// d'un tap supposait de redemander à Claude de proposer l'inverse — donc de dépendre
// du connecteur pour réparer ce que le connecteur a fait.

registerEndpoint('/api/auth/me', () => ({ connected: false, registered: true, bootstrapReady: false }))
registerEndpoint('/api/vault/pending', () => ({ mirrorAt: null, pending: [], recent: [] }))

const attendre = () => new Promise(r => setTimeout(r, 60))

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
})

/** La feuille est TÉLÉPORTÉE dans <body> : c'est là qu'on lit son contenu. */
async function monter() {
  const Propositions = (await import('../../components/sport/Propositions.vue')).default
  const w = mount(Propositions, { attachTo: document.body, global: { stubs: { transition: false } } })
  await attendre(); await attendre()
  return w
}
const texte = () => document.body.textContent ?? ''
function nettoyer(w: { unmount: () => void }) {
  w.unmount()
  document.body.querySelectorAll('.sport-portal').forEach(n => n.remove())
}

describe('le programme modifié, dans la feuille des propositions', () => {
  it('ne montre rien tant que rien n’a bougé', async () => {
    const w = await monter()
    expect(texte()).not.toContain('Programme modifié')
    nettoyer(w)
  })

  it('liste une modification et la défait d’un tap', async () => {
    const { useProgram } = await import('../../composables/useProgram')
    const prog = useProgram()
    const ex = prog.program.value[0]!.exercises[0]!
    prog.patchExercise(ex.id, { sets: 9 })

    const w = await monter()
    expect(texte()).toContain('Programme modifié')
    expect(texte()).toContain('9 séries')

    const defaire = document.body.querySelector('.pg-line button') as HTMLButtonElement
    expect(defaire, 'chaque modification doit porter son retour arrière').toBeTruthy()
    defaire.click()
    await attendre(); await attendre()
    // Défait pour de vrai : ce n'est pas la ligne qui disparaît, c'est le programme
    // qui retrouve sa valeur.
    expect(useProgram().exerciseById(ex.id)?.sets).not.toBe(9)
    expect(texte()).not.toContain('Programme modifié')
    nettoyer(w)
  })
})
