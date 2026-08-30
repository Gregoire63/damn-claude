import { clearSession } from './_auth'
import { readCredential, writeCredential } from '../../utils/vault'

/**
 * Reposer un passkey — la seule porte de sortie en cas de téléphone perdu.
 *
 * Sans elle, perdre son téléphone signifiait perdre définitivement l'accès au
 * coffre : il n'y a qu'un passkey, l'enregistrement se referme derrière lui, et
 * aucun écran ne sait le supprimer. Un verrou sans double des clés.
 *
 * Le code de démarrage sert de double : il vit dans les variables d'environnement,
 * donc seul le propriétaire du site peut le lire ou le changer. C'est le même
 * secret qui a permis de poser le premier passkey, et il ouvre la même porte —
 * pas une de plus.
 */
export default defineEventHandler(async (event) => {
  const { bootstrap } = await readBody<{ bootstrap?: string }>(event) ?? {}
  const expected = (process.env.NUXT_VAULT_BOOTSTRAP || '').trim()
  if (!expected) throw createError({ statusCode: 503, statusMessage: 'NUXT_VAULT_BOOTSTRAP non configuré' })
  if (!bootstrap || bootstrap !== expected) throw createError({ statusCode: 403, statusMessage: 'Code de démarrage invalide' })
  if (!(await readCredential())) return { ok: true, deja: true }

  // On écrit un enregistrement VIDE plutôt que de supprimer la clé : le pilote de
  // stockage n'a pas d'opération de suppression, et un identifiant vide échoue de
  // toute façon à toute vérification de signature.
  await writeCredential({ id: '', publicKey: '', counter: 0, at: new Date().toISOString() })
  clearSession(event)
  return { ok: true }
})
