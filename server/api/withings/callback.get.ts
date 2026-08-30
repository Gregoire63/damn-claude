import { defineEventHandler, getQuery } from 'h3'
import { putHandover, verifyToken } from '../../utils/vault'
import { exchangeCode } from './_client'

// ─────────────────────────────────────────────────────────────────────────────
// Étape 2 : le retour de Withings, qui n'arrive pas là où l'on croit.
// ─────────────────────────────────────────────────────────────────────────────
//
// Ce point d'entrée renvoyait les jetons à l'application dans l'URL de retour. Sur
// un ordinateur ça marchait ; depuis la PWA du téléphone, jamais — et il a fallu du
// temps pour comprendre pourquoi, parce que le flux semblait réussir.
//
// Une application posée sur l'écran d'accueil qui navigue vers `account.withings.com`
// sort de son contexte : iOS ouvre Safari. L'autorisation se fait là, et cette
// redirection-ci y atterrit aussi. Les jetons étaient donc rangés dans le stockage
// de SAFARI, pendant que la PWA gardait son ancien jeton périmé et redemandait une
// reconnexion — qui repartait dans Safari. Une boucle parfaite.
//
// Ils sont maintenant DÉPOSÉS côté serveur, et l'application vient les chercher avec
// le nonce qu'elle avait tiré avant de partir. C'est le seul fil qui n'ait jamais
// quitté son contexte.
//
// Bénéfice au passage : un jeton ne traverse plus une barre d'adresse. Il n'est donc
// plus dans l'historique du navigateur, ni dans une capture d'écran, ni dans ce qui
// se partage quand on envoie un lien.

export default defineEventHandler(async (event) => {
  const { code, state, error } = getQuery(event) as Record<string, string | undefined>

  const page = (titre: string, message: string, ok: boolean) => {
    setHeader(event, 'content-type', 'text/html; charset=utf-8')
    // Aucune redirection : on est probablement dans le mauvais navigateur, et y
    // renvoyer vers /sport ouvrirait une deuxième copie de l'application, vide,
    // que l'on prendrait pour la vraie. Mieux vaut une page qui ne fait rien et
    // dit quoi faire.
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
<div class="i">${ok ? '⚖️' : '⚠️'}</div><h1>${titre}</h1><p>${message}</p></div></body></html>`
  }

  const echec = (raison: string) =>
    page('Connexion échouée', `${raison}<br><br>Rouvre <b>Sport</b> depuis ton écran d’accueil et réessaie.`, false)

  if (error) return echec(`Withings a refusé : ${error}.`)
  if (!code) return echec('Withings n’a pas renvoyé de code.')

  // La signature remplace le cookie : elle se vérifie dans n'importe quel contexte.
  const claims = verifyToken(state, Date.now())
  if (!claims || claims.scope !== 'oauth' || typeof claims.nonce !== 'string') {
    return echec('Le lien de connexion a expiré ou n’est pas valide.')
  }

  try {
    const tokens = await exchangeCode(event, code, `${getRequestURL(event).origin}/api/withings/callback`)
    await putHandover(claims.nonce, {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + tokens.expires_in,
      userid: String(tokens.userid ?? ''),
    }, Date.now())
    return page(
      'Balance connectée',
      'Tu peux fermer cet onglet. <b>Rouvre Sport depuis ton écran d’accueil</b> : '
      + 'la connexion s’y termine toute seule, tu n’as rien d’autre à faire.',
      true,
    )
  }
  catch (e) {
    return echec((e as Error).message.slice(0, 120))
  }
})
