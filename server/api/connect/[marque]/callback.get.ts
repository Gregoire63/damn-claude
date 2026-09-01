import { defineEventHandler, getQuery } from 'h3'
import { putHandover, verifyToken } from '../../../utils/vault'
import { identifiantsOuRefus, marqueDe, urlRetour } from './_commun'
import { providerById } from '../../../../lib/providers'

// ─────────────────────────────────────────────────────────────────────────────
// Étape 2 : le retour de la marque, qui n'arrive pas là où l'on croit.
// ─────────────────────────────────────────────────────────────────────────────
//
// Ce point d'entrée renvoyait les jetons à l'application dans l'URL de retour. Sur un
// ordinateur ça marchait ; depuis la PWA du téléphone, jamais — et il a fallu du temps
// pour comprendre pourquoi, parce que le flux semblait réussir.
//
// Une application posée sur l'écran d'accueil qui navigue vers le site de la marque
// SORT de son contexte : iOS ouvre Safari. L'autorisation se fait là, et cette
// redirection-ci y atterrit aussi. Les jetons étaient donc rangés dans le stockage de
// SAFARI, pendant que la PWA gardait son ancien jeton périmé et redemandait une
// reconnexion — qui repartait dans Safari. Une boucle parfaite.
//
// Ils sont maintenant DÉPOSÉS côté serveur, et l'application vient les chercher avec le
// nonce qu'elle avait tiré avant de partir. C'est le seul fil qui n'ait jamais quitté
// son contexte.
//
// Bénéfice au passage : un jeton ne traverse plus une barre d'adresse. Il n'est donc
// plus dans l'historique du navigateur, ni dans une capture d'écran, ni dans ce qui se
// partage quand on envoie un lien.

const echappe = (s: string) => s.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!))

export default defineEventHandler(async (event) => {
  const a = marqueDe(event)
  const fiche = providerById(a.id)
  const label = fiche?.label ?? a.id
  const { code, state, error } = getQuery(event) as Record<string, string | undefined>

  const page = (titre: string, message: string, ok: boolean) => {
    setHeader(event, 'content-type', 'text/html; charset=utf-8')
    // Aucune redirection : on est probablement dans le mauvais navigateur, et y
    // renvoyer vers l'application ouvrirait une deuxième copie, vide, que l'on
    // prendrait pour la vraie. Mieux vaut une page qui ne fait rien et dit quoi faire.
    return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${echappe(titre)}</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         background:#f7f5f2; color:#2b2622; font-family:system-ui,-apple-system,sans-serif; padding:24px; }
  .c { max-width:22rem; text-align:center; }
  .i { font-size:44px; line-height:1; margin-bottom:16px; }
  h1 { font-size:19px; margin:0 0 10px; }
  p { font-size:14.5px; line-height:1.55; color:#6b625a; margin:0; }
  b { color:#2b2622; }
</style></head><body><div class="c">
<div class="i">${ok ? (fiche?.icone ?? '✅') : '⚠️'}</div><h1>${echappe(titre)}</h1><p>${message}</p></div></body></html>`
  }

  const echec = (raison: string) =>
    page('Connexion échouée', `${echappe(raison)}<br><br>Rouvre l’application depuis ton écran d’accueil et réessaie.`, false)

  if (error) return echec(`${label} a refusé : ${error}.`)
  if (!code) return echec(`${label} n’a pas renvoyé de code.`)

  // La signature remplace le cookie : elle se vérifie dans n'importe quel contexte.
  // `sub` est comparé à la marque de l'URL, sinon un state signé pour une marque
  // servirait à en autoriser une autre.
  const claims = verifyToken(state, Date.now())
  if (!claims || claims.scope !== 'oauth' || claims.sub !== a.id || typeof claims.nonce !== 'string') {
    return echec('Le lien de connexion a expiré ou n’est pas valide.')
  }

  try {
    const ids = await identifiantsOuRefus(a)
    const j = await a.echanger(ids, code, urlRetour(getRequestURL(event).origin, a.id))
    await putHandover(claims.nonce, {
      access_token: j.acces,
      refresh_token: j.rafraichissement,
      expires_at: j.expireA,
    }, Date.now())
    return page(
      `${label} connecté`,
      'Tu peux fermer cet onglet. <b>Rouvre l’application depuis ton écran d’accueil</b> : '
      + 'la connexion s’y termine toute seule, tu n’as rien d’autre à faire.',
      true,
    )
  }
  catch (e) {
    return echec((e as Error).message.slice(0, 160))
  }
})
