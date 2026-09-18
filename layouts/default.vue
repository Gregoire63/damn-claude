<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { ONGLETS, titreDe } from '~/lib/onglets'
import { gearFor, variantName, variantsOf } from '~/data/exerciseVariants'
import { isTimed } from '~/lib/program'
import { setText } from '~/lib/setText'
import { fmtRest, restFor } from '~/lib/rest'
import { exercicesDuJour, groupeDe } from '~/lib/rotation'
import { EFFORT_OPTIONS } from '~/utils/sportStats'
import { exMuscles } from '~/lib/muscles'
import type { Exercise } from '~/data/sportProgram'
import { isoOf } from '~/utils/sportStats'
import { fmtDuree } from '~/lib/fractionne'
import { useSeance } from '~/composables/useSeance'
import { useFlash } from '~/composables/useFlash'
import { useJour } from '~/composables/useJour'
import { useProfile } from '~/composables/useProfile'
import { useConnecteurs } from '~/composables/useConnecteur'
import { providerById } from '~/lib/providers'
import { usePhotos } from '~/composables/usePhotos'
import { useNutrition } from '~/composables/useNutrition'
import { useVault } from '~/composables/useVault'
import { useDemarrage } from '~/composables/useDemarrage'
import { useMesures } from '~/composables/useMesures'
import { retirerEcranChargement } from '~/composables/useEcranChargement'
import { useSnapshot } from '~/composables/useSnapshot'
import { useWorkout } from '~/composables/useWorkout'
import { useBackGuard } from '~/composables/useBackGuard'
import { useClavier } from '~/composables/useClavier'
import { decalageGlissement, poserSens, useGlissement } from '~/composables/useGlissement'
import Popup from '~/components/Popup.vue'
import '~/assets/css/sport.css'
import '~/assets/css/nutrition.css'

// ─────────────────────────────────────────────────────────────────────────────
// La coque : en-tête, onglets, et tout ce qui se superpose à l'onglet courant.
// ─────────────────────────────────────────────────────────────────────────────
//
// Ce qui vit ici n'est pas « ce qui est commun aux cinq écrans » — c'est ce qui doit
// SURVIVRE au passage de l'un à l'autre. La feuille de séance en est l'exemple : on
// démarre une séance depuis l'accueil, on la replie, on va vérifier une charge dans
// le journal, on la rouvre. Dans une page, elle serait démontée au premier clic.
//
// Nuxt conserve le composant de mise en page tant que le nom ne change pas : la
// feuille, la mini-barre, le chrono et les cartes de confirmation traversent donc
// les changements de route sans rien perdre. L'état, lui, vit dans `useSeance()`,
// hors de tout composant — c'est la ceinture en plus des bretelles.

useHead({
  meta: [
    { name: 'theme-color', content: '#fefcf8' },
    // apple-mobile-web-app-capable est déprécié, mais reste nécessaire pour les
    // anciennes versions d'iOS : on déclare les deux.
    { name: 'mobile-web-app-capable', content: 'yes' },
    { name: 'apple-mobile-web-app-capable', content: 'yes' },
    { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
    { name: 'apple-mobile-web-app-title', content: 'Damn Claude' },
    { name: 'robots', content: 'noindex' },
  ],
})

const route = useRoute()
const router = useRouter()

const TABS = ONGLETS
const pageTitle = computed(() => titreDe(route.path))
const { flash, flashTon, flashAction, showFlash, lancerAction } = useFlash()

/**
 * L'exercice dont on regarde la fiche. Un objet et non un identifiant : la même
 * fenêtre s'ouvre depuis la séance en cours ET depuis l'aperçu d'une séance qu'on
 * n'a pas démarrée, et ces deux listes ne vivent pas au même endroit.
 */
const infoEx = ref<Exercise | null>(null)
/**
 * L'exercice dont la bulle d'aide de colonne est ouverte — un seul à la fois.
 *
 * Une par carte ouverte en même temps ferait trois bulles à refermer ; et deux cartes
 * ouvertes ne posent de toute façon pas la question en même temps.
 */
const aideCol = ref<string | null>(null)
/** « 16 septembre » : une date de pesée se lit, elle ne se décode pas. */
const jourDit = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })
/** L'exercice dont le menu d'options est ouvert — même raisonnement que `infoEx`. */
const optionsEx = ref<Exercise | null>(null)
const maj = useMaj()

// Les propositions de Claude : le badge de l'en-tête, et la feuille qu'il ouvre.
// `vault` est déclaré plus bas (c'est lui qui donne l'initiale de la marque) — même
// état de module, une seule instance.
const propositionsOuvertes = ref(false)
// Le parcours d'installation : tant qu'il reste une étape, il occupe l'écran seul.
const demarrage = useDemarrage()


const { todayISO, hydrateJour } = useJour()
const { sessionLog, seedDemo } = useWorkout()
const { hydrate: hydrateProfile } = useProfile()

// Toute la séance en cours vient de là. La coque n'en possède rien : elle l'affiche.
const s = useSeance()
const {
  activeSession, exercices, alternatives, choisirRotation, editingRecord, previewSession, openEx, sessionNote,
  draft, draftEffort, draftSwap, draftNote, draftVariant,
  previousNote,
  sprintMode, sprintOpen, sprintInfoOpen, sprintDraft, addSprintRow, removeSprintRow,
  elapsed, fmtClock,
  sheetOpen, sheetClosing, sheetVisible, sheetStyle, scrimStyle,
  expandSession, collapseSession, requestCollapse, onDragStart, onDragMove, onDragEnd,
  cancelPromptOpen, askCancel, confirmCancel,
  pickVariant, toggleSwap, startSession, demarrerApercu, restoreDraft,
  doneCount, workCount, isExDone, requiredEx, finishedCount, finishReady, finishSession,
  setEffort, addSet, addWarmup, removeSet, setLabel, toggleSet, warmupFor,
  overloadHint, isDumbbell, seanceWeight, poidsSource, lestOf, setLest, totalOf, derniere,
  ratioFor, restLeft, restFmt, addRest, stopRest,
} = s

/**
 * L'aperçu montre la séance TELLE QU'ELLE SE FERA cette semaine.
 *
 * Sans ça, lire une séance avant de la démarrer y montrerait les deux membres d'un
 * groupe d'alternance, et la feuille qui s'ouvre juste après n'en montrerait qu'un :
 * on croirait avoir perdu un exercice entre les deux écrans.
 */
const previewExercices = computed(() => exercicesDuJour(previewSession.value?.exercises ?? [], todayISO.value ?? ''))

/**
 * Avec quoi le mouvement de la fiche alterne — séance en cours OU séance lue.
 *
 * La fiche s'ouvre depuis les deux, et c'est justement dans l'aperçu que la question
 * se pose : on y voit un seul des deux mouvements, sans rien pour dire que l'autre
 * existe et reviendra la semaine prochaine.
 */
/** Le menu d'options ne rend qu'un identifiant — la fiche, elle, veut le mouvement. */
function ouvrirFiche(id: string) {
  infoEx.value = exercices.value.find(e => e.id === id) ?? null
}

