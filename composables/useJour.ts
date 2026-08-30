import { computed, ref } from 'vue'

// ─────────────────────────────────────────────────────────────────────────────
// La date du jour, lue une fois, partagée par tout le monde.
// ─────────────────────────────────────────────────────────────────────────────
//
// Elle vivait dans la page, en `ref` remplie au montage. Depuis que les onglets sont
// des pages distinctes, chacune serait repartie de `null` à son montage — donc un
// rendu vide, puis un saut, à chaque changement d'onglet.
//
// Au niveau du module, elle est calculée au premier montage et plus jamais après.
// `null` avant l'hydratation, et c'est volontaire : sur le serveur il n'y a pas de
// fuseau horaire de l'utilisateur, et une date de serveur affichée puis corrigée
// vaut moins qu'un blanc d'un dixième de seconde.

const todayDow = ref<number | null>(null)
const todayISO = ref<string | null>(null)

const p2 = (n: number) => String(n).padStart(2, '0')

export function useJour() {
  /** À appeler au montage de la coque. Idempotent : les appels suivants ne font rien. */
  function hydrateJour() {
    if (!import.meta.client || todayISO.value) return
    const now = new Date()
    todayDow.value = now.getDay()
    // Construit à la main plutôt qu'avec toISOString : celui-ci convertit en UTC, et
    // à 23 h passé le décalage donnait la date du lendemain.
    todayISO.value = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`
  }
  return {
    todayDow,
    todayISO,
    /** Lundi = 0. L'affichage part du lundi, `getDay()` part du dimanche. */
    todayIndex: computed(() => (todayDow.value === null ? null : (todayDow.value + 6) % 7)),
    hydrateJour,
  }
}
