import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ressourceProtegee } from '../../server/utils/decouverte'

const lire = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')
const existe = (f: string) => existsSync(new URL(`../../${f}`, import.meta.url))

/*
 * La découverte OAuth d'un serveur MCP tient à trois documents et un en-tête. Aucun
 * n'a d'écran : quand l'un manque, le client ne dit pas « document introuvable », il
 * dit « ce serveur ne prend pas en charge l'enregistrement automatique » et réclame
 * un identifiant à saisir à la main. Le message n'a plus aucun rapport avec la
 * cause, et on va chercher l'erreur là où elle n'est pas.
 */
describe('découverte : le document de ressource protégée', () => {
  it('annonce la ressource et son serveur d\'autorisation', () => {
    expect(ressourceProtegee('https://exemple.fr')).toEqual({
      resource: 'https://exemple.fr/api/mcp',
      authorization_servers: ['https://exemple.fr'],
      scopes_supported: ['suivi'],
      bearer_methods_supported: ['header'],
    })
  })

  /*
   * LA règle qui manquait. La RFC 9728 n'attend pas ce document à la racine quand la
   * ressource a un chemin : le segment bien-connu s'insère AVANT le chemin.
   */
  it('est servi sous le chemin de la ressource, comme la RFC 9728 le demande', () => {
    expect(existe('server/routes/.well-known/oauth-protected-resource/api/mcp.get.ts')).toBe(true)
  })

  it('reste servi à la racine, pour les connecteurs déjà installés', () => {
    expect(existe('server/routes/.well-known/oauth-protected-resource.get.ts')).toBe(true)
  })

  it('les deux adresses rendent le MÊME document', () => {
    const a = lire('server/routes/.well-known/oauth-protected-resource.get.ts')
    const b = lire('server/routes/.well-known/oauth-protected-resource/api/mcp.get.ts')
    for (const src of [a, b]) expect(src).toContain('ressourceProtegee(getRequestURL(event).origin)')
  })

  it('le 401 annonce l\'adresse conforme, celle qu\'un client strict recalcule', () => {
    expect(lire('server/api/mcp.post.ts'))
      .toContain('/.well-known/oauth-protected-resource/api/mcp"`')
  })
})
