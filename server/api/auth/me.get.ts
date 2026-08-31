import { ownerName, session } from './_auth'
import { bootstrapArme, readCredentials } from '../../utils/vault'

/**
 * L'état de la connexion, pour que l'écran sache quoi proposer.
 *
 * `bootstrapReady` disait seulement qu'une variable existait. Ça ne suffit plus :
 * le code de démarrage se brûle à l'usage, et un écran qui propose de le saisir
 * alors qu'il est consommé envoie chercher une faute de frappe qui n'existe pas.
 * On répond donc s'il est encore ARMÉ — sans jamais dire lequel, ni s'il en existe
 * un quand il ne peut plus servir.
 */
export default defineEventHandler(async (event) => {
  const creds = await readCredentials()
  return {
    connected: !!session(event),
    registered: creds.length > 0,
    /** Combien de passkeys : un seul veut dire « pas encore de secours ». */
    passkeys: creds.length,
    appareils: creds.map(c => ({ id: c.id, label: c.label ?? '', at: c.at })),
    bootstrapReady: await bootstrapArme(),
    ownerName: await ownerName(),
  }
})
