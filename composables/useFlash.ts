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

const message = ref('')
const ton = ref<FlashTon>('ok')
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
  function showFlash(texte: string, tonalite: FlashTon = 'ok') {
    message.value = texte
    ton.value = tonalite
    if (minuteur) clearTimeout(minuteur)
    const duree = tonalite === 'echec' || texte.length > 40 ? 6000 : 3000
    minuteur = setTimeout(() => { message.value = ''; minuteur = null }, duree)
  }
  return { flash: message, flashTon: ton, showFlash }
}
