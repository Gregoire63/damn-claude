import { beforeEach, describe, expect, it, vi } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Le code de démarrage n'est plus une clé maîtresse.
// ─────────────────────────────────────────────────────────────────────────────
//
// Il ouvrait la porte à tout moment, pour toujours. Ce n'était pas un choix : il n'y
// avait qu'un seul passkey, donc perdre son téléphone signifiait perdre le coffre,
// donc il fallait un double valide indéfiniment. Le secret permanent était la
// CONSÉQUENCE de l'absence de passkey de secours, pas une décision.
//
// Il y en a plusieurs maintenant, et le code redevient ce qu'il doit être : un code
// d'INSTALLATION. Trois propriétés le tiennent, et elles se cassent silencieusement
// — un code qui redeviendrait valide après usage ne se remarquerait jamais.

const memoire = new Map<string, string>()
const getStore = vi.fn(() => ({
  get: vi.fn(async (k: string) => memoire.get(k) ?? null),
  set: vi.fn(async (k: string, v: string) => { memoire.set(k, v) }),
}))
vi.mock('@netlify/blobs', () => ({ getStore }))

const CODE = 'code-de-demarrage-de-test'
const vault = () => import('../../server/utils/vault')

beforeEach(() => {
  memoire.clear()
  process.env.NETLIFY_BLOBS_CONTEXT = 'contexte-de-test'
  process.env.NUXT_VAULT_SECRET = 'un-secret-de-test-de-plus-de-32-caracteres'
  process.env.NUXT_VAULT_BOOTSTRAP = CODE
  vi.resetModules()
})

const passkey = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, publicKey: `pk-${id}`, counter: 0, at: '2026-08-30T10:00:00.000Z', ...extra })

describe('le code de démarrage', () => {
  it('accepte le bon code, refuse le mauvais', async () => {
    const { verifierBootstrap } = await vault()
    expect(await verifierBootstrap(CODE)).toBe('ok')
    expect(await verifierBootstrap('pas-le-bon')).toBe('faux')
  })

  it('ne sert QU’UNE FOIS', async () => {
    const { verifierBootstrap, brulerBootstrap } = await vault()
    expect(await verifierBootstrap(CODE)).toBe('ok')
    await brulerBootstrap()
    // « consommé » et non « faux » : le message doit dire quoi faire, pas envoyer
    // chercher une faute de frappe qui n'existe pas.
    expect(await verifierBootstrap(CODE)).toBe('consomme')
  })

  it('se réarme en changeant la variable d’environnement, et par là seulement', async () => {
    const { verifierBootstrap, brulerBootstrap, bootstrapArme } = await vault()
    await brulerBootstrap()
    expect(await bootstrapArme()).toBe(false)

    // C'est tout le mécanisme : on range l'EMPREINTE du code consommé. Une nouvelle
    // valeur a une autre empreinte, donc la porte se rouvre — et poser cette valeur
    // suppose l'accès au déploiement, qui est la vraie racine de confiance ici.
    process.env.NUXT_VAULT_BOOTSTRAP = 'une-toute-autre-valeur'
    expect(await bootstrapArme()).toBe(true)
    expect(await verifierBootstrap('une-toute-autre-valeur')).toBe('ok')
    // Et l'ancien ne revient pas d'entre les morts.
    expect(await verifierBootstrap(CODE)).toBe('faux')
  })

  it('se verrouille après cinq échecs, le bon code compris', async () => {
    const { verifierBootstrap } = await vault()
    for (let i = 0; i < 5; i++) expect(await verifierBootstrap('faux')).toBe('faux')
    // Le verrou vaut AUSSI pour le bon code : sinon il ne ralentit rien, il suffirait
    // d'essayer jusqu'à tomber juste.
    expect(await verifierBootstrap(CODE)).toBe('verrouille')
  })

  it('rouvre après un quart d’heure', async () => {
    const { verifierBootstrap } = await vault()
    const t = Date.parse('2026-08-30T12:00:00.000Z')
    for (let i = 0; i < 5; i++) await verifierBootstrap('faux', t)
    expect(await verifierBootstrap(CODE, t + 14 * 60 * 1000)).toBe('verrouille')
    expect(await verifierBootstrap(CODE, t + 16 * 60 * 1000)).toBe('ok')
  })

  it('n’est pas armé quand la variable est absente', async () => {
    delete process.env.NUXT_VAULT_BOOTSTRAP
    const { bootstrapArme, verifierBootstrap } = await vault()
    expect(await bootstrapArme()).toBe(false)
    expect(await verifierBootstrap('nimporte')).toBe('absent')
  })

  it('reste consommé après une remise à zéro', async () => {
    // Sinon la remise à zéro réarmerait le code qu'elle vient d'utiliser, et la
    // porte se rouvrirait toute seule — exactement ce qu'on cherche à empêcher.
    const { brulerBootstrap, clearCredentials, addCredential, bootstrapArme } = await vault()
    await addCredential(passkey('a'))
    await brulerBootstrap()
    await clearCredentials()
    expect(await bootstrapArme()).toBe(false)
  })
})

