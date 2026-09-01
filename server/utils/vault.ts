import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

// ─────────────────────────────────────────────────────────────────────────────
// Le coffre : ce que le serveur détient, et pourquoi il le détient.
// ─────────────────────────────────────────────────────────────────────────────
//
// Jusqu'ici l'application ne stockait RIEN côté serveur — c'était une propriété,
// pas un manque. Elle change ici pour une raison précise : un connecteur Claude est
// appelé depuis les serveurs d'Anthropic, jamais depuis le téléphone. Sans copie
// lisible côté serveur, il n'a rien à lire.
//
// Trois règles encadrent cette copie.
//
//  1. C'est un MIROIR, pas la source. Le téléphone reste la référence : il pousse
//     son instantané, le serveur l'accepte tel quel. Aucune fusion, donc aucun
//     conflit possible — le cas où deux copies divergent et où il faut arbitrer
//     n'existe pas.
//  2. Les écritures venant de Claude ne touchent JAMAIS le miroir. Elles vont dans
//     une file de PROPOSITIONS, que l'application montre à l'ouverture et qu'on
//     applique d'un geste. Une erreur d'interprétation coûte un refus, pas une
//     donnée perdue.
//  3. Rien n'est lisible sans authentification : le passkey pour l'application, un
//     jeton OAuth pour le connecteur.
//
// Le stockage est Netlify Blobs en production (rien à provisionner, rien à payer
// à cette échelle) et un dossier local en développement, derrière la même
// interface — pour que le code testé soit celui qui tourne.

export interface VaultProposal {
  id: string
  /** Quand Claude l'a déposée. */
  at: string
  /** L'outil qui l'a produite, pour savoir quoi appliquer côté application. */
  action: string
  /** Phrase lisible : c'est ce que l'utilisateur lira avant de valider. */
  summary: string
  /** Le détail, tel que l'application saura l'appliquer. */
  patch: Record<string, unknown>
  status: 'pending' | 'applied' | 'refused'
  resolvedAt?: string
}

export interface VaultMirror {
  /** Horodatage de l'instantané poussé par le téléphone. */
  at: string
  /** Version du format de l'export (celle de useWorkout). */
  version: number
  data: Record<string, unknown>
}

interface Store {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}

const KEY_MIRROR = 'mirror.json'
const KEY_PROPOSALS = 'proposals.json'
const KEY_CREDENTIAL = 'credential.json'
const KEY_HANDOVER = 'withings-handover.json'

/**
 * Netlify Blobs en production, dossier local sinon.
 *
 * Le repli n'est pas un gadget de confort : sans lui, rien de ce qui suit ne
 * serait exécutable ni testable hors déploiement, et on ne saurait qu'en
 * production si le coffre fonctionne.
 */
/**
 * Reconstruit à CHAQUE appel — et le commentaire qui disait l'inverse ici était la
 * panne elle-même.
 *
 * Il justifiait la mise en cache par : « c'est de la configuration, identique d'un
 * appel au suivant ». La première moitié est vraie, la seconde est fausse. Cette
 * configuration CONTIENT un jeton, et ce jeton expire.
 *
 * `getStore()` lit `NETLIFY_BLOBS_CONTEXT`, que la plateforme réinjecte à chaque
 * invocation avec une accréditation de courte durée. Mémoriser l'objet au niveau du
 * module revient à mémoriser le jeton pris au démarrage à froid : tant que
 * l'instance reste chaude — Netlify les garde une vingtaine de minutes — toutes les
 * invocations suivantes présentent une accréditation périmée, et le coffre répond
 * « Failed to decode token: Token expired ».
 *
 * Le symptôme est trompeur à trois titres, et c'est ce qui a coûté dix jours :
 *
 *  1. Il est INTERMITTENT. La plateforme répartit les requêtes entre instances
 *     jeunes et âgées ; on croit à un aléa réseau. Mesuré en production le jour du
 *     diagnostic : instance de 16 s → `store: ok`, instance de 1165 s →
 *     `Token expired`. Même code, même clé, même déploiement.
 *  2. Il « guérit » tout seul. Réessayer finit par tomber sur une instance neuve,
 *     ce qui ressemble à une reprise réussie et ne l'est pas.
 *  3. Il semble ne toucher QUE l'écriture. C'est un effet d'échantillonnage : une
 *     lecture isolée passe, quatre dépôts d'affilée tombent sur la même instance
 *     âgée. Lecture et écriture partagent ce `store()` (cf. `readJson` et
 *     `writeJson` plus bas) et donc le même jeton — elles échouent ensemble.
 *
 * Reconstruire ne coûte rien : `getStore()` ne fait aucun appel réseau, il assemble
 * un objet à partir de l'environnement. L'`import()` dynamique, lui, reste mis en
 * cache par le système de modules.
 *
 * RÈGLE, valable bien au-delà d'ici : dans une fonction sans état, tout ce qui porte
 * une accréditation temporaire se reconstruit À CHAQUE INVOCATION. On ne met en
 * cache que des données pures. Un test le vérifie — test/unit/vaultStore.test.ts.
 */
