import { requireSession } from '../auth/_auth'
import { readMirror, readProposals } from '../../utils/vault'

/** Ce que l'application demande à l'ouverture : y a-t-il quelque chose à valider,
 *  et le miroir est-il à jour ? */
export default defineEventHandler(async (event) => {
  requireSession(event)
  const mirror = await readMirror()
  const proposals = await readProposals()
  return {
    mirrorAt: mirror?.at ?? null,
    pending: proposals.filter(p => p.status === 'pending'),
    recent: proposals.filter(p => p.status !== 'pending').slice(-10).reverse(),
  }
})
