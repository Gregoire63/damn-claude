import { messageErreur } from '~/lib/erreurs'
import { useFoyer } from '~/composables/useFoyer'
import { computed, ref } from 'vue'
import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import type { RawProposal } from '~/lib/proposals'
import { planFor } from '~/lib/proposals'
import { useNutrition } from '~/composables/useNutrition'
import { useTraining } from '~/composables/useTraining'
import { useWorkout } from '~/composables/useWorkout'
import { useProfile } from '~/composables/useProfile'
import { useProgram } from '~/composables/useProgram'
import { useRestTimer } from '~/composables/useRestTimer'
import { useMesures } from '~/composables/useMesures'
import { useSnapshot } from '~/composables/useSnapshot'
import { createAt, pushAt, removeAt, setAt as setPointer } from '~/lib/pointer'

// ─────────────────────────────────────────────────────────────────────────────
// Le côté téléphone du coffre.
// ─────────────────────────────────────────────────────────────────────────────
//
// Trois responsabilités, et une seule règle qui les relie : le téléphone reste la
// source de vérité.
//
//  1. Se déverrouiller — passkey, donc biométrie. Rien à retenir, rien à taper.
//  2. Pousser un miroir de ses données, pour que le connecteur ait quelque chose à
//     lire. C'est aussi la sauvegarde automatique qui manquait : l'export manuel
//     existait, mais il fallait y penser.
//  3. Relever les propositions déposées par Claude et les appliquer — seulement
//     celles dont la forme est reconnue, et seulement sur validation.
//
// Ce qui n'est PAS ici, et c'est important : aucune fusion. Le serveur ne renvoie
// jamais de données à réintégrer. Il renvoie des propositions, que l'utilisateur
// accepte ou refuse. Il n'existe donc aucun cas où deux versions d'une séance
// doivent être arbitrées.

export interface VaultAppareil { id: string, label: string, at: string }

export interface VaultState {
  connected: boolean
  registered: boolean
  /**
   * Le code de démarrage est-il encore ARMÉ ?
   *
   * Ce n'est plus « la variable existe-t-elle » : le code se brûle à l'usage. Un
   * écran qui propose de le saisir alors qu'il est consommé envoie chercher une
   * faute de frappe qui n'existe pas.
   */
  bootstrapReady: boolean
  /** D'où il vient : « build » = journal de déploiement, « env » = variable posée à la main. */
  bootstrapSource?: 'build' | 'env'
  /** Combien de passkeys. Un seul veut dire : aucun secours en cas de perte. */
  passkeys: number
  appareils: VaultAppareil[]
  /** À qui appartient cette instance. Vide = anonyme, ce qui est un état valable. */
  ownerName: string
}

const state = ref<VaultState>({ connected: false, registered: false, bootstrapReady: false, passkeys: 0, appareils: [], ownerName: '' })
const pending = ref<RawProposal[]>([])
const recent = ref<RawProposal[]>([])
const mirrorAt = ref<string | null>(null)
const busy = ref(false)
const error = ref<string | null>(null)
let hydrated = false

const LAST_PUSH_KEY = 'gr-vault-push-v1'
/** En dessous, on ne repousse pas : le miroir n'a pas à suivre chaque frappe. */
const PUSH_MIN_INTERVAL_MS = 5 * 60 * 1000

// Le message d'erreur montré à l'écran : voir lib/erreurs.ts.
const message = messageErreur

