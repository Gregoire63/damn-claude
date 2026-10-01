import { computed, ref } from 'vue'
import type { Echec, EchecNouveau, Poste } from '~/lib/journal'
import { elaguer, lireJournal, noterEchec, oublierEchecs } from '~/lib/journal'

// ─────────────────────────────────────────────────────────────────────────────
// Le registre des échecs, côté application.
// ─────────────────────────────────────────────────────────────────────────────
//
// État de module, comme le foyer : l'écran de la boîte de réception, la cloche et le
// miroir lisent le MÊME journal. Deux copies se contrediraient au premier relevé
// raté, et c'est précisément le genre de divergence qu'on cherche à rendre visible.
//
// Le stockage est volontairement local et minuscule. Il n'y a pas d'envoi immédiat
// vers le serveur : l'échec le plus utile à enregistrer est justement celui où le
// serveur est injoignable, et un journal qui a besoin du réseau pour noter une panne
// de réseau ne note rien. Il part donc avec la sauvegarde, au prochain envoi qui
// réussit — ce qui arrive toujours, et explique le silence après coup.

const CLE = 'gr-erreurs-v1'
const echecs = ref<Echec[]>([])
let charge = false

function ecrire() {
  if (!import.meta.client) return
  try { localStorage.setItem(CLE, JSON.stringify(echecs.value)) }
  catch { /* stockage refusé : le journal vaut pour cette session, et c'est déjà ça */ }
}

export function useJournal() {
  function hydrate() {
    if (charge || !import.meta.client) return
    charge = true
    try { echecs.value = elaguer(lireJournal(JSON.parse(localStorage.getItem(CLE) || '[]')), new Date().toISOString()) }
    catch { echecs.value = [] }
  }
  if (import.meta.client) hydrate()

  /**
   * Noter un échec.
   *
   * Ne lève jamais : elle est appelée depuis des `catch`, et un journal qui échoue
   * en enregistrant un échec transformerait une panne lisible en page blanche.
   */
  function noter(e: EchecNouveau) {
    try {
      echecs.value = noterEchec(echecs.value, e, new Date().toISOString())
      ecrire()
    }
    catch { /* rien à faire de plus : on ne casse pas l'appelant pour un registre */ }
  }

  /** Ce qui est réglé s'efface — c'est le nettoyage demandé depuis une conversation. */
  function oublier(postes: Poste[], avant?: string) {
    echecs.value = oublierEchecs(echecs.value, postes, avant)
    ecrire()
  }

  function viderJournal() {
    echecs.value = []
    ecrire()
  }

  /** Pour la sauvegarde et le miroir. */
  const snapshot = () => ({ erreurs: echecs.value })

  function restore(brut: unknown) {
    echecs.value = lireJournal(brut)
    ecrire()
  }

  const dernierEchec = computed<Echec | null>(() => echecs.value.at(-1) ?? null)
  const echecsDe = (poste: Poste) => echecs.value.filter(e => e.poste === poste)

  return { echecs, noter, oublier, viderJournal, snapshot, restore, hydrate, dernierEchec, echecsDe }
}
