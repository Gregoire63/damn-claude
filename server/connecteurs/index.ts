import withings from './withings'
import fitbit from './fitbit'
import oura from './oura'
import type { Adaptateur } from './types'

/**
 * Le registre. C'est la SEULE ligne à ajouter pour brancher une marque de plus —
 * avec sa fiche dans lib/providers.ts, qui décide de ce que l'écran en dit.
 *
 * Volontairement explicite plutôt qu'un balayage du dossier : un import statique se
 * relit, se cherche, et surtout se compile. Un chargement dynamique aurait fait
 * disparaître une marque mal nommée sans un mot, à l'exécution, chez quelqu'un
 * d'autre.
 */
export const ADAPTATEURS: Adaptateur[] = [withings, fitbit, oura]

export const adaptateurPour = (id: string): Adaptateur | null =>
  ADAPTATEURS.find(a => a.id === id) ?? null

export type { Adaptateur, Identifiants, Jetons, Releve } from './types'
export { ErreurConnecteur } from './types'
