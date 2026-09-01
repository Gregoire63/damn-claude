import { requireSession } from '../auth/_auth'
import { adaptateurPour } from '../../connecteurs'
import { origineDe, poserIdentifiants } from '../../utils/connecteurs'

/**
 * Pose les identifiants d'une marque, depuis l'application.
 *
 * Le secret traverse le navigateur UNE fois, en HTTPS, et n'en ressort jamais. C'est
 * le prix assumé de ne plus dépendre de l'interface d'un hébergeur : sans cet écran,
 * brancher une balance imposait de poser deux variables ailleurs et de redéployer —
 * autant dire que personne d'autre que moi ne le faisait.
 *
 * Refus net si la marque est déjà configurée par l'hébergeur : sur une instance qui
 * marche, une saisie malheureuse ici ne doit pas pouvoir casser une connexion. Et
 * accepter en silence une valeur qui ne servira jamais — puisque l'environnement
 * gagne — serait la pire des réponses : on chercherait ensuite pourquoi « le nouveau
 * secret ne prend pas ».
 */
export default defineEventHandler(async (event) => {
  requireSession(event)
  const body = await readBody<{ marque?: string, clientId?: string, clientSecret?: string }>(event)
  const marque = String(body?.marque ?? '').trim()
  const clientId = String(body?.clientId ?? '').trim()
  const clientSecret = String(body?.clientSecret ?? '').trim()

  if (!adaptateurPour(marque)) {
    throw createError({ statusCode: 404, statusMessage: `Marque inconnue : ${marque.slice(0, 24)}` })
  }
  if (!clientId || !clientSecret) {
    throw createError({ statusCode: 400, statusMessage: 'Il faut l\'identifiant ET le secret : la marque refuse l\'un sans l\'autre.' })
  }
  if (await origineDe(marque) === 'env') {
    throw createError({
      statusCode: 409,
      statusMessage: 'Cette marque est déjà configurée par les variables de l\'hébergeur, qui restent prioritaires. Retire-les d\'abord si tu veux la gérer depuis ici.',
    })
  }

  await poserIdentifiants(marque, clientId, clientSecret)
  return { ok: true, marque }
})
