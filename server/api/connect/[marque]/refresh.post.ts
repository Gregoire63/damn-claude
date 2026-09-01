import { ErreurConnecteur } from '../../../connecteurs'
import { identifiantsOuRefus, marqueDe } from './_commun'

/**
 * Échange un jeton de rafraîchissement contre un jeu neuf. Rien d'autre.
 *
 * Cette route existe à cause d'un bogue qui a cassé la connexion à la balance, et
 * l'histoire mérite d'être écrite ici parce qu'elle se reproduira si on l'oublie :
 *
 * **Beaucoup de marques font tourner leurs jetons de rafraîchissement.** Chaque
 * rafraîchissement en émet un nouveau et INVALIDE l'ancien, immédiatement. Or `sync`
 * rafraîchissait au milieu de son travail, puis relançait l'appel de données. Si ce
 * second appel échouait — un réseau qui saute, un quota, un métro sans couverture — le
 * handler levait, et le jeton fraîchement émis n'atteignait jamais le téléphone. La
 * marque, elle, avait déjà enterré l'ancien.
 *
 * À partir de là, chaque synchro renvoyait le jeton mort, à vie, jusqu'à reconnexion
 * manuelle. Une seule requête malchanceuse suffisait, et rien dans l'interface ne
 * disait quoi faire.
 *
 * Le remède est d'ordonner les choses : on rafraîchit ICI, le client écrit les
 * nouveaux jetons dans son stockage, ET SEULEMENT APRÈS on va chercher les données.
 * Cette route ne fait qu'un aller-retour et n'a rien d'autre qui puisse échouer entre
 * l'émission du jeton et son enregistrement.
 */
export default defineEventHandler(async (event) => {
  const a = marqueDe(event)
  const body = await readBody<{ rafraichissement?: string }>(event)
  if (!body?.rafraichissement) {
    throw createError({ statusCode: 400, statusMessage: 'Aucun jeton de rafraîchissement fourni.' })
  }
  const ids = await identifiantsOuRefus(a)

  try {
    return { jetons: await a.rafraichir(ids, body.rafraichissement), reconnecter: false, erreur: null as string | null }
  }
  catch (e) {
    // Un jeton de rafraîchissement refusé ne se répare pas : il faut repasser par la
    // marque. On le DIT au client au lieu de lui rendre une erreur brute qu'il
    // afficherait telle quelle sans savoir qu'un bouton « Reconnecter » existe.
    if (e instanceof ErreurConnecteur && e.auth) {
      return { jetons: null, reconnecter: true, erreur: 'Autorisation révoquée. Reconnecte le compte ; les mesures déjà récupérées sont conservées.' }
    }
    throw e
  }
})