describe('les passkeys', () => {
  it('lisent l’ANCIENNE forme : un seul objet à la racine', async () => {
    // Une instance déjà installée a un `credential.json` qui EST le passkey. La
    // migrer à la lecture évite l'écriture la plus dangereuse qui soit : celle qui
    // touche à l'authentification pendant que personne ne regarde.
    memoire.set('credential.json', JSON.stringify(passkey('ancien', { ownerName: 'Grégoire' })))
    const { readCredentials, readCredential } = await vault()
    expect((await readCredentials()).map(c => c.id)).toEqual(['ancien'])
    expect((await readCredential())?.ownerName).toBe('Grégoire')
  })

  it('s’ajoutent sans se marcher dessus', async () => {
    const { addCredential, readCredentials } = await vault()
    await addCredential(passkey('telephone', { label: 'iPhone' }))
    await addCredential(passkey('ordi', { label: 'Portable' }))
    expect((await readCredentials()).map(c => c.label)).toEqual(['iPhone', 'Portable'])
  })

  it('ne comptent qu’une fois quand on repose le même', async () => {
    const { addCredential, readCredentials } = await vault()
    await addCredential(passkey('a'))
    await addCredential(passkey('a', { label: 'renommé' }))
    expect(await readCredentials()).toHaveLength(1)
  })

  it('n’avancent que LEUR compteur anti-clonage', async () => {
    // Le compteur détecte une clé clonée : le faire avancer sur le mauvais passkey
    // ferait échouer la connexion depuis l'autre appareil, sans rien expliquer.
    const { addCredential, setCredentialCounter, readCredentials } = await vault()
    await addCredential(passkey('a'))
    await addCredential(passkey('b'))
    await setCredentialCounter('b', 42)
    const parId = Object.fromEntries((await readCredentials()).map(c => [c.id, c.counter]))
    expect(parId).toEqual({ a: 0, b: 42 })
  })

  it('se révoquent, sauf le dernier', async () => {
    // Se verrouiller dehors d'un tap est un geste qu'aucune confirmation ne rattrape.
    const { addCredential, removeCredential, readCredentials } = await vault()
    await addCredential(passkey('a'))
    expect(await removeCredential('a')).toBe(false)

    await addCredential(passkey('b'))
    expect(await removeCredential('a')).toBe(true)
    expect((await readCredentials()).map(c => c.id)).toEqual(['b'])
    expect(await removeCredential('b')).toBe(false)
  })

  it('ignorent un enregistrement vide — c’est ce qu’écrivait l’ancienne remise à zéro', async () => {
    memoire.set('credential.json', JSON.stringify({ id: '', publicKey: '', counter: 0, at: '' }))
    const { readCredentials } = await vault()
    expect(await readCredentials()).toEqual([])
  })
})
