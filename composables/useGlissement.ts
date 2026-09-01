import { computed, ref } from 'vue'
import { ONGLETS } from '~/lib/onglets'
import { calqueOuvert } from '~/composables/useOverlay'

// ─────────────────────────────────────────────────────────────────────────────
// Changer d'onglet au doigt.
// ─────────────────────────────────────────────────────────────────────────────
//
// La barre du bas suffit à naviguer, mais elle demande de viser : sur un téléphone
// tenu d'une main, atteindre « Nutrition » depuis « Accueil » veut dire déplacer le
// pouce sur cinq cibles de quarante pixels. Un glissement, lui, se fait n'importe où
// sur l'écran et dans le sens où l'on pense — c'est le geste de toutes les
// applications à onglets, et son absence se remarque plus que sa présence.
//
// Trois décisions valent d'être dites.
//
// PREMIÈRE : le geste ne s'arme QUE s'il commence horizontal. Une liste se fait
// défiler du pouce, et un défilement vertical part rarement parfaitement droit. Tant
// que le déplacement vertical domine, on laisse filer — et une fois qu'on a tranché
// pour l'un des deux axes, on ne revient pas dessus.
//
// DEUXIÈME : il cède à un défilement horizontal — mais seulement tant que celui-ci a
// ENCORE de la place dans le sens du geste. La liste des séances, les jours de la
// semaine, un tableau large se parcourent latéralement eux aussi, et leur voler le
// geste rendrait leur contenu inatteignable. Mais une fois arrivé au bout de la
// liste, continuer dans le même sens ne fait plus rien du tout : c'est là que le
// geste doit revenir à la navigation, sinon des écrans entiers deviennent
// inatteignables au doigt — c'est ce qui se passait sur Nutrition, dont la semaine
// occupe la moitié de la hauteur.
//
// TROISIÈME : le doigt DÉPLACE l'écran, avec un amortissement. Une navigation qui se
// déclenche sans rien avoir bougé se ressent comme un accident ; suivre le doigt dit
// « j'ai compris, continue ou reviens ». Le déplacement est volontairement borné :
// c'est un accusé de réception, pas un aperçu de l'écran d'à côté.

/** Au-delà, on change d'onglet. En dessous, l'écran revient en place. */
const SEUIL_PX = 70
/** Un geste rapide emporte la décision même s'il est court. */
const VITESSE_MIN = 0.5 // px/ms
/** L'écran ne suit le doigt que d'autant : accusé de réception, pas aperçu. */
const AMORTI_MAX = 56
/** Au-delà, le geste est vertical : c'est un défilement, pas une navigation. */
const PENTE = 1.2

export type Sens = 'gauche' | 'droite'

/** Le sens du dernier changement, lu par la transition de page. */
const sens = ref<Sens>('gauche')
export const sensNavigation = computed(() => sens.value)

/** Décalage courant, en pixels. Zéro = aucun geste en cours. */
const decalage = ref(0)
export const decalageGlissement = computed(() => decalage.value)

const indexDe = (chemin: string): number => ONGLETS.findIndex((o: { chemin: string }) => o.chemin === chemin)

/**
 * Le premier ancêtre qui défile latéralement, s'il y en a un.
 *
 * Cherché au TOUCHER, pas au mouvement : à ce moment-là on sait où le doigt s'est
 * posé, et l'arbre n'a pas encore bougé sous lui.
 */
function defilementHorizontal(cible: EventTarget | null): HTMLElement | null {
  let n = cible as HTMLElement | null
  while (n && n !== document.body) {
    if (n.scrollWidth > n.clientWidth + 4) {
      const ox = getComputedStyle(n).overflowX
      if (ox === 'auto' || ox === 'scroll') return n
    }
    n = n.parentElement
  }
  return null
}

/**
 * Ce défilement peut-il encore avancer dans ce sens ?
 *
 * Le doigt vers la gauche fait avancer le contenu vers la droite. Tant qu'il reste de
 * la marge, le défilement est prioritaire ; arrivé au bout, il n'a plus rien à faire
 * du geste et la navigation le reprend.
 */
