import { WithingsError, refreshTokens } from './_client'

/**
 * Échange un refresh_token contre un jeu de jetons neuf. Rien d'autre.
 *
 * Cette route existe à cause d'un bug qui a cassé la connexion à la balance, et
 * l'histoire mérite d'être écrite ici parce qu'elle se reproduira si on l'oublie :
 *
 * **Withings fait tourner ses refresh_token.** Chaque rafraîchissement en émet un
 * nouveau et INVALIDE l'ancien, immédiatement. Or `sync` rafraîchissait au milieu de
 * son travail, puis relançait l'appel de données. Si ce second appel échouait — un
 * réseau qui saute, un quota, un métro sans couverture — le handler levait, et le
 * jeton fraîchement émis n'atteignait jamais le téléphone. Withings, lui, avait déjà
 * enterré l'ancien.
 *
 * À partir de là, chaque synchro renvoyait le jeton mort : `status 503 — invalid
 * params: refresh_token`, à vie, jusqu'à reconnexion manuelle. Une seule requête
 * malchanceuse suffisait, et rien dans l'interface ne disait quoi faire.
 *
 * Le remède est d'ordonner les choses : on rafraîchit ICI, le client écrit les
 * nouveaux jetons dans son stockage, ET SEULEMENT APRÈS on va chercher les données.
 * Cette route ne fait qu'un aller-retour et n'a rien d'autre qui puisse échouer
 * entre l'émission du jeton et son enregistrement.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<{ refreshToken?: string }>(event)
  if (!body?.refreshToken) {
    throw createError({ statusCode: 400, statusMessage: 'Aucun jeton de rafraîchissement fourni.' })
  }

  try {
    const t = await refreshTokens(event, body.refreshToken)
    return {
      tokens: { accessToken: t.access_token, refreshToken: t.refresh_token, expiresIn: t.expires_in },
      needsReconnect: false,
      error: null as string | null,
    }
  }
  catch (e) {
    // Un refresh_token refusé ne se répare pas : il faut repasser par Withings.
    // On le DIT au client au lieu de lui rendre une erreur brute qu'il affichera
    // telle quelle sans savoir qu'un bouton « Reconnecter » existe.
    if (e instanceof WithingsError && e.isAuth) {
      return { tokens: null, needsReconnect: true, error: 'La balance a révoqué l\'autorisation. Reconnecte le compte Withings, une fois : tes mesures déjà récupérées ne bougent pas.' }
    }
    throw e
  }
})