/**
 * Deux tentatives, et la seconde RECONSTRUIT le client.
 *
 * C'est le point qui fait toute la valeur de cette reprise, et le plus facile à
 * rater : rejouer l'opération sur le client déjà en main ne sert à rien. Si son
 * accréditation a expiré, les deux tentatives échouent exactement pareil — et on en
 * conclut que le correctif au-dessus n'a rien changé. On refait donc le client à
 * chaque essai.
 *
 * Deux tentatives et pas davantage : la reprise ne couvre qu'une accréditation
 * fraîchement périmée ou un hoquet réseau. Au-delà, le stockage a un vrai problème,
 * et insister ne fait qu'ajouter des secondes au délai que la passerelle nous
 * accorde — c'est ce qui transforme une erreur lisible en 502 muette.
 *
 * `get` comme `set` sont idempotents ici (même clé, même valeur), rejouer est donc
 * sans effet de bord.
 */
const REPRISE_MS = 200

async function avecReprise<T>(op: (s: Store) => Promise<T>): Promise<T> {
  let derniere: unknown
  for (let essai = 0; essai < 2; essai++) {
    if (essai > 0) await new Promise(r => setTimeout(r, REPRISE_MS))
    try {
      return await op(await buildStore())
    }
    catch (e) {
      derniere = e
    }
  }
  throw derniere
}

async function buildStore(): Promise<Store> {
  if (process.env.NETLIFY || process.env.NETLIFY_BLOBS_CONTEXT) {
    const { getStore } = await import('@netlify/blobs')
    const s = getStore({ name: 'gr-vault', consistency: 'strong' })
    return {
      get: key => s.get(key, { type: 'text' }) as Promise<string | null>,
      set: (key, value) => s.set(key, value),
    }
  }
  const dir = join(process.cwd(), '.data', 'vault')
  return {
    async get(key) {
      try { return await readFile(join(dir, key), 'utf8') }
      catch { return null }
    },
    async set(key, value) {
      const file = join(dir, key)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, value, 'utf8')
    },
  }
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  const raw = await avecReprise(s => s.get(key))
  if (!raw) return fallback
  try { return JSON.parse(raw) as T }
  catch { return fallback }
}
const writeJson = async (key: string, value: unknown) =>
  avecReprise(s => s.set(key, JSON.stringify(value)))

/**
 * Lecture et écriture brutes du coffre, pour les modules qui y rangent leurs propres
 * clés — aujourd'hui server/utils/connecteurs.ts.
 *
 * Exportées à contrecœur, et sous un nom qui le dit. L'alternative était de faire de
 * ce fichier le dépotoir de tout ce qui doit persister : le magasin de jetons de
 * marques n'a rien à voir avec les passkeys, et les mélanger ici aurait rendu les
 * deux plus difficiles à relire.
 */
export const lireCoffre = readJson
export const ecrireCoffre = writeJson

// ─── Miroir ──────────────────────────────────────────────────────────────────
export const readMirror = () => readJson<VaultMirror | null>(KEY_MIRROR, null)
export const writeMirror = (m: VaultMirror) => writeJson(KEY_MIRROR, m)

// ─── Propositions ────────────────────────────────────────────────────────────
export const readProposals = () => readJson<VaultProposal[]>(KEY_PROPOSALS, [])

/** Garde les 50 dernières : la file est une boîte de réception, pas un journal. */
const PROPOSAL_KEEP = 50

