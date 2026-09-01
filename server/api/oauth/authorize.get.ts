import { OWNER_SUB, session } from '../auth/_auth'
import { CODE_TTL, signToken } from '../../utils/vault'
import { redirectionValide, verifierClient } from '../../utils/clients'

/**
 * L'écran où l'on autorise Claude — et où l'on prouve d'abord que c'est bien soi.
 *
 * Deux choses s'y passent, dans cet ordre. D'abord l'authentification : sans
 * session valide, la page ne propose qu'un bouton « Déverrouiller », qui déclenche
 * le passkey. Ensuite seulement l'autorisation : un bouton pour accorder l'accès,
 * un pour refuser.
 *
 * C'est une page servie par le serveur et non un écran de l'application, pour une
 * raison simple : elle est ouverte par le navigateur de Claude, dans un contexte
 * où l'application n'est pas chargée. Elle doit donc tenir toute seule, sans
 * routeur, sans bundle, sans dépendre de ce que le client sait exécuter.
 *
 * Le code d'autorisation renvoyé est un jeton signé de deux minutes qui porte le
 * `code_challenge` : c'est PKCE. Sans lui, quiconque intercepterait la redirection
 * pourrait échanger le code contre un jeton d'accès.
 */
export default defineEventHandler((event) => {
  const q = getQuery(event)
  const clientId = String(q.client_id ?? '')
  const redirectUri = String(q.redirect_uri ?? '')
  const state = String(q.state ?? '')
  const challenge = String(q.code_challenge ?? '')
  const method = String(q.code_challenge_method ?? '')

  if (!redirectionValide(redirectUri)) {
    throw createError({ statusCode: 400, statusMessage: 'redirect_uri invalide : il faut une adresse https sans fragment' })
  }
  /*
   * Deux sortes de clients, une seule porte.
   *
   * Celui des variables d'environnement, qu'il faut recopier à la main, et ceux qui
   * se sont INSCRITS — dont l'identifiant porte lui-même ses redirections, donc rien
   * n'est stocké. Le second cas vérifie que la redirection demandée est bien l'une
   * des siennes : c'est ce qui empêche un identifiant recopié ailleurs de faire
   * renvoyer le code chez quelqu'un d'autre.
   */
  const verdict = verifierClient(clientId, redirectUri)
  if (verdict === 'inconnu') throw createError({ statusCode: 400, statusMessage: 'client_id inconnu' })
  if (verdict === 'redirection') {
    throw createError({ statusCode: 400, statusMessage: 'redirect_uri non déclarée par ce client' })
  }
  if (!challenge || method !== 'S256') {
    throw createError({ statusCode: 400, statusMessage: 'PKCE S256 obligatoire' })
  }

  const signedIn = !!session(event)
  // Le code n'est fabriqué QUE si la session est déjà valide : la page ne doit
  // jamais porter un code exploitable avant que l'utilisateur se soit authentifié.
  const code = signedIn
    // `clientId` est DANS le code : sans lui, un client inscrit pourrait présenter
    // au guichet un code remis à un autre. Le secret partagé jouait ce rôle ; il
    // n'existe plus pour un client public, c'est donc la signature qui le tient.
    ? signToken({ sub: OWNER_SUB, scope: 'code', challenge, redirectUri, clientId }, CODE_TTL, Date.now())
    : ''

  setHeader(event, 'content-type', 'text/html; charset=utf-8')
  setHeader(event, 'cache-control', 'no-store')
  return page({ signedIn, code, state, redirectUri })
})

function page(o: { signedIn: boolean, code: string, state: string, redirectUri: string }) {
  const j = (v: unknown) => JSON.stringify(v)
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Connecter Claude</title>
<style>
:root{color-scheme:light dark}
body{font-family:system-ui,-apple-system,sans-serif;margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f7f5f2;color:#3a3128;padding:24px}
.card{background:#fffdfa;border:1px solid #e3ddd4;border-radius:18px;padding:26px;max-width:420px;width:100%;box-shadow:0 10px 40px rgba(0,0,0,.06)}
h1{font-size:19px;margin:0 0 6px}p{font-size:14px;line-height:1.55;color:#6b6157;margin:0 0 16px}
ul{font-size:13.5px;line-height:1.6;color:#6b6157;padding-left:18px;margin:0 0 18px}
button{width:100%;border:none;border-radius:12px;padding:14px;font-size:15px;font-weight:600;font-family:inherit;cursor:pointer}
.go{background:#8b6f5c;color:#fff}.no{background:none;color:#6b6157;border:1px solid #e3ddd4;margin-top:8px}
.err{color:#b5502f;font-size:13px;margin-top:12px;min-height:18px}
</style></head><body><div class="card">
<h1>${o.signedIn ? 'Autoriser Claude' : 'Déverrouille d’abord'}</h1>
${o.signedIn
  ? `<p>Claude pourra&nbsp;:</p><ul>
      <li>lire tes séances, pesées, repas et ton planning ;</li>
      <li><b>proposer</b> des modifications — elles n’écrivent rien tant que tu ne les valides pas dans l’app.</li>
     </ul>
     <button class="go" id="go">Autoriser</button>
     <button class="no" id="no">Refuser</button>`
  : `<p>Cette page est publique&nbsp;: elle ne peut rien accorder avant de savoir que c’est toi. Utilise ton passkey.</p>
     <button class="go" id="unlock">🔓 Déverrouiller</button>`}
<div class="err" id="err"></div>
</div><script>
const REDIRECT=${j(o.redirectUri)},STATE=${j(o.state)},CODE=${j(o.code)};
const err=document.getElementById('err');
const b64u=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');
const buf=s=>{s=s.replace(/-/g,'+').replace(/_/g,'/');const b=atob(s);return Uint8Array.from(b,c=>c.charCodeAt(0)).buffer};
function back(params){const u=new URL(REDIRECT);for(const[k,v]of Object.entries(params))u.searchParams.set(k,v);if(STATE)u.searchParams.set('state',STATE);location.href=u.toString()}
document.getElementById('go')?.addEventListener('click',()=>back({code:CODE}));
document.getElementById('no')?.addEventListener('click',()=>back({error:'access_denied'}));
document.getElementById('unlock')?.addEventListener('click',async()=>{
  err.textContent='';
  try{
    const o=await(await fetch('/api/auth/challenge',{method:'POST',headers:{'content-type':'application/json'},body:'{"mode":"login"}'})).json();
    if(!o.challenge)throw new Error(o.statusMessage||'aucun passkey enregistré');
    const cred=await navigator.credentials.get({publicKey:{
      challenge:buf(o.challenge),rpId:o.rpId,timeout:o.timeout,userVerification:o.userVerification,
      allowCredentials:(o.allowCredentials||[]).map(c=>({id:buf(c.id),type:'public-key'}))}});
    const r=await fetch('/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({response:{
      id:cred.id,rawId:b64u(cred.rawId),type:cred.type,clientExtensionResults:cred.getClientExtensionResults(),
      response:{clientDataJSON:b64u(cred.response.clientDataJSON),authenticatorData:b64u(cred.response.authenticatorData),
        signature:b64u(cred.response.signature),userHandle:cred.response.userHandle?b64u(cred.response.userHandle):undefined}}})});
    if(!r.ok)throw new Error('signature refusée');
    location.reload();
  }catch(e){err.textContent='Échec : '+(e&&e.message?e.message:e)}
});
</script></body></html>`
}
