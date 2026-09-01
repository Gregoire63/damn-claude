import type { H3Event } from 'h3'
import { adaptateurPour } from '../../../connecteurs'
import type { Adaptateur, Identifiants } from '../../../connecteurs'
import { identifiantsDe } from '../../../utils/connecteurs'
import { providerById } from '../../../../lib/providers'

/**
 * Ce que les cinq routes ont en commun : trouver la marque, et refuser proprement
 * quand elle n'est pas branchable.
 *
 * Les deux erreurs sont distinctes exprès. 404 = « cette application ne connaît pas
 * cette marque » (une URL fabriquée à la main, ou un adaptateur oublié dans le
 * registre). 501 = « elle la connaît, mais cette instance-ci n'a pas ses
 * identifiants ». Les confondre enverrait chercher un bogue dans le code alors qu'il
 * manque deux champs dans un formulaire.
 */
export function marqueDe(event: H3Event): Adaptateur {
  const id = getRouterParam(event, 'marque') ?? ''
  const a = adaptateurPour(id)
  if (!a) throw createError({ statusCode: 404, statusMessage: `Marque inconnue : ${id.slice(0, 24)}` })
  return a
}

export async function identifiantsOuRefus(a: Adaptateur): Promise<Identifiants> {
  const ids = await identifiantsDe(a.id)
  if (!ids) {
    const label = providerById(a.id)?.label ?? a.id
    throw createError({
      statusCode: 501,
      statusMessage: `${label} n'est pas configuré. Renseigne son identifiant et son secret dans Profil → Connecteurs.`,
    })
  }
  return ids
}

/** L'URL de retour, fabriquée à UN SEUL endroit. Elle doit être recopiée telle quelle
 *  dans la console de la marque — un caractère d'écart et l'échange échoue, avec un
 *  message qui ne dit jamais lequel des deux est faux. */
export const urlRetour = (origine: string, marque: string) => `${origine}/api/connect/${marque}/callback`
