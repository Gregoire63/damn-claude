import { requireSession } from '../auth/_auth'
import { ADAPTATEURS } from '../../connecteurs'
import { etatDe, nomsEnv } from '../../utils/connecteurs'
import { providerById } from '../../../lib/providers'

/**
 * L'état de configuration de chaque marque — derrière le passkey.
 *
 * Pourquoi une session alors que /api/sources est publique : celle-ci rend le
 * `clientId` et la DATE de pose, c'est-à-dire de quoi savoir ce qui a été branché et
 * quand. Ce n'est pas un secret, mais ce n'est plus « ce que l'instance sait faire » :
 * c'est la configuration de quelqu'un.
 *
 * Le secret, lui, ne repart JAMAIS, session ou pas. Le champ du formulaire affiche
 * « ●●●● posé le … » et se remplit à nouveau pour remplacer. Un secret qu'on peut
 * relire est un secret qui finit dans un journal, une capture d'écran ou un cache.
 */
export default defineEventHandler(async (event) => {
  requireSession(event)
  const marques = []
  for (const a of ADAPTATEURS) {
    const fiche = providerById(a.id)
    const etat = await etatDe(a.id)
    marques.push({
      id: a.id,
      label: fiche?.label ?? a.id,
      icone: fiche?.icone ?? '🔌',
      console: fiche?.console ?? '',
      note: fiche?.note ?? '',
      ...etat,
      /** Les noms attendus si l'on préfère passer par l'hébergeur. */
      env: nomsEnv(a.id),
    })
  }
  return { marques }
})
