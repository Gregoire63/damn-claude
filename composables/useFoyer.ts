import { computed, ref } from 'vue'
import type { Convive } from '~/lib/foyer'
import { borner, facteurConvives, idConvive, libelleConvives, MOI, normaliserConvives } from '~/lib/foyer'

// ─────────────────────────────────────────────────────────────────────────────
// Qui mange à la maison.
// ─────────────────────────────────────────────────────────────────────────────
//
// Tout le module nutrition compte en portions, et une portion c'est la sienne.
// Cuisiner à deux se réglait donc en multipliant par deux — sauf que deux personnes
// ne mangent presque jamais pareil. Un convive porte un appétit relatif au sien, et
// les quantités suivent la somme de ceux qui sont au repas.
//
// L'état vit au niveau du module, comme le reste : la fiche de recette, la liste de
// courses et la préparation à l'avance lisent le MÊME foyer. Cocher quelqu'un avant
// de cuisiner doit se voir partout, sinon on pèse pour deux et on achète pour un.

const CLE = 'gr-foyer-v1'
const convives = ref<Convive[]>([MOI])
let charge = false

function ecrire() {
  if (!import.meta.client) return
  // « Moi » n'est pas rangé : il est réinjecté à la lecture. Le stocker inviterait à
  // le modifier dans le stockage, alors que c'est l'unité de compte de tout le reste.
  try { localStorage.setItem(CLE, JSON.stringify(convives.value.filter(c => c.id !== MOI.id))) }
  catch { /* stockage refusé : le foyer reste valable pour cette session */ }
}

export function useFoyer() {
  function hydrate() {
    if (charge || !import.meta.client) return
    charge = true
    try { convives.value = normaliserConvives(JSON.parse(localStorage.getItem(CLE) || '[]')) }
    catch { convives.value = [MOI] }
  }
  if (import.meta.client) hydrate()

  /** Ce par quoi multiplier les quantités à peser et à acheter. */
  const facteur = computed(() => facteurConvives(convives.value))
  /** Vrai dès que quelqu'un d'autre est au repas : ce qui déclenche l'affichage. */
  const aDuMonde = computed(() => facteur.value !== 1 || convives.value.length > 1)
  const libelle = computed(() => libelleConvives(convives.value))

  function ajouter(nom: string, appetit = 1): boolean {
    const propre = nom.trim().slice(0, 24)
    if (!propre || convives.value.length >= 9) return false
    convives.value = [...convives.value, {
      id: idConvive(propre, convives.value), nom: propre, appetit: borner(appetit), actif: true,
    }]
    ecrire()
    return true
  }

  /** « Moi » ne se modifie pas : c'est l'unité dans laquelle tout le reste est écrit. */
  function modifier(id: string, champs: Partial<Pick<Convive, 'nom' | 'appetit' | 'actif'>>): void {
    if (id === MOI.id) return
    convives.value = convives.value.map(c => (c.id === id
      ? {
          ...c,
          ...(champs.nom !== undefined ? { nom: champs.nom.trim().slice(0, 24) || c.nom } : {}),
          ...(champs.appetit !== undefined ? { appetit: borner(champs.appetit) } : {}),
          ...(champs.actif !== undefined ? { actif: champs.actif } : {}),
        }
      : c))
    ecrire()
  }

  function retirer(id: string): void {
    if (id === MOI.id) return
    convives.value = convives.value.filter(c => c.id !== id)
    ecrire()
  }

  /** Remplace tout le foyer d'un coup — ce que fait une restauration ou un import. */
  function remplacer(brut: unknown): void {
    convives.value = normaliserConvives(brut)
    ecrire()
  }

  return { convives, facteur, aDuMonde, libelle, hydrate, ajouter, modifier, retirer, remplacer }
}
