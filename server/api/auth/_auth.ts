import type { H3Event } from 'h3'
import { SESSION_COOKIE, SESSION_TTL, readCredential, verifyToken } from '../../utils/vault'

// Ce qui identifie « le site » aux yeux d'un passkey.
//
// Un passkey est lié à un DOMAINE, et c'est toute sa force : il ne peut pas être
// rejoué ailleurs, donc un site qui imite celui-ci n'obtiendra jamais de signature
// valide. Encore faut-il que le domaine soit lu de la requête et non écrit en dur —
// sinon le développement local et la production ne peuvent pas coexister.

/** Le domaine, sans le port : c'est ce que la spécification WebAuthn appelle le RP ID. */
export function rpId(event: H3Event): string {
  return (getRequestHost(event) || 'localhost').split(':')[0]
}

/** L'origine complète, port compris — elle, doit correspondre exactement. */
export function origin(event: H3Event): string {
  return getRequestURL(event).origin
}

/**
 * Le nom affiché par le système au moment de poser ou d'utiliser un passkey, et
 * l'identifiant sous lequel les jetons sont signés.
 *
 * Ils étaient écrits en dur avec mon prénom. Quelqu'un qui héberge ce code voyait
 * donc « Damn Claude — Grégoire » dans la fenêtre de son propre téléphone, et
 * signait ses jetons sous `sub: 'gregoire'`. Rien ne cassait — `sub` n'est lu nulle
 * part, seul le `scope` autorise — mais c'est le genre de détail qui dit à celui qui
 * fork que le code n'était pas écrit pour lui.
 *
 * `NUXT_OWNER_NAME` côté Netlify, « Moi » à défaut : un fork sans configuration
 * fonctionne, il est simplement anonyme.
 */
const propre = (v: unknown): string => String(v ?? '').trim().slice(0, 40)

/**
 * Le nom du propriétaire, dans l'ordre où on le cherche.
 *
 * Le coffre d'abord : c'est celui que la personne a tapé en posant son passkey, donc
 * le seul qu'elle ait choisi. La variable d'environnement ensuite, pour qui préfère
 * tout décrire dans sa configuration. « Moi » enfin — une instance sans nom
 * fonctionne, elle est simplement anonyme, et ça vaut mieux que d'afficher le prénom
 * de celui qui a écrit le code.
 */
export async function ownerName(): Promise<string> {
  const cred = await readCredential().catch(() => null)
  return propre(cred?.ownerName) || propre(useRuntimeConfig().ownerName) || 'Moi'
}

/** Le nom sans lire le coffre : pour l'inscription, où le passkey n'existe pas encore. */
export const ownerNameSync = (): string => propre(useRuntimeConfig().ownerName) || 'Moi'

export const RP_NAME = async () => `Damn Claude — ${await ownerName()}`
/** L'identifiant du sujet dans les jetons. Une constante suffit : il n'y a qu'un
 *  compte par instance, et rien ne lit cette valeur — c'est le `scope` qui autorise. */
export const OWNER_SUB = 'owner'

/** La session du téléphone, ou `null`. Aucune requête protégée ne s'en passe. */
export function session(event: H3Event, nowMs = Date.now()) {
  const token = getCookie(event, SESSION_COOKIE)
  const payload = verifyToken(token, nowMs)
  return payload && payload.scope === 'app' ? payload : null
}

export function setSession(event: H3Event, token: string) {
  setCookie(event, SESSION_COOKIE, token, {
    httpOnly: true, // hors de portée du JavaScript : une faille XSS ne l'emporte pas
    secure: !import.meta.dev,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL,
  })
}

export function clearSession(event: H3Event) {
  deleteCookie(event, SESSION_COOKIE, { path: '/' })
}

/** Refuse proprement plutôt que de laisser filer une requête non authentifiée. */
export function requireSession(event: H3Event) {
  const s = session(event)
  if (!s) throw createError({ statusCode: 401, statusMessage: 'Session requise' })
  return s
}
