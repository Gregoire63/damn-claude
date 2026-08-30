import { onScopeDispose, watch } from 'vue'
import type { Ref } from 'vue'
import { pushBack } from './useBackStack'

// ─────────────────────────────────────────────────────────────────────────────
// Détourner le geste « retour » sur une CONDITION, et non sur un composant.
// ─────────────────────────────────────────────────────────────────────────────
//
// Les feuilles et les fenêtres passent par `useOverlay` : elles s'inscrivent en se
// montant, se retirent en se démontant, il n'y a rien à écrire. Mais tout ce qui se
// ferme au retour n'est pas un composant qui naît et meurt. Un onglet ouvert est un
// `ref` qui change de valeur ; la feuille de séance est un panneau toujours présent
// dans le gabarit, qu'un booléen fait monter et descendre ; une carte de
// confirmation est un `v-if` sur une variable de la page.
//
// D'où cette forme : on donne une condition et une action. Tant que la condition est
// vraie, le retour exécute l'action au lieu de quitter l'application.
//
// L'ordre est celui de l'INSCRIPTION, pas de la déclaration. Une carte qui s'ouvre
// par-dessus une feuille s'inscrit après elle, donc se ferme avant : c'est ce que
// l'utilisateur voit, et c'est ce qu'il attend.
//
// Il n'y a délibérément PAS de `beforeunload` ici. Il avertissait avant un
// rechargement ou une fermeture, pour une perte qui n'arrive pas : le brouillon
// persiste la séance entière — séries, ressentis, notes, machine choisie — et
// jusqu'à l'identifiant de la séance en cours de modification. Un avertissement qui
// ne protège de rien finit par s'apprendre comme du bruit.

/**
 * Détourne le geste « retour » tant que `active` est vrai.
 *
 * @param active La condition. Fausse, le retour reprend son cours normal — et il
 *   faut qu'il puisse le reprendre : une application dont on ne sort jamais est
 *   aussi cassée qu'une application qu'on quitte par accident.
 * @param onBack Ce que « retour » déclenche. Peut refermer quelque chose, ou ouvrir
 *   une confirmation : la garde se réarme dans les deux cas.
 */
export function useBackGuard(active: Ref<boolean>, onBack: () => void) {
  let release: (() => void) | null = null

  const set = (on: boolean) => {
    if (on && !release) release = pushBack(onBack)
    else if (!on && release) { release(); release = null }
  }

  if (import.meta.client) {
    watch(active, set, { immediate: true })
    onScopeDispose(() => set(false))
  }
}
