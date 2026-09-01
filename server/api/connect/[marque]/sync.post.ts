import { ErreurConnecteur } from '../../../connecteurs'
import type { Jetons } from '../../../connecteurs'
import { identifiantsOuRefus, marqueDe } from './_commun'

/**
 * Va chercher pesées et pas. Le navigateur envoie ses jetons, le serveur les
 * rafraîchit si besoin et renvoie les nouveaux : le client_secret ne sort jamais d'ici.
 *
 * Pas de base de données côté serveur : les jetons vivent dans le localStorage du
 * téléphone, comme le reste de l'application. C'est aussi pour ça qu'il n'y a pas de
 * webhook — un webhook a besoin d'un serveur qui stocke, sinon il n'a personne à
 * prévenir. La synchro se fait à l'ouverture, ce qui suffit largement pour une pesée
 * par jour.
 *
 * La réponse est NORMALISÉE : des pesées, des pas, un curseur. Aucune trace du JSON de
 * la marque. C'est ce qui permet au navigateur de n'avoir qu'un seul code de synchro
 * pour toutes les marques — la version d'avant renvoyait du brut pour l'une et du
 * traduit pour l'autre, et les deux traductions ont fini par diverger.
 */
export default defineEventHandler(async (event) => {
  const a = marqueDe(event)
  const body = await readBody<{ acces?: string, rafraichissement?: string, depuis?: number }>(event)
  if (!body?.acces && !body?.rafraichissement) {
    throw createError({ statusCode: 400, statusMessage: 'Aucun jeton fourni. Reconnecte le compte.' })
  }
  const ids = await identifiantsOuRefus(a)

  let acces = body.acces ?? ''
  let neufs: Jetons | null = null

  const vide = (extra: Record<string, unknown>) => ({
    pesees: [],
    pas: [],
    curseur: 0,
    // Les jetons renouvelés repartent TOUJOURS, y compris quand la suite a échoué.
    // C'est la règle qui manquait : une marque qui fait tourner ses jetons enterre
    // l'ancien dès qu'elle en émet un nouveau, donc un jeton émis mais non transmis
    // est un compte cassé jusqu'à reconnexion manuelle. Il ne doit exister AUCUN
    // chemin de sortie qui perde `neufs`.
    jetons: neufs,
    reconnecter: false,
    erreur: null as string | null,
    ...extra,
  })

  /**
   * On tente, et on rafraîchit UNIQUEMENT sur une erreur d'authentification.
   *
   * Le « uniquement » a son importance : réessayer sur n'importe quelle erreur
   * brûlerait un jeton de rafraîchissement pour un quota dépassé ou un réseau qui
   * saute — et comme l'ancien est enterré à la seconde où le nouveau est émis, une
   * seule requête malchanceuse peut condamner le compte.
   */
  try {
    let releve
    try {
      releve = await a.lire(ids, acces, body.depuis ?? 0)
    }
    catch (e) {
      if (!body.rafraichissement || !(e instanceof ErreurConnecteur) || !e.auth) throw e
      neufs = await a.rafraichir(ids, body.rafraichissement)
      acces = neufs.acces
      releve = await a.lire(ids, acces, body.depuis ?? 0)
    }
    return { ...vide({}), ...releve, jetons: neufs }
  }
  catch (e) {
    if (e instanceof ErreurConnecteur && e.auth) {
      return vide({ reconnecter: true, erreur: 'Autorisation révoquée. Reconnecte le compte ; les mesures déjà récupérées sont conservées.' })
    }
    // Toute autre panne : on rend quand même les jetons s'il y en a de neufs.
    if (neufs) return vide({ erreur: (e as Error).message.slice(0, 160) })
    throw e
  }
})
