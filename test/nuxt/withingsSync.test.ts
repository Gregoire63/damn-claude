import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerEndpoint } from '@nuxt/test-utils/runtime'
import { readBody } from 'h3'

/**
 * La route de synchronisation, simulée. `vi.stubGlobal('$fetch')` ne suffit pas :
 * l'environnement Nuxt intercepte `$fetch` avec son propre routeur de test, et
 * l'appel finit en « Cannot find any path matching ». On enregistre donc un vrai
 * point de terminaison, une fois pour le fichier, dont la réponse est pilotée par
 * les variables ci-dessous.
 */
let syncPayload: Record<string, unknown> = {}
let syncCalls = 0
let lastBody: Record<string, unknown> | null = null

registerEndpoint('/api/withings/sync', {
  method: 'POST',
  handler: async (event) => {
    syncCalls++
    lastBody = await readBody(event)
    return syncPayload
  },
})

// La route de rafraîchissement, simulée elle aussi : depuis la correction du jeton
// mort, `sync()` passe TOUJOURS par elle quand le jeton d'accès est périmé.
let refreshPayload: Record<string, unknown> = {}
let refreshCalls = 0
let lastRefreshBody: Record<string, unknown> | null = null

registerEndpoint('/api/withings/refresh', {
  method: 'POST',
  handler: async (event) => {
    refreshCalls++
    lastRefreshBody = await readBody(event)
    if (refreshPayload.boom) throw new Error('réseau indisponible')
    return refreshPayload
  },
})

// Câblage du composable Withings : persistance, report de composition, reversement
// des pas dans la nutrition, synchronisation d'ouverture.
//
// Ce fichier existe parce que `composables/useWithings.ts` était à 0 % de couverture
// alors qu'il pilote DEUX chiffres qui décident du contenu de l'assiette : la cible
// calorique (via les pas) et la cible protéique (via la masse maigre). Les calculs
// purs sont testés dans test/unit/withings.test.ts ; ici on teste les fils.
//
// L'état vit au niveau du module : on réimporte à neuf à chaque test.
beforeEach(() => {
  localStorage.clear()
  vi.resetModules()
  syncCalls = 0
  lastBody = null
  syncPayload = { groups: [], activity: [], updatetime: 1_760_000_000, tokens: null }
  refreshCalls = 0
  lastRefreshBody = null
  refreshPayload = { tokens: { accessToken: 'a2', refreshToken: 'r2', expiresIn: 10800 }, needsReconnect: false, error: null }
})

const load = async () => {
  const { useWithings } = await import('../../composables/useWithings')
  const w = useWithings()
  w.hydrate()
  return w
}

const TODAY = '2026-08-10'

describe('saisie manuelle et composition', () => {
  it('une pesée sans impédance reste une pesée utile', async () => {
    const w = await load()
    w.addManual(92.6, TODAY)
    expect(w.entries.value).toHaveLength(1)
    expect(w.entries.value[0].kg).toBe(92.6)
    expect(w.entries.value[0].fatRatio).toBeUndefined()
    expect(w.entries.value[0].leanMass).toBeUndefined()
  })

  it('déduit masse grasse et masse maigre du seul pourcentage', async () => {
    // Trois champs à remplir pour une seule information, ce serait deux de trop.
    const w = await load()
    w.addManual(92.6, TODAY, undefined, 26.5)
    const e = w.entries.value[0]
    expect(e.fatRatio).toBe(26.5)
    expect(e.fatMass).toBeCloseTo(24.54, 1)
    expect(e.leanMass).toBeCloseTo(68.06, 1)
    // Les deux doivent se recomposer en le poids : sinon on affiche une contradiction.
    expect(e.fatMass! + e.leanMass!).toBeCloseTo(92.6, 1)
  })

  it('refuse un taux de masse grasse impossible plutôt que de le stocker', async () => {
    const w = await load()
    w.addManual(92.6, TODAY, undefined, 1)
    expect(w.entries.value[0].fatRatio).toBeUndefined()
    w.addManual(90, '2026-08-11', undefined, 95)
    expect(w.entries.value.at(-1)!.fatRatio).toBeUndefined()
  })

  it('survit à un rechargement', async () => {
    const w = await load()
    w.addManual(92.6, TODAY, undefined, 26.5)
    vi.resetModules()
    const again = await load()
    expect(again.entries.value).toHaveLength(1)
    expect(again.entries.value[0].fatRatio).toBe(26.5)
  })
})

