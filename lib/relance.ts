/**
 * Réessayer un geste qui peut n'avoir simplement pas encore abouti ailleurs.
 *
 * Écrit pour la reprise d'une autorisation : l'autre navigateur range les jetons
 * côté serveur, et l'application vient ensuite les réclamer. Entre les deux il y a
 * un aller-retour réseau, et on revient à l'application avant qu'il soit fini —
 * c'est le cas NORMAL, puisque revenir est le premier réflexe une fois « Autoriser »
 * tapé. Un seul essai échouait alors sans que plus rien ne se redéclenche.
 *
 * `null` veut dire « pas encore », pas « échoué » : on ne distingue pas, parce que
 * l'appelant ne peut rien en faire de différent — dans les deux cas on retente plus
 * tard, et le jeton d'attente survit.
 *
 * `dormir` est un paramètre pour qu'un test n'attende pas cinq secondes.
 */
export async function avecRelances<T>(
  attentes: number[],
  essai: () => Promise<T | null>,
  dormir: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)),
): Promise<T | null> {
  for (const attente of attentes) {
    if (attente > 0) await dormir(attente)
    const r = await essai()
    if (r) return r
  }
  return null
}
