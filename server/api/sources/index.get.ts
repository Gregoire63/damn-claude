import { availableProviders, unavailableProviders } from '~/lib/providers'
import { ADAPTATEURS } from '../../connecteurs'
import { identifiantsDe } from '../../utils/connecteurs'

/**
 * Quelles sources de données cette instance sait proposer.
 *
 * Le navigateur ne peut pas le savoir seul : les identifiants de chaque marque vivent
 * côté serveur — variables d'hébergement ou coffre — et ils doivent y rester. On ne
 * renvoie donc que des identifiants de MARQUE et un état, jamais une valeur.
 *
 * Route publique, comme le reste des écrans de suivi : elle ne dit rien de personnel,
 * seulement ce qui est branchable. C'est d'ailleurs ce qui permet à l'écran d'afficher
 * « pas encore configuré » plutôt qu'un bouton mort — un bouton qui mène à une 501 se
 * lit comme une panne, on réessaie, on cherche dix minutes.
 */
export default defineEventHandler(async () => {
  const configures: string[] = []
  for (const a of ADAPTATEURS) {
    if (await identifiantsDe(a.id)) configures.push(a.id)
  }
  return {
    disponibles: availableProviders(configures).map(p => ({
      id: p.id, label: p.label, icone: p.icone, capabilities: p.capabilities, note: p.note ?? '',
    })),
    // Les indisponibles portent aussi ce qu'ils SAURAIENT fournir : la liste des
    // réglages les affiche au même format que les autres, et « Garmin — poids ·
    // masse grasse · pas, indisponible » dit en une ligne ce qu'on rate, là où le
    // nom seul laissait croire à une marque exotique.
    indisponibles: unavailableProviders(configures).map(d => ({
      id: d.provider.id,
      label: d.provider.label,
      icone: d.provider.icone,
      capabilities: d.provider.capabilities,
      note: d.provider.note ?? '',
      raison: d.raison,
      /** Vrai quand un formulaire peut y remédier ; faux quand c'est la marque qui bloque. */
      configurable: !d.provider.bloque,
    })),
  }
})