describe('bodyComp — ce qui nourrit la cible protéique', () => {
  it('prend tout de la dernière pesée quand elle mesure la composition', async () => {
    const w = await load()
    w.addManual(93.4, '2026-08-01', undefined, 26.8)
    w.addManual(92.6, TODAY, undefined, 26.5)
    expect(w.bodyComp.value).toMatchObject({ kg: 92.6, fatRatio: 26.5, carried: false })
  })

  it('reporte le dernier taux connu quand la dernière pesée n\'a pas d\'impédance', async () => {
    // LE cas de régression : sans report, la cible protéique bondirait d'une
    // vingtaine de grammes du jour au lendemain pour un corps qui n'a pas bougé.
    const w = await load()
    w.addManual(92.6, '2026-08-08', undefined, 26.5)
    w.addManual(92.1, TODAY)
    const c = w.bodyComp.value!
    expect(c.kg).toBe(92.1) // le poids d'aujourd'hui
    expect(c.fatRatio).toBe(26.5) // le taux d'avant-hier
    expect(c.carried).toBe(true)
    // Et surtout : pas de kilos recopiés, ils appartiennent à l'autre pesée.
    expect(c.fatMass).toBeUndefined()
    expect(c.leanMass).toBeUndefined()
  })

  it('rend un poids exploitable même sans aucune mesure de composition', async () => {
    const w = await load()
    w.addManual(92.6, TODAY)
    expect(w.bodyComp.value).toMatchObject({ kg: 92.6, measuredOn: null, carried: false })
  })

  it('rend null tant qu\'on ne s\'est jamais pesé', async () => {
    const w = await load()
    expect(w.bodyComp.value).toBeNull()
  })
})

describe('miroir vers le journal des séances', () => {
  it('recopie le poids là où le métabolisme de base va le chercher', async () => {
    const w = await load()
    w.addManual(92.6, TODAY, undefined, 26.5)
    const { useWorkout } = await import('../../composables/useWorkout')
    const wk = useWorkout()
    expect(wk.bodyWeight.value.some(e => e.date === TODAY && e.kg === 92.6)).toBe(true)
  })
})

// ─── Synchronisation ────────────────────────────────────────────────────────

/** Réponse minimale de /api/withings/sync, telle que le composable l'attend. */
function stubSync(payload: {
  groups?: { date: number, measures: { value: number, type: number, unit: number }[] }[]
  activity?: { date: string, steps?: number }[]
  updatetime?: number
}) {
  syncPayload = {
    groups: payload.groups ?? [],
    activity: payload.activity ?? [],
    updatetime: payload.updatetime ?? 1_760_000_000,
    tokens: null,
  }
}

/** Branche des jetons sans passer par le flux OAuth. */
function connect(w: Awaited<ReturnType<typeof load>>) {
  w.adoptFromQuery({ access_token: 'a', refresh_token: 'r', expires_at: '9999999999' })
}

describe('sync', () => {
  it('ne part pas en requête sans jetons', async () => {
    const w = await load()
    stubSync({})
    expect(await w.sync()).toBe(false)
    expect(syncCalls).toBe(0)
  })

  it('range les mesures et retient l\'horodatage', async () => {
    const w = await load()
    connect(w)
    stubSync({
      groups: [{
        date: Math.floor(Date.parse('2026-08-10T07:00:00Z') / 1000),
        measures: [{ value: 92600, type: 1, unit: -3 }],
      }],
      updatetime: 1_760_000_123,
    })
    expect(await w.sync()).toBe(true)
    expect(w.entries.value).toHaveLength(1)
    expect(w.entries.value[0].kg).toBeCloseTo(92.6, 1)
    expect(w.lastSync.value).toBe(1_760_000_123)
  })
})