const infoAlternatives = computed(() => {
  const ex = infoEx.value
  if (!ex) return []
  const enSeance = alternatives(ex.id)
  if (enSeance.length) return enSeance
  return groupeDe(previewSession.value?.exercises ?? [], ex.id).filter(a => a.id !== ex.id)
})

/**
 * Le fractionné fini, son journal s'écrit tout seul.
 *
 * Le chrono est le seul à connaître le compte exact — six sprints de trente
 * secondes, pas « cinq ou six, je crois ». Attendre qu'on le retape, essoufflé,
 * c'est la garantie d'un journal approximatif ou vide, et le suivi de vitesse
 * s'appuie dessus.
 *
 * On n'ÉCRASE rien : les lignes déjà remplies à la main restent, seules les lignes
 * vierges (celles que le formulaire crée par défaut) cèdent la place. Et l'intensité
 * est laissée vide — le chrono ne sait pas à quelle vitesse on a couru.
 */
function remplirSprint(b: { sprints: number, sprintS: number, echauffementS: number }) {
  // « Vide » se juge sur la durée et l'intensité, PAS sur le compte : la ligne que le
  // formulaire crée par défaut porte déjà « 1 ». La tester sur les trois champs
  // laissait donc traîner un échauffement fantôme au-dessus de celui du chrono.
  const vide = (r: { duration: string, intensity: string }) => !r.duration.trim() && !r.intensity.trim()
  const gardees = sprintDraft.value.filter(r => !vide(r))
  const ajout: typeof sprintDraft.value = []
  if (b.echauffementS > 0) ajout.push({ kind: 'echauffement', count: '1', duration: fmtDuree(b.echauffementS), intensity: '' })
  // Le bloc peut avoir été coupé après l'échauffement seul : une ligne « 0 sprint »
  // ne dit rien, et il faudrait la supprimer à la main.
  if (b.sprints > 0) ajout.push({ kind: 'sprint', count: String(b.sprints), duration: `${b.sprintS} s`, intensity: '' })
  if (!ajout.length) return
  sprintDraft.value = [...gardees, ...ajout]
  sprintOpen.value = true
  showFlash(b.sprints > 0
    ? `Fractionné inscrit — ${b.sprints} × ${b.sprintS} s`
    : 'Échauffement inscrit', 'ok')
}

/**
 * Le glissement latéral change d'onglet.
 *
 * Neutralisé dans trois cas, et chacun a coûté un essai :
 *
 *   · pendant le parcours d'installation — il n'y a rien à côté, et un geste qui ne
 *     fait rien se lit comme une panne ;
 *   · quand la feuille de séance est ouverte — elle se glisse VERTICALEMENT et vit
 *     dans la même coque ; changer d'onglet dessous reviendrait à échanger le décor
 *     pendant qu'on joue la scène ;
 *   · quand un aperçu de séance est posé par-dessus, pour la même raison.
 *
 * Les fenêtres et les feuilles du bas, elles, passent par `useOverlay` et sont
 * couvertes par le composable lui-même.
 *
 * `router.push` et non `replace` : le retour du téléphone doit défaire un changement
 * d'onglet comme il défait un tap.
 */
const glisse = useGlissement(
  chemin => router.push(chemin),
  () => demarrage.fini.value && !sheetVisible.value && !previewSession.value,
)

/**
 * Le sens de l'animation, même quand la navigation ne vient pas d'un geste.
 *
 * Sans ça, toucher « Profil » depuis « Accueil » rejouait le sens du dernier
 * glissement : l'écran partait à droite pour arriver de gauche, et on voyait que
 * quelque chose clochait sans pouvoir dire quoi.
 */
router.beforeEach((to, from) => { poserSens(from.path, to.path) })


/**
 * Le titre est-il assez remonté pour que la barre reprenne la main ?
 *
 * Le seuil est celui du grand titre lui-même, pas une valeur ronde : on bascule
 * quand il a réellement disparu sous la barre, sinon on voit un instant les deux.
 * Écouteur passif — un `preventDefault` depuis un écouteur de défilement bloque le
 * fil du compositeur, et c'est exactement ce qu'on ne veut pas pendant qu'on fait
 * défiler une liste au doigt.
 */
const titreReplie = ref(false)
function onScroll() { titreReplie.value = window.scrollY > 34 }

/**
 * Le monogramme de l'en-tête.
 *
 * Il valait « GR » en dur, du temps où cette application n'avait qu'un seul
 * utilisateur possible. Il vient maintenant du nom que le coffre renvoie —
 * « Moi » tant que personne ne s'est nommé, donc « M » — et se met à jour tout
 * seul dès qu'on se renomme depuis Profil.
 */
const vault = useVault()
/** Le nombre écrit sur la cloche. Zéro : pas de badge, le bouton reste. */
const propositionsEnAttente = computed(() => vault.pendingCount.value)

/**
 * Signaler l'ARRIVÉE, pas seulement l'état.
 *
 * `useVault` relève maintenant la boîte tout seul — au retour au premier plan, et
 * toutes les minutes tant que l'écran est visible. Mais un badge qui passe de 1 à 2
 * pendant qu'on regarde le journal ne se remarque pas : le compte est juste, et on
 * ne le voit pas plus qu'avant. D'où un bandeau au moment où ça tombe, et la cloche
 * qui bat une seconde.
 *
 * Le tout premier relevé ne déclenche rien. Au démarrage, le passage de 0 à N n'est
 * pas une arrivée — c'est ce qui attendait déjà, et le badge le dit très bien. Un
 * bandeau à chaque ouverture de l'application deviendrait un bruit de fond qu'on
 * apprend à ignorer, exactement ce qu'il ne faut pas pour la seule chose de
 * l'application qui attend quelque chose de toi.
 */
const clocheNeuve = ref(false)
watch(() => vault.arrivees.value, (n, avant) => {
  if (n <= (avant ?? 0) || n === 0) return
  const neuves = n - (avant ?? 0)
  showFlash(neuves > 1 ? `${neuves} nouvelles propositions de Claude` : 'Nouvelle proposition de Claude', 'ok')
  // On coupe puis on relance : deux arrivées d'affilée doivent refaire sonner la
  // cloche, or une classe déjà posée ne rejoue pas son animation.
  clocheNeuve.value = false
  void nextTick(() => { clocheNeuve.value = true })
  setTimeout(() => { clocheNeuve.value = false }, 2400)
})
const brandMark = computed(() => {
  const mots = (vault.state.value.ownerName || 'Moi').trim().split(/\s+/).filter(Boolean)
  const lettres = mots.slice(0, 2).map(m => [...m][0] ?? '').join('')
  return (lettres || 'M').toUpperCase()
})

/**
 * Le geste « retour » referme la feuille au lieu de quitter l'application.
 *
 * L'accueil est la première page de l'historique de la PWA : un balayage arrière n'a
 * rien où revenir, il sort. On lui donne donc quelque chose à consommer, et il fait
 * exactement ce que fait la poignée — `collapseSession`, c'est-à-dire replier la
 * feuille sans rien arrêter, ou, en pleine modification d'une séance enregistrée,
 * ouvrir la confirmation d'abandon qui existe déjà pour ce cas.
 *
 * Armé sur la feuille OUVERTE et non sur la séance : une fois la feuille repliée, la
 * séance continue mais le retour redevient le retour. C'est ce qu'on attend d'un
 * deuxième geste de suite, et ça évite d'enfermer l'utilisateur dans l'application.
 */
