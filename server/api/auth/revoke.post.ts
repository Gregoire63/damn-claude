import { requireSession } from './_auth'
import { readCredentials, removeCredential } from '../../utils/vault'

/**
 * Retirer un passkey — l'ordinateur revendu, le téléphone perdu.
 *
 * Le pendant indispensable du passkey de secours : pouvoir en poser plusieurs sans
 * pouvoir en retirer un, c'est accumuler des clés dont on ne sait plus où elles
 * sont. Un accès qu'on ne peut pas révoquer n'est pas un accès, c'est une fuite
 * lente.
 *
 * Le dernier ne se retire pas. Se verrouiller dehors d'un tap est un geste qu'aucune
 * confirmation ne rattrape, et la remise à zéro existe pour ce cas-là — au prix
 * d'un passage chez l'hébergeur, ce qui est exactement le prix qu'il doit coûter.
 */
export default defineEventHandler(async (event) => {
  requireSession(event)
  const { id } = await readBody<{ id?: string }>(event) ?? {}
  if (!id) throw createError({ statusCode: 400, statusMessage: 'Clé d\'accès non précisée' })

  if (!(await removeCredential(String(id)))) {
    throw createError({ statusCode: 409, statusMessage: 'Impossible : dernière clé d\'accès, ou clé inexistante' })
  }
  return { ok: true, passkeys: (await readCredentials()).length }
})
