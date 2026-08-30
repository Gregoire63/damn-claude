// ─────────────────────────────────────────────────────────────────────────────
// UNE pile pour le geste « retour ». Une seule, pour toute l'application.
// ─────────────────────────────────────────────────────────────────────────────
//
// L'accueil est la première page de l'historique de la PWA. Un balayage arrière n'a
// donc rien où revenir : il sort de l'application, purement et simplement — et il
// n'a aucune raison de croire qu'il interrompt quelque chose, puisque rien de ce
// qu'on voit à l'écran n'est une route. Une feuille ouverte, un onglet, une carte
// de confirmation : ce sont des ÉTATS, invisibles pour le navigateur.
//
// On lui donne donc quelque chose à consommer : une entrée d'historique FACTICE,
// maintenue tant qu'il reste quelque chose à refermer. Le retour la consomme,
// l'application reste ouverte, et le calque du dessus se ferme.
//
// UNE entrée factice, pas une par calque. Le nombre d'entrées n'est pas ce que
// l'utilisateur perçoit — il perçoit qu'un retour ferme une chose. Après chaque
// interception on réempile aussitôt s'il reste des gestionnaires : le geste suivant
// est intercepté lui aussi, et l'historique ne gonfle jamais de plus d'un cran.
//
// La pile est déclarée AU NIVEAU DU MODULE. C'est ce qui fait qu'une carte ouverte
// par-dessus une feuille, elle-même ouverte par-dessus un onglet, se ferme dans le
// bon ordre : le dernier inscrit est le premier servi, quel que soit le composant
// qui l'a inscrit.
//
// Le piège, quand on écrit ça : désarmer appelle `history.back()`, qui déclenche à
// son tour un `popstate`. Sans la garde « plus personne dans la pile → on laisse
// partir », fermer un calque relancerait la fermeture, en boucle. C'est exactement
// le bug qui a fait rester plantée la carte « ta séance est en cours ».

const MARK = 'gr-back'

interface Handler { run: () => void }

const stack: Handler[] = []
let armed = false
let listening = false

function arm() {
  if (!import.meta.client || armed) return
  history.pushState({ [MARK]: true }, '')
  armed = true
}

/** Consomme l'entrée factice si elle est encore là — sans ça, on reculerait d'un
 *  cran de trop la prochaine fois et on quitterait quand même. */
function disarm() {
  if (!import.meta.client || !armed) return
  armed = false
  if ((history.state as Record<string, unknown> | null)?.[MARK]) history.back()
}

function sync() {
  if (stack.length) arm()
  else disarm()
}

function onPop() {
  // L'entrée factice vient d'être consommée — soit par l'utilisateur, soit par
  // notre propre `disarm`.
  armed = false
  const top = stack.at(-1)
  // Plus rien à retenir : le retour redevient le retour. C'est la seule sortie de
  // l'application, et elle doit rester possible.
  if (!top) return
  // Réarmer AVANT d'agir. Si l'action ne ferme rien — une confirmation qui s'ouvre
  // par-dessus — le geste suivant doit être intercepté lui aussi ; si elle ferme,
  // le retrait du gestionnaire désarmera cette entrée tout seul.
  arm()
  top.run()
}

/**
 * Inscrit ce que « retour » doit faire tant que ce gestionnaire est en place.
 *
 * @returns De quoi le retirer. À appeler au démontage du calque, ou quand la
 *   condition qui le justifiait cesse d'être vraie.
 */
export function pushBack(run: () => void): () => void {
  if (import.meta.client && !listening) {
    listening = true
    window.addEventListener('popstate', onPop)
  }
  const h: Handler = { run }
  stack.push(h)
  sync()
  return () => {
    // `lastIndexOf` : deux calques peuvent naître dans le même tick, et c'est la
    // place la plus récente qui est la nôtre.
    const i = stack.lastIndexOf(h)
    if (i < 0) return
    stack.splice(i, 1)
    sync()
  }
}

/** Uniquement pour les tests : repartir d'une pile vide entre deux cas. */
export function resetBackStack() {
  stack.length = 0
  armed = false
}
