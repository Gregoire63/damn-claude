import { requireSession } from '../auth/_auth'
import { resolveProposal } from '../../utils/vault'

/**
 * Appliquée ou refusée — décidé par l'utilisateur, dans l'application.
 *
 * Le serveur ne fait qu'enregistrer la décision : c'est le téléphone qui écrit
 * réellement dans ses données, puis qui repousse son miroir. Le coffre ne modifie
 * jamais les données de lui-même.
 */
export default defineEventHandler(async (event) => {
  requireSession(event)
  const { id, status } = await readBody<{ id?: string, status?: 'applied' | 'refused' }>(event) ?? {}
  if (!id || (status !== 'applied' && status !== 'refused')) {
    throw createError({ statusCode: 400, statusMessage: 'Décision invalide' })
  }
  const ok = await resolveProposal(id, status, new Date().toISOString())
  if (!ok) throw createError({ statusCode: 404, statusMessage: 'Proposition introuvable ou déjà traitée' })
  return { ok: true }
})
