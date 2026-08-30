import { computed, onScopeDispose, ref } from 'vue'

// ─────────────────────────────────────────────────────────────────────────────
// Une seule horloge pour toute l'application.
// ─────────────────────────────────────────────────────────────────────────────
//
// Chaque écran lisait l'heure à sa façon, une fois pour toutes, au moment de sa
// création : `const nowHour = new Date().getHours()`. Ça paraît anodin et ça ne
// l'est pas, parce que les écrans ne naissent pas au même instant.
//
// L'accueil est monté une fois et reste là toute la journée. La feuille des repas,
// elle, se recrée à chaque ouverture. Passé 15 h — le seuil au-delà duquel une
// séance non enregistrée est considérée comme manquée — les deux ne répondaient
// donc plus la même chose à « suis-je allé à la salle aujourd'hui ». L'un
// construisait la journée avec les créneaux de SALLE, l'autre avec ceux de REPOS.
//
// Or ce ne sont pas les mêmes créneaux : la banane de 11 h 45 n'existe que les jours
// de salle, et le déjeuner est à 13 h 45 d'un côté, 12 h 30 de l'autre. L'accueil
// pouvait donc mettre en avant un repas qui n'apparaissait nulle part dans la
// feuille — et son bouton « ✓ Mangé » cochait un créneau que l'autre écran ne
// savait pas afficher.
//
// D'où cette horloge partagée : une valeur au niveau du module, que tout le monde
// lit et que personne ne fige. Deux écrans qui posent la même question à la même
// seconde obtiennent forcément la même réponse.

/** Minutes écoulées depuis minuit. Le tout premier calcul se fait à l'import. */
const nowMin = ref(minutesNow())

function minutesNow(): number {
  const d = new Date()
  return d.getHours() * 60 + d.getMinutes()
}

let timer: ReturnType<typeof setInterval> | null = null
let clients = 0

/**
 * Toutes les minutes, et à chaque retour au premier plan.
 *
 * Le retour au premier plan compte autant que le minuteur : un téléphone met en
 * veille les minuteurs des onglets cachés. Sans lui, une application laissée
 * ouverte tout l'après-midi rouvrait le soir avec l'heure du midi — exactement le
 * gel qu'on cherche à supprimer, déplacé d'un cran.
 */
function start() {
  if (timer || !import.meta.client) return
  const tick = () => { nowMin.value = minutesNow() }
  timer = setInterval(tick, 60_000)
  document.addEventListener('visibilitychange', tick)
  window.addEventListener('focus', tick)
}

export function useNow() {
  if (import.meta.client) {
    clients++
    start()
    // On ne coupe jamais le minuteur : il coûte un réveil par minute, et l'arrêter
    // au dernier démontage rouvrirait la porte au gel qu'on vient de fermer. Le
    // compteur ne sert qu'au diagnostic.
    onScopeDispose(() => { clients-- })
  }
  return {
    /** Minutes depuis minuit, tenu à jour. */
    nowMin,
    /** L'heure seule, pour les seuils qui raisonnent en heures. */
    nowHour: computed(() => Math.floor(nowMin.value / 60)),
  }
}