describe('pushToJournal — les pas arrivent dans la nutrition', () => {
  it('écrit les pas d\'un jour passé tels quels', async () => {
    const w = await load()
    connect(w)
    stubSync({ activity: [{ date: '2026-08-09', steps: 4200 }] })
    await w.syncAndPush(TODAY)

    const { useNutrition } = await import('../../composables/useNutrition')
    const n = useNutrition()
    n.hydrate()
    expect(n.stepsFor('2026-08-09')).toBe(4200)
  })

  it('ne révise le jour EN COURS que vers le haut', async () => {
    // Le compteur du matin est partiel : à 9 h il affiche 800 pas. L'écrire ferait
    // tomber la cible sous l'estimation, et l'app conseillerait de moins manger au
    // petit-déjeuner parce qu'on n'a pas encore marché.
    const w = await load()
    connect(w)
    stubSync({ activity: [{ date: TODAY, steps: 800 }] })
    await w.syncAndPush(TODAY)

    const { useNutrition } = await import('../../composables/useNutrition')
    const n = useNutrition()
    n.hydrate()
    expect(n.stepsFor(TODAY)).toBeNull()
  })

  it('écrit le jour en cours dès que le réel dépasse l\'estimation', async () => {
    const w = await load()
    connect(w)
    stubSync({ activity: [{ date: TODAY, steps: 12_000 }] })
    await w.syncAndPush(TODAY)

    const { useNutrition } = await import('../../composables/useNutrition')
    const n = useNutrition()
    n.hydrate()
    expect(n.stepsFor(TODAY)).toBe(12_000)
  })

  it('ignore une journée à zéro pas plutôt que de la croire', async () => {
    const w = await load()
    connect(w)
    stubSync({ activity: [{ date: '2026-08-09', steps: 0 }] })
    await w.syncAndPush(TODAY)

    const { useNutrition } = await import('../../composables/useNutrition')
    const n = useNutrition()
    n.hydrate()
    expect(n.stepsFor('2026-08-09')).toBeNull()
  })
})

describe('autoSync — la synchro d\'ouverture', () => {
  it('ne fait rien sans balance connectée', async () => {
    const w = await load()
    stubSync({})
    expect(await w.autoSync(TODAY)).toBe(false)
    expect(syncCalls).toBe(0)
  })

  it('part en requête quand la dernière synchro est ancienne', async () => {
    const w = await load()
    connect(w)
    stubSync({ activity: [{ date: '2026-08-09', steps: 5000 }] })
    expect(await w.autoSync(TODAY)).toBe(true)
    expect(syncCalls).toBe(1)
  })

  it('se court-circuite si elle a déjà tourné dans l\'heure', async () => {
    // Le pas de temps n'est pas une optimisation réseau : c'est ce qui évite de
    // repartir en requête à chaque navigation entre onglets.
    const w = await load()
    connect(w)
    stubSync({ updatetime: Math.floor(Date.now() / 1000) })
    await w.autoSync(TODAY)

    const before = syncCalls
    expect(await w.autoSync(TODAY)).toBe(false)
    expect(syncCalls).toBe(before)
  })

  it('le bouton « Synchroniser », lui, force le passage', async () => {
    const w = await load()
    connect(w)
    stubSync({ updatetime: Math.floor(Date.now() / 1000) })
    await w.autoSync(TODAY)

    const before = syncCalls
    expect(await w.syncAndPush(TODAY, { full: true })).toBe(true)
    expect(syncCalls).toBe(before + 1)
    // `full` repart de zéro : c'est ce qui permet de rattraper une pesée corrigée.
    expect(lastBody!.since).toBe(0)
  })
})

