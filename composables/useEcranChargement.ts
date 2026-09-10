// ─────────────────────────────────────────────────────────────────────────────
// L'écran de chargement, tenu assez longtemps pour être vu.
// ─────────────────────────────────────────────────────────────────────────────
//
// Nuxt place le gabarit `spa-loading-template.html` DANS la racine de
// l'application, et le montage de Vue remplace cette racine. L'écran disparaît donc
// à l'octet près où l'application est prête — sur un rechargement à chaud, ça fait
// une soixantaine de millisecondes : un flash, pas un écran. On voit qu'il s'est
// passé quelque chose sans avoir eu le temps de lire quoi, ce qui est le pire des
// deux mondes.
//
// D'où deux gestes, et le premier est le seul qui compte : le gabarit se SORT de la
// racine Nuxt à l'analyse du HTML (voir le script en bas de
// `spa-loading-template.html`). Il n'est donc plus remplacé par personne, et c'est
// nous qui décidons quand il s'en va.
//
// Le prix est réel et assumé : sur une application déjà chaude, on ajoute l'attente
// qui manque pour atteindre le minimum. C'est un choix d'image, pas une optimisation
// — et il ne coûte JAMAIS rien quand le chargement dépasse déjà ce minimum, ce qui
// est le cas du premier lancement, du réseau lent, et du téléphone qui rame.

/** Ce qu'on tient à l'écran, au minimum. */
export const MIN_AFFICHAGE_MS = 2000

/** Le fondu de sortie. Doit rester égal à la transition CSS du gabarit. */
export const FONDU_MS = 320

/**
 * Combien de temps il reste à tenir.
 *
 * Séparé du DOM parce que c'est la seule chose qui peut être fausse — et qu'elle
 * peut l'être dans les deux sens : ne pas attendre du tout (le flash qu'on répare),
 * ou attendre par-dessus un chargement déjà long (une application qui traîne pour
 * rien).
 */
export function attenteRestante(debutMs: number | null | undefined, maintenantMs: number, minimum = MIN_AFFICHAGE_MS): number {
  // Pas d'horodatage : le script du gabarit n'a pas tourné (rendu serveur, gabarit
  // absent). On ne fabrique pas une attente sur une base inconnue.
  if (!debutMs) return 0
  const ecoule = maintenantMs - debutMs
  // Borné des DEUX côtés. Vers le bas c'est le flash qu'on répare ; vers le haut,
  // c'est une horloge système qui recule (changement d'heure, remise à l'heure par
  // le réseau) : `minimum - ecoule` devient alors plus grand que le minimum, et
  // l'écran resterait planté dix secondes sans que rien ne l'explique.
  return Math.min(minimum, Math.max(0, minimum - ecoule))
}

/** L'horodatage posé par le gabarit à l'analyse du HTML. */
function debutAffichage(): number | null {
  const w = window as unknown as { __slDebut?: number }
  return typeof w.__slDebut === 'number' ? w.__slDebut : null
}

/**
 * Retire l'écran de chargement, une fois son temps fait.
 *
 * Appelé au montage de la coque. Sans élément — parce que Nuxt l'a quand même
 * remplacé, ou parce qu'on est sur une page servie sans gabarit — il n'y a rien à
 * faire, et surtout rien à créer.
 */
export function retirerEcranChargement() {
  if (!import.meta.client) return
  const el = document.getElementById('sport-loading')
  if (!el) return
  setTimeout(() => {
    el.classList.add('sl-out')
    // On retire pour de bon : un calque en `opacity: 0` reste dans l'arbre, et une
    // fenêtre modale qui s'ouvrirait dessous hériterait de son empilement.
    setTimeout(() => el.remove(), FONDU_MS)
  }, attenteRestante(debutAffichage(), Date.now()))
}
