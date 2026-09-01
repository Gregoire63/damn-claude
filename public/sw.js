// Service worker de l'application — cache hors-ligne du suivi.
// Servi depuis la racine du domaine, il a donc le scope racine par défaut :
// aucun en-tête `Service-Worker-Allowed` n'est nécessaire.
/*
 * La VERSION du cache vient de l'URL de ce fichier, pas d'un nombre écrit à la main.
 *
 * C'était `sport-v2`, à changer soi-même « chaque fois qu'un changement doit atteindre
 * un appareil qui a déjà visité le site ». Personne ne s'en souvient. Le numéro est
 * resté figé trois déploiements durant, et les appareils qui avaient déjà ouvert
 * l'application gardaient les caches d'alors : rafraîchir ne servait à rien, parce
 * qu'un cache périmé ne sait pas qu'il l'est.
 *
 * L'application enregistre donc `/sw.js?v=<version du build>`. Pour le navigateur,
 * une URL de script différente est un AUTRE service worker : il l'installe, et
 * l'`activate` ci-dessous jette tout `sport-*` qui ne porte pas cette version. Un
 * déploiement purge le précédent, sans que personne ait à y penser.
 *
 * Le repli `sans-version` couvre l'ouverture directe de /sw.js et les enregistrements
 * d'avant ce changement : ils continuent de fonctionner, avec un cache à eux qui sera
 * jeté à la première activation d'une vraie version.
 *
 * Le manifeste, lui, reste RÉSEAU D'ABORD (voir plus bas) : c'est une correction
 * indépendante, et elle doit tenir même si l'on ouvre /sw.js sans version.
 */
const VERSION = new URL(self.location.href).searchParams.get('v') || 'sans-version'
const CACHE = `sport-${VERSION}`

const SHELL = '/'
const NAV_TIMEOUT_MS = 3000

// Ce qui est mis en cache d'office, en plus de _nuxt/. Une liste explicite et
// non un préfixe : `/` engloberait /api/**, et une réponse d'API figée dans le
// cache est bien pire qu'une absence de cache.
const ASSET_PREFIXES = ['/_nuxt/', '/exercises/', '/_fonts/']
const ASSET_FILES = ['/icon-192.png', '/icon-512.png']

/**
 * Le manifeste est RÉSEAU D'ABORD, comme la coque HTML — et pas cache d'abord.
 *
 * C'est lui qui décide de l'installabilité, et il change avec les déploiements. Mis
 * en cache d'abord, il était figé sur l'appareil : quand Netlify l'a servi un temps
 * en `application/octet-stream`, corriger le serveur ne suffisait plus. Il fallait
 * changer la version du cache ET recharger DEUX fois — le premier chargement sert
 * encore l'ancien pendant que le nouveau service worker s'installe.
 *
 * Deux chargements pour propager une correction, c'est déjà trop ; se le rappeler
 * six mois plus tard, c'est impossible. Réseau d'abord, le cache ne sert que hors
 * ligne, et une correction arrive au chargement suivant. Le fichier fait cinq cents
 * octets : il n'y avait rien à économiser.
 */
const MANIFEST = '/manifest.webmanifest'

function isAsset(pathname) {
  return ASSET_PREFIXES.some((p) => pathname.startsWith(p)) || ASSET_FILES.includes(pathname)
}

// Ne met en cache que ce qui est réellement servable. Une réponse d'erreur ou
// une REDIRECTION mise en cache rendait l'application inaccessible durablement :
// servie à une navigation, la redirection repart sur la même URL, le SW la
// ressert… jusqu'à ERR_TOO_MANY_REDIRECTS, et le rechargement n'y changeait rien
// puisque la réponse fautive venait du cache.
function cacheable(res) {
  return !!res && res.ok && !res.redirected && res.type === 'basic'
}

function put(request, res) {
  if (!cacheable(res)) return
  const copy = res.clone()
  caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => { /* quota */ })
}

self.addEventListener('install', (e) => {
  // Un échec de mise en cache ne doit pas faire échouer l'installation, sinon le
  // SW ne s'active jamais et la page dépend d'un cache qui n'existera pas.
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => fetch(SHELL).then((res) => (cacheable(res) ? c.put(SHELL, res) : undefined)))
      .catch(() => { /* hors-ligne à l'install */ })
  )
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('sport-') && k !== CACHE).map((k) => caches.delete(k)))
    )
      .then(() => self.clients.claim())
      /*
       * Prévenir les pages OUVERTES qu'elles tournent sur la version d'avant.
       *
       * `claim()` ne recharge rien : l'onglet garde le JavaScript qu'il a déjà, et
       * ses morceaux à charger plus tard viennent d'être supprimés du cache. On ne
       * recharge pas d'autorité — une séance peut être en cours, et perdre une série
       * pour une mise à jour serait un mauvais échange. On le DIT, et la personne
       * recharge quand ça l'arrange.
       */
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then((list) => { for (const c of list) c.postMessage({ type: 'maj', version: VERSION }) })
      .catch(() => { /* rien d'ouvert */ })
  )
})

// Clic sur la notification de fin de repos : on ramène l'utilisateur sur l'app.
self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if (new URL(c.url).origin === self.location.origin && 'focus' in c) return c.focus()
      }
      if (self.clients.openWindow) return self.clients.openWindow(SHELL)
    })
  )
})

// Navigation : réseau d'abord, cache en repli. Le HTML référence des assets
// _nuxt dont le nom est haché ; servir un HTML périmé après un déploiement fait
// pointer la page vers des fichiers qui n'existent plus et l'app ne démarre pas.
// Le cache ne sert donc que hors-ligne, ou si le réseau traîne au-delà du délai.
function navigate(request) {
  return new Promise((resolve) => {
    let settled = false
    const done = (r) => { if (!settled) { settled = true; resolve(r) } }
    const fallback = () => caches.match(SHELL).then((cached) => (cached ? done(cached) : undefined))
    const timer = setTimeout(fallback, NAV_TIMEOUT_MS)
    fetch(request)
      .then((res) => {
        clearTimeout(timer)
        put(SHELL, res)
        done(res)
      })
      .catch(() => {
        clearTimeout(timer)
        caches.match(SHELL).then((cached) => done(cached || Response.error()))
      })
  })
}

/** Réseau d'abord, cache en repli : pour ce qui doit rester frais mais survivre hors ligne. */
function reseauDAbord(request) {
  return fetch(request)
    .then((res) => { put(request, res); return res })
    .catch(() => caches.match(request).then((c) => c || Response.error()))
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return

  if (e.request.mode === 'navigate') {
    e.respondWith(navigate(e.request))
    return
  }

  if (url.pathname === MANIFEST) {
    e.respondWith(reseauDAbord(e.request))
    return
  }

  // Un build produit des noms hachés, donc immuables : le cache d'abord est sûr.
  // En développement, Vite sert les SOURCES sous leur vrai chemin
  // (/_nuxt/utils/monFichier.ts) : les mettre en cache fige l'application sur une
  // version morte, et un fichier renommé continue d'être servi après sa disparition.
  // On ne met donc jamais en cache un chemin qui ressemble à un fichier source.
  const isSource = /\.(?:ts|tsx|vue|jsx|mjs|css|scss)(?:\?|$)/.test(url.pathname + url.search)
  if (isSource) return

  // Assets (_nuxt, images d'exercices, icônes, manifeste) : cache d'abord,
  // réseau en cas d'absence. Changer la version du cache suffit à repartir propre.
  if (isAsset(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then((cached) => {
        if (cached) return cached
        return fetch(e.request).then((res) => {
          put(e.request, res)
          return res
        })
      })
    )
  }
})
