import { availableProviders, unavailableProviders } from '~/lib/providers'

/**
 * Quelles sources de données cette instance sait proposer.
 *
 * Le navigateur ne peut pas le savoir seul : les identifiants de chaque marque sont
 * des variables d'environnement côté serveur, et ils doivent le rester. On ne renvoie
 * donc que des NOMS de variables et un état — jamais une valeur.
 *
 * Route publique, comme le reste de /sport : elle ne dit rien de personnel, seulement
 * ce que l'hébergeur a configuré. C'est d'ailleurs ce qui permet à l'écran de profil
 * d'afficher « à configurer sur l'hébergement : … » plutôt qu'un bouton mort.
 */
export default defineEventHandler(() => {
  const c = useRuntimeConfig()
  const poses: string[] = []
  if (c.withings?.clientId && c.withings?.clientSecret) {
    poses.push('NUXT_WITHINGS_CLIENT_ID', 'NUXT_WITHINGS_CLIENT_SECRET')
  }
  if (c.fitbit?.clientId && c.fitbit?.clientSecret) {
    poses.push('NUXT_FITBIT_CLIENT_ID', 'NUXT_FITBIT_CLIENT_SECRET')
  }
  return {
    disponibles: availableProviders(poses).map(p => ({
      id: p.id, label: p.label, icone: p.icone, capabilities: p.capabilities, note: p.note ?? '',
    })),
    // Les indisponibles portent aussi ce qu'ils SAURAIENT fournir : la liste des
    // réglages les affiche au même format que les autres, et « Garmin — poids ·
    // masse grasse · pas, indisponible » dit en une ligne ce qu'on rate, là où le
    // nom seul laissait croire à une marque exotique.
    indisponibles: unavailableProviders(poses).map(d => ({
      id: d.provider.id, label: d.provider.label, icone: d.provider.icone,
      capabilities: d.provider.capabilities, note: d.provider.note ?? '', raison: d.raison,
    })),
  }
})