useBackGuard(computed(() => !!activeSession.value && sheetOpen.value), () => collapseSession())

// Les trois cartes de confirmation et l'aperçu en lecture seule ne sont pas des
// composants `Sheet` : ce sont des `v-if` sur des variables de cette page, écrits à
// la main. Elles n'héritent donc de rien et doivent le dire elles-mêmes. Inscrites
// APRÈS la feuille de séance : une confirmation qui s'ouvre par-dessus elle
// s'inscrit plus tard, donc se ferme d'abord.
useBackGuard(cancelPromptOpen, () => { cancelPromptOpen.value = false })
useBackGuard(computed(() => !!previewSession.value), () => { previewSession.value = null })

/**
 * Chrono flottant : visible dès que le VRAI chrono ne l'est plus.
 *
 * Il se déclenchait sur un défilement de 150 px, ce qui n'a rien à voir avec la
 * question posée — le chrono de la colonne d'outils peut très bien être hors champ
 * sans qu'on ait bougé d'un pixel, selon l'exercice qu'on est en train de remplir.
 * On validait alors une série et il ne se passait rien de visible : il fallait
 * faire défiler la page POUR VOIR qu'un décompte avait démarré.
 *
 * On observe donc directement l'élément : présent à l'écran, pas de doublon ;
 * absent, le flottant prend le relais.
 */
const timerBox = ref<HTMLElement | null>(null)
const timerVisible = ref(true)
let timerObserver: IntersectionObserver | null = null
// Position du chrono flottant calée sur le viewport VISIBLE (reste visible clavier ouvert sur iOS)
// Décalé sous l'en-tête collant de la feuille (gap haut ~26 px + en-tête ~56 px).
const floatTop = ref(92)
const keyboardOpen = ref(false)
function onViewport() {
  const vv = import.meta.client ? window.visualViewport : null
  floatTop.value = (vv ? Math.round(vv.offsetTop) : 0) + 92
  keyboardOpen.value = vv ? window.innerHeight - vv.height > 120 : false
}

/**
 * Reprend une connexion laissée en plan dans un autre navigateur.
 *
 * L'autorisation part de la PWA et revient dans Safari — deux stockages, deux cookies.
 * Les jetons ne peuvent donc pas revenir par l'URL : ils sont déposés côté serveur, et
 * c'est ici qu'on va les chercher, avec le nonce que l'application avait gardé. C'est
 * le premier instant du flux dont on soit sûr qu'il se joue DANS l'app.
 *
 * Silencieux quand il n'y a rien : on ouvre l'application cent fois pour une connexion
 * de balance. Et valable pour TOUTES les marques — la coque n'en connaît aucune, elle
 * demande simplement à celles que ce navigateur a déjà branchées.
 */
// La reprise et ses relances vivent dans `useConnecteurs()` — ici on ne fait que
// ce qui regarde la COQUE : aller sur le profil, et le dire.
let repriseEnCours = false
async function reprendreConnexions() {
  if (!import.meta.client || repriseEnCours) return
  repriseEnCours = true
  try {
    const repris = await useConnecteurs().reprendreAvecRelances()
    if (!repris) return
    const fiche = providerById(repris)
    void router.push('/profil')
    showFlash(`${fiche?.icone ?? '🔌'} ${fiche?.label ?? repris} connecté`)
    await useConnecteurs().autoSyncTout(isoOf(new Date()))
  }
  finally { repriseEnCours = false }
}

/**
 * Au retour au premier plan aussi, et pas seulement à l'ouverture.
 *
 * Le cas normal est exactement celui-là : l'application était déjà ouverte en
 * arrière-plan, on est parti autoriser dans Safari, on revient dessus. Sans cette
 * écoute il faudrait la fermer et la rouvrir pour que la connexion se termine —
 * c'est-à-dire deviner qu'il faut le faire.
 */
function surveillerRetourAutorisation() {
  if (!import.meta.client) return
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') reprendreConnexions()
  })
}


onMounted(() => {
  // Service worker, mises à jour et purge des caches : tout est dans `useMaj()`.
  maj.installer(import.meta.dev)
  surveillerRetourAutorisation()
  // L'écran de chargement ne se retire plus tout seul : il a été sorti de la racine
  // Nuxt pour ne pas s'évaporer au montage. C'est ici qu'on le laisse partir.
  retirerEcranChargement()
  hydrateProfile()
  // L'onglet D'ABORD, la séance ensuite : `restoreDraft` rouvre la feuille par-dessus,
  // et c'est bien l'onglet restauré qu'on doit retrouver en la repliant.
  restoreDraft() // rouvre la séance en cours après un refresh accidentel
  reprendreConnexions()
  // Les mesures AVANT la synchronisation, et ce n'est pas de l'ordre pour l'ordre.
  //
  // Deux raisons, dont une qui a coûté un historique. La synchro écrit dans le
  // journal des pesées ; le composable protège désormais son propre stockage, mais
  // l'hydrater ici lui évite de le faire dans l'urgence. Et surtout : `bodyComp` en
  // sort, or c'est lui qui calcule la cible protéique sur la masse maigre. Non
  // hydraté, il rend `null`, la cible retombe sur le poids total et se trouve
  // surestimée — sur le premier écran, avant qu'on ait visité Progrès.
  useMesures().hydrate()
  // Les pas de la balance à l'OUVERTURE de l'app, plus seulement en visitant le
  // Rapport. Tant que c'était accroché à cet écran, la cible du jour tournait sur une
  // estimation forfaitaire pour qui n'y allait jamais — et c'est justement la cible
  // qui décide de ce qu'on met dans l'assiette du soir.
  // Volontairement non attendu : rien de ce qui s'affiche n'en dépend, et une balance
  // injoignable ne doit pas retarder le premier écran d'une milliseconde.
  useConnecteurs().autoSyncTout(isoOf(new Date())).catch(() => { /* hors ligne : ce sera pour la prochaine ouverture */ })
  // Les métadonnées des photos de plats, dès l'ouverture.
  //
  // Elles n'étaient chargées que par le panneau Nutrition : tant qu'on n'était pas
  // passé par l'onglet « Plats », `has(id)` répondait faux partout ailleurs et les
  // vignettes restaient vides — sur l'accueil, dans la feuille des repas, dans la
  // fiche d'un plat. Il fallait visiter un écran pour que les autres s'affichent.
  //
  // Ce sont bien les MÉTADONNÉES seules (identifiant, dimensions, poids), pas les
  // images : quelques centaines d'octets, lus une fois. Chaque vignette lit son blob
  // à la demande, donc ceci ne charge rien d'inutile au démarrage.
  // Le clavier virtuel se pose PAR-DESSUS la page : un champ de la moitié basse
  // disparaît derrière lui et on tape à l'aveugle. Posé ici, dans la coque, parce
  // que ça vaut pour tous les écrans — et une seule fois, le composable s'en assure.
  useClavier()
  usePhotos().hydrate().catch(() => { /* IndexedDB indisponible : navigation privée */ })
  // Le coffre : on relève l'état (session, propositions) et, si la session est
  // ouverte, on repousse le miroir — au plus une fois toutes les cinq minutes.
  // C'est ce qui remplace l'export manuel qu'il fallait penser à faire.
  const { buildSnapshot } = useSnapshot()
  demarrage.hydrate()
  // `hydrate()` alimente aussi la cloche de l'en-tête : sans lui, elle n'aurait
  // aucun compte à afficher tant qu'on n'a pas ouvert les réglages — c'est-à-dire
  // précisément l'écran qu'elle sert à éviter.
  vault.hydrate()
    .then(() => vault.push(buildSnapshot))
    .catch(() => { /* hors ligne : le coffre est un confort, pas une dépendance */ })
  useNutrition().hydrate()
  // Données de démo UNIQUEMENT en environnement local/test (jamais en prod) :
  // actif en `nuxt dev`, ou si NUXT_PUBLIC_SEED_TEST_DATA=true. En prod → rien.
  // Elles simulent un HISTORIQUE sur le programme en place ; sans programme — le cas
  // d'une installation neuve — `seedDemo` ne fait rien et le drapeau reste à poser,
  // pour qu'elles arrivent dès qu'une séance existe.
  try {
    const seedAllowed = import.meta.dev || useRuntimeConfig().public.seedTestData
    if (seedAllowed && !localStorage.getItem('gr-seeded-v1') && !sessionLog().length) {
      seedDemo()
      if (sessionLog().length) localStorage.setItem('gr-seeded-v1', '1')
    }
  } catch { /* stockage indisponible */ }
  hydrateJour()

  window.addEventListener('scroll', onScroll, { passive: true })
  onScroll()

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', onViewport)
    window.visualViewport.addEventListener('scroll', onViewport)
    onViewport()
  }

  // Le chrono de la colonne d'outils n'existe que dans la vue « séance » : on
  // (re)branche l'observateur quand il apparaît, et on le débranche quand il part.
  watch(timerBox, (el) => {
    timerObserver?.disconnect()
    if (!el) { timerVisible.value = false; return }
    timerObserver = new IntersectionObserver(
      ([entry]) => { timerVisible.value = entry.isIntersecting },
      // Une marge négative en haut : à moitié caché sous l'en-tête collant, il ne
      // compte pas comme visible.
      { root: null, rootMargin: '-64px 0px 0px 0px', threshold: 0.5 },
    )
    timerObserver.observe(el)
  }, { immediate: true })
})
onUnmounted(() => {
  if (import.meta.client) window.removeEventListener('scroll', onScroll)
  timerObserver?.disconnect()
  if (import.meta.client && window.visualViewport) {
    window.visualViewport.removeEventListener('resize', onViewport)
    window.visualViewport.removeEventListener('scroll', onViewport)
  }
})
</script>