export async function addProposal(p: Omit<VaultProposal, 'id' | 'at' | 'status'>, now: string): Promise<VaultProposal> {
  const all = await readProposals()
  const created: VaultProposal = { ...p, id: randomBytes(8).toString('hex'), at: now, status: 'pending' }
  await writeJson(KEY_PROPOSALS, [...all, created].slice(-PROPOSAL_KEEP))
  return created
}

export async function resolveProposal(id: string, status: 'applied' | 'refused', now: string): Promise<boolean> {
  const all = await readProposals()
  const found = all.find(p => p.id === id)
  if (!found || found.status !== 'pending') return false
  found.status = status
  found.resolvedAt = now
  await writeJson(KEY_PROPOSALS, all)
  return true
}

// ─── Consigne des jetons Withings ────────────────────────────────────────────
//
// Le flux OAuth de Withings part de la PWA et revient dans le NAVIGATEUR. Sur iOS,
// une application posée sur l'écran d'accueil qui navigue vers une autre origine
// sort de son contexte : l'autorisation se fait dans Safari, et le retour y atterrit
// aussi. Or Safari et la PWA n'ont ni le même stockage local ni les mêmes cookies.
//
// Les jetons repartaient jusqu'ici dans l'URL de retour. Ils étaient donc écrits
// dans le stockage du navigateur qui recevait la redirection — pas dans celui de
// l'application, qui gardait son ancien jeton mort et redemandait une reconnexion
// à chaque fois. La boucle ne pouvait pas se refermer.
//
// D'où cette consigne : le retour dépose les jetons ICI, et l'application vient les
// chercher avec le nonce qu'elle avait tiré AVANT de partir — le seul élément qui
// ait traversé sans changer de contexte, puisqu'elle ne l'a jamais quitté.
//
// Trois précautions, parce qu'un jeton en transit est un jeton exposé :
//
//   • le nonce n'est pas stocké tel quel mais haché. Une fuite du coffre ne donne
//     alors pas de quoi réclamer un dépôt en cours ;
//   • le retrait est à USAGE UNIQUE — lu, effacé. Un jeton qui traîne dans une
//     boîte aux lettres finit par être ramassé par quelqu'un d'autre ;
//   • dix minutes de validité. Au-delà, on refait le tour, ça coûte deux taps.

export interface Handover { tokens: Record<string, unknown>, at: number }

const HANDOVER_TTL_MS = 10 * 60 * 1000
const hashNonce = (nonce: string) => createHmac('sha256', 'withings-handover').update(nonce).digest('hex').slice(0, 32)

export async function putHandover(nonce: string, tokens: Record<string, unknown>, nowMs: number): Promise<void> {
  const all = await readJson<Record<string, Handover>>(KEY_HANDOVER, {})
  // Ménage au passage : sans lui, chaque connexion abandonnée laisserait un jeton
  // valide dans le coffre pour toujours.
  const frais: Record<string, Handover> = {}
  for (const [k, v] of Object.entries(all)) {
    if (nowMs - v.at < HANDOVER_TTL_MS) frais[k] = v
  }
  frais[hashNonce(nonce)] = { tokens, at: nowMs }
  await writeJson(KEY_HANDOVER, frais)
}

/** Retire le dépôt et l'efface. Rend `null` s'il n'existe pas ou s'il a expiré. */
export async function takeHandover(nonce: string, nowMs: number): Promise<Record<string, unknown> | null> {
  const all = await readJson<Record<string, Handover>>(KEY_HANDOVER, {})
  const clef = hashNonce(nonce)
  const trouve = all[clef]
  delete all[clef]
  await writeJson(KEY_HANDOVER, all)
  if (!trouve || nowMs - trouve.at >= HANDOVER_TTL_MS) return null
  return trouve.tokens
}

// ─── Passkeys enregistrés ────────────────────────────────────────────────────
export interface StoredCredential {
  id: string
  publicKey: string
  counter: number
  at: string
  /** Où il a été posé — « iPhone », « Portable ». Sert à savoir lequel révoquer. */
  label?: string
  /**
   * Le prénom du propriétaire, saisi au moment de poser le passkey.
   *
   * Ici, et pas dans une variable d'environnement, parce que c'est une donnée
   * d'INSTANCE et non de déploiement : celui qui installe l'application n'a alors
   * rien à configurer sur son hébergement pour que son propre prénom s'affiche, et
   * il peut le corriger sans redéployer. La variable reste acceptée en repli, pour
   * les instances qui préfèrent tout décrire dans leur configuration.
   *
   * Facultatif : une instance posée avant ce champ continue de fonctionner.
   */
  ownerName?: string
}

