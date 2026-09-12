import { ref } from 'vue'

// ─────────────────────────────────────────────────────────────────────────────
// Le bandeau qui dit ce qui vient de se passer.
// ─────────────────────────────────────────────────────────────────────────────
//
// Trois lignes, mais elles doivent vivre hors des composants : c'est la coque qui
// AFFICHE le message, et la séance ou le coffre qui le DÉCLENCHENT. Passer la
// fonction en propriété d'un écran à l'autre aurait traversé quatre niveaux pour
// une chaîne de caractères.
//
// État au niveau du module, comme le reste de l'application : deux appelants
// obtiennent le même bandeau, et le dernier message gagne — ce qui est exactement
// ce qu'on veut, personne ne lit deux notifications empilées.

/**
 * Le ton du bandeau.
 *
 * Il était vert quoi qu'il arrive. Un import qui échoue affichait donc un message
 * d'erreur sur fond de réussite — et « Fichier invalide » en vert se lit de loin
 * comme « c'est bon ». La couleur porte la moitié du message ; la donner fausse est
 * pire que ne rien afficher.
 */
export type FlashTon = 'ok' | 'echec'

/**
 * Le bouton du bandeau — « Annuler », et rien d'autre pour l'instant.
 *
 * Une suppression a besoin d'être rattrapable là où elle vient de se produire. Une
 * confirmation avant ne suffit pas : on l'a lue, on a dit oui, et c'est une seconde
 * plus tard qu'on se rend compte. Le seul endroit où l'annulation se trouve sans
 * réfléchir est l'endroit où l'application vient d'annoncer l'acte.
 */
export interface ActionFlash { label: string, run: () => void }

const message = ref('')
const ton = ref<FlashTon>('ok')
const action = ref<ActionFlash | null>(null)
let minuteur: ReturnType<typeof setTimeout> | null = null

export function useFlash() {
  /**
   * Affiche un message. Un nouvel appel remplace le précédent.
   *
   * La durée suit le texte : trois secondes pour « Séance enregistrée », six pour un
   * bilan d'import ou une erreur. Un compte-rendu de quinze mots qui disparaît en
   * trois secondes n'est pas lu, il est aperçu — et c'est précisément celui qu'il
   * faut lire.
   */
  function showFlash(texte: string, tonalite: FlashTon = 'ok', act: ActionFlash | null = null) {
    message.value = texte
    ton.value = tonalite
    action.value = act
    if (minuteur) clearTimeout(minuteur)
    // Un bandeau qui porte un bouton tient plus longtemps : il faut lire, décider et
    // viser. Trois secondes suffisent à annoncer, pas à rattraper.
    const duree = act || tonalite === 'echec' || texte.length > 40 ? 6000 : 3000
    minuteur = setTimeout(cacher, duree)
  }
  function cacher() {
    message.value = ''
    action.value = null
    if (minuteur) { clearTimeout(minuteur); minuteur = null }
  }
  /** Déclenche l'action et referme : un « Annuler » qui reste affiché invite à re-cliquer. */
  function lancerAction() {
    const a = action.value
    cacher()
    a?.run()
  }
  return { flash: message, flashTon: ton, flashAction: action, showFlash, lancerAction, cacherFlash: cacher }
}