export function useVault() {
  const nutrition = useNutrition()
  const training = useTraining()
  const workout = useWorkout()
  const profileStore = useProfile()
  const program = useProgram()
  const restTimer = useRestTimer()
  const foyer = useFoyer()
  const mesures = useMesures()
  const { buildSnapshot } = useSnapshot()

  /**
   * Ce que le validateur doit savoir du monde réel.
   *
   * Les deux lecteurs de valeurs (`setAt`, `weightAt`) ne sont pas là pour afficher :
   * ils servent à REFUSER une correction dont la valeur de départ ne correspond pas
   * à ce qui est réellement stocké. C'est ce contrôle qui rend acceptable d'écrire
   * par-dessus une donnée qu'on ne pourra pas reconstituer.
   */
  const ctx = {
    recipeKnown: (id: string) => !!nutrition.library.value.recipes[id],
    foodKnown: (id: string) => !!nutrition.library.value.foods[id],
    setAt: workout.setAt,
    weightAt: workout.weightAt,
    snapshot: buildSnapshot,
    sessionKnown: (id: string) => !!program.sessionById(id),
    // Retirés COMPRIS : c'est ce qui permet de réactiver un mouvement mis de côté.
    exerciseKnown: (id: string) => !!program.exerciseById(id),
    // Les ACTIFS, dans l'ordre. C'est cette différence avec `exerciseKnown` qui
    // distingue « déjà retiré » de « inconnu », et qui valide un réordonnancement.
    exercisesOf: (sessionId: string) => program.sessionById(sessionId)?.exercises.map(e => e.id) ?? [],
    exerciseAt: program.exerciseAt,
  }

  async function hydrate() {
    if (hydrated || !import.meta.client) return
    hydrated = true
    await refresh()
  }

  /** Où en est-on : passkey enregistré ? session ouverte ? */
  async function refresh() {
    try {
      state.value = await $fetch<VaultState>('/api/auth/me')
      if (state.value.connected) await loadPending()
    }
    catch { /* hors ligne : le coffre est un confort, pas une dépendance */ }
  }

  /**
   * Le tout premier passkey, protégé par le code de démarrage — et à qui appartient
   * cette instance.
   *
   * Le nom part DEUX fois, et ce n'est pas une redondance : avec la demande de défi,
   * pour que la fenêtre du système affiche le bon nom au moment où l'on approche son
   * doigt ; puis avec l'enregistrement, pour qu'il soit conservé. Le premier est
   * cosmétique et immédiat, le second est la donnée.
   */
  async function register(bootstrap: string, nom = ''): Promise<boolean> {
    busy.value = true; error.value = null
    try {
      const options = await $fetch('/api/auth/challenge', { method: 'POST', body: { mode: 'register', nom } })
      const response = await startRegistration({ optionsJSON: options as never })
      await $fetch('/api/auth/register', { method: 'POST', body: { bootstrap, nom, response } })
      await refresh()
      return true
    }
    catch (e) { error.value = message(e); return false }
    finally { busy.value = false }
  }

  /**
   * Un passkey de SECOURS, posé depuis un second appareil.
   *
   * C'est ce qui a permis de retirer le mot de passe permanent. Tant qu'il n'y en
   * avait qu'un, perdre son téléphone imposait de garder valide pour toujours un
   * code de démarrage capable de tout rouvrir — un secret permanent, sans
   * expiration ni révocation. Avec un second passkey, ce double n'a plus lieu
   * d'être : le code redevient un code d'installation, utilisable une fois.
   *
   * Aucun secret demandé ici, et c'est voulu : la session en cours prouve déjà
   * qu'on tient le coffre. Exiger en plus un code déjà consommé serait absurde.
   */
  async function ajouterSecours(label = ''): Promise<boolean> {
    busy.value = true; error.value = null
    try {
      const options = await $fetch('/api/auth/challenge', { method: 'POST', body: { mode: 'register' } })
      const response = await startRegistration({ optionsJSON: options as never })
      await $fetch('/api/auth/register', { method: 'POST', body: { label, response } })
      await refresh()
      return true
    }
    catch (e) { error.value = message(e); return false }
    finally { busy.value = false }
  }

  /** Retirer un passkey : l'ordinateur revendu, le téléphone perdu. Jamais le dernier. */
  async function revoquer(id: string): Promise<boolean> {
    busy.value = true; error.value = null
    try {
      await $fetch('/api/auth/revoke', { method: 'POST', body: { id } })
      await refresh()
      return true
    }
    catch (e) { error.value = message(e); return false }
    finally { busy.value = false }
  }

  /** Corriger le nom après coup, sans redéployer ni retoucher au passkey. */
  async function rename(nom: string): Promise<boolean> {
    busy.value = true; error.value = null
    try {
      await $fetch('/api/auth/name', { method: 'POST', body: { nom } })
      await refresh()
      return true
    }
    catch (e) { error.value = message(e); return false }
    finally { busy.value = false }
  }

  async function login(): Promise<boolean> {
    busy.value = true; error.value = null
    try {
      const options = await $fetch('/api/auth/challenge', { method: 'POST', body: { mode: 'login' } })
      const response = await startAuthentication({ optionsJSON: options as never })
      await $fetch('/api/auth/login', { method: 'POST', body: { response } })
      await refresh()
      return true
    }
    catch (e) { error.value = message(e); return false }
    finally { busy.value = false }
  }

  async function logout() {
    await $fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    state.value = { ...state.value, connected: false }
    pending.value = []
  }

  async function loadPending() {
    try {
      const r = await $fetch<{ mirrorAt: string | null, pending: RawProposal[], recent: RawProposal[] }>('/api/vault/pending')
      mirrorAt.value = r.mirrorAt
      pending.value = r.pending
      recent.value = r.recent
    }
    catch { /* session expirée : `refresh` le dira */ }
  }

  /**
   * Pousse l'instantané. `force` contourne l'espacement minimal.
   *
   * Sans espacement, chaque série cochée déclencherait un envoi ; avec, le miroir
   * a au pire quelques minutes de retard — et l'outil `etat` du connecteur donne
   * toujours sa date, pour qu'aucune réponse ne soit construite sur une fraîcheur
   * supposée.
   */
  async function push(snapshot: () => Record<string, unknown>, force = false): Promise<boolean> {
    if (!state.value.connected) return false
    const last = Number(localStorage.getItem(LAST_PUSH_KEY) || 0)
    if (!force && Date.now() - last < PUSH_MIN_INTERVAL_MS) return false
    busy.value = true; error.value = null
    try {
      const r = await $fetch<{ at: string }>('/api/vault/push', { method: 'POST', body: { version: 2, data: snapshot() } })
      mirrorAt.value = r.at
      localStorage.setItem(LAST_PUSH_KEY, String(Date.now()))
      return true
    }
    catch (e) { error.value = message(e); return false }
    finally { busy.value = false }
  }

  /**
   * Réinjecter l'instantané modifié dans TOUS les composables.
   *
   * La liste était écrite à la main au milieu de la branche « correction de champ »,
   * et il en manquait un : `useRestTimer`. Conséquence, corriger `/restTimer/volume`
   * écrivait bien la valeur dans l'instantané, marquait la proposition « appliquée »,
   * et la perdait au prochain `buildSnapshot()` — qui relit le composable, resté sur
   * son ancienne valeur. Accepté, archivé, disparu : le pire des trois états, et
   * exactement le bug qu'on avait déjà eu sur ces mêmes réglages à l'export.
   *
   * Une fonction plutôt qu'une liste en ligne, pour qu'il n'y ait qu'UN endroit à
   * compléter le jour où une section s'ajoute — et un test qui compare cette liste
   * aux sections réellement présentes dans l'instantané.
   */
  function restoreAll(snap: Record<string, unknown>) {
    workout.restoreData(snap)
    profileStore.restore(snap as never)
    nutrition.restore({ nutrition: snap.nutrition } as never)
    mesures.restore(snap as never)
    program.restore(snap)
    restTimer.restore(snap)
    // C'est CE chemin qui rend le foyer modifiable par une proposition : une écriture
    // générique sur /foyer passe par instantané → modification → restauration
    // complète, et le composable revalide ce qu'on lui rend.
    foyer.restore(snap.foyer)
  }

  /**
   * Applique une proposition — et seulement si sa forme est reconnue.
   *
   * `planFor` rend `null` pour tout ce qui sort des deux gestes fermés ; on refuse
   * alors d'écrire quoi que ce soit plutôt que d'interpréter. L'écriture passe par
   * les mêmes fonctions que l'interface : rien de spécial, donc rien qui puisse
   * diverger de ce qu'un tap fait déjà.
   */
  /**
   * `archiver: false` — appliquer SANS rien dire au serveur.
   *
   * Sert à défaire une proposition validée : l'inverse est fabriqué localement
   * (voir `defaireProposition`), il n'a jamais existé côté serveur, et l'archiver
   * échouerait sur « proposition introuvable ». L'écriture, elle, a bien eu lieu —
   * répondre `false` ferait croire le contraire, et c'est le pire des deux mondes :
   * la donnée change et l'écran annonce un échec.
   */
  async function apply(p: RawProposal, { archiver = true }: { archiver?: boolean } = {}): Promise<boolean> {
    const plan = planFor(p, ctx)
    if (!plan) { error.value = 'Cette proposition ne peut pas être appliquée automatiquement.'; return false }
    // On passe par les MÊMES fonctions que l'interface : `assign` tient ensemble le
    // planning et la journée alimentaire, donc les calories suivent, que le geste
    // vienne du calendrier ou d'une proposition.
    if (plan.kind === 'plat') { nutrition.setPicked(plan.date, plan.slot, plan.recipeId) }
    else if (plan.kind === 'repas-libre') {
      if (!nutrition.setFreeMeal(plan.date, plan.slot, plan.repas)) {
        error.value = 'Ce repas n\'a pas pu être enregistré.'
        return false
      }
    }
    else if (plan.kind === 'seance') { training.assign(plan.date, plan.sessionId) }
    else if (plan.kind === 'aliment') {
      // Même porte que l'écran d'édition : `addFood` crée, `patchFood` fusionne. Un
      // aliment livré n'est jamais réécrit, il reçoit un patch — c'est ce qui permet
      // de revenir à la fiche d'origine si la correction se révèle mauvaise.
      if (plan.id) nutrition.patchFood(plan.id, plan.aliment as never)
      else nutrition.addFood({ ...plan.aliment, custom: true } as never)
    }
    else if (plan.kind === 'recette') {
      if (plan.id) nutrition.patchRecipe(plan.id, plan.recette)
      else nutrition.addRecipe({ ...plan.recette, custom: true })
    }
    else if (plan.kind === 'semaine-type') {
      plan.seances?.forEach((sid, i) => profileStore.setDay(i, sid))
      plan.salle?.forEach((on, i) => nutrition.setWeekDay(i, 'gym', on))
      plan.teletravail?.forEach((on, i) => nutrition.setWeekDay(i, 'tt', on))
    }
    else if (plan.kind === 'correction-serie') {
      if (!workout.fixSet(plan.exercice, plan.date, plan.index, plan.vers)) {
        error.value = 'La série visée n\'existe plus telle quelle.'
        return false
      }
    }
    else if (plan.kind === 'correction-champ') {
      // On repasse par le chemin d'IMPORT : instantané → modification → restauration
      // complète. Écrire dans localStorage directement laisserait les composables
      // sur leur ancienne valeur en mémoire, et l'écran continuerait d'afficher
      // ce qu'on vient de corriger.
      const snap = buildSnapshot()
      /**
       * Le même chemin pour les quatre gestes : instantané → modification →
       * restauration complète.
       *
       * Écrire dans localStorage directement laisserait les composables sur leur
       * ancienne valeur en mémoire, et l'écran continuerait d'afficher ce qu'on vient
       * de corriger. C'est aussi ce qui fait que chaque composable revalide ce qu'on
       * lui rend : une écriture générique ne court-circuite personne.
       */
      const fait = plan.op === 'creer'
        ? createAt(snap, plan.chemin, plan.vers)
        : plan.op === 'ajouter'
          ? pushAt(snap, plan.chemin, plan.vers)
          : plan.op === 'supprimer'
            ? removeAt(snap, plan.chemin)
            : setPointer(snap, plan.chemin, plan.vers as never)
      if (!fait) {
        error.value = plan.op === 'creer'
          ? 'Cet emplacement existe déjà, ou son parent n\'existe pas.'
          : 'Ce champ n\'existe plus, ou n\'est pas modifiable.'
        return false
      }
      restoreAll(snap)
    }
    else if (plan.kind === 'programme') {
      // Mêmes fonctions que l'écran d'édition. « retirer » DÉSACTIVE : les séances
      // enregistrées sont indexées par identifiant d'exercice, et supprimer
      // effacerait des records réellement soulevés.
      if (plan.op === 'modifier') {
        if (plan.patch && Object.keys(plan.patch).length) program.patchExercise(plan.exercice!, plan.patch)
        if (plan.variants) program.setVariants(plan.exercice!, plan.variants)
      }
      else if (plan.op === 'ajouter' && plan.nouveau) {
        program.addExercise(plan.seance, plan.nouveau, plan.apres)
        if (plan.variants) program.setVariants(plan.nouveau.id, plan.variants)
      }
      else if (plan.op === 'retirer') program.disableExercise(plan.exercice!)
      else if (plan.op === 'reactiver') program.enableExercise(plan.exercice!, plan.apres)
      else if (plan.op === 'reordonner' && plan.ordre) program.setOrder(plan.seance, plan.ordre)
      else if (plan.op === 'creer-seance' && plan.seanceNeuve) {
        // `addSession` refuse un identifiant déjà pris et le DIT. Ignorer son retour
        // archiverait la proposition en « appliquée » alors que rien n'a changé —
        // exactement le genre de mensonge qu'on ne découvre que des jours plus tard.
        if (!program.addSession(plan.seanceNeuve)) {
          error.value = 'Une séance porte déjà cet identifiant.'
          return false
        }
      }
      else { error.value = 'Modification de programme incomplète.'; return false }
    }
    else if (plan.kind === 'correction-pesee') {
      const ok = plan.vers === null
        ? workout.removeBodyWeight(plan.date)
        : (workout.setBodyWeightAt(plan.date, plan.vers), true)
      if (!ok) { error.value = 'Pesée introuvable.'; return false }
    }
    else {
      // Une semaine entière : on CRÉE une semaine nommée plutôt que de réécrire
      // celle en cours. Les semaines livrées doivent rester ce qu'elles sont, et on
      // veut pouvoir revenir en arrière en réappliquant l'ancienne.
      const id = nutrition.createMenu(plan.nom, plan.jours)
      if (!id) { error.value = 'Semaine invalide.'; return false }
      nutrition.applyMenuFrom(plan.lundi, id)
    }
    return archiver ? resolve(p, 'applied') : true
  }

  async function resolve(p: RawProposal, status: 'applied' | 'refused'): Promise<boolean> {
    try {
      await $fetch('/api/vault/resolve', { method: 'POST', body: { id: p.id, status } })
      pending.value = pending.value.filter(x => x.id !== p.id)
      recent.value = [{ ...p, status, resolvedAt: new Date().toISOString() }, ...recent.value].slice(0, 10)
      return true
    }
    catch (e) { error.value = message(e); return false }
  }

  /** Applicable d'un tap ? Sert aussi à l'écran, pour ne pas promettre un bouton
   *  qui ne ferait rien. */
  const applicable = (p: RawProposal) => planFor(p, ctx) !== null

  const pendingCount = computed(() => pending.value.length)

  return {
    state, pending, recent, mirrorAt, busy, error, pendingCount,
    hydrate, refresh, register, ajouterSecours, revoquer, rename, login, logout, loadPending, push, apply, resolve, applicable, ctx, restoreAll,
  }
}
