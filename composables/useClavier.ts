/**
 * Remonter le champ que le clavier vient de cacher.
 *
 * Le clavier virtuel ne fait pas défiler la page : il se pose PAR-DESSUS. Un champ
 * situé dans la moitié basse de l'écran — la recherche de plats, le poids d'une
 * série, le prénom d'un convive — se retrouve donc derrière lui, et on tape à
 * l'aveugle. Le navigateur remonte parfois le champ tout seul, parfois non ; ça
 * dépend de la version, du conteneur de défilement et de la vitesse du focus.
 *
 * ── Pourquoi mesurer plutôt que déclarer ────────────────────────────────────
 *
 * `interactive-widget=resizes-content` dans le `viewport` règle le problème d'un
 * mot… sur Android uniquement. iOS ne l'implémente pas, et il casserait au passage
 * la détection de clavier qui pilote le chrono flottant (elle compare `innerHeight`
 * à la hauteur du viewport visible ; en `resizes-content` les deux rétrécissent
 * ensemble, l'écart tombe à zéro et le clavier devient invisible pour le code).
 *
 * On mesure donc le viewport VISIBLE, qui existe sur les deux plateformes et dit la
 * vérité : si le bas du champ passe sous cette limite, on le remonte. Rien n'est
 * supposé du clavier — ni sa hauteur, ni son existence.
 *
 * ── Le délai ────────────────────────────────────────────────────────────────
 *
 * On n'agit pas au focus mais au REDIMENSIONNEMENT du viewport visible, c'est-à-dire
 * quand le clavier est réellement monté. Mesurer au focus donnerait la géométrie
 * d'avant, où rien n'est caché — et on ne ferait rien. Un repli à 350 ms couvre les
 * navigateurs qui n'émettent pas l'événement.
 */

/** Marge sous le champ : de quoi voir la ligne suivante, pas seulement le curseur. */
const MARGE = 24

/** Le champ est-il passé sous la limite visible ? Séparé pour être testable. */
export function doitRemonter(basDuChamp: number, basVisible: number, marge = MARGE): boolean {
  return basDuChamp > basVisible - marge
}

const SAISIE = 'input, textarea, [contenteditable="true"]'

/** Les champs qu'on ne remonte pas : ils n'ouvrent aucun clavier. */
const SANS_CLAVIER = new Set(['checkbox', 'radio', 'range', 'file', 'color', 'submit', 'button', 'reset'])

let installe = false

function estSaisie(el: Element | null): el is HTMLElement {
  if (!el || !(el as HTMLElement).matches?.(SAISIE)) return false
  const t = (el as HTMLInputElement).type
  return !(t && SANS_CLAVIER.has(t))
}

export function useClavier() {
  if (installe || !import.meta.client) return
  installe = true

  let champ: HTMLElement | null = null
  let minuteur: ReturnType<typeof setTimeout> | null = null

  function remonter() {
    if (!champ || document.activeElement !== champ) return
    const vv = window.visualViewport
    // Sans `visualViewport` (navigateurs de bureau anciens), il n'y a pas de clavier
    // à contourner : on ne touche à rien plutôt que de faire défiler au hasard.
    if (!vv) return
    const basVisible = vv.offsetTop + vv.height
    if (!doitRemonter(champ.getBoundingClientRect().bottom, basVisible)) return
    champ.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  function planifier() {
    if (minuteur) clearTimeout(minuteur)
    minuteur = setTimeout(remonter, 60)
  }

  document.addEventListener('focusin', (e) => {
    const cible = e.target as Element | null
    if (!estSaisie(cible)) { champ = null; return }
    champ = cible
    // Repli : certains navigateurs n'émettent pas `resize` sur le viewport visible.
    if (minuteur) clearTimeout(minuteur)
    minuteur = setTimeout(remonter, 350)
  })

  document.addEventListener('focusout', () => {
    champ = null
    if (minuteur) { clearTimeout(minuteur); minuteur = null }
  })

  // Le clavier monte (ou descend, ou l'écran tourne) : c'est LE moment où la mesure
  // devient vraie.
  window.visualViewport?.addEventListener('resize', planifier)
}