describe('sauvegarde', () => {
  it('exporte et restaure les pesées, composition comprise', async () => {
    const w = await load()
    w.addManual(92.6, TODAY, undefined, 26.5)
    const snap = w.snapshot()

    localStorage.clear()
    vi.resetModules()
    const fresh = await load()
    expect(fresh.entries.value).toHaveLength(0)
    fresh.restore(snap as Record<string, unknown>)
    expect(fresh.entries.value).toHaveLength(1)
    expect(fresh.bodyComp.value).toMatchObject({ kg: 92.6, fatRatio: 26.5 })
  })

  it('n\'exporte JAMAIS les jetons Withings', async () => {
    // Un fichier de sauvegarde se transfère par mail ou par clé USB. Un jeton d'accès
    // dedans, c'est un compte Withings ouvert à qui le récupère.
    const w = await load()
    connect(w)
    w.addManual(92.6, TODAY)
    expect(JSON.stringify(w.snapshot())).not.toContain('access')
    expect(Object.keys(w.snapshot())).toEqual(['withingsBody'])
  })
})

describe('quarantaine', () => {
  it('ne reporte jamais le taux de quelqu\'un d\'autre', async () => {
    // Balance partagée. Quelqu'un se pèse au milieu de la série : 64 kg et 18 % de
    // masse grasse. Deux jours plus tard, Grégoire se pèse sur un pèse-personne sans
    // impédance. Si le report allait chercher la mesure la plus récente sans filtrer
    // la quarantaine, il repartirait sur les 18 % — et la cible protéique serait
    // calculée sur le corps d'un autre.
    // Les pesées doivent venir de la BALANCE : une saisie manuelle est réputée venir
    // de l'utilisateur, donc jamais mise en quarantaine. C'est voulu — et c'est aussi
    // pour ça qu'on passe par `restore` ici plutôt que par `addManual`.
    const w = await load()
    const body = [
      ...[1, 2, 3, 4, 5].map(d => ({
        date: `2026-08-0${d}`,
        at: `2026-08-0${d}T07:00`,
        kg: 92.5,
        fatRatio: 26.5,
        source: 'withings' as const,
      })),
      { date: '2026-08-06', at: '2026-08-06T07:00', kg: 64, fatRatio: 18, source: 'withings' as const },
      { date: '2026-08-07', at: '2026-08-07T07:00', kg: 92.4, source: 'withings' as const },
    ]
    w.restore({ withingsBody: body })

    expect(w.suspects.value.map(e => e.kg)).toContain(64)
    const c = w.bodyComp.value!
    expect(c.kg).toBe(92.4)
    expect(c.fatRatio).toBe(26.5)
    expect(c.carried).toBe(true)
  })
})


// ─── Le jeton qui meurt ──────────────────────────────────────────────────────
//
// Le bug qui a cassé la balance, et les trois règles qui l'empêchent de revenir.
//
// Withings FAIT TOURNER ses refresh_token : chaque rafraîchissement en émet un
// nouveau et invalide l'ancien dans la seconde. `sync` rafraîchissait au milieu de
// son travail puis relançait l'appel de données ; quand ce second appel échouait, le
// handler levait et le jeton neuf n'atteignait jamais le téléphone — pendant que
// Withings avait déjà enterré l'ancien. À partir de là, chaque synchro renvoyait un
// jeton mort : « status 503 : invalid params: refresh_token », à vie.
const TOK_KEY = 'gr-withings-tok-v1'
const seedTokens = (expiresAt: number, refresh = 'r1') =>
  localStorage.setItem(TOK_KEY, JSON.stringify({ accessToken: 'a1', refreshToken: refresh, expiresAt }))
