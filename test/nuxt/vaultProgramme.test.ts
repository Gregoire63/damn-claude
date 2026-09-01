import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerEndpoint } from '@nuxt/test-utils/runtime'
import type { RawProposal } from '../../lib/proposals'

// Ces tests tournent sur le PACK D'EXEMPLE : l'application ne livre plus de données.
// Voir test/exemple.ts pour le pourquoi.
vi.mock('../../data/nutritionProgram', () => (import('../exemple')).then(m => m.catalogueExemple()))
vi.mock('../../data/sportProgram', () => (import('../exemple')).then(m => m.programmeExemple()))

// ─────────────────────────────────────────────────────────────────────────────
// Ce qu'on lit AVANT de valider une modification de programme.
// ─────────────────────────────────────────────────────────────────────────────
//
// Une proposition n'est pas un message : c'est une écriture en attente. Elle
// s'affichait en JSON replié sous « Voir le détail » — « patch: {"sets":5,"rest":180} » —
// et ce détail-là ne se valide pas. Pour juger si c'est une bonne idée il faut savoir
// ce qu'il y avait AVANT, et personne ne se rappelle qu'un développé haltères était
// à 4 séries et 120 secondes.
//
// Le test vérifie donc la seule chose qui compte ici : les deux valeurs sont à
// l'écran, l'ancienne et la nouvelle. Pas la mise en forme — les chiffres.

const PROPOSITION: RawProposal = {
  id: 'p1',
  at: '2026-08-19T10:00:00.000Z',
  action: 'programme',
  summary: 'Développé haltères : 4×8-10 → 5×5, repos 3 min',
  patch: {
    op: 'modifier', seance: 's4', exercice: 'dev-halteres',
    de_series: 4, de_reps: '8-10', de_repos_s: 120,
    patch: { series: 5, reps: '5', repos_s: 180 },
  },
  status: 'pending',
}

registerEndpoint('/api/auth/me', () => ({ connected: true, registered: true, bootstrapReady: true }))
registerEndpoint('/api/vault/health', () => ({ pret: true, env: {}, store: 'local', driver: 'fs' }))
registerEndpoint('/api/vault/pending', () => ({ mirrorAt: '2026-08-19T09:00:00.000Z', pending: [PROPOSITION], recent: [] }))
registerEndpoint('/api/vault/resolve', () => ({ ok: true }))

const attendre = () => new Promise(r => setTimeout(r, 60))

/**
 * Un composant NEUF à chaque test.
 *
 * L'état du coffre vit au niveau du module : sans réinitialisation, la proposition
 * appliquée par un test reste appliquée pour le suivant, qui monte alors un écran
 * vide et voit toutes ses assertions passer sans rien vérifier. C'est exactement ce
 * qui s'est produit — le test « valeur périmée » ne testait plus rien depuis
 * longtemps, et personne ne pouvait le voir.
 */
async function monter() {
  vi.resetModules()
  const Propositions = (await import('../../components/sport/Propositions.vue')).default
  const w = mount(Propositions, { attachTo: document.body, global: { stubs: { transition: false } } })
  await attendre(); await attendre()
  await attendre(); await attendre()
  return w
}

beforeEach(() => {
  localStorage.clear()
  document.body.querySelectorAll('.sport-portal').forEach(n => n.remove())
})

describe('une modification de programme, dans la boîte de réception', () => {
  it('montre l’avant ET l’après, pas seulement le patch', async () => {
    // La boîte s'ouvre au clic, dans une fenêtre TÉLÉPORTÉE : on lit donc <body>,
    // pas le composant. Chercher dans `w.text()` renverrait un vide trompeur.
    const w = await monter()

    const txt = document.body.textContent ?? ''
    expect(txt).toContain('Développé couché haltères') // le nom réel, pas l'identifiant
    expect(txt).toContain('Modifier')
    // L'avant vient du programme, l'après de la proposition. Les deux, côte à côte.
    expect(txt).toMatch(/4[\s\S]*5/) // séries : 4 → 5
    expect(txt).toContain('8-10')
    expect(txt).toContain('2:00') // repos actuel
    expect(txt).toContain('3:00') // repos proposé
    w.unmount()
    document.body.querySelectorAll('.sport-portal').forEach(n => n.remove())
  })

  /**
   * Le bouton doit ÉCRIRE, pas seulement s'afficher.
   *
   * Une proposition dont la forme est reconnue mais que rien n'applique est le pire
   * des trois états : elle s'affiche, on la valide, elle s'archive en « appliquée »,
   * et le programme n'a pas bougé. On ne s'en aperçoit qu'à la séance suivante.
   */
  it('applique vraiment le geste au programme', async () => {
    const w = await monter()

    const appliquer = [...document.body.querySelectorAll('button')].find(b => b.textContent === 'Appliquer')
    expect(appliquer, 'le bouton « Appliquer » doit être proposé').toBeTruthy()
    appliquer!.click()
    await attendre(); await attendre()

    expect(JSON.parse(localStorage.getItem('gr-prog-patch-v1') ?? '{}'))
      .toEqual({ 'dev-halteres': { sets: 5, reps: '5', rest: 180 } })
    w.unmount()
    document.body.querySelectorAll('.sport-portal').forEach(n => n.remove())
  })

  /**
   * Le deuxième étage de la garde, et celui qui fait foi.
   *
   * Le serveur confronte les « de_… » au MIROIR, qui peut avoir des heures de retard.
   * L'application les confronte à ses propres données. Sans ce second contrôle, une
   * proposition déposée ce matin sur « 4 séries » s'appliquerait ce soir sur un
   * exercice passé à 3 entre-temps — et l'écart ne se verrait jamais.
   */
  it('refuse à la validation une proposition bâtie sur une valeur périmée', async () => {
    localStorage.clear()
    // Le téléphone est déjà passé à 3 séries : le « de_series: 4 » de la proposition
    // ne décrit plus rien.
    localStorage.setItem('gr-prog-patch-v1', JSON.stringify({ 'dev-halteres': { sets: 3 } }))
    const w = await monter()

    const boutons = [...document.body.querySelectorAll('button')].map(b => b.textContent)
    expect(boutons).not.toContain('Appliquer')
    expect(document.body.textContent).toContain('plus applicable')
    w.unmount()
    document.body.querySelectorAll('.sport-portal').forEach(n => n.remove())
  })
})