<template>
    <!--
      Le geste est écouté sur la COQUE, pas sur l'écran de l'onglet.
  
      Sur l'onglet, il cessait de répondre juste après un changement : le temps de la
      transition, l'écran sortant est parti et l'entrant n'est pas là — le doigt tombait
      alors dans le vide, en dehors de l'élément qui écoute. Même effet sur un écran
      court, dont la moitié basse n'appartient à personne. La coque, elle, fait toujours
      la hauteur de la fenêtre.
    -->
    <div
      class="sport-app"
      :class="{ 'has-bottomnav': demarrage.fini.value, 'has-minibar': demarrage.fini.value && activeSession && !sheetOpen && !sheetClosing, 'has-flash': !!flash }"
      @touchstart.passive="glisse.debut"
      @touchmove.passive="glisse.bouge"
      @touchend.passive="glisse.fin"
      @touchcancel.passive="glisse.fin"
    >
    <header class="sport-header" :class="{ 'titre-replie': titreReplie }">
      <div class="header-top">
        <button class="brand" @click="router.push('/')">
          <span class="brand-mark">{{ brandMark }}</span>
        </button>
        <!--
          Le nom de l'app et le titre de l'écran occupent la MÊME case, et se
          croisent au défilement. iOS centre le titre replié ; ici la marque tient la
          gauche, alors on échange plutôt que de superposer — deux titres visibles en
          même temps ne servent personne, et un titre centré passerait par-dessus la
          marque sur un écran étroit.
        -->
        <span class="header-txt">
          <span class="brand-eyebrow">Damn Claude</span>
          <span class="header-titre">{{ pageTitle }}</span>
        </span>
        <!--
          Les propositions de Claude, atteignables depuis PARTOUT.

          Elles vivaient derrière un bouton, dans la carte du coffre, en bas des
          réglages. Or c'est la seule chose de l'application qui attend quelque chose
          de toi : tant qu'une proposition n'est ni appliquée ni refusée, rien n'est
          écrit. Une file d'attente qu'il faut penser à aller consulter n'est pas une
          file d'attente, c'est un oubli programmé.

          Le bouton reste même à zéro : c'est aussi par là qu'on DÉFAIT une
          modification déjà acceptée, et ce chemin-là doit exister quand rien
          n'attend. Seul le badge apparaît et disparaît.
        -->
        <button
          v-if="demarrage.fini.value"
          class="header-alerte"
          :class="{ some: propositionsEnAttente > 0, neuf: clocheNeuve }"
          :aria-label="propositionsEnAttente
            ? `Propositions de Claude : ${propositionsEnAttente} en attente`
            : 'Propositions de Claude'"
          @click="propositionsOuvertes = true; vault.vuArrivees()"
        >
          <Glyphe nom="cloche" :taille="20" />
          <span v-if="propositionsEnAttente" class="header-badge mono">{{ propositionsEnAttente > 9 ? '9+' : propositionsEnAttente }}</span>
        </button>
      </div>
      <!-- Desktop : navigation en haut -->
      <nav v-if="demarrage.fini.value" class="topnav">
        <button v-for="t in TABS" :key="t.chemin" class="topnav-tab" :class="{ active: route.path === t.chemin }" @click="router.push(t.chemin)">
          <Glyphe :nom="t.glyphe" :taille="17" />
          <span class="tn-label">{{ t.label }}</span>
        </button>
      </nav>
    </header>

    <!-- Chrono de repos flottant : fixe en haut quand on a scrollé, revient à sa place en haut de page -->
    <transition name="ft-drop">
      <div v-if="sheetOpen && restLeft > 0 && (!timerVisible || keyboardOpen)" class="floating-timer" :style="{ top: floatTop + 'px' }">
        <span class="ft-time mono">{{ restFmt(restLeft) }}</span>
        <span class="ft-label">Repos</span>
        <button class="ft-btn" @click="addRest(15)">+15</button>
        <button class="ft-btn stop" @click="stopRest()">Stop</button>
      </div>
    </transition>

    <transition name="flash">
      <div v-if="flash" class="flash" :class="flashTon" role="status">
        <span class="flash-txt">{{ flash }}</span>
        <button v-if="flashAction" class="flash-act" @click="lancerAction()">{{ flashAction.label }}</button>
      </div>
    </transition>


    <!--
      Le grand titre vit HORS de la barre collante, et c'est tout le mécanisme : il
      défile avec la page et disparaît sous elle, pendant que sa version réduite
      apparaît dans la barre. Rien à animer à la main — le défilement fait le
      travail, on ne fait que croiser deux opacités.
    -->
    <h1 class="grand-titre">{{ pageTitle }}</h1>

    <!--
      L'onglet courant. C'est la seule chose qui change d'une route à l'autre ; tout
      ce qui l'entoure — en-tête, feuille, mini-barre, barre d'onglets — traverse.
    -->
    <!--
      Le parcours d'installation prend TOUT l'écran, et il barre la route.

      Il vivait dans l'accueil, sous la barre d'onglets : on pouvait donc en sortir
      d'un tap vers Nutrition ou Progrès, et y trouver des écrans qui n'ont rien à
      montrer et des chiffres calculés sur un profil absent. Un blocage qu'on
      contourne par le bas n'est pas un blocage, c'est une suggestion.

      Il est donc posé ici, à la place de l'onglet, et la navigation se retire avec
      lui — il n'y a rien à visiter tant qu'il n'y a rien dedans.
    -->
    <ClientOnly>
      <SportDemarrage v-if="!demarrage.fini.value" @flash="showFlash" />
    </ClientOnly>
        <!--
          L'écran d'un onglet, et le geste qui en change.
    
          Le `transform` n'est posé QUE pendant le glissement, jamais au repos : un
          élément transformé devient le bloc conteneur de ses descendants `position:
          fixed` et déplace le calcul des `sticky`. Au repos, `:style` rend `undefined`
          et l'attribut disparaît — l'en-tête collant et les barres internes retrouvent
          la fenêtre pour référence.
        -->
            <div
              v-if="demarrage.fini.value"
              class="onglet-glisse"
              :style="decalageGlissement ? { transform: `translate3d(${decalageGlissement}px,0,0)` } : undefined"
            >
              <slot />
            </div>

    <!-- ═══════════ SÉANCE (vraie feuille : monte, descend, glissable au doigt) ═══════════ -->
    <!-- Voile : l'onglet reste rendu derrière ; on le voit quand on descend la feuille -->
    <div v-if="sheetVisible" class="sheet-scrim" :style="scrimStyle" @click="collapseSession"></div>
    <div v-if="sheetVisible && activeSession" class="session-sheet" :style="[{ '--c': activeSession.color }, sheetStyle]">
      <div class="session-sheet-head" @pointerdown="onDragStart">
        <button class="sheet-grab" :aria-label="editingRecord ? 'Fermer' : 'Réduire la séance'" @click="requestCollapse"></button>
        <div class="ssh-row">
          <div class="ssh-title">
            <span class="ssh-dot" aria-hidden="true"></span>
            <span class="ssh-name">{{ activeSession.name }}</span>
          </div>
          <div class="ssh-right">
            <span v-if="editingRecord" class="ssh-time ssh-edit">✏️ Modification</span>
            <span v-else class="ssh-time mono">⏱ {{ fmtClock(elapsed) }}</span>
            <button class="ssh-abandon" :aria-label="editingRecord ? 'Abandonner les modifications' : 'Annuler la séance'" @pointerdown.stop @click="askCancel">✕</button>
          </div>
        </div>
      </div>
      <div class="session-layout">
        <aside class="session-tools">
        <!-- Le minuteur de repos, et rien d'autre.
             « Calcul de barre » et « 1RM & charges » vivaient ici. Le premier ne sert
             que sur une barre libre — sur une machine ou une poulie, le chiffre est
             écrit sur la pile. Le second refaisait à la main ce que l'app calcule déjà
             seule à chaque série enregistrée, et qui alimente la progression et les
             coefficients entre machines. Deux boutons permanents en haut de chaque
             séance pour un besoin qui ne s'est jamais présenté.
             Les composants sont toujours dans components/sport/ : les remettre est une
             ligne de gabarit. -->
        <div class="tools-sticky">
          <div ref="timerBox" class="timer-box"><LazySportRestTimer /></div>
        </div>
      </aside>

      <div class="session-main">
        <div v-for="(e, idx) in exercices" :key="e.id" class="card no-pad exercise" :class="{ 'ex-opt': e.optionnel }">
          <!-- UN bouton dans l'en-tête, et un seul. Il y en a eu trois — le « i » de
               la fiche, le 💬 du commentaire, l'engrenage des gestes du jour — soit
               dix-huit pastilles de 26 pixels sur une séance de six mouvements, dans
               la colonne où l'on vient taper des kilos. Tout ce qui ouvre quelque
               chose passe maintenant par l'engrenage ; la carte garde ce qui se touche
               entre deux séries. Il s'ALLUME quand il y a quelque chose à savoir —
               commentaire écrit, machine changée, mouvement repris en main —, ce qui
               est ce que le 💬 apportait vraiment. -->
          <div class="exhead-row">
            <button class="exhead" @click="openEx = openEx === e.id ? null : e.id">
              <div>
                <div class="ex-name">{{ idx + 1 }}. {{ e.name }}<span v-if="e.optionnel" class="ex-opt-tag">facultatif</span></div>
                <div class="muted mt-2">{{ e.sets }} × {{ e.reps }}<template v-if="derniere(e)"> · dernière : {{ derniere(e) }}</template></div>
              </div>
              <div class="set-counter mono" :class="{ complete: draft[e.id] && workCount(e.id) > 0 && doneCount(e.id) === workCount(e.id) }">{{ doneCount(e.id) }}/{{ workCount(e.id) || e.sets }}</div>
            </button>
            <button
              class="ex-info-btn ex-opt-btn"
              :class="{ has: !!draftVariant[e.id] || !!draftSwap[e.id] || !!draftNote[e.id]?.trim() }"
              :aria-label="`Fiche et options de ${e.name}`"
              @click="optionsEx = e"
            >⚙</button>
          </div>
          <div v-if="openEx === e.id" class="ex-body">
            <!-- Photos, schéma musculaire et consignes ouvraient cette carte, à
                 chaque fois, y compris à la quatrième série où l'on sait déjà à quoi
                 le mouvement ressemble. Ils sont derrière le « i » de l'en-tête :
                 voir components/sport/ExerciseInfo.vue. Ce qui reste ici est ce qui
                 change d'une série à l'autre. -->
            <div v-if="overloadHint(e)" class="hint-pill" :class="overloadHint(e)!.cls">{{ overloadHint(e)!.text }}</div>
            <div v-if="previousNote(e.id)" class="hint-pill note">💬 La dernière fois : {{ previousNote(e.id) }}</div>
            <!-- Le nom de la machine et son coefficient : un bouton allumé dit qu'on
                 a changé, pas POUR QUOI ni de combien. Le second est celui qui
                 explique les kilos préremplis. -->
            <p v-if="draftVariant[e.id]" class="ex-acts-say muted">
              {{ variantName(e.id, draftVariant[e.id], e.name) }} ·
              équivalent {{ e.name }} ×{{ ratioFor(e.id, draftVariant[e.id]).ratio.toLocaleString('fr-FR') }}
            </p>
            <div class="sets">
              <!-- Superset : une charge par mouvement -->
              <template v-if="e.superset">
                <!-- Les colonnes se nomment UNE fois, en tête du bloc.
                     Le superset n'avait pas d'en-tête du tout : deux champs nus par
                     mouvement, six par série, et rien pour dire lequel est les kilos.
                     Les répéter dans chaque carte ferait six fois le même mot ; ici ils
                     sont dits une fois, alignés sur les champs par la même gouttière et
                     le même retrait que `.ss-move`. -->
                <div class="ss-head" aria-hidden="true">
                  <span class="ss-move-label"></span>
                  <span class="col-head mono">kg</span>
                  <span class="times">{{ isTimed(e) ? '·' : '×' }}</span>
                  <span class="col-head mono">{{ isTimed(e) ? 'sec' : 'reps' }}</span>
                </div>
                <div v-for="(s, i) in draft[e.id]" :key="i" class="ss-set" :class="{ done: s.done }">
                  <div class="ss-set-top">
                    <span class="mono ss-set-label">Série {{ i + 1 }}</span>
                    <button class="check" :class="{ ok: s.done }" @click="toggleSet(s, e)">{{ s.done ? '✓' : '○' }}</button>
                    <button v-if="draft[e.id].length > 1" class="rm" aria-label="Retirer la série" @click="removeSet(e.id, i)">×</button>
                  </div>
                  <div class="ss-move">
                    <span class="ss-move-label">{{ e.superset[0] }}</span>
                    <input v-model="s.w" type="number" inputmode="decimal" placeholder="kg">
                    <span class="times">{{ isTimed(e) ? '·' : '×' }}</span>
                    <input v-model="s.r" type="number" inputmode="numeric" :placeholder="isTimed(e) ? 'sec' : 'reps'">
                  </div>
                  <div class="ss-move">
                    <span class="ss-move-label">{{ e.superset[1] }}</span>
                    <input v-model="s.w2" type="number" inputmode="decimal" placeholder="kg">
                    <span class="times">{{ isTimed(e) ? '·' : '×' }}</span>
                    <input v-model="s.r2" type="number" inputmode="numeric" :placeholder="isTimed(e) ? 'sec' : 'reps'">
                  </div>
                </div>
              </template>
              <!-- Exercice classique -->
              <template v-else>
                <!-- L'aide de saisie tient dans un « i » posé SUR le titre de la
                     colonne, et non dans une bandeau au-dessus des séries.
                     « Saisis uniquement le lest » et « le total des deux haltères »
                     s'affichaient en permanence : deux lignes lues une fois, relues
                     jamais, traversées à chaque série pendant des mois. La question
                     qu'elles répondent — « ce champ attend quoi ? » — se pose devant
                     la colonne, donc l'aide y vit. -->
                <div class="setrow setrow-head">
                  <span class="set-label" aria-hidden="true"></span>
                  <span class="col-head mono col-aide">
                    {{ e.bodyweight ? 'lest' : 'kg' }}
                    <button
                      v-if="e.bodyweight || isDumbbell(e)"
                      class="col-info" :class="{ on: aideCol === e.id }"
                      :aria-label="`Ce que demande la colonne ${e.bodyweight ? 'lest' : 'kg'}`"
                      :aria-expanded="aideCol === e.id"
                      @click="aideCol = aideCol === e.id ? null : e.id"
                    >i</button>
                  </span>
                  <span class="times" aria-hidden="true">{{ isTimed(e) ? '·' : '×' }}</span>
                  <span class="col-head mono" aria-hidden="true">{{ isTimed(e) ? 'sec' : 'reps' }}</span>
                </div>
                <div v-if="aideCol === e.id" class="hint-pill col-bulle">
                  <template v-if="e.bodyweight">
                    🧍 Saisis le <strong>lest</strong> seulement — laisse vide si tu n'en mets pas.
                    Le total enregistré (poids du corps + lest) s'affiche sous le champ.
                    <template v-if="poidsSource">
                      <br>Poids retenu : <b>{{ poidsSource.kg }} kg</b><template v-if="!poidsSource.memeJour"> — pesée du {{ jourDit(poidsSource.date) }}, faute d'une d'aujourd'hui</template>.
                    </template>
                    <template v-else><br>Aucune pesée connue : le total sera ce que tu tapes.</template>
                  </template>
                  <template v-else>🏋️ Le poids <strong>total des deux haltères</strong> (2 × 20 kg → 40 kg).</template>
                </div>
                <div v-for="(s, i) in draft[e.id]" :key="i" class="setrow" :class="{ done: s.done, warm: s.warm }">
                  <button class="set-label mono" :class="{ warm: s.warm }" :title="s.warm ? 'Échauffement (non compté) — clic pour repasser en série' : 'Clic pour marquer en échauffement'" @click="s.warm = !s.warm">{{ setLabel(draft[e.id], i) }}</button>
                  <!-- Au poids de corps, le champ porte le LEST et le total s'affiche
                       dessous : c'est lui qui sera enregistré, il ne doit pas être
                       une surprise au moment de valider. -->
                  <span v-if="e.bodyweight" class="lest-cell">
                    <input
                      :value="lestOf(s.w)" type="number" inputmode="decimal" placeholder="lest"
                      @input="setLest(s, ($event.target as HTMLInputElement).value)"
                    >
                    <span v-if="totalOf(s.w)" class="lest-total mono">{{ totalOf(s.w) }}</span>
                  </span>
                  <input v-else v-model="s.w" type="number" inputmode="decimal" placeholder="kg">
                  <span class="times">{{ isTimed(e) ? '·' : '×' }}</span>
                  <input v-model="s.r" type="number" inputmode="numeric" :placeholder="isTimed(e) ? 'sec' : 'reps'">
                  <button class="check" :class="{ ok: s.done }" @click="toggleSet(s, e)">{{ s.done ? '✓' : '○' }}</button>
                  <button v-if="draft[e.id].length > 1" class="rm" aria-label="Retirer la série" @click="removeSet(e.id, i)">×</button>
                </div>
              </template>
              <div class="set-adds">
                <button class="add-set" @click="addSet(e.id)">+ Série</button>
                <button v-if="!e.superset" class="add-set warm" @click="addWarmup(e.id)">+ Échauffement</button>
              </div>
            </div>
            <!-- Ressenti : un tap, et la charge conseillée s'adapte la prochaine fois -->
            <div class="effort">
              <span class="effort-label">Ressenti</span>
              <div class="effort-chips">
                <button
                  v-for="o in EFFORT_OPTIONS" :key="o.value"
                  class="effort-chip" :class="[o.value, { sel: draftEffort[e.id] === o.value }]"
                  :aria-pressed="draftEffort[e.id] === o.value"
                  @click="setEffort(e.id, o.value)"
                >{{ o.icon }} {{ o.label }}</button>
              </div>
            </div>
            <!-- Le commentaire se RELIT ici et s'ÉCRIT dans le menu ⚙, où le champ est
                 posé sous les deux gestes du jour. Un champ toujours déplié dans la
                 carte ferait défiler dix lignes de plus entre deux séries pour quelque
                 chose qu'on écrit une fois ; le relire, en revanche, ne doit coûter
                 aucun tap. -->
            <div v-if="draftNote[e.id]?.trim()" class="ex-note-said">
              💬 {{ draftNote[e.id] }}
              <button class="ex-note-edit" @click="optionsEx = e">modifier</button>
            </div>
          </div>
        </div>
        <div v-if="activeSession.sprint" class="card no-pad exercise sprint-exercise">
          <!-- Le même en-tête qu'un mouvement : un engrenage, et rien d'autre. Ce qui
               se règle et ce qui se lit sont dans la fenêtre ; la carte garde le chrono
               et la saisie, c'est-à-dire ce qu'on touche essoufflé. -->
          <div class="exhead-row">
            <button class="exhead" @click="sprintOpen = !sprintOpen">
              <div>
                <div class="ex-name">⚡ {{ activeSession.sprint.title }}</div>
                <div class="muted mt-2">Optionnel · {{ activeSession.sprint.protocol[0].value }} × {{ activeSession.sprint.protocol[1].value }}</div>
              </div>
              <div class="set-counter mono chevron">{{ sprintOpen ? '▲' : '▼' }}</div>
            </button>
            <button
              class="ex-info-btn ex-opt-btn"
              aria-label="Réglages et protocole du sprint"
              @click="sprintInfoOpen = true"
            >⚙</button>
          </div>
          <div v-if="sprintOpen" class="ex-body sprint-body">
            <!-- Le chrono qui enchaîne les phases, annoncées à la voix -->
            <SportFractionne @termine="remplirSprint" />

            <!-- Saisie : ce que tu as réellement couru -->
            <div class="sprint-log">
              <div class="sprint-block-title">Ce que tu as fait</div>
              <div v-for="(r, i) in sprintDraft" :key="i" class="sprint-row">
                <button class="kind-chip" :class="r.kind" @click="r.kind = r.kind === 'echauffement' ? 'sprint' : 'echauffement'">{{ r.kind === 'echauffement' ? 'Échauff.' : 'Sprint' }}</button>
                <button v-if="sprintDraft.length > 1" class="rm" aria-label="Retirer" @click="removeSprintRow(i)">×</button>
                <div class="sr-fields">
                  <input v-model="r.count" class="sr-count" type="number" inputmode="numeric" placeholder="nb">
                  <span class="times">×</span>
                  <input v-model="r.duration" class="sr-dur" type="text" placeholder="20 s">
                  <span class="times">@</span>
                  <input v-model="r.intensity" class="sr-int" type="text" placeholder="16 km/h">
                </div>
              </div>
              <div class="sprint-add">
                <button class="add-set" @click="addSprintRow('echauffement')">+ Échauffement</button>
                <button class="add-set" @click="addSprintRow('sprint')">+ Sprint</button>
              </div>
              <div class="muted sprint-hint">Exemple : échauffement 1 × 3 min à 8 km/h, puis 3 × 20 s à 16 km/h. Enregistré avec la séance.</div>
            </div>
          </div>
        </div>
        <div class="card note-card">
          <div class="section-label mb-8">Note de séance <span class="muted">· facultatif</span></div>
          <textarea v-model="sessionNote" class="note-input" rows="2" placeholder="Douleur épaule, mal dormi, banc occupé…"></textarea>
          <div class="muted mt-6">Utile pour expliquer une séance en dessous de tes standards.</div>
        </div>
        <button class="btn-primary finish" :disabled="!finishReady" @click="finishSession">{{ editingRecord ? 'Enregistrer les modifications' : 'Terminer et enregistrer la séance' }}</button>
        <div v-if="!finishReady && activeSession" class="finish-hint muted">80 % des exercices sont nécessaires pour enregistrer — {{ finishedCount }}/{{ requiredEx.length }} faits.</div>
          </div>
        </div>
      </div>

    <!--
      Aperçu d'une séance, en lecture seule.

      Il n'apparaissait qu'une fois coincé : toucher une autre séance alors qu'une
      était en cours. C'était donc un message d'empêchement déguisé en écran, et le
      seul moyen de LIRE une séance était de la démarrer. Le même calque sert
      maintenant dans les deux cas — ce qui change est le pied : reprendre ce qui
      tourne, ou démarrer ce qu'on vient de lire.
    -->
    <div v-if="previewSession" class="preview-overlay" @click.self="previewSession = null">
      <div class="preview-sheet" :style="{ '--c': previewSession.color }">
        <!-- Le même en-tête que la séance en cours : pastille de couleur, nom, croix.
             L'aperçu portait un titre et un sur-titre à lui, et on ne reconnaissait
             pas la séance qu'on allait démarrer dans celle qui démarrait. -->
        <div class="preview-head">
          <div class="ssh-title">
            <span class="ssh-dot" aria-hidden="true"></span>
            <div>
              <div class="ssh-name">{{ previewSession.name }}</div>
              <div class="preview-sub mono muted">
                {{ previewSession.tag }} · {{ previewExercices.length }} exercices<template v-if="previewSession.sprint"> · ⚡ sprint</template>
              </div>
            </div>
          </div>
          <button class="sheet-close" aria-label="Fermer" @click="previewSession = null">×</button>
        </div>
        <!-- Ce qui défile est le MILIEU, pas la feuille entière.
             La feuille portait `overflow-y: auto` avec ses coins arrondis : la barre
             de défilement se dessinait au ras du bord, par-dessus l'arrondi, et
             semblait dépasser de la feuille. Elle court maintenant à l'intérieur, le
             long de la gouttière ; l'en-tête et le bouton du bas restent en place, ce
             qui est de toute façon ce qu'on veut d'une feuille qu'on fait défiler. -->
        <div class="preview-corps">
        <div v-if="activeSession" class="preview-note">🔒 Une séance est déjà en cours. Termine-la ou abandonne-la d'abord.</div>

        <!-- Les MÊMES cartes que dans la séance : `.exercise`, `.exhead`, `.ex-name`,
             le compteur à droite, le « i » de la fiche. Ce qui change est ce qu'il y
             a dedans — ici on lit, là on saisit — et rien d'autre. -->
        <div class="preview-list">
          <div v-for="(e, idx) in previewExercices" :key="e.id" class="card no-pad exercise preview-ex" :class="{ 'ex-opt': e.optionnel }">
            <div class="exhead-row">
              <div class="exhead">
                <div>
                  <div class="ex-name">{{ idx + 1 }}. {{ e.name }}<span v-if="e.optionnel" class="ex-opt-tag">facultatif</span></div>
                  <div class="muted mt-2">⏱ Repos {{ fmtRest(restFor(e)) }}</div>
                </div>
                <div class="set-counter mono">{{ e.sets }} × {{ e.reps }}</div>
              </div>
              <button class="ex-info-btn" :aria-label="`Comment exécuter ${e.name}`" @click="infoEx = e">i</button>
            </div>
            <div class="preview-ex-foot">
              <span v-for="m in exMuscles(e)" :key="m" class="sc-chip">{{ m }}</span>
            </div>
          </div>
          <div v-if="previewSession.sprint" class="card no-pad exercise sprint-exercise preview-ex">
            <div class="exhead">
              <div>
                <div class="ex-name">⚡ {{ previewSession.sprint.title }}</div>
                <div class="muted mt-2">Optionnel<template v-if="previewSession.sprint.goal"> · {{ previewSession.sprint.goal }}</template></div>
              </div>
              <div v-if="previewSession.sprint.protocol.length >= 2" class="set-counter mono">
                {{ previewSession.sprint.protocol[0].value }} × {{ previewSession.sprint.protocol[1].value }}
              </div>
            </div>
          </div>
        </div>
        </div>
        <button v-if="activeSession" class="btn-primary preview-resume" @click="previewSession = null; expandSession()">↩ Reprendre la séance en cours</button>
        <button v-else class="btn-primary preview-resume" :style="{ background: previewSession.color }" @click="demarrerApercu()">Démarrer cette séance →</button>
      </div>
    </div>

    <!-- Popup de confirmation « annuler la séance » (remplace le confirm() natif) -->
    <transition name="pop">
      <div v-if="cancelPromptOpen" class="confirm-overlay" @click.self="cancelPromptOpen = false">
        <div class="confirm-box">
          <div class="confirm-emoji" aria-hidden="true">{{ editingRecord ? '✏️' : '🗑️' }}</div>
          <div class="confirm-title">{{ editingRecord ? 'Abandonner les modifications ?' : 'Annuler la séance en cours ?' }}</div>
          <div class="confirm-text">{{ editingRecord ? 'Les changements non enregistrés seront perdus (la séance d\'origine reste intacte).' : 'Les séries saisies mais non enregistrées seront perdues.' }}</div>
          <div class="confirm-actions">
            <button class="btn confirm-keep" @click="cancelPromptOpen = false">{{ editingRecord ? 'Continuer les modifications' : 'Continuer la séance' }}</button>
            <button class="confirm-yes" @click="confirmCancel">{{ editingRecord ? 'Abandonner les modifications' : 'Annuler la séance' }}</button>
          </div>
        </div>
      </div>
    </transition>

    <!-- Le geste « retour » n'ouvre plus de carte : il replie la feuille, comme la
         poignée. La seule question qu'il pose encore est celle de l'abandon des
         modifications — et c'est la carte ci-dessus, celle qui existait déjà. -->

    <!-- Le commentaire d'un exercice, en fenêtre.
         `persistent` : on est en train d'écrire. Une pression à côté du champ, sur
         un téléphone où le clavier occupe la moitié de l'écran, ne doit pas fermer
         la fenêtre. La croix et Échap restent, eux — ce sont des gestes voulus. -->
    <!-- La fiche d'un mouvement : photos, muscles, consignes, machine.
         Écrite ICI et non dans la carte de l'exercice, parce que la même fenêtre
         s'ouvre depuis la séance en cours et depuis l'aperçu d'une séance qu'on n'a
         pas démarrée. Deux copies auraient divergé au premier ajout. -->
    <LazySportExerciseInfo v-if="infoEx" :ex="infoEx" :repos="restFor(infoEx)" :alternatives="infoAlternatives" @close="infoEx = null" />

    <!-- Réglages et protocole du sprint : la même fenêtre que pour un mouvement, au
         même endroit, avec la même règle — elle n'ouvre rien d'autre. -->
    <LazySportSprintOptions
      v-if="sprintInfoOpen && activeSession?.sprint"
      :sprint="activeSession.sprint"
      :mode="sprintMode"
      @update:mode="sprintMode = $event"
      @close="sprintInfoOpen = false"
    />

    <!-- Le menu d'options d'un mouvement. Il n'existe que pendant une séance : hors
         séance, aucun des trois gestes n'a de sens — il n'y a ni machine du jour, ni
         brouillon à recalculer, ni journée à faire tourner. -->
    <LazySportExerciseOptions
      v-if="optionsEx && activeSession"
      :ex="optionsEx"
      :repos="restFor(optionsEx)"
      :note="draftNote[optionsEx.id] ?? ''"
      :note-precedente="previousNote(optionsEx.id)"
      :variant="draftVariant[optionsEx.id] ?? null"
      :swap="!!draftSwap[optionsEx.id]"
      :alternatives="alternatives(optionsEx.id)"
      @update:note="draftNote[optionsEx!.id] = $event"
      @pick-variant="pickVariant(optionsEx!.id, $event)"
      @swap="toggleSwap($event)"
      @alterner="choisirRotation($event)"
      @close="optionsEx = null"
    />

    <!-- Mini-feuille « séance en cours » : docké au-dessus de la barre d'onglets,
         affiche la durée en direct ; on tape dessus pour rouvrir la séance -->
    <div v-if="activeSession && !sheetOpen && !sheetClosing" class="mini-session" :style="{ '--c': activeSession.color }">
      <button class="mini-open" @click="expandSession">
        <span class="mini-grab" aria-hidden="true"></span>
        <span class="mini-dot" aria-hidden="true"></span>
        <span class="mini-main">
          <span class="mini-name">{{ activeSession.name }}</span>
          <span class="mini-sub">{{ editingRecord ? 'Modification · toucher pour reprendre' : 'Séance en cours · toucher pour reprendre' }}</span>
        </span>
        <span class="mini-time mono">⏱ {{ fmtClock(elapsed) }}</span>
        <span class="mini-chevron" aria-hidden="true">⌃</span>
      </button>
      <button class="mini-abandon" aria-label="Annuler la séance" @click="askCancel">✕</button>
    </div>

    <ClientOnly>
      <SportPropositions v-if="propositionsOuvertes" @close="propositionsOuvertes = false" @flash="showFlash" />
    </ClientOnly>

    <!--
      Nouvelle version installée.

      Une pastille FIXE en bas à droite, pas un bandeau en haut de page. Le bandeau
      partait avec le défilement : on le manquait, ou on le voyait une seconde en
      revenant en haut. Ce n'est pas un événement qui passe, c'est un état qui dure
      jusqu'au rechargement, et un état s'affiche là où il reste visible.

      On ne recharge JAMAIS d'autorité : une séance peut être ouverte, et personne
      n'échange une série contre une mise à jour. Elle se ferme d'un geste — et
      revient au retour dans l'application, voir composables/useMaj.ts.
    -->
    <div v-if="maj.majVisible.value" class="maj-pop" role="status">
      <div class="maj-txt">
        <b>Nouvelle version</b>
        <span class="muted">Recharge pour l'appliquer.</span>
      </div>
      <button class="maj-go" @click="maj.recharger()">Recharger</button>
      <button class="maj-x" aria-label="Fermer" @click="maj.masquer()">✕</button>
    </div>

    <!-- Mobile : navigation en bas (barre d'onglets) -->
    <nav v-if="demarrage.fini.value" class="bottomnav">
      <button v-for="t in TABS" :key="t.chemin" class="bn-tab" :class="{ active: route.path === t.chemin }" @click="router.push(t.chemin)">
        <Glyphe :nom="t.glyphe" :taille="25" />
        <span class="bn-label">{{ t.label }}</span>
      </button>
    </nav>
  </div>
</template>
