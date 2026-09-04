import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PROVIDERS, availableProviders, providerById } from '../../lib/providers'

// ─────────────────────────────────────────────────────────────────────────────
// Le contrat des connecteurs : ce qu'un adaptateur DOIT faire, quelle que soit la marque.
// ─────────────────────────────────────────────────────────────────────────────
//
// Ce fichier est la contrepartie de la promesse « ajouter une marque = un fichier ».
// Une promesse pareille ne tient que si quelque chose la vérifie : sans ça, le
// deuxième connecteur oublie un scope, le troisième rend des livres au lieu de kilos,
// et on ne le découvre que le jour où quelqu'un branche vraiment sa montre.
//
// Les appels réseau sont remplacés : on teste la TRADUCTION et les décisions, pas la
// disponibilité d'une API tierce. Un test qui dépend d'internet ne dit rien le jour
// où il échoue.

const appels: { url: string, opts: Record<string, unknown> }[] = []
let reponses: unknown[] = []

vi.mock('ofetch', () => ({
  ofetch: (url: string, opts: Record<string, unknown>) => {
    appels.push({ url, opts })
    const r = reponses.shift()
    if (r instanceof Error) return Promise.reject(r)
    return Promise.resolve(r)
  },
}))

const { ADAPTATEURS, adaptateurPour, ErreurConnecteur } = await import('../../server/connecteurs')
const IDS = { clientId: 'cid', clientSecret: 'secret' }

beforeEach(() => { appels.length = 0; reponses = [] })

describe('le registre et les fiches se répondent', () => {
  /**
   * Le piège qu'on évite ici : un adaptateur nommé « fitbits » côté serveur et
   * « fitbit » dans la fiche. Rien ne planterait — la marque n'apparaîtrait tout
   * simplement jamais dans la liste, et on chercherait la cause dans les identifiants.
   */
  it('chaque adaptateur a sa fiche, et l’identifiant est le même des deux côtés', () => {
    for (const a of ADAPTATEURS) {
      expect(providerById(a.id), `aucune fiche pour « ${a.id} » dans lib/providers.ts`).toBeTruthy()
      expect(a.id).toMatch(/^[a-z][a-z0-9-]*$/)
    }
  })

  it('chaque marque annoncée comme branchable a un adaptateur', () => {
    // Une fiche sans adaptateur, c'est un bouton « Connecter » qui mène à un 404. Les
    // marques bloquées (Garmin) sont l'exception assumée : elles sont là pour être
    // visibles, pas pour être branchées.
    for (const p of PROVIDERS) {
      if (!p.identifiants || p.bloque) continue
      expect(adaptateurPour(p.id), `aucun adaptateur pour « ${p.id} »`).toBeTruthy()
    }
  })

  it('ne connaît aucune marque qui ne soit pas dans le registre', () => {
      // La saisie à la main a longtemps figuré ici comme un fournisseur. Elle n'en est
      // pas un : il n'y a rien à autoriser, rien à synchroniser, et une ligne « À la
      // main » dans une liste de marques à brancher n'apprenait rien.
      expect(adaptateurPour('manual')).toBeNull()
      expect(providerById('manual')).toBeNull()
    })

  /**
   * L'URL d'autorisation est le seul endroit où une faute ne se voit pas : la marque
   * répond « invalid request » sans dire quel paramètre manque, et on relit la console
   * développeur pendant vingt minutes.
   */
  it('chaque adaptateur fabrique une URL d’autorisation complète', () => {
    for (const a of ADAPTATEURS) {
      const brut = a.autoriser({ clientId: 'cid', redirectUri: 'https://x.fr/api/connect/y/callback', state: 'st' })
      const u = new URL(brut)
      expect(u.protocol, a.id).toBe('https:')
      expect(u.searchParams.get('client_id'), a.id).toBe('cid')
      expect(u.searchParams.get('redirect_uri'), a.id).toBe('https://x.fr/api/connect/y/callback')
      expect(u.searchParams.get('state'), a.id).toBe('st')
      expect(u.searchParams.get('response_type'), a.id).toBe('code')
      // Sans scope, l'autorisation réussit et la lecture des données échoue plus tard,
      // avec un 403 qui ne dit pas qu'il manquait une case à cocher.
      expect(u.searchParams.get('scope')?.length, a.id).toBeGreaterThan(3)
    }
  })

  it('aucun adaptateur ne lit l’environnement : ses identifiants lui sont donnés', async () => {
    // C'est ce qui permet aux identifiants de venir tantôt de l'hébergeur, tantôt du
    // coffre, sans qu'un adaptateur ait à le savoir — et ce qui rend ce test possible.
    const { readFileSync } = await import('node:fs')
    for (const a of ADAPTATEURS) {
      const src = readFileSync(`server/connecteurs/${a.id}.ts`, 'utf8')
      expect(src, a.id).not.toMatch(/process\.env|useRuntimeConfig/)
    }
  })
})

