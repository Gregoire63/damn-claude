import { computed, ref } from 'vue'
import { useProfile } from '~/composables/useProfile'
import { useProgram } from '~/composables/useProgram'
import { useVault } from '~/composables/useVault'
import { useWorkout } from '~/composables/useWorkout'

/**
 * Le parcours d'installation : ce qu'il faut avoir posé pour que l'application dise
 * la vérité.
 *
 * L'accueil ne proposait que deux boutons — faire remplir par Claude, ou charger
 * l'exemple. Ils règlent le CONTENU, et laissent de côté tout ce dont les calculs
 * dépendent : sans taille, sexe et année de naissance, le métabolisme de base
 * n'existe pas, et la cible calorique affichée est fausse. Fausse sans le dire, ce
 * qui est la pire façon de l'être : une cible trop haute ne se remarque pas, elle
 * se mange.
 *
 * D'où quatre étapes, et une seule qui barre la route.
 */
export type EtapeId = 'toi' | 'claude' | 'capteurs' | 'remplir'

const PASSEES_KEY = 'gr-demarrage-v1'

const passees = ref<EtapeId[]>([])
let hydrated = false

export function useDemarrage() {
  const { profile } = useProfile()
  const { bodyWeight } = useWorkout()
  const { program } = useProgram()
  const vault = useVault()

  function hydrate() {
    if (hydrated || !import.meta.client) return
    try {
      const brut = JSON.parse(localStorage.getItem(PASSEES_KEY) || '[]')
      if (Array.isArray(brut)) passees.value = brut.filter(x => typeof x === 'string') as EtapeId[]
    }
    catch { /* stockage indisponible ou illisible : on repart d'un parcours neuf */ }
    hydrated = true
  }

  function passer(id: EtapeId) {
    if (!passees.value.includes(id)) passees.value = [...passees.value, id]
    if (import.meta.client) {
      try { localStorage.setItem(PASSEES_KEY, JSON.stringify(passees.value)) }
      catch { /* stockage plein ou refusé : l'étape se reproposera, sans dommage */ }
    }
  }

  /**
   * « Faite » se DÉDUIT de l'état réel, elle ne se coche pas.
   *
   * Une case cochée est une affirmation qui peut mentir : elle survit à un import
   * qui a tout remplacé, à une réinitialisation, à un changement d'appareil. Lire
   * l'état réel coûte trois comparaisons et ne peut pas se désynchroniser.
   *
   * `capteurs` fait exception, et c'est délibéré : se peser à la main est une
   * réponse légitime, pas un manque. Cette étape ne se termine donc que par un choix
   * explicite — brancher une marque, ou dire qu'on n'en a pas.
   */
  const profilComplet = computed(() =>
    !!profile.value.heightCm && !!profile.value.sex && !!profile.value.birthYear && bodyWeight.value.length > 0)

  const etapes = computed(() => ([
    {
      id: 'toi' as EtapeId,
      titre: 'Toi',
      sous: 'Prénom, sexe, taille, année de naissance, premier poids',
      faite: profilComplet.value,
      // La seule bloquante : tout le reste de l'application en dépend.
      bloquante: true,
    },
    {
      id: 'claude' as EtapeId,
      titre: 'Claude',
      sous: 'Le passkey, puis le connecteur à brancher dans Claude',
      faite: vault.state.value.registered,
      bloquante: false,
    },
    {
      id: 'capteurs' as EtapeId,
      titre: 'Balance et pas',
      sous: 'Ou la saisie à la main, qui est un choix comme un autre',
      faite: false,
      bloquante: false,
    },
    {
      id: 'remplir' as EtapeId,
      titre: 'Remplir',
      sous: 'Ton programme et ta nutrition, par Claude ou depuis l’exemple',
      faite: program.value.length > 0,
      bloquante: false,
    },
  ]).map(e => ({ ...e, passee: passees.value.includes(e.id), reglee: e.faite || passees.value.includes(e.id) })))

  const restantes = computed(() => etapes.value.filter(e => !e.reglee))
  const progression = computed(() => etapes.value.filter(e => e.reglee).length)
  /** Tant que le profil manque, le reste de l'accueil n'aurait que des tirets à montrer. */
  const bloque = computed(() => !profilComplet.value)
  const fini = computed(() => restantes.value.length === 0)

  return { hydrate, etapes, restantes, progression, bloque, fini, passer, passees }
}
