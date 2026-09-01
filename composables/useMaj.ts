import { ref } from 'vue'

// ─────────────────────────────────────────────────────────────────────────────
// La mise à jour de l'application installée.
// ─────────────────────────────────────────────────────────────────────────────
//
// Une application posée sur l'écran d'accueil n'a pas de barre d'adresse, pas de
// bouton « recharger », et le tiré-pour-rafraîchir est coupé (`overscroll-behavior`,
// sans quoi tirer une liste vers le bas rechargerait la page en pleine saisie). Il
// ne reste donc AUCUN geste pour aller chercher une nouvelle version : c'est au code
// de le faire.
//
// Trois choses, et il en manquait trois :
//
//  1. l'URL du service worker porte la version du build, donc chaque déploiement est
//     un nouveau service worker aux yeux du navigateur, qui l'installe et purge les
//     caches d'avant (voir public/sw.js) ;
//  2. on redemande au navigateur de vérifier quand l'application REVIENT à l'écran —
//     sinon une application jamais fermée ne vérifie jamais ;
//  3. quand la nouvelle version prend la main, on le dit au lieu de recharger dans
//     le dos de quelqu'un qui est peut-être au milieu d'une série.

/** Vrai quand une nouvelle version est installée et n'attend qu'un rechargement. */
export const majDisponible = ref(false)

/** La version qui tourne dans cet onglet. Affichée dans les réglages. */
export function versionCourante(): string {
  return useRuntimeConfig().public.version || 'inconnue'
}

/** L'URL d'enregistrement. Exportée pour être vérifiable sans navigateur. */
export function urlDuServiceWorker(version: string): string {
  return `/sw.js?v=${encodeURIComponent(version)}`
}

export function useMaj() {
  /**
   * Installe le service worker — PRODUCTION UNIQUEMENT.
   *
   * En développement, Vite sert les sources sous leur vrai chemin : les mettre en
   * cache fige l'application sur une version morte, et un fichier renommé continue
   * d'être servi après sa disparition. On désinscrit donc, et on purge, sinon un
   * service worker installé une seule fois sabote tous les rechargements suivants.
   */
  function installer(dev: boolean) {
    if (!('serviceWorker' in navigator)) return

    if (dev) {
      navigator.serviceWorker.getRegistrations()
        .then(rs => Promise.all(rs.map(r => r.unregister())))
        .then(() => (typeof caches !== 'undefined' ? caches.keys() : Promise.resolve([])))
        .then(keys => Promise.all(keys.filter(k => k.startsWith('sport-')).map(k => caches.delete(k))))
        .catch(() => { /* rien à désinscrire */ })
      return
    }

    const version = versionCourante()
    navigator.serviceWorker.register(urlDuServiceWorker(version), { scope: '/' })
      .then((reg) => {
        // Le navigateur ne vérifie de lui-même qu'au chargement d'une page. Une
        // application restée ouverte trois jours sur un téléphone n'a donc jamais
        // rien vérifié. On le demande à chaque retour à l'écran ; c'est gratuit
        // quand il n'y a rien de neuf (une requête conditionnelle sur un fichier
        // de trois kilos).
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') reg.update().catch(() => {})
        })
      })
      .catch(() => { /* pas de service worker : l'application marche sans */ })

    // Le service worker dit lui-même qu'il a pris la main (voir son `activate`).
    navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
      if (e.data?.type === 'maj' && e.data.version !== versionCourante()) majDisponible.value = true
    })
    // Ceinture et bretelles : `controllerchange` part aussi quand le message se
    // perd — un onglet en arrière-plan peut manquer le `postMessage`.
    navigator.serviceWorker.addEventListener('controllerchange', () => { majDisponible.value = true })
  }

  /** Recharge pour appliquer la version installée. */
  function recharger() {
    majDisponible.value = false
    location.reload()
  }

  return { majDisponible, installer, recharger, version: versionCourante }
}