describe('Withings — le piège du 200 qui cache une erreur', () => {
  const w = adaptateurPour('withings')!

  it('lit le statut dans le CORPS, pas dans le code HTTP', async () => {
    // Withings répond toujours 200 : traiter la réponse comme réussie ferait passer
    // une erreur de jeton pour des données vides, et le bogue devient introuvable.
    reponses = [{ status: 401, error: 'invalid_token' }]
    await expect(w.lire(IDS, 'acces', 0)).rejects.toThrow(ErreurConnecteur)
  })

  it('distingue un jeton mort d’une panne — 503 est un statut Withings, pas un HTTP', async () => {
    reponses = [{ status: 503, error: 'invalid params: refresh_token' }]
    const e = await w.rafraichir(IDS, 'vieux').catch((x: unknown) => x as InstanceType<typeof ErreurConnecteur>)
    expect(e.auth, 'un refresh_token refusé doit demander une reconnexion').toBe(true)

    reponses = [{ status: 601, error: 'too many requests' }]
    const quota = await w.rafraichir(IDS, 'bon').catch((x: unknown) => x as InstanceType<typeof ErreurConnecteur>)
    // Le distinguo n'est pas cosmétique : rafraîchir sur un simple quota brûlerait un
    // jeton pour rien, et Withings enterre l'ancien dès qu'il en émet un nouveau.
    expect(quota.auth, 'un quota n’est pas une autorisation révoquée').toBe(false)
  })

  it('traduit les groupes de mesures en pesées, et rend le curseur de la marque', async () => {
    reponses = [
      {
        status: 0,
        body: {
          updatetime: 1767000000,
          measuregrps: [{ date: 1766900000, measures: [{ value: 78450, type: 1, unit: -3 }] }],
        },
      },
      { status: 0, body: { activities: [{ date: '2026-01-05', steps: 8421 }] } },
    ]
    const r = await w.lire(IDS, 'acces', 0)
    expect(r.pesees).toHaveLength(1)
    expect(r.pesees[0]!.kg).toBeCloseTo(78.45, 2)
    expect(r.pesees[0]!.source).toBe('withings')
    expect(r.pas).toEqual([{ date: '2026-01-05', steps: 8421 }])
    // `updatetime` et non l'heure locale : il tient compte des mesures corrigées après
    // coup, qu'un curseur calculé ici raterait définitivement.
    expect(r.curseur).toBe(1767000000)
  })

  it('rapporte les pesées même quand l’activité échoue', async () => {
    // Les pas sont un bonus, les pesées sont le sujet : une application déclarée sans
    // le scope activité doit continuer à rendre des pesées.
    reponses = [
      { status: 0, body: { updatetime: 42, measuregrps: [{ date: 1766900000, measures: [{ value: 78450, type: 1, unit: -3 }] }] } },
      { status: 401, error: 'no activity scope' },
    ]
    const r = await w.lire(IDS, 'acces', 0)
    expect(r.pesees).toHaveLength(1)
    expect(r.pas).toEqual([])
  })
})

describe('Fitbit — de vrais codes HTTP, et un 403 qui n’est pas un 401', () => {
  const f = adaptateurPour('fitbit')!

  it('un 401 demande une reconnexion, un 403 non', async () => {
    reponses = [Object.assign(new Error('expired'), { status: 401 })]
    const mort = await f.rafraichir(IDS, 'x').catch((e: unknown) => e as InstanceType<typeof ErreurConnecteur>)
    expect(mort.auth).toBe(true)

    // 403 = l'application déclarée n'a pas les scopes. Réautoriser n'y changera rien
    // tant que « weight » et « activity » ne sont pas cochés dans le portail : le
    // ranger sous « auth » ferait tourner en rond entre l'écran et la console.
    reponses = [Object.assign(new Error('insufficient scope'), { status: 403 })]
    const scope = await f.rafraichir(IDS, 'x').catch((e: unknown) => e as InstanceType<typeof ErreurConnecteur>)
    expect(scope.auth).toBe(false)
  })

  it('demande les kilos, pas les livres', async () => {
    // `Accept-Language` décide des UNITÉS. Sans lui, 91,5 kg arrive à 201,7 et rien
    // dans la réponse ne dit que c'est des livres : on verrait un bond de 110 kg.
    reponses = [{ 'body-weight': [] }, { 'activities-steps': [] }, { weight: [] }]
    await f.lire(IDS, 'acces', 0)
    const entetes = appels[0]!.opts.headers as Record<string, string>
    expect(entetes['Accept-Language']).toBe('fr_FR')
  })

  it('n’écrit pas un jour à zéro pas par-dessus l’estimation', async () => {
    // Zéro pas est une vraie journée, mais Fitbit rend aussi zéro pour un jour qu'il
    // ne connaît pas — et l'écrire ferait tomber la cible calorique sous l'estimation.
    reponses = [
      { 'body-weight': [{ dateTime: '2026-01-05', value: '78.4' }] },
      { 'activities-steps': [{ dateTime: '2026-01-05', value: '8421' }, { dateTime: '2026-01-06', value: '0' }] },
      { weight: [] },
    ]
    const r = await f.lire(IDS, 'acces', 0)
    expect(r.pas).toEqual([{ date: '2026-01-05', steps: 8421 }])
    expect(r.pesees[0]!.source).toBe('fitbit')
  })
})

