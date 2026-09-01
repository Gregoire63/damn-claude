import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/*
 * Le service worker n'est pas dans le bundle : c'est un fichier servi tel quel, et
 * aucun test de composant ne le traverse. Il a pourtant tenu l'application entière
 * sur une version périmée pendant trois déploiements — un cache dont le nom ne
 * changeait jamais, donc que rien ne purgeait, sur des appareils où « rafraîchir »
 * n'existe même pas.
 *
 * On l'exécute donc pour de vrai, dans une portée fabriquée à la main : c'est le seul
 * moyen de vérifier ce qu'il FAIT plutôt que ce qu'il contient.
 */
const source = readFileSync(new URL('../../public/sw.js', import.meta.url), 'utf8')

type Ecouteurs = Record<string, (e: any) => void>

function portee(href: string) {
  const ecouteurs: Ecouteurs = {}
  const caches_ = new Map<string, Map<string, unknown>>()
  const messages: unknown[] = []
  const self_ = {
    location: { href, origin: 'https://exemple.fr' },
    addEventListener: (nom: string, fn: (e: any) => void) => { ecouteurs[nom] = fn },
    skipWaiting: () => {},
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () => Promise.resolve([{ postMessage: (m: unknown) => messages.push(m) }]),
    },
  }
  const cachesApi = {
    keys: () => Promise.resolve([...caches_.keys()]),
    delete: (k: string) => Promise.resolve(caches_.delete(k)),
    open: (k: string) => {
      if (!caches_.has(k)) caches_.set(k, new Map())
      return Promise.resolve({ put: () => Promise.resolve() })
    },
    match: () => Promise.resolve(undefined),
  }
  // eslint-disable-next-line no-new-func
  new Function('self', 'caches', 'fetch', 'Response', source)(
    self_, cachesApi, () => Promise.resolve({ ok: true, clone: () => ({}) }), { error: () => ({}) },
  )
  return { ecouteurs, caches_, messages }
}

/** Déclenche un évènement et attend le `waitUntil` qu'il a posé. */
async function declencher(ecouteurs: Ecouteurs, nom: string) {
  let attendu: Promise<unknown> = Promise.resolve()
  ecouteurs[nom]({ waitUntil: (p: Promise<unknown>) => { attendu = p } })
  await attendu
}

describe('service worker : la version vient de son URL', () => {
  it('nomme son cache d\'après le paramètre v', async () => {
    const { ecouteurs, caches_ } = portee('https://exemple.fr/sw.js?v=58debfa')
    await declencher(ecouteurs, 'install')
    expect([...caches_.keys()]).toEqual(['sport-58debfa'])
  })

  it('retombe sur un nom neutre quand l\'URL n\'a pas de version', async () => {
    const { ecouteurs, caches_ } = portee('https://exemple.fr/sw.js')
    await declencher(ecouteurs, 'install')
    expect([...caches_.keys()]).toEqual(['sport-sans-version'])
  })

  /*
   * LE test. Sans lui, la panne d'origine repasse : un cache d'une version d'avant
   * qui survit à l'activation continue de servir une application morte, et aucun
   * rechargement ne le déloge.
   */
  it('jette les caches des versions précédentes en s\'activant', async () => {
    const { ecouteurs, caches_ } = portee('https://exemple.fr/sw.js?v=neuve')
    caches_.set('sport-v2', new Map())
    caches_.set('sport-ancienne', new Map())
    caches_.set('autre-appli', new Map())
    await declencher(ecouteurs, 'activate')
    // `autre-appli` survit : on ne purge que ce qui nous appartient.
    expect([...caches_.keys()]).toEqual(['autre-appli'])
  })

  it('prévient les pages ouvertes au lieu de les recharger de force', async () => {
    const { ecouteurs, messages } = portee('https://exemple.fr/sw.js?v=neuve')
    await declencher(ecouteurs, 'activate')
    expect(messages).toEqual([{ type: 'maj', version: 'neuve' }])
  })

  // On vise l'AFFECTATION, pas le mot : le commentaire du fichier cite `sport-v2`
  // pour raconter la panne, et il doit pouvoir continuer.
  it('ne fige plus le nom du cache dans le code', () => {
    expect(source).not.toMatch(/const CACHE\s*=\s*['"]/)
    expect(source).toContain("searchParams.get('v')")
  })
})
