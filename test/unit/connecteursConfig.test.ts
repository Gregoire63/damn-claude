import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Les identifiants d'une marque : d'où ils viennent, et sous quelle forme ils dorment.
// ─────────────────────────────────────────────────────────────────────────────
//
// C'est le fichier le plus sensible de la refonte des connecteurs, parce qu'il déplace
// un secret : jusqu'ici le client_secret ne vivait que dans les variables de
// l'hébergeur. Il peut maintenant être saisi depuis l'application — sans quoi ce dépôt
// restait inutilisable par quelqu'un d'autre, brancher une balance imposant de poser
// deux variables ailleurs et de redéployer.
//
// Trois propriétés à tenir, et elles sont testées ici plutôt que relues :
//   · l'environnement passe DEVANT le coffre ;
//   · ce qui dort dans le coffre est chiffré, jamais en clair ;
//   · un secret chiffré avec une autre clé ne se déchiffre pas en silence.
//
// Le coffre écrit dans .data/vault hors Netlify : le test travaille donc sur un vrai
// fichier, et le nettoie.

const SECRET = 'un-secret-de-vingt-quatre-caracteres-au-moins'
const DOSSIER = join(process.cwd(), '.data', 'vault')

let mod: typeof import('../../server/utils/connecteurs')

beforeEach(async () => {
  process.env.NUXT_VAULT_SECRET = SECRET
  delete process.env.NUXT_WITHINGS_CLIENT_ID
  delete process.env.NUXT_WITHINGS_CLIENT_SECRET
  await rm(DOSSIER, { recursive: true, force: true })
  mod = await import('../../server/utils/connecteurs')
})
afterEach(async () => { await rm(DOSSIER, { recursive: true, force: true }) })

describe('les noms de variables se déduisent de l’identifiant', () => {
  it('suit la convention, sans table à tenir à jour', () => {
    // Écrire les noms dans chaque fiche, c'était une occasion de faute de frappe par
    // marque — et une raison de plus de toucher lib/providers.ts pour ajouter un
    // connecteur.
    expect(mod.nomsEnv('withings')).toEqual({
      id: 'NUXT_WITHINGS_CLIENT_ID', secret: 'NUXT_WITHINGS_CLIENT_SECRET',
    })
    expect(mod.nomsEnv('google-fit').id).toBe('NUXT_GOOGLE_FIT_CLIENT_ID')
  })
})

describe('d’où viennent les identifiants', () => {
  it('rend null quand rien n’est configuré — donc aucun bouton à l’écran', async () => {
    // Un bouton qui mène à une 501 se lit comme une panne : on réessaie, on cherche sa
    // connexion, on perd dix minutes.
    expect(await mod.identifiantsDe('withings')).toBeNull()
    expect(await mod.origineDe('withings')).toBeNull()
  })

  it('lit ce que l’application a posé, une fois posé', async () => {
    await mod.poserIdentifiants('withings', 'cid', 'sec')
    expect(await mod.identifiantsDe('withings')).toEqual({ clientId: 'cid', clientSecret: 'sec' })
    expect(await mod.origineDe('withings')).toBe('coffre')
  })

  it('l’hébergeur l’emporte sur le coffre', async () => {
    // Sur une instance qui a déjà ses variables, une saisie malheureuse dans l'écran
    // ne doit pas pouvoir casser une connexion qui marche. Et un secret rangé chez
    // l'hébergeur est mieux protégé que le même secret rangé dans les données.
    await mod.poserIdentifiants('withings', 'du-coffre', 'sec-coffre')
    process.env.NUXT_WITHINGS_CLIENT_ID = 'de-l-env'
    process.env.NUXT_WITHINGS_CLIENT_SECRET = 'sec-env'
    expect(await mod.identifiantsDe('withings')).toEqual({ clientId: 'de-l-env', clientSecret: 'sec-env' })
    expect(await mod.origineDe('withings')).toBe('env')
  })

  it('ignore une variable à moitié posée', async () => {
    // L'identifiant sans le secret est le cas le plus fréquent — une variable oubliée
    // dans l'interface de l'hébergeur. Elle ne doit pas faire apparaître un bouton.
    process.env.NUXT_WITHINGS_CLIENT_ID = 'seul'
    expect(await mod.identifiantsDe('withings')).toBeNull()
  })

  it('se retire sans toucher aux autres marques', async () => {
    await mod.poserIdentifiants('withings', 'a', 'b')
    await mod.poserIdentifiants('fitbit', 'c', 'd')
    expect(await mod.retirerIdentifiants('withings')).toBe(true)
    expect(await mod.identifiantsDe('withings')).toBeNull()
    expect(await mod.identifiantsDe('fitbit')).toEqual({ clientId: 'c', clientSecret: 'd' })
    expect(await mod.retirerIdentifiants('withings'), 'retirer deux fois n’est pas une erreur silencieuse').toBe(false)
  })
})