describe('Oura — une marque qui ne pèse pas', () => {
  const o = adaptateurPour('oura')!

  /**
   * Le test qui compte pour cette marque. La portée `personal` donne un poids : celui
   * que la personne a tapé dans l'application Oura, une fois, il y a peut-être deux
   * ans. L'enregistrer comme une pesée fabriquerait une mesure qui n'a jamais eu lieu,
   * et elle irait nourrir le métabolisme de base et la courbe, où plus rien ne la
   * distinguerait d'une vraie.
   */
  it('ne rend aucune pesée, et ne demande pas la portée qui en donnerait une', async () => {
    reponses = [{ data: [{ day: '2026-01-05', steps: 7200 }] }]
    const r = await o.lire(IDS, 'acces', 0)
    expect(r.pesees).toEqual([])
    expect(providerById('oura')!.capabilities).toEqual(['pas'])

    const u = new URL(o.autoriser({ clientId: 'c', redirectUri: 'https://x.fr/cb', state: 's' }))
    expect(u.searchParams.get('scope')).toBe('daily')
    expect(u.searchParams.get('scope')).not.toContain('personal')
  })

  it('accepte les trois formes plausibles du champ de date', async () => {
    // La documentation consultée ne le fixe pas de façon certaine. Deviner et se
    // tromper donnerait des journées silencieusement écartées — une marque qui « ne
    // remonte rien » sans qu'on sache pourquoi.
    reponses = [{
      data: [
        { day: '2026-01-05', steps: 7200 },
        { summary_date: '2026-01-06', steps: 8100 },
        { timestamp: '2026-01-07T00:00:00+01:00', steps: 9000 },
        { steps: 5000 },
        { day: '2026-01-08', steps: 0 },
      ],
    }]
    const r = await o.lire(IDS, 'acces', 0)
    expect(r.pas).toEqual([
      { date: '2026-01-05', steps: 7200 },
      { date: '2026-01-06', steps: 8100 },
      { date: '2026-01-07', steps: 9000 },
    ])
  })

  it('envoie le secret dans l’en-tête, pas dans le corps', async () => {
    // Oura accepte les deux. Un secret dans un corps de requête finit dans les
    // journaux d'accès de tout ce qui passe entre les deux ; un en-tête non.
    reponses = [{ access_token: 'a', refresh_token: 'r', expires_in: 86400 }]
    await o.echanger(IDS, 'code', 'https://x.fr/cb')
    const opts = appels[0]!.opts as { body: string, headers: Record<string, string> }
    expect(opts.headers.Authorization).toMatch(/^Basic /)
    expect(opts.body).not.toContain('secret')
  })
})

