import { requireSession } from '../auth/_auth'
import { retirerIdentifiants } from '../../utils/connecteurs'

/**
 * Retire les identifiants d'une marque du coffre.
 *
 * Ne touche à RIEN d'autre : ni aux jetons posés sur le téléphone, ni aux pesées déjà
 * récupérées. Elles sont à la personne, pas à la marque — c'est la même règle que
 * « déconnecter », un cran plus haut.
 */
export default defineEventHandler(async (event) => {
  requireSession(event)
  const marque = String((getQuery(event).marque ?? '')).trim()
  const retire = await retirerIdentifiants(marque)
  if (!retire) throw createError({ statusCode: 404, statusMessage: 'Aucun identifiant enregistré pour cette marque.' })
  return { ok: true, marque }
})
