import { defineEventHandler, getQuery } from 'h3'
import { putHandover, verifyToken } from '../../utils/vault'
import { exchangeCode } from './_client'

/**
 * Étape 2 : le retour de Fitbit, qui n'arrive pas là où l'on croit.
 *
 * Le raisonnement est celui écrit pour Withings, et il vaut pour n'importe quelle
 * marque : une application posée sur l'écran d'accueil qui navigue vers un domaine
 * tiers sort de son contexte, iOS ouvre Safari, et cette redirection y atterrit. Des
 * jetons rendus dans l'URL seraient donc rangés dans le stockage de Safari pendant
 * que la PWA garde son ancien jeton périmé et redemande une connexion — qui repart
 * dans Safari. Une boucle parfaite, et qui a l'air de fonctionner à chaque étape.
 *
 * Les jetons sont donc DÉPOSÉS côté serveur, et l'application vient les chercher avec
 * le nonce qu'elle avait tiré avant de partir : le seul fil qui n'ait jamais quitté
 * son contexte.
 */
export default defineEventHandler(async (event) => {
  const { code, state, error, error_description: desc } = getQuery(event) as Record<string, string | undefined>

  const page = (titre: string, message: string, ok: boolean) => {
    setHeader(event, 'content-type', 'text/html; charset=utf-8')
    // Aucune redirection : on est probablement dans le mauvais navigateur, et y
    // renvoyer vers /sport ouvrirait une deuxième copie de l'application, vide,
    // qu'on prendrait pour la vraie.
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${titre}</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#f7f5f2; color:#2b2622; font-family:system-ui,-apple-system,sans-serif; padding:24px; }
  .c { max-width:22rem; text-align:center; }
  .i { font-size:44px; line-height:1; margin-bottom:16px; }
  h1 { font-size:19px; margin:0 0 10px; }
  p { font-size:14.5px; line-height:1.55; color:#6b625a; margin:0; }
  b { color:#2b2622; }
</style></head><body><div class="c">
<div class="i">${ok ? '⌚' : '⚠️'}</div><h1>${titre}</h1><p>${message}</p></div></body></html>`
  }

  const echec = (raison: string) =>
    page('Connexion échouée', `${raison}<br><br>Rouvre <b>Sport</b> depuis ton écran d’accueil et réessaie.`, false)

  if (error) return echec(`Fitbit a refusé : ${desc || error}.`)
  if (!code) return echec('Fitbit n’a pas renvoyé de code.')

  const claims = verifyToken(state, Date.now())
  if (!claims || claims.scope !== 'oauth' || claims.sub !== 'fitbit' || typeof claims.nonce !== 'string') {
    return echec('Le lien de connexion a expiré ou n’est pas valide.')
  }

  try {
    // L'URL de retour doit être IDENTIQUE à celle envoyée à l'étape 1 : Fitbit la
    // recompare, et une différence de protocole ou de barre oblique finale suffit
    // à faire échouer l'échange.
    const tokens = await exchangeCode(event, code, `${getRequestURL(event).origin}/api/fitbit/callback`)
    await putHandover(claims.nonce, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in,
      userid: String(tokens.user_id ?? ''),
    }, Date.now())
    return page(
      'Fitbit connecté',
      'Tu peux fermer cet onglet. <b>Rouvre Sport depuis ton écran d’accueil</b> : '
      + 'la connexion s’y termine toute seule, tu n’as rien d’autre à faire.',
      true,
    )
  }
  catch (e) {
    return echec((e as Error).message.slice(0, 160))
  }
})
