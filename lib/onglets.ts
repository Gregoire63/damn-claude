// ─────────────────────────────────────────────────────────────────────────────
// Les cinq onglets, décrits UNE fois.
// ─────────────────────────────────────────────────────────────────────────────
//
// Ce fichier est lu par deux mondes qui ne se parlent pas : la coque, qui en tire sa
// barre d'onglets et son titre, et `nuxt.config.ts`, qui en tire les règles de route.
// Les deux doivent dire la même chose — sans quoi un onglet ajouté ici serait rendu
// côté serveur, où `localStorage` n'existe pas, et l'écran resterait blanc.
//
// D'où la contrainte : AUCUN import ici. Ni `~/`, ni Vue, ni Nuxt. `nuxt.config` est
// évalué avant que les alias du projet existent ; un seul import cassera le build,
// et le message d'erreur ne parlera pas d'onglets.

/** Les identifiants internes hérités, encore émis par certains composants. */
export type View = 'home' | 'history' | 'rapport' | 'nutrition' | 'profil'

export interface Onglet {
  /** Le chemin servi. Toujours absolu. */
  chemin: string
  /** L'identifiant interne, pour les composants qui émettent encore une vue. */
  vue: View
  /** Le nom du tracé dans components/Glyphe.vue. */
  glyphe: string
  /** Sous l'icône, dans la barre. */
  label: string
  /** Dans l'en-tête, en gros. Ce n'est pas le même mot que `label` : la barre dit
   *  où l'on va, l'en-tête dit où l'on est. */
  titre: string
}

/**
 * L'ordre est celui de la barre. Le Journal juste après l'accueil : c'est le
 * deuxième écran ouvert dans la journée, il n'a rien à faire au milieu des vues
 * d'analyse.
 *
 * Les chemins portent les mots visibles, pas les identifiants internes — une URL se
 * lit et se dicte. `rapport` s'appelle donc `/progres` dehors, et `history`
 * `/journal`. Sans accent : un accent dans une URL survit mal au copier-coller.
 */
export const ONGLETS: Onglet[] = [
  { chemin: '/', vue: 'home', glyphe: 'maison', label: 'Accueil', titre: 'Mes séances' },
  { chemin: '/journal', vue: 'history', glyphe: 'calendrier', label: 'Journal', titre: 'Historique' },
  { chemin: '/nutrition', vue: 'nutrition', glyphe: 'couverts', label: 'Nutrition', titre: 'Nutrition' },
  { chemin: '/progres', vue: 'rapport', glyphe: 'courbe', label: 'Progrès', titre: 'Ma progression' },
  { chemin: '/profil', vue: 'profil', glyphe: 'personne', label: 'Profil', titre: 'Profil' },
]

/** Les chemins servis, pour les règles de route de nuxt.config. */
export const CHEMINS: string[] = ONGLETS.map(o => o.chemin)

/** Le titre d'en-tête d'un chemin. Vide si le chemin n'est pas un onglet. */
export function titreDe(chemin: string): string {
  return ONGLETS.find(o => o.chemin === chemin)?.titre ?? ''
}

/**
 * Identifiant interne → chemin.
 *
 * Sert aux composants qui émettent encore une vue plutôt qu'une URL — `Body.vue`
 * demande « emmène-moi au profil » sans avoir à savoir que le profil vit sur
 * `/profil`. C'est volontaire : un composant d'affichage n'a pas à connaître le plan
 * du site.
 */
export function cheminDeVue(vue: string): string {
  return ONGLETS.find(o => o.vue === vue)?.chemin ?? '/'
}
