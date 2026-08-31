import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Le code de démarrage ne doit JAMAIS atteindre le navigateur.
// ─────────────────────────────────────────────────────────────────────────────
//
// Il est fabriqué pendant `nuxt build` et cuit dans la configuration serveur. Toute
// la sécurité tient à un seul détail : qu'il soit hors de `runtimeConfig.public`.
// Nuxt sérialise `public` dans le bundle du navigateur — l'y déplacer d'une ligne
// publierait le code sur la page d'accueil, en clair, à qui l'ouvre.
//
// Rien ne le signalerait. L'application marcherait exactement pareil.

const CONFIG = readFileSync('nuxt.config.ts', 'utf8')
const VAULT = readFileSync('server/utils/vault.ts', 'utf8')

describe('le code de démarrage', () => {
  it('est fabriqué au build, pas écrit en dur', () => {
    // Une constante dans le dépôt serait publique le jour où le dépôt l'est.
    expect(CONFIG).toContain('randomBytes(8).toString(\'hex\')')
    expect(CONFIG).toMatch(/vaultBootstrap: codeDeDemarrage/)
  })

  it('est déclaré HORS de runtimeConfig.public', () => {
    const rc = CONFIG.slice(CONFIG.indexOf('runtimeConfig: {'))
    const pub = rc.indexOf('public: {')
    const clef = rc.indexOf('vaultBootstrap')
    expect(clef).toBeGreaterThan(-1)
    // Déclaré AVANT l'ouverture de `public`, donc à la racine : c'est la seule
    // position qui le garde côté serveur.
    expect(clef).toBeLessThan(pub)
  })

  it('n’est pas imprimé quand une variable a été posée à la main', () => {
    // Sinon le journal de déploiement recopierait le secret de l'utilisateur.
    expect(CONFIG).toContain("if (!(process.env.NUXT_VAULT_BOOTSTRAP || '').trim()) {")
  })

  it('laisse la variable d’environnement l’emporter', () => {
    // C'est Nuxt qui le fait : une variable écrase la clé de runtimeConfig qui porte
    // son nom. Le serveur doit donc lire runtimeConfig EN PREMIER, sans quoi la
    // variable posée par l'utilisateur serait ignorée.
    const corps = VAULT.slice(VAULT.indexOf('function codeAttendu'), VAULT.indexOf('export const origineBootstrap'))
    expect(corps.indexOf('useRuntimeConfig')).toBeLessThan(corps.indexOf('process.env'))
  })

  /**
   * Le test qui compte : on construit, et on cherche le code dans ce qui part au
   * navigateur. Les trois précédents lisent la source ; celui-ci lit le RÉSULTAT,
   * donc il attrape aussi ce qu'aucune relecture ne verrait — une sérialisation qui
   * changerait de règle, un module qui recopierait la valeur.
   */
  it('ne se retrouve nulle part dans le bundle du navigateur', () => {
    // On réutilise `.output` s'il est là — la CI construit AVANT de tester, pour ne
    // pas payer deux fois le même build. Sinon on le fabrique, pour que le test dise
    // quelque chose même lancé seul.
    if (!existsSync('.output/server/chunks/nitro/nitro.mjs')) {
      execFileSync('npx', ['nuxt', 'build'], { stdio: 'pipe', timeout: 600000 })
    }

    // La valeur réellement cuite dans le serveur de ce build.
    const serveur = readFileSync('.output/server/chunks/nitro/nitro.mjs', 'utf8')
    const trouve = /"?vaultBootstrap"?:\s*"([0-9a-f]{16})"/.exec(serveur)
    expect(trouve, 'le code doit être présent côté SERVEUR').not.toBeNull()
    const code = trouve![1]!

    const client = readdirSync('.output/public/_nuxt')
      .filter(f => f.endsWith('.js') || f.endsWith('.json'))
      .map(f => readFileSync(`.output/public/_nuxt/${f}`, 'utf8'))
      .join('\n')
    expect(client).not.toContain(code)
  }, 900000)
})