/**
 * Le coffre en contient PLUSIEURS, et c'est ce qui supprime le mot de passe permanent.
 *
 * Il n'y en avait qu'un. Perdre le téléphone, c'était donc perdre l'accès — d'où un
 * code de démarrage gardé valide pour toujours dans les variables d'environnement,
 * qui servait de double. Un secret permanent qui rouvre tout, sans expiration ni
 * révocation : c'est le maillon faible de toute l'authentification, et il ne tenait
 * qu'à l'absence d'un second passkey.
 *
 * Avec une liste, « téléphone perdu » se règle par le passkey de secours posé sur
 * l'ordinateur, et le code de démarrage redevient ce qu'il aurait toujours dû être :
 * un code d'INSTALLATION, utilisable une fois.
 */
interface CredentialStore {
  credentials: StoredCredential[]
  /**
   * L'empreinte du code de démarrage déjà consommé.
   *
   * On range l'empreinte et non le code : lire le coffre ne doit rien apprendre.
   * Le réarmement tombe alors tout seul — changer `NUXT_VAULT_BOOTSTRAP` change
   * l'empreinte, donc le code redevient valide. Autrement dit, rouvrir la porte
   * exige l'accès au DÉPLOIEMENT, qui est la vraie racine de confiance d'une
   * application auto-hébergée.
   */
  bootstrapUsed?: string
  /** Échecs consécutifs sur le code de démarrage, et l'instant du premier. */
  tentatives?: { n: number, depuis: number }
}

const VIDE: CredentialStore = { credentials: [] }

/**
 * Lit le coffre, en acceptant l'ANCIENNE forme : un seul passkey à la racine.
 *
 * Une instance déjà installée a un `credential.json` qui est l'objet lui-même. La
 * migrer à la lecture plutôt qu'au déploiement évite l'écriture la plus dangereuse
 * qui soit — celle qui touche à l'authentification pendant que personne ne regarde.
 */
export async function readCredentialStore(): Promise<CredentialStore> {
  const brut = await readJson<Record<string, unknown> | null>(KEY_CREDENTIAL, null)
  if (!brut || typeof brut !== 'object') return { ...VIDE }
  if (Array.isArray((brut as CredentialStore).credentials)) {
    const s = brut as unknown as CredentialStore
    return { ...s, credentials: s.credentials.filter(c => c?.id && c?.publicKey) }
  }
  const seul = brut as unknown as StoredCredential
  return { credentials: seul.id && seul.publicKey ? [seul] : [] }
}

export const writeCredentialStore = (s: CredentialStore) => writeJson(KEY_CREDENTIAL, s)

/** Tous les passkeys valides. Un enregistrement vide n'en est pas un. */
export async function readCredentials(): Promise<StoredCredential[]> {
  return (await readCredentialStore()).credentials
}

/** Le premier passkey, ou `null`. C'est lui qui porte le nom du propriétaire. */
export async function readCredential(): Promise<StoredCredential | null> {
  const [premier] = await readCredentials()
  return premier ?? null
}

/** Ajoute un passkey sans toucher aux autres, ni au drapeau de démarrage. */
export async function addCredential(c: StoredCredential): Promise<void> {
  const s = await readCredentialStore()
  await writeCredentialStore({ ...s, credentials: [...s.credentials.filter(x => x.id !== c.id), c] })
}

/** Réécrit le compteur anti-clonage d'un passkey après une connexion réussie. */
export async function setCredentialCounter(id: string, counter: number): Promise<void> {
  const s = await readCredentialStore()
  await writeCredentialStore({
    ...s,
    credentials: s.credentials.map(c => (c.id === id ? { ...c, counter } : c)),
  })
}

