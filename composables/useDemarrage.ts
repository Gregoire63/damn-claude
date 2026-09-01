import { computed, ref } from 'vue'
import { useProfile } from '~/composables/useProfile'
import { useProgram } from '~/composables/useProgram'
import { useConnecteurs } from '~/composables/useConnecteur'
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
  const conn = useConnecteurs()

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
   * Rejouer le parcours.
   *
   * Il ne revient jamais de lui-même : une fois les quatre étapes réglées, l'écran
   * disparaît, et c'est voulu — une liste de tâches finie qui se raccroche à l'accueil
   * est une nuisance. Mais on a besoin de le revoir : pour brancher une balance
   * achetée depuis, pour poser un passkey sur un second navigateur, ou simplement
   * pour vérifier ce qu'on fait avaler à quelqu'un qui installe le dépôt.
   *
   * Seuls les « passées » sont effacés — c'est-à-dire les décisions de reporter. Rien
   * de ce qui est réellement fait n'est défait : le profil, le passkey et le programme
   * restent, et leurs étapes se rouvrent déjà cochées.
   */
  function rejouer() {
    passees.value = []
    if (import.meta.client) {
      try { localStorage.removeItem(PASSEES_KEY) }
      catch { /* stockage refusé : le parcours se rejoue quand même, sans mémoire */ }
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
  /** Combien de marques réellement branchées. Zéro tant qu'on n'a rien connecté. */
  const branchees = computed(() => conn.branchees.value.length)

  const profilComplet = computed(() =>
    !!profile.value.heightCm && !!profile.value.sex && !!profile.value.birthYear && bodyWeight.value.length > 0)

  const etapes = computed(() => ([
    {
      id: 'toi' as EtapeId,
      titre: 'Profil',
      sous: 'Prénom, sexe, taille, année de naissance, poids',
      faite: profilComplet.value,
      // La seule bloquante : tout le reste de l'application en dépend.
      bloquante: true,
    },
    {
      id: 'claude' as EtapeId,
      titre: 'Claude',
      sous: 'Sécuriser l’accès, puis brancher le connecteur',
      faite: vault.state.value.registered,
      bloquante: false,
    },
    {
      id: 'capteurs' as EtapeId,
      titre: 'Connecteurs',
      /*
       * L'étape se coche quand une marque est branchée — et elle DIT combien.
       *
       * `faite` valait `false`, écrit en dur : l'étape ne pouvait donc jamais se
       * cocher. On branchait sa balance, on revenait, et le rond restait vide. Il
       * n'y a pas de doute plus décourageant sur un parcours d'installation : ou
       * bien la connexion a échoué, ou bien l'écran ment, et rien ne permet de
       * trancher.
       *
       * L'intention était pourtant déjà écrite juste au-dessus — « brancher une
       * marque, ou dire qu'on n'en a pas ». Seule la première moitié manquait.
       */
      sous: branchees.value
        ? `${branchees.value} ${branchees.value > 1 ? 'appareils branchés' : 'appareil branché'}`
        : 'Balance ou montre. Facultatif.',
      faite: branchees.value > 0,
      bloquante: false,
    },
    {
      id: 'remplir' as EtapeId,
      titre: 'Contenu',
      sous: 'Programme et nutrition, par Claude ou depuis l’exemple',
      faite: program.value.length > 0,
      bloquante: false,
    },
  ]).map(e => ({ ...e, passee: passees.value.includes(e.id), reglee: e.faite || passees.value.includes(e.id) })))

  const restantes = computed(() => etapes.value.filter(e => !e.reglee))
  const progression = computed(() => etapes.value.filter(e => e.reglee).length)
  /** Tant que le profil manque, le reste de l'accueil n'aurait que des tirets à montrer. */
  const bloque = computed(() => !profilComplet.value)
  const fini = computed(() => restantes.value.length === 0)

  return { hydrate, etapes, restantes, progression, bloque, fini, passer, rejouer, passees }
}
