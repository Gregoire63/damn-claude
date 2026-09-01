import { clearSession } from './_auth'
import { brulerBootstrap, clearCredentials, readCredentials, verifierBootstrap } from '../../utils/vault'

/**
 * Tout effacer et repartir de zéro — le dernier recours.
 *
 * Ce n'est plus la porte de sortie ordinaire : celle-là, c'est le **passkey de
 * secours** posé sur un second appareil, qui se pose depuis l'application et ne
 * demande aucun secret. Cette route ne sert que si on a perdu TOUS ses passkeys.
 *
 * Et elle coûte ce qu'elle doit coûter. Le code de démarrage est brûlé après usage,
 * donc celui de l'installation ne marche plus : il faut poser une NOUVELLE valeur
 * dans `NUXT_VAULT_BOOTSTRAP` chez l'hébergeur. Autrement dit, se ré-ouvrir la porte
 * suppose de contrôler le déploiement.
 *
 * C'est la bonne racine de confiance pour une application auto-hébergée, et c'est
 * ce qui a fait disparaître la clé maîtresse permanente : le code ne restait valide
 * pour toujours que parce qu'il était le seul double.
 */
export default defineEventHandler(async (event) => {
  const { bootstrap } = await readBody<{ bootstrap?: string }>(event) ?? {}
  const verdict = await verifierBootstrap(String(bootstrap ?? ''))
  if (verdict === 'absent') throw createError({ statusCode: 503, statusMessage: 'NUXT_VAULT_BOOTSTRAP non configuré' })
  if (verdict === 'verrouille') throw createError({ statusCode: 429, statusMessage: 'Trop de tentatives. Réessaie dans quinze minutes.' })
  if (verdict === 'consomme') throw createError({ statusCode: 403, statusMessage: 'Ce code de démarrage a déjà servi. Pose une nouvelle valeur dans NUXT_VAULT_BOOTSTRAP chez ton hébergeur.' })
  if (verdict !== 'ok') throw createError({ statusCode: 403, statusMessage: 'Code de démarrage invalide' })

  if (!(await readCredentials()).length) return { ok: true, deja: true }

  await clearCredentials()
  // Le code vient de servir : il se referme derrière lui, comme à l'installation.
  await brulerBootstrap()
  clearSession(event)
  return { ok: true }
})