describe('ce qui dort dans le coffre', () => {
  it('n’y dort pas en clair', async () => {
    const { readFile } = await import('node:fs/promises')
    await mod.poserIdentifiants('withings', 'mon-id', 'mon-secret-en-clair')
    const brut = await readFile(join(DOSSIER, 'connecteurs'), 'utf8')
    expect(brut).not.toContain('mon-secret-en-clair')
    // L'identifiant, lui, n'est pas un secret : il voyage en clair dans l'URL
    // d'autorisation, et le montrer permet de vérifier qu'on a collé le bon.
    expect(brut).toContain('mon-id')
  })

  it('ne ressort jamais le secret vers l’écran', async () => {
    await mod.poserIdentifiants('withings', 'mon-id', 'mon-secret')
    const etat = await mod.etatDe('withings')
    expect(JSON.stringify(etat)).not.toContain('mon-secret')
    expect(etat).toMatchObject({ origine: 'coffre', clientId: 'mon-id', lisible: true })
    expect(etat.at).toMatch(/^\d{4}-\d{2}-\d{2}/)
  })

  it('refuse de deviner quand la clé a changé, plutôt que de rendre n’importe quoi', async () => {
    // Changer NUXT_VAULT_SECRET rend les fiches illisibles : c'est voulu — un secret
    // changé doit invalider ce qu'il protégeait. Ce qui ne doit PAS arriver, c'est
    // qu'un secret se déchiffre en octets aléatoires, envoyés ensuite à la marque :
    // on chercherait l'erreur dans la console développeur pendant une heure.
    await mod.poserIdentifiants('withings', 'id', 'sec')
    process.env.NUXT_VAULT_SECRET = 'une-tout-autre-cle-de-plus-de-vingt-quatre'
    expect(await mod.identifiantsDe('withings')).toBeNull()
    expect((await mod.etatDe('withings')).lisible).toBe(false)
  })

  it('chiffre deux fois le même secret différemment', async () => {
    // Un chiffrement déterministe laisserait voir que deux marques partagent le même
    // secret — et, sur un magasin qu'on peut lire, c'est déjà une information.
    const { chiffrer, dechiffrer } = mod._chiffrement
    const a = chiffrer('pareil')
    const b = chiffrer('pareil')
    expect(a).not.toBe(b)
    expect(dechiffrer(a)).toBe('pareil')
    expect(dechiffrer(b)).toBe('pareil')
  })

  it('rejette un paquet modifié au lieu de le déchiffrer à moitié', async () => {
    // AES-GCM porte une étiquette d'authentification : sans elle, un octet changé dans
    // le stockage donnerait un secret silencieusement faux.
    const { chiffrer, dechiffrer } = mod._chiffrement
    const paquet = chiffrer('secret')
    const abime = paquet.slice(0, -4) + 'AAAA'
    expect(() => dechiffrer(abime)).toThrow()
  })
})
