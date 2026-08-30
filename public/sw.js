// Service worker de l'application — cache hors-ligne du suivi.
// Servi depuis la racine du domaine, il a donc le scope racine par défaut :
// aucun en-tête `Service-Worker-Allowed` n'est nécessaire.
/*
 * La VERSION du cache est le seul bouton qui purge un téléphone à distance.
 *
 * `activate` supprime tout cache `sport-*` qui n'est pas le courant : changer ce
 * numéro jette d'un coup les coquilles HTML et les assets d'avant. À faire chaque
 * fois qu'un changement doit atteindre un appareil qui a déjà visité le site et
 * que le réseau seul ne suffirait pas à corriger — le manifeste et les icônes sont
 * servis CACHE D'ABORD, donc figés jusqu'ici pour toujours.
 *
 * v2 : le manifeste avait été mis en cache alors que Netlify le servait en
 * `application/octet-stream`, c'est-à-dire ignoré par le navigateur.
 */
const CACHE = 'sport-v2'
const SHELL = '/'
const NAV_TIMEOUT_MS = 3000

// Ce qui est mis en cache d'office, en plus de _nuxt/. Une liste explicite et
// non un préfixe : `/` engloberait /api/**, et une réponse d'API figée dans le
// cache est bien pire qu'une absence de cache.
const ASSET_PREFIXES = ['/_nuxt/', '/exercises/', '/_fonts/']
const ASSET_FILES = ['/icon-192.png', '/icon-512.png', '/manifest.webmanifest']

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
    ).then(() => self.clients.claim())
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

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return

  if (e.request.mode === 'navigate') {
    e.respondWith(navigate(e.request))
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