/** Retire un passkey. Rend `false` si c'était le dernier — on ne se verrouille pas dehors. */
export async function removeCredential(id: string): Promise<boolean> {
  const s = await readCredentialStore()
  if (s.credentials.length <= 1) return false
  const reste = s.credentials.filter(c => c.id !== id)
  if (reste.length === s.credentials.length) return false
  await writeCredentialStore({ ...s, credentials: reste })
  return true
}

/** Efface tous les passkeys. Le drapeau de démarrage reste : le code est consommé. */
export async function clearCredentials(): Promise<void> {
  const s = await readCredentialStore()
  await writeCredentialStore({ ...s, credentials: [] })
}

// ─── Code de démarrage ───────────────────────────────────────────────────────
//
// Il ouvrait la porte à tout moment, pour toujours. Ce n'était pas un code
// d'installation, c'était une clé maîtresse : connue une fois — capture d'écran,
// message collé, épaule regardée — elle donnait accès au coffre indéfiniment, sans
// révocation autre que changer la variable, et sans rien pour ralentir un essai
// systématique si le code était court.
//
// Trois règles le ramènent à ce qu'il doit être.

/** Cinq essais, puis un quart d'heure de silence. De quoi rendre inutile la force brute. */
const ESSAIS_MAX = 5
const VERROU_MS = 15 * 60 * 1000

const empreinte = (code: string) => createHash('sha256').update(code).digest('hex')