function peutEncoreDefiler(el: HTMLElement, dx: number): boolean {
  const max = el.scrollWidth - el.clientWidth
  return dx < 0 ? el.scrollLeft < max - 1 : el.scrollLeft > 1
}

/**
 * Les gestes de la coque. `aller` reçoit le chemin de destination — la coque décide
 * comment y aller, ce composable ne connaît pas le routeur.
 */
export function useGlissement(aller: (chemin: string) => void, actif: () => boolean) {
    let x0 = 0
    let y0 = 0
    let t0 = 0
    /** null = on n'a pas encore tranché entre défilement et navigation. */
    let horizontal: boolean | null = null
    /** Le défilement latéral sous le doigt, s'il y en a un. */
    let piste: HTMLElement | null = null

  const voisin = (vers: Sens): string | null => {
    const i = indexDe(window.location.pathname)
    if (i < 0) return null
    const j = vers === 'gauche' ? i + 1 : i - 1
    return ONGLETS[j]?.chemin ?? null
  }

  function debut(e: TouchEvent) {
    decalage.value = 0
    horizontal = null
        piste = null
        if (!actif() || calqueOuvert.value || e.touches.length !== 1) { horizontal = false; return }
        piste = defilementHorizontal(e.target)
        const t = e.touches[0]!
    x0 = t.clientX
    y0 = t.clientY
    t0 = e.timeStamp
  }

  function bouge(e: TouchEvent) {
    if (horizontal === false || e.touches.length !== 1) return
    const t = e.touches[0]!
    const dx = t.clientX - x0
    const dy = t.clientY - y0
    if (horizontal === null) {
      // Tant que rien ne dépasse le bruit du doigt, on ne tranche pas.
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return
            horizontal = Math.abs(dx) > Math.abs(dy) * PENTE
            if (!horizontal) return
            // Le sens est connu : on peut enfin dire si le défilement sous le doigt a encore
            // quelque chose à faire de ce geste.
            if (piste && peutEncoreDefiler(piste, dx)) { horizontal = false; return }
          }
    // Pas de voisin de ce côté : le premier et le dernier onglet ne rebondissent pas
    // dans le vide, ils restent immobiles.
    if (!voisin(dx < 0 ? 'gauche' : 'droite')) { decalage.value = 0; return }
    // Amortissement : le déplacement freine à mesure qu'il s'éloigne.
    const a = Math.abs(dx)
    decalage.value = Math.sign(dx) * AMORTI_MAX * (1 - 1 / (1 + a / AMORTI_MAX))
  }

  function fin(e: TouchEvent) {
    const etaitHorizontal = horizontal === true
    horizontal = false
    decalage.value = 0
    if (!etaitHorizontal) return
    const t = e.changedTouches[0]
    if (!t) return
    const dx = t.clientX - x0
    const vitesse = Math.abs(dx) / Math.max(1, e.timeStamp - t0)
    if (Math.abs(dx) < SEUIL_PX && vitesse < VITESSE_MIN) return
    const vers: Sens = dx < 0 ? 'gauche' : 'droite'
    const chemin = voisin(vers)
    if (!chemin) return
    sens.value = vers
    aller(chemin)
  }

  return { debut, bouge, fin }
}

/**
 * Le sens d'une navigation qui ne vient PAS d'un glissement — la barre du bas, un lien.
 *
 * Sans ça, toucher « Profil » depuis « Accueil » jouait l'animation du dernier geste,
 * qui pouvait aller dans l'autre sens. L'écran partait à droite pour arriver de
 * gauche : on voit que quelque chose cloche sans savoir quoi.
 */
export function poserSens(depuis: string, vers: string) {
  const a = indexDe(depuis)
  const b = indexDe(vers)
  if (a < 0 || b < 0 || a === b) return
  sens.value = b > a ? 'gauche' : 'droite'
}