const stored = () => JSON.parse(localStorage.getItem(TOK_KEY) || '{}')
const past = Math.floor(Date.now() / 1000) - 60
const future = Math.floor(Date.now() / 1000) + 3600

describe('jetons Withings', () => {
  it('rafraîchit AVANT d\'aller chercher les données, et enregistre aussitôt', async () => {
    // L'ordre est tout : il ne doit rien rester entre l'émission du jeton et son
    // écriture. C'est le seul moyen qu'une panne de réseau ne condamne pas le compte.
    seedTokens(past)
    const w = await load()
    await w.sync()
    expect(refreshCalls).toBe(1)
    expect(lastRefreshBody).toMatchObject({ refreshToken: 'r1' })
    expect(stored().refreshToken).toBe('r2')
    // …et la synchro est bien partie ensuite, avec le jeton neuf.
    expect(syncCalls).toBe(1)
    expect(lastBody).toMatchObject({ accessToken: 'a2', refreshToken: 'r2' })
  })

  it('ne brûle pas un jeton encore valide', async () => {
    seedTokens(future)
    const w = await load()
    await w.sync()
    expect(refreshCalls).toBe(0)
    expect(syncCalls).toBe(1)
  })

  it('garde les jetons rendus par une synchro qui a ÉCHOUÉ', async () => {
    // Le cœur de la régression. Le serveur rend désormais `tokens` même quand la
    // suite s'est mal passée ; les perdre ici referait exactement le même trou.
    seedTokens(future)
    syncPayload = {
      groups: [], activity: [], updatetime: 0,
      tokens: { accessToken: 'a9', refreshToken: 'r9', expiresIn: 10800 },
      needsReconnect: false, error: 'Withings status 601: too many requests',
    }
    const w = await load()
    const ok = await w.sync()
    expect(ok).toBe(false)
    expect(stored().refreshToken).toBe('r9') // écrit malgré l'échec
    expect(w.syncError.value).toContain('601')
  })

  it('bascule sur « à reconnecter » quand le refresh_token est refusé', async () => {
    seedTokens(past)
    refreshPayload = { tokens: null, needsReconnect: true, error: 'La balance a révoqué l\'autorisation.' }
    const w = await load()
    const ok = await w.sync()
    expect(ok).toBe(false)
    expect(w.needsReconnect.value).toBe(true)
    expect(syncCalls).toBe(0) // inutile d'aller plus loin
    expect(stored().refreshToken).toBe('r1') // on n'écrase pas avec du vide
  })

  it('sort de l\'état « à reconnecter » dès qu\'une synchro repasse', async () => {
    seedTokens(past)
    refreshPayload = { tokens: null, needsReconnect: true, error: 'révoquée' }
    const w = await load()
    await w.sync()
    expect(w.needsReconnect.value).toBe(true)
    refreshPayload = { tokens: { accessToken: 'a3', refreshToken: 'r3', expiresIn: 10800 }, needsReconnect: false, error: null }
    await w.sync()
    expect(w.needsReconnect.value).toBe(false)
    expect(stored().refreshToken).toBe('r3')
  })

  it('tente quand même la synchro si la route de rafraîchissement est injoignable', async () => {
    // Réseau coupé sur /refresh : le jeton d'accès en main est peut-être encore bon.
    // Ce qu'on ne fait surtout pas, c'est déclarer le compte mort — ni brûler le
    // refresh_token pour rien.
    seedTokens(past)
    refreshPayload = { boom: true }
    const w = await load()
    await w.sync()
    expect(w.needsReconnect.value).toBe(false)
    expect(syncCalls).toBe(1)
  })

  it('oublie l\'état de reconnexion quand on déconnecte le compte', async () => {
    seedTokens(past)
    refreshPayload = { tokens: null, needsReconnect: true, error: 'révoquée' }
    const w = await load()
    await w.sync()
    expect(w.needsReconnect.value).toBe(true)
    w.disconnect()
    expect(w.needsReconnect.value).toBe(false)
  })
})
