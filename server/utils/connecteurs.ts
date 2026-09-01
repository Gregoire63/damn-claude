import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { ecrireCoffre, lireCoffre } from './vault'
import type { Identifiants } from '../connecteurs/types'

// ─────────────────────────────────────────────────────────────────────────────
// D'où viennent les identifiants d'une marque.
// ─────────────────────────────────────────────────────────────────────────────
//
// Deux chemins, et l'ordre entre les deux est une décision, pas un détail.
//
// 1. Les VARIABLES D'ENVIRONNEMENT de l'hébergeur. Le secret n'atteint alors jamais
//    ni le navigateur ni le coffre. C'est le plus sûr, et ça reste prioritaire.
// 2. Le COFFRE, saisi depuis l'application derrière le passkey. Le secret transite
//    une fois par le navigateur, en HTTPS, puis vit chiffré dans le stockage.
//
// Le second existe parce que le premier rendait ce dépôt inutilisable par quelqu'un
// d'autre : brancher une balance imposait d'aller dans l'interface d'un hébergeur,
// poser deux variables et REDÉPLOYER. Autant dire que personne ne le faisait. Un
// projet qu'on partage doit pouvoir se configurer depuis lui-même.
//
// L'environnement passe devant pour une raison précise : sur une instance qui a déjà
// ses variables — la mienne — une saisie malheureuse dans l'écran ne doit pas pouvoir
// casser une connexion qui marche. Et parce qu'un secret rangé dans l'hébergeur est
// strictement mieux protégé que le même secret rangé dans les données de l'appli.
//
// Ce qui n'est PAS résolu, et ne peut pas l'être ici : l'URL de retour doit toujours
// être déclarée dans la console de la marque. Aucune API ne permet de le faire à sa
// place — l'écran de configuration se contente donc d'afficher l'URL exacte à
// recopier, ce qui est déjà la moitié des échecs évités.

const CLE = 'connecteurs'

/** Une fiche telle qu'elle dort dans le coffre. `secret` est CHIFFRÉ. */
interface Fiche {
  clientId: string
  secret: string
  /** Quand elle a été posée, pour que l'écran puisse le dire. */
  at: string
}
type Magasin = Record<string, Fiche>

export type Origine = 'env' | 'coffre'

/**
 * La clé de chiffrement, dérivée de NUXT_VAULT_SECRET.
 *
 * Pas de secret supplémentaire à poser : il en existe déjà un, obligatoire, et en
 * ajouter un second aurait surtout produit des installations où l'un des deux manque.
 * `scrypt` plutôt que le secret brut : il transforme une phrase choisie par un humain
 * en 32 octets, ce qu'attend AES — et le fait lentement, ce qui n'a aucune importance
 * ici (une fois par requête) et beaucoup pour qui tenterait de remonter au secret.
 *
 * Conséquence à connaître : CHANGER NUXT_VAULT_SECRET rend les fiches illisibles.
 * C'est voulu — un secret changé doit invalider ce qu'il protégeait — et c'est dit à
 * l'écran plutôt que laissé à deviner (voir `dechiffrer`).
 */
function cle(): Buffer {
  const s = (process.env.NUXT_VAULT_SECRET || '').trim()
  if (!s || s.length < 24) throw new Error('NUXT_VAULT_SECRET manquant ou trop court (32 caractères minimum)')
  return scryptSync(s, 'gr-connecteurs-v1', 32)
}

/** AES-256-GCM : le GCM n'est pas décoratif, c'est lui qui rend le message INFALSIFIABLE.
 *  Sans l'étiquette d'authentification, un secret modifié dans le stockage se
 *  déchiffrerait en n'importe quoi, et on chercherait l'erreur chez la marque. */
function chiffrer(clair: string): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', cle(), iv)
  const data = Buffer.concat([c.update(clair, 'utf8'), c.final()])
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.')
}

function dechiffrer(paquet: string): string {
  const [v, iv, tag, data] = paquet.split('.')
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('fiche illisible')
  const d = createDecipheriv('aes-256-gcm', cle(), Buffer.from(iv, 'base64url'))
  d.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8')
}