function memeChaine(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export type VerdictBootstrap = 'ok' | 'absent' | 'faux' | 'consomme' | 'verrouille'

/**
 * Le code de démarrage attendu, ou `''` s'il n'y en a pas.
 *
 * Il vient d'abord de la configuration Nuxt, où il est FABRIQUÉ AU BUILD et imprimé
 * dans le journal de déploiement (voir `nuxt.config.ts`). Il n'y a donc plus rien à
 * poser chez l'hébergeur, et chaque build en produit un neuf — l'ancien ne vaut plus
 * rien sans qu'on ait à s'en occuper.
 *
 * `NUXT_VAULT_BOOTSTRAP` continue de fonctionner et l'emporte : Nuxt écrase de
 * lui-même la valeur de `runtimeConfig` qui porte le nom de la variable. C'est le
 * repli pour qui préfère tout décrire dans sa configuration, et c'est l'option la
 * plus faible — elle redevient un secret permanent.
 *
 * Le repli sur `process.env` sert aux tests unitaires, qui importent ce module en
 * Node pur : `useRuntimeConfig` n'y existe pas, et une référence non résolue ferait
 * échouer l'appel au lieu de retomber sur la variable.
 */
function codeAttendu(): string {
  try {
    // @ts-expect-error auto-importé par Nitro, absent hors du serveur Nuxt
    if (typeof useRuntimeConfig === 'function') {
      // @ts-expect-error idem
      const v = String(useRuntimeConfig().vaultBootstrap ?? '').trim()
      if (v) return v
    }
  }
  catch { /* hors contexte Nitro : on retombe sur l'environnement */ }
  return (process.env.NUXT_VAULT_BOOTSTRAP || '').trim()
}

/**
 * D'où vient le code : du build, ou d'une variable posée à la main ?
 *
 * L'écran d'installation en a besoin pour dire OÙ le chercher. « Code de démarrage »
 * sans plus d'indication envoyait fouiller les variables Netlify — alors qu'il est
 * désormais dans le journal du dernier déploiement, à un autre endroit de la même
 * interface.
 */
export const origineBootstrap = (): 'env' | 'build' =>
  ((process.env.NUXT_VAULT_BOOTSTRAP || '').trim() ? 'env' : 'build')

/** Le code peut-il encore servir ? Sans révéler s'il existe un code, ni lequel. */
export async function bootstrapArme(): Promise<boolean> {
  const attendu = codeAttendu()
  if (!attendu) return false
  const s = await readCredentialStore()
  return s.bootstrapUsed !== empreinte(attendu)
}

/**
 * Vérifie un code, en comptant les échecs.
 *
 * `consomme` se distingue de `faux` volontairement : « ce code a déjà servi » dit
 * quoi faire (changer la variable), là où « code invalide » envoie chercher une
 * faute de frappe qui n'existe pas.
 */
export async function verifierBootstrap(code: string, nowMs = Date.now()): Promise<VerdictBootstrap> {
  const attendu = codeAttendu()
  if (!attendu) return 'absent'
  const s = await readCredentialStore()

  const t = s.tentatives
  if (t && t.n >= ESSAIS_MAX && nowMs - t.depuis < VERROU_MS) return 'verrouille'
  const compteur = t && nowMs - t.depuis < VERROU_MS ? t : { n: 0, depuis: nowMs }

  if (!memeChaine(String(code ?? ''), attendu)) {
    await writeCredentialStore({ ...s, tentatives: { n: compteur.n + 1, depuis: compteur.depuis } })
    return 'faux'
  }
  // Le bon code, mais déjà consommé : on ne compte pas d'échec — ce n'est pas une
  // tentative d'intrusion, c'est quelqu'un qui ignore que la porte s'est refermée.
  if (s.bootstrapUsed === empreinte(attendu)) return 'consomme'
  return 'ok'
}

/** Brûle le code courant. Le réarmer, c'est changer la variable d'environnement. */
export async function brulerBootstrap(): Promise<void> {
  const attendu = codeAttendu()
  if (!attendu) return
  const s = await readCredentialStore()
  await writeCredentialStore({ ...s, bootstrapUsed: empreinte(attendu), tentatives: undefined })
}

// ─── Jetons signés ───────────────────────────────────────────────────────────
// Ni base de sessions, ni bibliothèque JWT : un seul utilisateur, un seul secret,
// et une signature HMAC suffit. Le jeton porte sa propre expiration ; le serveur
// n'a donc rien à retenir entre deux requêtes — ce qui est exactement ce qu'il
// faut sur des fonctions sans état qui peuvent démarrer à froid.

const b64u = (b: Buffer) => b.toString('base64url')

function secret(): string {
  const s = (process.env.NUXT_VAULT_SECRET || '').trim()
  if (!s || s.length < 24) throw new Error('NUXT_VAULT_SECRET manquant ou trop court (32 caractères minimum)')
  return s
}

export interface TokenPayload { sub: string, scope: string, exp: number, [k: string]: unknown }

export function signToken(payload: Omit<TokenPayload, 'exp'>, ttlSeconds: number, nowMs: number): string {
  const body = { ...payload, exp: Math.floor(nowMs / 1000) + ttlSeconds }
  const data = b64u(Buffer.from(JSON.stringify(body)))
  const sig = b64u(createHmac('sha256', secret()).update(data).digest())
  return `${data}.${sig}`
}

/**
 * Vérifie signature PUIS expiration, avec une comparaison à temps constant.
 *
 * L'ordre compte : lire le contenu avant d'avoir validé la signature, c'est faire
 * confiance à une chaîne fournie par l'appelant. Et `timingSafeEqual` plutôt que
 * `===` parce qu'une comparaison qui s'arrête au premier octet différent laisse
 * deviner la signature attendue, octet par octet.
 */
export function verifyToken(token: string | undefined | null, nowMs: number): TokenPayload | null {
  if (!token || !token.includes('.')) return null
  const [data, sig] = token.split('.')
  if (!data || !sig) return null
  let expected: Buffer
  try { expected = createHmac('sha256', secret()).update(data).digest() }
  catch { return null }
  const given = Buffer.from(sig, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString('utf8')) as TokenPayload
    if (typeof payload.exp !== 'number' || payload.exp * 1000 < nowMs) return null
    return payload
  }
  catch { return null }
}

export const SESSION_COOKIE = 'gr-session'
export const SESSION_TTL = 60 * 60 * 24 * 30 // 30 jours : c'est un téléphone personnel
export const CHALLENGE_TTL = 60 * 5
export const CODE_TTL = 60 * 2
export const ACCESS_TTL = 60 * 60 * 24 * 90 // le connecteur ne doit pas se déconnecter tous les matins
/*
 * L'identifiant d'un client inscrit. Dix ans : ce n'est pas un accès, c'est un NOM.
 * Il ne donne rien par lui-même — chaque autorisation repasse par la clé d'accès —
 * et le faire expirer obligerait à réinstaller le connecteur sans raison. Il cesse
 * de valoir quelque chose si l'on change NUXT_VAULT_SECRET, ce qui est la bonne
 * porte de sortie : tout se réinscrit, rien à purger.
 */
export const CLIENT_TTL = 60 * 60 * 24 * 365 * 10
