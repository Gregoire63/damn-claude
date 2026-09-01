import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerEndpoint } from '@nuxt/test-utils/runtime'
import { readBody } from 'h3'

/**
 * Les routes, simulées. `vi.stubGlobal('$fetch')` ne suffit pas : l'environnement Nuxt
 * intercepte `$fetch` avec son propre routeur de test, et l'appel finit en « Cannot
 * find any path matching ». On enregistre donc de vrais points de terminaison, une
 * fois pour le fichier, dont la réponse est pilotée par les variables ci-dessous.
 */
let syncPayload: Record<string, unknown> = {}
let syncCalls = 0
let lastBody: Record<string, unknown> | null = null

registerEndpoint('/api/connect/withings/sync', {
  method: 'POST',
  handler: async (event) => {
    syncCalls++
    lastBody = await readBody(event)
    return syncPayload
  },
})

// La route de rafraîchissement : depuis la correction du jeton mort, la synchro passe
// TOUJOURS par elle quand le jeton d'accès est périmé.
let refreshPayload: Record<string, unknown> = {}
let refreshCalls = 0
let lastRefreshBody: Record<string, unknown> | null = null

registerEndpoint('/api/connect/withings/refresh', {
  method: 'POST',
  handler: async (event) => {
    refreshCalls++
    lastRefreshBody = await readBody(event)
    if (refreshPayload.boom) throw new Error('réseau indisponible')
    return refreshPayload
  },
})

const TODAY = '2026-08-10'
const TOK = 'gr-conn-withings-tok-v1'
const past = Math.floor(Date.now() / 1000) - 60
const future = Math.floor(Date.now() / 1000) + 3600

beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
  syncCalls = 0
  lastBody = null
  syncPayload = { pesees: [], pas: [], curseur: 1_760_000_000, jetons: null }
  refreshCalls = 0
  lastRefreshBody = null
  refreshPayload = { jetons: { acces: 'a2', rafraichissement: 'r2', expireA: future }, reconnecter: false, erreur: null }
})

const load = async (id = 'withings') => {
  const { useConnecteur } = await import('../../composables/useConnecteur')
  return useConnecteur(id)
}
/** Branche des jetons sans passer par le flux OAuth. */
const seed = (expireA: number, rafraichissement = 'r1') =>
  localStorage.setItem(TOK, JSON.stringify({ acces: 'a1', rafraichissement, expireA }))
const stocke = () => JSON.parse(localStorage.getItem(TOK) || '{}')

describe('synchronisation', () => {
  it('ne part pas en requête sans jetons', async () => {
    const c = await load()
    expect(await c.synchroniser(TODAY)).toBe(false)
    expect(syncCalls).toBe(0)
  })

  it('range les mesures et retient le curseur rendu par la marque', async () => {
    seed(future)
    const c = await load()
    syncPayload = {
      pesees: [{ date: TODAY, at: `${TODAY}T07:00`, kg: 92.6, source: 'withings' }],
      pas: [{ date: '2026-08-09', steps: 4200 }],
      curseur: 1_760_000_123,
      jetons: null,
    }
    expect(await c.synchroniser(TODAY)).toBe(true)
    expect(c.derniere.value).toBe(1_760_000_123)

    const { useMesures } = await import('../../composables/useMesures')
    expect(useMesures().entries.value).toHaveLength(1)
    const { useNutrition } = await import('../../composables/useNutrition')
    const n = useNutrition()
    n.hydrate()
    expect(n.stepsFor('2026-08-09')).toBe(4200)
  })

  it('reprend au curseur, et repart de zéro quand on demande tout', async () => {
    seed(future)
    const c = await load()
    syncPayload = { pesees: [], pas: [], curseur: 999, jetons: null }
    await c.synchroniser(TODAY)
    expect(lastBody!.depuis).toBe(0) // première fois : rien à reprendre
    await c.synchroniser(TODAY)
    expect(lastBody!.depuis).toBe(999)
    await c.synchroniser(TODAY, { complet: true })
    // `complet` repart de zéro : c'est ce qui permet de rattraper une pesée corrigée.
    expect(lastBody!.depuis).toBe(0)
  })
})

