import { defineEventHandler, readBody } from 'h3'
import { takeHandover } from '../../utils/vault'

/**
 * Étape 3 : l'application vient chercher ses jetons.
 *
 * Identique au dépôt Withings, et volontairement : c'est le même problème. Le
 * nonce fait office de mot de passe à usage unique, tiré par l'application avant de
 * partir, jamais affiché, jamais transmis en clair à Fitbit — il voyage signé dans
 * le `state`. Le dépôt est retiré à la première lecture.
 *
 * La boîte aux lettres est partagée entre les marques : elle est indexée par le
 * hachage du nonce, pas par le fournisseur. Deux connexions simultanées de deux
 * marques différentes ont donc deux cases distinctes, sans rien à coordonner.
 */
export default defineEventHandler(async (event) => {
  const { nonce } = await readBody<{ nonce?: string }>(event).catch(() => ({ nonce: '' }))
  if (typeof nonce !== 'string' || nonce.length < 16) {
    throw createError({ statusCode: 400, statusMessage: 'Nonce absent' })
  }
  const tokens = await takeHandover(nonce, Date.now())
  // 404 plutôt qu'un corps vide : l'application distingue « pas encore autorisé,
  // je repasserai » d'une réponse qu'elle devrait savoir lire.
  if (!tokens) throw createError({ statusCode: 404, statusMessage: 'Aucun jeton en attente' })
  return { tokens }
})
