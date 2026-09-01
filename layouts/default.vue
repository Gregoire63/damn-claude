<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { ONGLETS, titreDe } from '~/lib/onglets'
import { gearFor, variantName, variantsOf } from '~/data/exerciseVariants'
import { isTimed } from '~/lib/program'
import { setText } from '~/lib/setText'
import { fmtRest, restFor } from '~/lib/rest'
import { EFFORT_OPTIONS } from '~/utils/sportStats'
import { exMuscles } from '~/lib/muscles'
import { isoOf } from '~/utils/sportStats'
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
import { useSnapshot } from '~/composables/useSnapshot'
import { useWorkout } from '~/composables/useWorkout'
import { useBackGuard } from '~/composables/useBackGuard'
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
const { flash, flashTon, showFlash } = useFlash()
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
  activeSession, editingRecord, previewSession, openEx, sessionNote,
  draft, draftEffort, draftSwap, draftNote, draftVariant,
  picking, pickingEx, noting, notingEx, notePopup, closeNote, clearNote, previousNote,
  sprintMode, sprintOpen, sprintInfoOpen, sprintDraft, addSprintRow, removeSprintRow,
  elapsed, fmtClock,
  sheetOpen, sheetClosing, sheetVisible, sheetStyle, scrimStyle,
  expandSession, collapseSession, requestCollapse, onDragStart, onDragMove, onDragEnd,
  cancelPromptOpen, askCancel, confirmCancel, swapAsk, swapEx, confirmSwap,
  pickVariant, startSession, restoreDraft,
  doneCount, workCount, isExDone, requiredEx, finishedCount, finishReady, finishSession,
  setEffort, addSet, addWarmup, removeSet, setLabel, toggleSet, warmupFor,
  overloadHint, isDumbbell, seanceWeight, lestOf, setLest, totalOf, derniere,
  ratioFor, restLeft, restFmt, addRest, stopRest,
} = s

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

