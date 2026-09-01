import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const lire = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')

/*
 * L'inscription d'un client est OUVERTE : n'importe qui peut demander un
 * identifiant. Ce qui rend ça acceptable tient en deux propriétés, et ce sont
 * exactement celles que ce fichier vérifie.
 *
 *  · un identifiant ne donne aucun accès — la page d'autorisation exige la clé
 *    d'accès du propriétaire, et ça se voit dans authorize.get.ts ;
 *  · un identifiant ne peut pas servir vers une AUTRE redirection que celles
 *    déclarées à l'inscription. Sans ce contrôle, un identifiant recopié ferait
 *    renvoyer le code d'autorisation chez celui qui l'a recopié.
 */

const SECRET = 'un-secret-de-test-assez-long-pour-passer'
const CLAUDE = 'https://claude.ai/api/mcp/auth_callback'

async function utils() {
  vi.resetModules()
  process.env.NUXT_VAULT_SECRET = SECRET
  return import('../../server/utils/clients')
}

beforeEach(() => { delete process.env.NUXT_MCP_CLIENT_ID })

describe('redirections acceptables', () => {
  it.each([
    [CLAUDE, true],
    ['https://exemple.fr/cb?x=1', true],
    ['http://exemple.fr/cb', false],          // en clair : le code serait lisible en chemin
    ['https://exemple.fr/cb#frag', false],    // fragment : interdit par la spécification
    ['pas-une-url', false],
    ['', false],
  ])('%s → %s', async (uri, attendu) => {
    const { redirectionValide } = await utils()
    expect(redirectionValide(uri)).toBe(attendu)
  })
})

describe('un client inscrit', () => {
  it('est reconnu pour la redirection qu\'il a déclarée', async () => {
    const { inscrireClient, verifierClient } = await utils()
    const id = inscrireClient([CLAUDE], 'Claude')
    expect(verifierClient(id, CLAUDE)).toBe('ok')
  })

  /* LE contrôle. Un identifiant qui circule ne doit pas pouvoir détourner le code. */
  it('est refusé pour une redirection qu\'il n\'a pas déclarée', async () => {
    const { inscrireClient, verifierClient } = await utils()
    const id = inscrireClient([CLAUDE], 'Claude')
    expect(verifierClient(id, 'https://pirate.example/cb')).toBe('redirection')
  })

  it('accepte plusieurs redirections déclarées', async () => {
    const { inscrireClient, verifierClient } = await utils()
    const id = inscrireClient([CLAUDE, 'https://exemple.fr/cb'], '')
    expect(verifierClient(id, 'https://exemple.fr/cb')).toBe('ok')
  })

  it('ne vaut rien si on invente son identifiant', async () => {
    const { verifierClient } = await utils()
    expect(verifierClient('client-invente', CLAUDE)).toBe('inconnu')
  })

  /*
   * La signature est faite avec NUXT_VAULT_SECRET : changer le secret invalide tous
   * les identifiants d'un coup. C'est la porte de sortie — tout se réinscrit, il n'y
   * a aucune table à purger.
   */
  it('ne survit pas à un changement de NUXT_VAULT_SECRET', async () => {
    const { inscrireClient } = await utils()
    const id = inscrireClient([CLAUDE], 'Claude')
    vi.resetModules()
    process.env.NUXT_VAULT_SECRET = 'un-AUTRE-secret-de-test-assez-long'
    const { verifierClient } = await import('../../server/utils/clients')
    expect(verifierClient(id, CLAUDE)).toBe('inconnu')
  })
})

describe('le client des variables d\'environnement continue de passer', () => {
  it('est accepté tel quel', async () => {
    const { verifierClient } = await utils()
    process.env.NUXT_MCP_CLIENT_ID = 'historique'
    expect(verifierClient('historique', CLAUDE)).toBe('ok')
  })

  it('se distingue d\'un client inscrit', async () => {
    const { clientInscrit, inscrireClient } = await utils()
    process.env.NUXT_MCP_CLIENT_ID = 'historique'
    expect(clientInscrit('historique')).toBe(false)
    expect(clientInscrit(inscrireClient([CLAUDE], ''))).toBe(true)
  })

  it('sur une instance sans variable, tout client est un client inscrit', async () => {
    const { clientInscrit } = await utils()
    expect(clientInscrit('peu-importe')).toBe(true)
  })
})

describe('ce qu\'on accorde à l\'inscription', () => {
  /*
   * LE cas qui bloquait : Claude demande authorization_code ET refresh_token, comme
   * la plupart des clients. La première version refusait l'inscription entière —
   * 400 avant même le premier écran d'autorisation — pour une préférence que le
   * client n'exigeait pas.
   */
  it('accorde authorization_code même quand refresh_token est demandé', async () => {
    const { grantsAccordes } = await utils()
    expect(grantsAccordes(['authorization_code', 'refresh_token'])).toEqual(['authorization_code'])
  })

  it('accorde authorization_code quand rien n\'est demandé', async () => {
    const { grantsAccordes } = await utils()
    expect(grantsAccordes([])).toEqual(['authorization_code'])
  })

  /* On ne fait pas semblant : un client qui ne veut QUE ce qu'on ne sait pas faire
     doit l'apprendre à l'inscription, pas au milieu d'une redirection. */
  it('n\'accorde rien quand rien de demandé n\'est réalisable', async () => {
    const { grantsAccordes } = await utils()
    expect(grantsAccordes(['implicit', 'password'])).toEqual([])
  })
})

describe('la réponse d\'inscription reste conforme', () => {
  const src = () => lire('server/api/oauth/register.post.ts')

  /*
   * `client_secret_expires_at: 0` traînait dans la réponse. La RFC 7591 ne prévoit
   * ce champ que lorsqu'un secret est DÉLIVRÉ — et ce client public n'en reçoit
   * aucun. Annoncer l'expiration d'un secret qui n'existe pas laisse un client
   * conformant conclure qu'il en attendait un, et rejeter la réponse entière.
   */
  it('n\'annonce pas l\'expiration d\'un secret qu\'elle ne délivre pas', () => {
    expect(src()).not.toMatch(/^\s*client_secret_expires_at:/m)
    expect(src()).not.toMatch(/^\s*client_secret:/m)
  })

  it('annonce un client public : aucune authentification au guichet', () => {
    expect(src()).toContain("token_endpoint_auth_method: 'none'")
  })
})