describe('la synchro d\'ouverture', () => {
  it('ne fait rien sans marque connectée', async () => {
    expect(await (await load()).autoSync(TODAY)).toBe(false)
    expect(syncCalls).toBe(0)
  })

  it('part en requête quand la dernière synchro est ancienne', async () => {
    seed(future)
    const c = await load()
    expect(await c.autoSync(TODAY)).toBe(true)
    expect(syncCalls).toBe(1)
  })

  it('se court-circuite si elle a déjà tourné dans l\'heure', async () => {
    // Le pas de temps n'est pas une optimisation réseau : c'est ce qui évite de
    // repartir en requête à chaque navigation entre onglets.
    seed(future)
    const c = await load()
    syncPayload = { pesees: [], pas: [], curseur: Math.floor(Date.now() / 1000), jetons: null }
    await c.autoSync(TODAY)
    const avant = syncCalls
    expect(await c.autoSync(TODAY)).toBe(false)
    expect(syncCalls).toBe(avant)
  })
})

// ─── Le jeton qui meurt ──────────────────────────────────────────────────────
//
// Le bogue qui a cassé la balance, et les règles qui l'empêchent de revenir.
//
// Beaucoup de marques FONT TOURNER leurs jetons de rafraîchissement : chaque
// rafraîchissement en émet un nouveau et invalide l'ancien dans la seconde. La synchro
// rafraîchissait au milieu de son travail puis relançait l'appel de données ; quand ce
// second appel échouait, le handler levait et le jeton neuf n'atteignait jamais le
// téléphone — pendant que la marque avait déjà enterré l'ancien. À partir de là,
// chaque synchro renvoyait un jeton mort, à vie.
describe('jetons', () => {
  it('rafraîchit AVANT d\'aller chercher les données, et enregistre aussitôt', async () => {
    // L'ordre est tout : il ne doit rien rester entre l'émission du jeton et son
    // écriture. C'est le seul moyen qu'une panne de réseau ne condamne pas le compte.
    seed(past)
    const c = await load()
    await c.synchroniser(TODAY)
    expect(refreshCalls).toBe(1)
    expect(lastRefreshBody).toMatchObject({ rafraichissement: 'r1' })
    expect(stocke().rafraichissement).toBe('r2')
    expect(syncCalls).toBe(1)
    expect(lastBody).toMatchObject({ acces: 'a2', rafraichissement: 'r2' })
  })

  it('ne brûle pas un jeton encore valide', async () => {
    seed(future)
    await (await load()).synchroniser(TODAY)
    expect(refreshCalls).toBe(0)
    expect(syncCalls).toBe(1)
  })

  it('garde les jetons rendus par une synchro qui a ÉCHOUÉ', async () => {
    // Le cœur de la régression. Le serveur rend `jetons` même quand la suite s'est mal
    // passée ; les perdre ici referait exactement le même trou.
    seed(future)
    syncPayload = {
      pesees: [], pas: [], curseur: 0,
      jetons: { acces: 'a9', rafraichissement: 'r9', expireA: future },
      reconnecter: false, erreur: 'status 601: too many requests',
    }
    const c = await load()
    expect(await c.synchroniser(TODAY)).toBe(false)
    expect(stocke().rafraichissement).toBe('r9') // écrit malgré l'échec
    expect(c.erreur.value).toContain('601')
  })

  it('bascule sur « à reconnecter » quand le jeton de rafraîchissement est refusé', async () => {
    seed(past)
    refreshPayload = { jetons: null, reconnecter: true, erreur: 'L\'autorisation a été révoquée.' }
    const c = await load()
    expect(await c.synchroniser(TODAY)).toBe(false)
    expect(c.reconnecter.value).toBe(true)
    expect(syncCalls).toBe(0) // inutile d'aller plus loin
    expect(stocke().rafraichissement).toBe('r1') // on n'écrase pas avec du vide
  })

  it('sort de l\'état « à reconnecter » dès qu\'une synchro repasse', async () => {
    seed(past)
    refreshPayload = { jetons: null, reconnecter: true, erreur: 'révoquée' }
    const c = await load()
    await c.synchroniser(TODAY)
    expect(c.reconnecter.value).toBe(true)
    refreshPayload = { jetons: { acces: 'a3', rafraichissement: 'r3', expireA: future }, reconnecter: false, erreur: null }
    await c.synchroniser(TODAY)
    expect(c.reconnecter.value).toBe(false)
    expect(stocke().rafraichissement).toBe('r3')
  })

  it('tente quand même la synchro si la route de rafraîchissement est injoignable', async () => {
    // Réseau coupé : le jeton d'accès en main est peut-être encore bon. Ce qu'on ne
    // fait surtout pas, c'est déclarer le compte mort — ni brûler le jeton pour rien.
    seed(past)
    refreshPayload = { boom: true }
    const c = await load()
    await c.synchroniser(TODAY)
    expect(c.reconnecter.value).toBe(false)
    expect(syncCalls).toBe(1)
  })

  it('oublie l\'état de reconnexion quand on débranche la marque', async () => {
    seed(past)
    refreshPayload = { jetons: null, reconnecter: true, erreur: 'révoquée' }
    const c = await load()
    await c.synchroniser(TODAY)
    expect(c.reconnecter.value).toBe(true)
    c.deconnecter()
    expect(c.reconnecter.value).toBe(false)
    expect(c.connecte.value).toBe(false)
  })
})