describe('Polar — l’inscription en plus', () => {
  const p = adaptateurPour('polar')!

  /**
   * Le détail qui coûte une soirée : sans `POST /v3/users`, toutes les lectures
   * répondent 404 — et un 404 sur une donnée se lit comme « pas de données », pas
   * comme « il manque une inscription ».
   */
  it('inscrit l’utilisateur juste après l’échange du code', async () => {
    reponses = [{ access_token: 'a', expires_in: 86400 }, { 'polar-user-id': 42 }]
    await p.echanger(IDS, 'code', 'https://x.fr/cb')
    expect(appels.map(a => a.url)).toEqual([
      'https://polarremote.com/v2/oauth2/token',
      'https://www.polaraccesslink.com/v3/users',
    ])
  })

  it('traite « déjà inscrit » comme un succès, pas comme une panne', async () => {
    // C'est le cas NORMAL d'une reconnexion. Le laisser remonter ferait échouer un
    // raccordement qui a parfaitement fonctionné.
    reponses = [{ access_token: 'a', expires_in: 86400 }, Object.assign(new Error('conflict'), { status: 409 })]
    await expect(p.echanger(IDS, 'code', 'https://x.fr/cb')).resolves.toMatchObject({ acces: 'a' })
  })

  it('n’annonce aucun jeton de rafraîchissement quand la marque n’en émet pas', async () => {
    // Une chaîne vide dit « rien à rafraîchir » : la route de synchro ne tentera donc
    // jamais un rafraîchissement qui ne peut pas aboutir.
    reponses = [{ access_token: 'a', expires_in: 86400 }, {}]
    const j = await p.echanger(IDS, 'code', 'https://x.fr/cb')
    expect(j.rafraichissement).toBe('')
  })

  it('lit les pas et les pesées, quelle que soit l’enveloppe rendue', async () => {
    // Polar rend une liste nue ici, un objet englobant là. Deviner et se tromper
    // donnerait une marque qui « ne remonte rien » sans qu'on sache pourquoi.
    reponses = [
      { activities: [{ date: '2026-09-01', 'active-steps': 9100 }, { date: '2026-09-02', 'active-steps': 0 }] },
      [{ created: '2026-09-01T07:12:00', weight: 74.3 }],
    ]
    const r = await p.lire(IDS, 'acces', 0)
    expect(r.pas).toEqual([{ date: '2026-09-01', steps: 9100 }])
    expect(r.pesees).toEqual([{ date: '2026-09-01', at: '2026-09-01T07:00', kg: 74.3, source: 'polar' }])
  })

  it('rend les pas même sans balance', async () => {
    // Une montre seule ne rend aucune information physique : l'échec de cet appel ne
    // doit pas emporter les pas, qui sont le sujet.
    reponses = [
      [{ date: '2026-09-01', steps: 8000 }],
      Object.assign(new Error('not found'), { status: 404 }),
    ]
    const r = await p.lire(IDS, 'acces', 0)
    expect(r.pas).toHaveLength(1)
    expect(r.pesees).toEqual([])
  })
})

describe('les montres qu’on ne peut pas brancher', () => {
  /**
   * Apple Watch et Wear OS figurent dans les fiches POUR ÊTRE VUES. Sans elles,
   * quelqu'un qui en porte une ouvre l'écran, ne trouve rien, et conclut que
   * l'application ne sait pas faire — ou cherche une manipulation qui n'existe pas.
   */
  it('sont listées, avec une raison qui tient debout', () => {
    for (const id of ['apple', 'wearos', 'garmin']) {
      const f = providerById(id)!
      expect(f, id).toBeTruthy()
      expect(f.bloque, `${id} doit dire pourquoi`).toBeTruthy()
      expect(f.bloque!.length, `${id} : une raison en trois mots n'explique rien`).toBeGreaterThan(60)
      expect(adaptateurPour(id), `${id} ne doit PAS avoir d'adaptateur`).toBeNull()
    }
  })

  it('n’apparaissent jamais comme branchables, même tout configuré', () => {
    const configures = PROVIDERS.map(p => p.id)
    const dispo = availableProviders(configures).map(p => p.id)
    expect(dispo).not.toContain('apple')
    expect(dispo).not.toContain('wearos')
    expect(dispo).not.toContain('garmin')
    expect(dispo).toEqual(['withings', 'fitbit', 'polar', 'oura'])
  })
})

describe('withings : la fenêtre demandée', () => {
  /*
   * `depuis` a trois valeurs et deux se ressemblaient trop : 0 est le DÉFAUT
   * (quatre-vingt-dix jours), 1 veut dire « tout », le reste est un curseur. Le mode
   * complet envoyait 0 — donc le défaut — en promettant l'historique. Rien
   * n'échouait ; les mesures anciennes n'arrivaient jamais, et aucun test ne pouvait
   * le voir puisque celui du client vérifiait lui aussi « 0 ».
   *
   * Le comportement est vérifié côté client (test/nuxt/connecteur.test.ts : la
   * requête part avec 1). Ici on garde la DISTINCTION elle-même : le jour où
   * quelqu'un simplifie `depuis > 0 ? depuis : défaut`, les deux sens fusionnent et
   * « Tout récupérer » redevient silencieusement « les trois derniers mois ».
   */
  it('distingue « rien à reprendre » de « tout reprendre »', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(new URL('../../server/connecteurs/withings.ts', import.meta.url), 'utf8')
    expect(src).toMatch(/depuis > 0 \? depuis :/)
    // Les pas restent bornés même en mode complet : cinquante ans de getactivity
    // n'est une requête que personne ne veut voir passer.
    expect(src).toMatch(/startdateymd: jour\(Math\.max\(debut,/)
  })
})