useBackGuard(computed(() => !!swapEx.value), () => { swapAsk.value = null })

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
  hydrateProfile()
  // L'onglet D'ABORD, la séance ensuite : `restoreDraft` rouvre la feuille par-dessus,
  // et c'est bien l'onglet restauré qu'on doit retrouver en la repliant.
  restoreDraft() // rouvre la séance en cours après un refresh accidentel
  reprendreConnexions()
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
          :class="{ some: propositionsEnAttente > 0 }"
          :aria-label="propositionsEnAttente
            ? `Propositions de Claude : ${propositionsEnAttente} en attente`
            : 'Propositions de Claude'"
          @click="propositionsOuvertes = true"
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
      <div v-if="flash" class="flash" :class="flashTon" role="status">{{ flash }}</div>
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
        <div v-for="(e, idx) in activeSession.exercises" :key="e.id" class="card no-pad exercise" :class="{ 'ex-opt': e.optionnel }">
          <!-- L'icône vit dans l'en-tête, pas dans le corps : c'est là qu'on voit
               d'un coup d'œil quels exercices portent déjà un commentaire, sans
               déplier les six cartes une par une. Et elle ouvre une fenêtre au lieu
               de déplier un champ tout en bas de la carte : commenter ne demande
               plus d'ouvrir l'exercice ni de défiler jusqu'au bout. -->
          <div class="exhead-row">
            <button class="exhead" @click="openEx = openEx === e.id ? null : e.id">
              <div>
                <div class="ex-name">{{ idx + 1 }}. {{ e.name }}<span v-if="e.optionnel" class="ex-opt-tag">facultatif</span></div>
                <div class="muted mt-2">{{ e.sets }} × {{ e.reps }}<template v-if="derniere(e)"> · dernière : {{ derniere(e) }}</template></div>
              </div>
              <div class="set-counter mono" :class="{ complete: draft[e.id] && workCount(e.id) > 0 && doneCount(e.id) === workCount(e.id) }">{{ doneCount(e.id) }}/{{ workCount(e.id) || e.sets }}</div>
            </button>
            <button
              class="ex-note-btn" :class="{ has: !!draftNote[e.id]?.trim() }"
              :aria-label="`Commentaire sur ${e.name}`"
              @click="noting = e.id"
            >💬</button>
          </div>
          <div v-if="openEx === e.id" class="ex-body">
            <LazySportExerciseMove :ex-id="e.id"><LazySportMuscleMap :muscles="e.muscles" /></LazySportExerciseMove>
            <div v-if="e.bodyweight" class="hint-pill bw">
              🧍 Saisis uniquement le <strong>lest</strong> ; laisse vide sans lest.
              <template v-if="seanceWeight">Ton poids du jour ({{ seanceWeight }} kg) est ajouté automatiquement&nbsp;;</template>
              <template v-else>Aucune pesée pour ce jour : le total sera ce que tu tapes&nbsp;;</template>
              le total enregistré s'affiche sous le champ.
            </div>
            <div v-if="overloadHint(e)" class="hint-pill" :class="overloadHint(e)!.cls">{{ overloadHint(e)!.text }}</div>
            <div v-if="previousNote(e.id)" class="hint-pill note">💬 La dernière fois : {{ previousNote(e.id) }}</div>
            <div v-if="isDumbbell(e)" class="hint-pill db">🏋️ Saisis le poids <strong>total des deux haltères</strong> (2 × 20 kg → 40 kg).</div>
            <!-- Les deux gestes « ça ne s'est pas passé comme prévu », côte à côte
                 et sans texte. Ils occupaient dix lignes d'explication chacun, à deux
                 endroits opposés de la carte, pour deux boutons qu'on touche une fois
                 par mois. L'explication n'a pas disparu : elle est dans la carte qui
                 s'ouvre, c'est-à-dire au moment où on en a besoin.
                 Placés AVANT les séries parce que la machine change les kilos
                 préremplis : on choisit, puis on remplit. -->
            <div class="ex-acts">
              <button
                v-if="variantsOf(e.id).length"
                class="ex-act" :class="{ sel: !!draftVariant[e.id] }"
                :aria-label="`Changer de machine pour ${e.name}`"
                :aria-pressed="!!draftVariant[e.id]"
                @click="picking = e.id"
              >
                <span class="ex-act-i" aria-hidden="true">🔁</span>
                <span class="ex-act-t">Autre machine</span>
                <span v-if="draftVariant[e.id]" class="ex-act-ok" aria-hidden="true">✓</span>
              </button>
              <button
                class="ex-act" :class="{ sel: draftSwap[e.id] }"
                :aria-label="`Reprise en main sur ${e.name}`"
                :aria-pressed="!!draftSwap[e.id]"
                @click="swapAsk = e.id"
              >
                <span class="ex-act-i" aria-hidden="true">🔀</span>
                <span class="ex-act-t">Repris en main</span>
                <span v-if="draftSwap[e.id]" class="ex-act-ok" aria-hidden="true">✓</span>
              </button>
            </div>
            <!-- Le nom de la machine et son coefficient : un bouton allumé dit qu'on
                 a changé, pas POUR QUOI ni de combien. Le second est celui qui
                 explique les kilos préremplis. -->
            <p v-if="draftVariant[e.id]" class="ex-acts-say muted">
              {{ variantName(e.id, draftVariant[e.id], e.name) }} ·
              équivalent {{ e.name }} ×{{ ratioFor(e.id, draftVariant[e.id]).ratio.toLocaleString('fr-FR') }}
            </p>
            <div class="cues">
              <div v-for="(c, i) in e.cues" :key="i" class="cue"><span class="cue-arrow">›</span>{{ c }}</div>
              <div v-if="e.machine" class="muted italic mt-6">{{ e.machine }}</div>
            </div>
            <div class="sets">
              <!-- Le repos prévu, annoncé AVANT de valider.
                   Le minuteur partait tout seul avec une durée qu'on découvrait au
                   moment où elle s'affichait : impossible de savoir, en attaquant
                   l'exercice, si on partait sur une minute ou sur trois. Le dire ici
                   n'ajoute pas un réglage, ça montre celui qui existe déjà. -->
              <div class="sets-rest mono muted">⏱ Repos {{ fmtRest(restFor(e)) }}<template v-if="e.superset"> · après les deux mouvements</template></div>
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
                <div class="setrow setrow-head" aria-hidden="true">
                  <span class="set-label"></span>
                  <span class="col-head mono">{{ e.bodyweight ? 'lest' : 'kg' }}</span>
                  <span class="times">{{ isTimed(e) ? '·' : '×' }}</span>
                  <span class="col-head mono">{{ isTimed(e) ? 'sec' : 'reps' }}</span>
                </div>
                <div v-for="(s, i) in draft[e.id]" :key="i" class="setrow" :class="{ done: s.done, warm: s.warm }">
                  <button class="set-label mono" :class="{ warm: s.warm }" :title="s.warm ? 'Échauffement (non compté) — clic pour repasser en série' : 'Clic pour marquer en échauffement'" @click="s.warm = !s.warm">{{ setLabel(draft[e.id], i) }}</button>
                  <!-- Au poids de corps, le champ porte le LEST et le total s'affiche
                       dessous : c'est lui qui sera enregistré, il ne doit pas être
                       une surprise au moment de valider. -->
                  <span v-if="e.bodyweight" class="lest-cell">
                    <input
                      :value="lestOf(s.w)" type="number" inputmode="decimal" placeholder="0"
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
            <!-- Le commentaire ne s'écrit plus ici : 💬 dans l'en-tête ouvre une
                 fenêtre. Ce qui reste dans la carte, c'est ce qu'on LIT en
                 soulevant — la note de la dernière fois, plus haut. -->
            <div v-if="draftNote[e.id]?.trim()" class="ex-note-said">
              💬 {{ draftNote[e.id] }}
              <button class="ex-note-edit" @click="noting = e.id">modifier</button>
            </div>
          </div>
        </div>
        <div v-if="activeSession.sprint" class="card no-pad exercise sprint-exercise">
          <button class="exhead" @click="sprintOpen = !sprintOpen">
            <div>
              <div class="ex-name">⚡ {{ activeSession.sprint.title }}</div>
              <div class="muted mt-2">Optionnel · {{ activeSession.sprint.protocol[0].value }} × {{ activeSession.sprint.protocol[1].value }}</div>
            </div>
            <div class="set-counter mono chevron">{{ sprintOpen ? '▲' : '▼' }}</div>
          </button>
          <div v-if="sprintOpen" class="ex-body sprint-body">
            <!-- Essentiel : le protocole, en un coup d'œil -->
            <div class="sprint-protocol">
              <div v-for="p in activeSession.sprint.protocol" :key="p.label" class="sp-stat">
                <div class="sp-val mono">{{ p.value }}</div>
                <div class="sp-lab">{{ p.label }}</div>
              </div>
            </div>
            <button class="sprint-info-btn" :class="{ open: sprintInfoOpen }" @click="sprintInfoOpen = !sprintInfoOpen">
              <span class="i-mark">i</span>{{ sprintInfoOpen ? 'Masquer les détails' : 'Détails : échauffement, tapis, technique' }}
            </button>

            <!-- Bulle info : tout le détail, masqué par défaut -->
            <div v-if="sprintInfoOpen" class="sprint-info">
              <div class="sprint-goal">{{ activeSession.sprint.goal }}</div>
              <div class="sprint-block">
                <div class="sprint-block-title">🔥 Échauffement</div>
                <ul class="sprint-list"><li v-for="(w, i) in activeSession.sprint.warmup" :key="i">{{ w }}</li></ul>
              </div>
              <div class="sprint-block">
                <div class="sprint-block-title">Où cours-tu ?</div>
                <div class="sprint-toggle">
                  <button :class="{ active: sprintMode === 'exterieur' }" @click="sprintMode = 'exterieur'">🏟️ Extérieur</button>
                  <button :class="{ active: sprintMode === 'tapis' }" @click="sprintMode = 'tapis'">🏃 Tapis</button>
                </div>
                <ul class="sprint-list">
                  <li v-for="(s, i) in (sprintMode === 'exterieur' ? activeSession.sprint.exterieur : activeSession.sprint.tapis)" :key="i">{{ s }}</li>
                </ul>
                <div v-if="sprintMode === 'tapis'" class="sprint-note">⚠️ {{ activeSession.sprint.tapisNote }}</div>
              </div>
              <div class="sprint-block">
                <div class="sprint-block-title">Technique</div>
                <ul class="sprint-list"><li v-for="(c, i) in activeSession.sprint.cues" :key="i">{{ c }}</li></ul>
              </div>
              <div class="sprint-cooldown">🧊 Retour au calme — {{ activeSession.sprint.cooldown }}</div>
            </div>

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
        <SportVariantSheet
          v-if="picking && pickingEx"
          :ex="pickingEx"
          :current="draftVariant[picking] ?? null"
          @pick="pickVariant(picking, $event)"
          @close="picking = null"
        />
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

    <!-- Aperçu lecture seule d'une séance quand une autre est déjà en cours -->
    <div v-if="previewSession" class="preview-overlay" @click.self="previewSession = null">
      <div class="preview-sheet" :style="{ '--c': previewSession.color }">
        <div class="preview-head">
          <div>
            <div class="preview-eyebrow">Aperçu · lecture seule</div>
            <h3 class="preview-title">{{ previewSession.name }}</h3>
          </div>
          <button class="sheet-close" aria-label="Fermer" @click="previewSession = null">×</button>
        </div>
        <div class="preview-note">🔒 Une séance est déjà en cours. Termine-la ou abandonne-la d'abord.</div>
        <div class="preview-list">
          <div v-for="(e, idx) in previewSession.exercises" :key="e.id" class="preview-ex" :class="{ 'ex-opt': e.optionnel }">
            <div class="preview-ex-head">
              <span class="preview-ex-name">{{ idx + 1 }}. {{ e.name }}<span v-if="e.optionnel" class="ex-opt-tag">facultatif</span></span>
              <span class="preview-ex-sets mono">{{ e.sets }} × {{ e.reps }}</span>
            </div>
            <div class="sc-muscles"><span v-for="m in exMuscles(e)" :key="m" class="sc-chip">{{ m }}</span></div>
            <div v-if="e.cues && e.cues.length" class="preview-cues">
              <div v-for="(c, i) in e.cues" :key="i" class="cue"><span class="cue-arrow">›</span>{{ c }}</div>
            </div>
          </div>
          <div v-if="previewSession.sprint" class="preview-ex">
            <div class="preview-ex-head"><span class="preview-ex-name">⚡ {{ previewSession.sprint.title }}</span></div>
          </div>
        </div>
        <button class="btn-primary preview-resume" @click="previewSession = null; expandSession()">↩ Reprendre la séance en cours</button>
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

    <!-- Ce que « reprise en main » veut dire, au moment où on l'active. -->
    <transition name="pop">
      <div v-if="swapEx" class="confirm-overlay" @click.self="swapAsk = null">
        <div class="confirm-box">
          <div class="confirm-emoji" aria-hidden="true">🔀</div>
          <div class="confirm-title">
            {{ draftSwap[swapEx.id] ? 'Annuler la reprise en main ?' : 'J’ai repris le mouvement en main' }}
          </div>
          <div class="confirm-text">
            <template v-if="draftSwap[swapEx.id]">
              <b>{{ swapEx.name }}</b> redeviendra comparable aux séances précédentes :
              records et progression reprennent leur fil.
            </template>
            <template v-else>
              À cocher après une <b>baisse volontaire de charge</b> : reprise, douleur ou
                            correction technique.
              <br><br>
              Sur <b>{{ swapEx.name }}</b>, records et progression <b>repartent de cette séance</b> :
                            la baisse ne sera pas lue comme une régression.
              <br><br>
              Si la machine était simplement occupée, utilise 🔁 : la progression reste
                              continue, convertie par le coefficient.
            </template>
          </div>
          <div class="confirm-actions">
            <button class="btn confirm-keep" @click="swapAsk = null">Annuler</button>
            <button class="confirm-yes" @click="confirmSwap">
              {{ draftSwap[swapEx.id] ? 'Retirer' : 'Oui, j’ai repris en main' }}
            </button>
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
    <Popup
      v-if="notingEx"
      ref="notePopup"
      persistent
      popup-class="note-popup"
      :title="`💬 ${notingEx.name}`"
      subtitle="Pourquoi ce mouvement-là a bougé"
      @close="noting = null"
    >
      <p v-if="previousNote(notingEx.id)" class="hint-pill note">
        La dernière fois : {{ previousNote(notingEx.id) }}
      </p>
      <textarea
        v-model="draftNote[notingEx.id]"
        class="note-input note-popup-input" rows="4"
        placeholder="Machine occupée, épaule qui tire, prise changée…"
      ></textarea>
      <p class="muted">
        Cette note s'affichera <b>à la prochaine séance</b>, en haut de cet exercice.
      </p>
      <div class="nav-row">
        <button v-if="draftNote[notingEx.id]?.trim()" class="btn flex-1" @click="clearNote(notingEx.id)">Effacer</button>
        <button class="btn-primary flex-1" @click="closeNote()">Terminé</button>
      </div>
    </Popup>

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