const lireMagasin = () => lireCoffre<Magasin>(CLE, {})

/**
 * Les variables d'environnement d'une marque, par convention de nommage.
 *
 * `NUXT_WITHINGS_CLIENT_ID`, `NUXT_FITBIT_CLIENT_SECRET`… La convention remplace une
 * déclaration par marque dans `nuxt.config.ts` : ajouter un connecteur ne doit pas
 * obliger à toucher la configuration de l'application, sans quoi la promesse « un
 * fichier suffit » est fausse.
 */
export const nomsEnv = (id: string) => {
  const M = id.toUpperCase().replace(/[^A-Z0-9]/g, '_')
  return { id: `NUXT_${M}_CLIENT_ID`, secret: `NUXT_${M}_CLIENT_SECRET` }
}

function depuisEnv(id: string): Identifiants | null {
  const n = nomsEnv(id)
  const clientId = (process.env[n.id] || '').trim()
  const clientSecret = (process.env[n.secret] || '').trim()
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

/**
 * Les identifiants utilisables pour cette marque, d'où qu'ils viennent — ou `null`.
 *
 * `null` veut dire « rien à proposer » et doit se traduire à l'écran par l'ABSENCE
 * de bouton, pas par un bouton qui mènera à une 501. Un bouton mort se lit comme une
 * panne : on réessaie, on cherche sa connexion, on perd dix minutes.
 */
export async function identifiantsDe(id: string): Promise<Identifiants | null> {
  const env = depuisEnv(id)
  if (env) return env
  const fiche = (await lireMagasin())[id]
  if (!fiche) return null
  try { return { clientId: fiche.clientId, clientSecret: dechiffrer(fiche.secret) } }
  catch { return null }
}

/** D'où ils viennent, pour que l'écran sache quoi permettre. */
export async function origineDe(id: string): Promise<Origine | null> {
  if (depuisEnv(id)) return 'env'
  return (await lireMagasin())[id] ? 'coffre' : null
}

/** Toutes les marques configurées, avec leur origine. Une seule lecture du coffre. */
export async function origines(): Promise<Record<string, Origine>> {
  const magasin = await lireMagasin()
  const out: Record<string, Origine> = {}
  for (const id of Object.keys(magasin)) out[id] = 'coffre'
  return out
}

/**
 * L'état complet, pour l'écran de configuration.
 *
 * Le `clientId` repart, le secret JAMAIS. L'identifiant n'est pas un secret — il
 * voyage en clair dans l'URL d'autorisation, il est visible de toute personne qui
 * regarde la barre d'adresse pendant la connexion. Le montrer permet de vérifier
 * qu'on a collé le bon ; cacher les deux ne protégerait rien et ferait ressaisir les
 * deux à chaque correction.
 */
export async function etatDe(id: string): Promise<{ origine: Origine | null, clientId: string, at: string, lisible: boolean }> {
  const env = depuisEnv(id)
  if (env) return { origine: 'env', clientId: env.clientId, at: '', lisible: true }
  const fiche = (await lireMagasin())[id]
  if (!fiche) return { origine: null, clientId: '', at: '', lisible: true }
  let lisible = true
  try { dechiffrer(fiche.secret) }
  catch { lisible = false }
  return { origine: 'coffre', clientId: fiche.clientId, at: fiche.at, lisible }
}

export async function poserIdentifiants(id: string, clientId: string, clientSecret: string, now = new Date()): Promise<void> {
  const magasin = await lireMagasin()
  magasin[id] = { clientId: clientId.trim(), secret: chiffrer(clientSecret.trim()), at: now.toISOString() }
  await ecrireCoffre(CLE, magasin)
}

export async function retirerIdentifiants(id: string): Promise<boolean> {
  const magasin = await lireMagasin()
  if (!magasin[id]) return false
  delete magasin[id]
  await ecrireCoffre(CLE, magasin)
  return true
}

/** Exporté pour les tests : le chiffrement doit pouvoir être vérifié sans coffre. */
export const _chiffrement = { chiffrer, dechiffrer }