describe('la reprise des anciennes clés', () => {
  /**
   * Le test qui protège une installation qui MARCHE.
   *
   * Avant la refonte, chaque marque écrivait ses jetons sous une clé à elle. Sans
   * reprise, la mise à jour déconnecterait une balance qui fonctionne, et il faudrait
   * repasser par l'autorisation sans que rien n'explique pourquoi.
   */
  it('reprend les jetons Withings posés par l\'ancienne organisation', async () => {
    localStorage.setItem('gr-withings-tok-v1', JSON.stringify({
      accessToken: 'ancien-a', refreshToken: 'ancien-r', expiresAt: future,
    }))
    localStorage.setItem('gr-withings-sync-v1', JSON.stringify(1_755_000_000))
    const c = await load()
    expect(c.connecte.value).toBe(true)
    expect(c.derniere.value).toBe(1_755_000_000)
    // Et la reprise est ÉCRITE : elle ne doit pas se rejouer à chaque ouverture.
    expect(stocke().acces).toBe('ancien-a')
  })

  it('ne ressuscite pas une marque qu\'on vient de débrancher', async () => {
    // L'ancienne clé traînait encore : sans son effacement, la marque se serait
    // reconnectée toute seule au rechargement suivant.
    localStorage.setItem('gr-withings-tok-v1', JSON.stringify({ accessToken: 'a', refreshToken: 'r', expiresAt: future }))
    const c = await load()
    c.deconnecter()
    expect(localStorage.getItem('gr-withings-tok-v1')).toBeNull()
    vi.resetModules()
    expect((await load()).connecte.value).toBe(false)
  })

  it('ignore un curseur Fitbit en millisecondes plutôt que de sauter dix mille ans', async () => {
    // L'ancien Fitbit stockait `Date.now()` ; pris pour des secondes, il place le
    // curseur en l'an 57 000 et la marque ne rend plus jamais rien.
    localStorage.setItem('gr-fitbit-tok-v1', JSON.stringify({ accessToken: 'a', refreshToken: 'r', expiresAt: future }))
    const c = await load('fitbit')
    expect(c.connecte.value).toBe(true)
    expect(c.derniere.value).toBe(0)
  })
})

describe('les marques connues de ce navigateur', () => {
  it('se lisent dans le stockage, sans liste écrite nulle part', async () => {
    // C'est ce qui permet à la coque de reprendre une connexion et de synchroniser
    // sans aller demander au serveur quelles marques existent — et à un connecteur
    // de plus de ne toucher aucun fichier côté navigateur.
    seed(future)
    localStorage.setItem('gr-conn-fitbit-nonce-v1', JSON.stringify({ nonce: 'x'.repeat(32), at: Date.now() }))
    const { marquesLocales } = await import('../../composables/useConnecteur')
    expect(marquesLocales().sort()).toEqual(['fitbit', 'withings'])
  })
})
