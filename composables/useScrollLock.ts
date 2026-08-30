// Verrou de défilement de la page, pendant qu'une feuille est ouverte.
//
// `overscroll-behavior: contain` sur le contenu de la feuille ne suffit pas : il
// empêche la propagation quand on ARRIVE AU BOUT d'une zone défilante, mais une
// feuille dont le contenu tient à l'écran n'a rien à faire défiler — le geste part
// alors directement dans la page derrière, qui bouge sous la feuille.
//
// Et `overflow: hidden` sur le body ne suffit pas non plus : Safari iOS l'ignore
// pour le défilement tactile. La seule méthode qui tienne partout est de figer le
// body en `position: fixed` à son décalage courant, puis de le restaurer.

/**
 * Compteur, et non booléen : deux feuilles peuvent être ouvertes l'une sur l'autre
 * (une fiche de plat par-dessus la feuille des repas). Avec un booléen, fermer la
 * première rendrait le défilement à la page alors que la seconde est encore là.
 */
let locks = 0
let savedY = 0

function apply() {
  const b = document.body
  savedY = window.scrollY
  b.style.position = 'fixed'
  b.style.top = `-${savedY}px`
  b.style.left = '0'
  b.style.right = '0'
  b.style.width = '100%'
}

function release() {
  const b = document.body
  b.style.position = ''
  b.style.top = ''
  b.style.left = ''
  b.style.right = ''
  b.style.width = ''
  // Restaure la position AVANT le verrou : sans ça, fermer une feuille renvoie en
  // haut de page, et on perd l'endroit où l'on était en train de lire.
  window.scrollTo(0, savedY)
}

export function useScrollLock() {
  function lock() {
    if (!import.meta.client) return
    if (locks === 0) apply()
    locks++
  }
  function unlock() {
    if (!import.meta.client) return
    locks = Math.max(0, locks - 1)
    if (locks === 0) release()
  }
  return { lock, unlock }
}
