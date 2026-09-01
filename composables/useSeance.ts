import { computed, effectScope, reactive, ref, watch } from 'vue'
import type { Exercise, Session } from '~/data/sportProgram'
import type { SessionRecord } from '~/composables/useWorkout'
import { useWorkout } from '~/composables/useWorkout'
import { useRestTimer } from '~/composables/useRestTimer'
import { useProgram } from '~/composables/useProgram'
import { useJour } from '~/composables/useJour'
import { useFlash } from '~/composables/useFlash'
import { isTimed } from '~/lib/program'
import { setText } from '~/lib/setText'
import { WARMUP_REST, restFor } from '~/lib/rest'
import { warmupLoad, isEffort } from '~/utils/sportStats'
import type { Effort, PrKind } from '~/utils/sportStats'

// ─────────────────────────────────────────────────────────────────────────────
// La séance en cours : son état, sa feuille, sa saisie, son enregistrement.
// ─────────────────────────────────────────────────────────────────────────────
//
// Sept cents lignes qui vivaient dans la page. Elles en sont sorties le jour où les
// onglets sont devenus cinq pages : la feuille de séance est un CALQUE au-dessus de
// l'onglet courant, pas un morceau d'onglet. Elle doit survivre au passage de
// l'accueil au journal, et deux écrans doivent pouvoir agir dessus — l'accueil pour
// démarrer une séance, le journal pour en rouvrir une enregistrée.
//
// D'où un état unique, hors de tout composant.
//
// ── Pourquoi un `effectScope` détaché ───────────────────────────────────────
//
// Les observateurs d'ici — le chrono qui égrène les secondes, la sauvegarde
// automatique du brouillon — doivent vivre aussi longtemps que l'application. Créés
// dans le `setup` du premier écran qui appelle `useSeance()`, ils seraient liés à la
// portée de CET écran et mourraient avec lui : il aurait suffi de démarrer une séance
// depuis l'accueil puis d'ouvrir le journal pour que le chrono se fige et que le
// brouillon cesse d'être sauvegardé. Sans erreur, évidemment.
//
// `effectScope(true)` est détaché : il ne s'attache à aucun parent, donc rien ne
// l'arrête. C'est le pendant exact des `ref` au niveau du module qu'utilise le reste
// de l'application, pour du code qui a besoin de `useRouter()` et ne peut donc pas
// vivre au niveau du module.

let instance: ReturnType<typeof creer> | null = null

export function useSeance() {
  if (!instance) instance = effectScope(true).run(creer)!
  return instance
}

/** Uniquement pour les tests : repartir d'une séance vierge entre deux cas. */
export function resetSeance() {
  instance = null
}

function creer() {
  const router = useRouter()
  const {
    bodyWeight, bodyWeightAt, lastPerf, lastOn, ratioFor, lastEffort,
    recordSession, updateSession, suggestWeight, sessionLog, fatigue,
  } = useWorkout()
  const { start: startRest, secondsLeft: restLeft, stop: stopRest, addTime: addRest } = useRestTimer()
  const restFmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  const { program: prog, sessionById } = useProgram()
  const { todayISO, todayDow } = useJour()
  const { showFlash } = useFlash()

  const activeSession = ref<Session | null>(null)
  const openEx = ref<string | null>(null)
  const flash = ref('')
  // L'écran de chargement est géré par Nuxt (spa-loading-template.html) : /sport est
  // rendu 100 % client (ssr:false), donc plus de « gel » d'hydratation à masquer ici.
  const draft = reactive<Record<string, { w: string; r: string; done: boolean; warm: boolean; w2: string; r2: string }[]>>({})
  // Ressenti déclaré par exercice (facile / correct / dur / échec) : c'est lui qui
  // permet d'auto-réguler la charge conseillée à la séance suivante.
  const draftEffort = reactive<Record<string, Effort>>({})
  // Matériel différent de la fois d'avant : la charge n'est plus comparable, les
  // records et la stagnation repartent d'ici. Cf. `sinceSwap` dans utils/sportStats.
  const draftSwap = reactive<Record<string, true>>({})
  // Note libre de la séance (douleur, sommeil, machine occupée…) : c'est ce qui
  // explique une mauvaise séance quand on la relit des semaines plus tard.
  const sessionNote = ref('')
  // Commentaire PAR exercice. La note de séance répond à « comment allait la
  // journée » ; celle-ci répond à « pourquoi ce mouvement-là a bougé » — et c'est
  // cette réponse-là qu'on veut relire la fois suivante, au moment de recharger la
  // barre, pas trois semaines plus tard en bas d'une séance.
  const draftNote = reactive<Record<string, string>>({})
  // Machine réellement utilisée, par exercice. Vide = celle du programme.
  //
  // C'est ce qui remplace « la charge n'est plus comparable » : au lieu de couper
  // l'historique en deux le jour où le rack est pris, on déclare SUR QUOI on a
  // travaillé, et les comparaisons se font en équivalent référence.
  const draftVariant = reactive<Record<string, string>>({})
  // L'exercice dont la feuille « choisir une machine » est ouverte.
  const picking = ref<string | null>(null)
  const pickingEx = computed(() => activeSession.value?.exercises.find(e => e.id === picking.value) ?? null)
  /**
   * L'exercice dont le commentaire est en cours d'écriture.
   *
   * Le champ était déplié DANS la carte, tout en bas, sous les séries et les
   * sensations. Écrire trois mots demandait donc d'ouvrir la carte, de la faire
   * défiler jusqu'au bout, puis d'écrire dans un écran qui bougeait sous le clavier
   * — pour une phrase qu'on tape entre deux séries, une main sur la barre.
   *
   * En fenêtre, le geste tient en deux touches : 💬, on écrit, terminé. La carte
   * n'a plus besoin d'être ouverte, et le champ est au milieu de l'écran, seul.
   */
  const noting = ref<string | null>(null)
  const notingEx = computed(() => activeSession.value?.exercises.find(e => e.id === noting.value) ?? null)
  /** La fenêtre s'anime en se fermant : on passe par elle plutôt que de couper le `v-if`. */
  const notePopup = ref<{ dismiss: () => void } | null>(null)
  const closeNote = () => (notePopup.value ? notePopup.value.dismiss() : (noting.value = null))
  function clearNote(id: string) {
    delete draftNote[id]
    closeNote()
  }
  /** Ce qui avait été noté la dernière fois sur cet exercice. */
  const previousNote = (id: string) => lastPerf(id)?.note ?? null
  const sessionStart = ref(0)
  // Édition d'une séance déjà enregistrée (au lieu d'en démarrer une neuve)
  const editingRecord = ref<SessionRecord | null>(null)
  const editReturn = ref<string>('/')
  // Aperçu en lecture seule (quand une séance est déjà en cours et qu'on clique une autre)
  const previewSession = ref<Session | null>(null)
  // Brouillon de la séance active, sauvegardé en continu (survit à un refresh)
  const DRAFT_KEY = 'gr-active-draft-v1'
  const sprintMode = ref<'exterieur' | 'tapis'>('exterieur')
  const sprintOpen = ref(false)
  const sprintInfoOpen = ref(false)
  // Saisie des efforts de course : ex. « 3 × 20 s @ 16 km/h »
  interface SprintRow { kind: 'echauffement' | 'sprint'; count: string; duration: string; intensity: string }
  const sprintDraft = ref<SprintRow[]>([])
  function newSprintRows(): SprintRow[] {
    return [
      { kind: 'echauffement', count: '1', duration: '', intensity: '' },
      { kind: 'sprint', count: '', duration: '', intensity: '' },
    ]
  }
  function addSprintRow(kind: 'echauffement' | 'sprint') { sprintDraft.value.push({ kind, count: '', duration: '', intensity: '' }) }
  function removeSprintRow(i: number) { sprintDraft.value.splice(i, 1) }

  // ─────────── Chrono séance ───────────
  // La durée tourne tant qu'une séance est active (même réduite en mini-feuille),
  // pour l'afficher en direct dans la barre « séance en cours ».
  const elapsed = ref(0)
  let elapsedInt: ReturnType<typeof setInterval> | null = null
  const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  watch(() => activeSession.value, (s) => {
    if (elapsedInt) { clearInterval(elapsedInt); elapsedInt = null }
    if (!s) return
    // Édition d'une ancienne séance : le chrono ne redémarre PAS. On affiche
    // simplement la durée enregistrée (figée).
    if (editingRecord.value) {
      elapsed.value = (editingRecord.value.durationMin ?? 0) * 60
      return
    }
    elapsed.value = Math.floor((Date.now() - sessionStart.value) / 1000)
    elapsedInt = setInterval(() => { elapsed.value = Math.floor((Date.now() - sessionStart.value) / 1000) }, 1000)
  }, { immediate: true })

  // ─────────── Feuille de séance animée (vrai bottom-sheet, superposé à l'app) ───
  // La feuille est un CALQUE au-dessus de l'onglet courant (qui reste rendu
  // derrière, avec un voile) : quand on la fait glisser vers le bas, on voit
  // l'écran de l'app derrière. sheetOpen est indépendant de `view`.
  const sheetOpen = ref(false)
  const dragY = ref(0)            // translation verticale courante (px)
  const dragging = ref(false)     // doigt en train de glisser → transition figée
  const sheetClosing = ref(false) // la feuille descend puis se démonte
  let dragStartY = 0
  let dragMoved = false
  const sheetVisible = computed(() => !!activeSession.value && (sheetOpen.value || sheetClosing.value))
  const sheetStyle = computed(() => {
    const t = `translateY(${dragY.value}px)`
    return dragging.value ? { transform: t, transition: 'none' } : { transform: t }
  })
  // Voile derrière la feuille : opaque à fond, s'éclaircit quand on descend la feuille
  const scrimStyle = computed(() => {
    const h = import.meta.client ? window.innerHeight : 800
    const o = Math.max(0, 1 - dragY.value / h)
    return dragging.value ? { opacity: String(o), transition: 'none' } : { opacity: String(o) }
  })
  function sheetH() { return import.meta.client ? window.innerHeight : 800 }

  // Ouvre la feuille : elle monte depuis le bas (par-dessus l'onglet courant)
  function expandSession() {
    sheetClosing.value = false
    if (!import.meta.client) { sheetOpen.value = true; return }
    dragging.value = true          // fige la transition pour placer la feuille en bas
    dragY.value = sheetH()
    sheetOpen.value = true
    requestAnimationFrame(() => {
      dragging.value = false        // réactive la transition
      requestAnimationFrame(() => { dragY.value = 0 }) // → remonte en glissant
    })
  }
  // Anime la DESCENTE de la feuille (glisse vers le bas) puis exécute `after`
  // (nettoyage/état) une fois l'animation finie. Utilisé par toutes les fermetures
  // (réduire, terminer, abandonner) pour un rendu cohérent.
  function animateSheetDown(after?: () => void) {
    const done = after ?? (() => {})
    if (!import.meta.client || (!sheetOpen.value && !sheetClosing.value)) { sheetOpen.value = false; done(); return }
    if (sheetClosing.value) { done(); return }
    sheetClosing.value = true
    sheetOpen.value = false         // l'app derrière redevient active
    requestAnimationFrame(() => { dragY.value = sheetH() })
    setTimeout(() => { sheetClosing.value = false; dragY.value = 0; done() }, 300)
  }
  // Réduit la feuille : elle descend (l'app est visible derrière) puis se démonte.
  // En mode ÉDITION, fermer ne réduit pas : ça propose d'abandonner les modifs.
  function collapseSession() {
    if (sheetClosing.value) return
    if (editingRecord.value) { dragY.value = 0; askCancel(); return } // la feuille remonte, on confirme
    animateSheetDown()
  }
  // Glisser la poignée : la feuille suit le doigt ; relâchée assez bas → réduit.
  // On écoute sur window pendant le geste → suit le doigt même hors de l'en-tête,
  // pour la souris comme le tactile, sans casser le tap (pas de capture de pointeur).
  function onDragMove(e: PointerEvent) {
    if (!dragging.value) return
    const dy = e.clientY - dragStartY
    if (dy > 4) dragMoved = true
    dragY.value = Math.max(0, dy)   // uniquement vers le bas
  }
  function onDragEnd() {
    if (!dragging.value) return
    dragging.value = false
    if (import.meta.client) {
      window.removeEventListener('pointermove', onDragMove)
      window.removeEventListener('pointerup', onDragEnd)
      window.removeEventListener('pointercancel', onDragEnd)
    }
    if (dragY.value > 110) collapseSession()
    else dragY.value = 0            // pas assez bas → revient en place (animé)
  }
  function onDragStart(e: PointerEvent) {
    if (sheetClosing.value || !import.meta.client) return
    dragging.value = true; dragMoved = false; dragStartY = e.clientY
    window.addEventListener('pointermove', onDragMove)
    window.addEventListener('pointerup', onDragEnd)
    window.addEventListener('pointercancel', onDragEnd)
  }
  function requestCollapse() { if (!dragMoved) collapseSession() } // tap sur la poignée

  // ─────────── Popup « annuler la séance » (remplace le confirm() natif) ────────
  const cancelPromptOpen = ref(false)
  function askCancel() { cancelPromptOpen.value = true }

  /**
   * L'exercice dont on valide la « reprise en main ».
   *
   * Le bouton ne bascule plus directement. Ce réglage remet les records et la
   * progression à zéro à partir de cette séance : c'est irréversible dans les
   * courbes, et une icône seule ne peut pas porter ça. On explique dans la carte,
   * au moment où la question se pose.
   */
  const swapAsk = ref<string | null>(null)
  const swapEx = computed(() => activeSession.value?.exercises.find(e => e.id === swapAsk.value) ?? null)

  function confirmSwap() {
    if (swapAsk.value) toggleSwap(swapAsk.value)
    swapAsk.value = null
  }
  function confirmCancel() {
    cancelPromptOpen.value = false
    animateSheetDown(() => clearActive()) // la feuille glisse vers le bas puis se ferme
  }

  /**
   * Les lignes de saisie d'un exercice, préremplies pour LA MACHINE choisie.
   *
   * On repart de la dernière séance faite sur cette machine-là — c'est le repère le
   * plus sûr, il n'a besoin d'aucune conversion. À défaut (première fois sur cette
   * machine), on prend le conseil de charge, qui lui est converti depuis l'historique
   * de la référence : c'est exactement ce dont on a besoin le jour où le rack est pris.
   */
  /**
   * Reprend une charge d'une séance passée, en la remettant au poids d'aujourd'hui.
   *
   * Sur un exercice au poids du corps — dips, tractions — la charge notée est le
   * TOTAL soulevé : le corps plus le lest. Recopier telle quelle celle de la dernière
   * séance revenait donc à recopier aussi le poids de corps de ce jour-là, et il ne
   * bougeait plus jamais. Trois kilos perdus, et l'application continuait de proposer
   * 94 : la courbe de progression restait plate, les dips passaient pour « bloqués »
   * chaque semaine, et le rapport affichait trois kilos de lest fantôme sur des séries
   * faites sans ceinture.
   *
   * Ce qu'il faut reprendre, c'est le LEST — la seule part qui soit une décision.
   * On le retrouve en retirant le poids de corps du jour de la séance, et on le
   * rajoute au poids d'aujourd'hui.
   *
   * Sans pesée à l'une des deux dates on ne convertit rien : mieux vaut proposer
   * l'ancienne valeur, visiblement à corriger, qu'un chiffre calculé sur un poids
   * inventé.
   */
  function rebase(e: Exercise, valeur: number | null | undefined, dateSeance: string): string {
    if (valeur == null) return ''
    if (!e.bodyweight) return String(valeur)
    const alors = bodyWeightAt(dateSeance)
    const maintenant = seanceWeight.value
    if (alors === null || maintenant === null) return String(valeur)
    const lest = valeur - alors
    return String(Math.round((maintenant + lest) * 10) / 10)
  }

  function prefillRows(e: Exercise, variant?: string): DraftRow[] {
    const bw = seanceWeight.value ?? 0 // poids de corps DU JOUR, pour les exos au poids du corps
    const last = lastOn(e.id, variant)
    let rows: DraftRow[]
    if (last && last.sets.length) {
      // Poids ET reps des séries de travail préremplis. Rien n'est coché → il n'y a
      // plus qu'à ajuster et valider.
      rows = last.sets.map(st => ({
        w: rebase(e, st.w, last.date),
        r: st.r != null ? String(st.r) : '',
        done: false,
        warm: !!st.warm,
        w2: rebase(e, st.w2, last.date),
        r2: st.r2 != null ? String(st.r2) : '',
      }))
    } else {
      const sug = suggestWeight(e, variant)
      rows = Array.from({ length: e.sets }, () => ({
        w: e.bodyweight && bw ? String(bw) : (sug.weight ? String(sug.weight) : ''),
        r: '', done: false, warm: false, w2: '', r2: '',
      }))
    }
    // Échauffement auto : une série d'échauffement en tête, calculée sur la charge
    // de travail la plus lourde (voir withWarmup) — remplace tout échauffement repris.
    return withWarmup(e, rows)
  }

  /**
   * Changer de machine en cours de route. On reprend le préremplissage — c'est tout
   * l'intérêt : les kilos affichés sont ceux à mettre SUR CETTE machine-là. Sauf si
   * des séries sont déjà validées : on ne réécrit jamais ce qui a été fait.
   */
  function pickVariant(exId: string, id: string | null) {
    const ex = activeSession.value?.exercises.find(e => e.id === exId)
    picking.value = null
    if (!ex) return
    if (id) draftVariant[exId] = id
    else delete draftVariant[exId]
    if (!(draft[exId] || []).some(r => r.done)) draft[exId] = prefillRows(ex, id ?? undefined)
  }

  // ─────────── Séance ───────────
  function startSession(s: Session) {
    // Une séance est déjà en cours : impossible d'en démarrer une autre.
    // Même séance → on la reprend ; autre séance → aperçu en lecture seule.
    if (activeSession.value) {
      if (activeSession.value.id === s.id) expandSession()
      else previewSession.value = s
      return
    }
    activeSession.value = s
    editingRecord.value = null
    for (const k of Object.keys(draft)) delete draft[k]
    for (const k of Object.keys(draftEffort)) delete draftEffort[k]
    for (const k of Object.keys(draftSwap)) delete draftSwap[k]
    for (const k of Object.keys(draftNote)) delete draftNote[k]
    for (const k of Object.keys(draftVariant)) delete draftVariant[k]
    sessionNote.value = ''
    for (const e of s.exercises) draft[e.id] = prefillRows(e)
    openEx.value = s.exercises[0].id
    sprintOpen.value = false
    sprintInfoOpen.value = false
    sprintDraft.value = s.sprint ? newSprintRows() : []
    sessionStart.value = Date.now()
    expandSession()
  }
  // Rouvre une séance déjà enregistrée pour la modifier (préremplie avec les perfs saisies)
  function editSession(rec: SessionRecord) {
    if (activeSession.value) { showFlash('Termine ou abandonne ta séance en cours avant d’en modifier une autre.'); return }
    const s = sessionById(rec.sessionId) || prog.value.find(p => p.name === rec.name)
    if (!s) return
    activeSession.value = s
    editingRecord.value = rec
    editReturn.value = router.currentRoute.value.path
    for (const k of Object.keys(draft)) delete draft[k]
    for (const k of Object.keys(draftEffort)) delete draftEffort[k]
    for (const k of Object.keys(draftSwap)) delete draftSwap[k]
    for (const k of Object.keys(draftNote)) delete draftNote[k]
    for (const k of Object.keys(draftVariant)) delete draftVariant[k]
    sessionNote.value = rec.note ?? ''
    const bw = seanceWeight.value ?? 0
    for (const e of s.exercises) {
      const entry = rec.entries.find(en => en.exId === e.id)
      if (entry && isEffort(entry.effort)) draftEffort[e.id] = entry.effort
      if (entry?.swap) draftSwap[e.id] = true
      if (entry?.note) draftNote[e.id] = entry.note
      if (entry?.variant) draftVariant[e.id] = entry.variant
      if (entry && entry.sets.length) {
        draft[e.id] = entry.sets.map(st => ({
          w: st.w != null ? String(st.w) : '',
          r: st.r != null ? String(st.r) : '',
          done: true,
          warm: !!st.warm,
          w2: st.w2 != null ? String(st.w2) : '',
          r2: st.r2 != null ? String(st.r2) : '',
        }))
      } else {
        draft[e.id] = Array.from({ length: e.sets }, () => ({
          w: e.bodyweight && bw ? String(bw) : '', r: '', done: false, warm: false, w2: '', r2: '',
        }))
      }
    }
    openEx.value = s.exercises[0].id
    sprintOpen.value = false
    sprintInfoOpen.value = false
    sprintDraft.value = (rec.sprint && rec.sprint.length)
      ? rec.sprint.map(sp => ({ kind: sp.kind, count: String(sp.count), duration: sp.duration, intensity: sp.intensity }))
      : (s.sprint ? newSprintRows() : [])
    sessionStart.value = Date.now() - (rec.durationMin ?? 0) * 60000
    expandSession()
  }
  // On ne compte que les séries de travail (l'échauffement ne compte pas)
  const doneCount = (exId: string) => (draft[exId] || []).filter(s => s.done && !s.warm).length
  const workCount = (exId: string) => (draft[exId] || []).filter(s => !s.warm).length
  // Un exercice est « fini » quand toutes ses séries de travail sont cochées
  const isExDone = (exId: string) => { const wc = workCount(exId); return wc > 0 && doneCount(exId) === wc }
  /**
   * Le seuil des 80 % se compte sur les exercices EXIGÉS.
   *
   * Un mouvement facultatif est là s'il reste du temps ; le compter au dénominateur
   * ferait qu'une séance complète mais sans les accessoires refuserait de s'enregistrer.
   * Sur une séance de six dont deux facultatifs, faire les quatre vrais donnait 4/6 =
   * 67 % et un bouton grisé — pour une séance faite en entier.
   *
   * Fait, un facultatif compte NORMALEMENT partout ailleurs : volume, records,
   * historique. Ce n'est pas du travail au rabais, c'est du travail en plus.
   */
  const requiredEx = computed(() => (activeSession.value?.exercises ?? []).filter(e => !e.optionnel))
  const finishedCount = computed(() => requiredEx.value.filter(e => isExDone(e.id)).length)

  const finishReady = computed(() => {
    if (editingRecord.value) return true
    const total = requiredEx.value.length
    return total ? finishedCount.value / total >= 0.8 : true
  })
  // Un 2e tap sur le même ressenti l'annule (on peut se tromper de bouton)
  function setEffort(exId: string, v: Effort) {
    if (draftEffort[exId] === v) delete draftEffort[exId]
    else draftEffort[exId] = v
  }
  function toggleSwap(exId: string) {
    if (draftSwap[exId]) delete draftSwap[exId]
    else draftSwap[exId] = true
  }
  function addSet(exId: string) { const rows = draft[exId]; const lastW = [...rows].reverse().find(s => !s.warm); rows.push({ w: lastW?.w ?? '', r: '', done: false, warm: false, w2: lastW?.w2 ?? '', r2: '' }) }
  function addWarmup(exId: string) { const wu = warmupFor(exId); draft[exId].unshift({ w: wu !== null ? String(wu) : '', r: '', done: false, warm: true, w2: '', r2: '' }) }
  function removeSet(exId: string, i: number) { if (draft[exId].length > 1) draft[exId].splice(i, 1) }
  // Libellé : « Éch » pour l'échauffement, sinon numéro de série de travail
  function setLabel(rows: { warm: boolean }[], i: number) {
    if (rows[i].warm) return 'Éch'
    let n = 0
    for (let k = 0; k <= i; k++) if (!rows[k].warm) n++
    return 'S' + n
  }
  function toggleSet(s: { done: boolean; warm: boolean }, e: Exercise) {
    s.done = !s.done
    if (s.done) startRest(s.warm ? WARMUP_REST : restFor(e))
  }
  type DraftRow = { w: string; r: string; done: boolean; warm: boolean; w2: string; r2: string }
  // Charge d'échauffement d'un exercice, d'après la série de travail la plus lourde
  // actuellement saisie (utilisée par le bouton « + Échauffement »).
  function warmupFor(exId: string): number | null {
    const work = (draft[exId] || []).filter(s => !s.warm)
    return warmupLoad(Math.max(0, ...work.map(r => parseFloat(r.w) || 0)))
  }
  // Échauffement auto : sur un exercice suffisamment chargé (hors poids du corps et
  // hors superset), on garantit UNE série d'échauffement en tête, calculée à ~50 % de
  // la charge de travail la plus lourde (arrondie à 2,5 kg). Recalculée à chaque
  // démarrage à partir des séries de travail préremplies — donc de tes dernières perfs.
  // Tout échauffement repris de l'ancienne séance est remplacé par cette série calculée.
  function withWarmup(e: Exercise, rows: DraftRow[]): DraftRow[] {
    const work = rows.filter(r => !r.warm)
    if (e.bodyweight || e.superset) return work // pas d'échauffement chiffré ici
    const wu = warmupLoad(Math.max(0, ...work.map(r => parseFloat(r.w) || 0)))
    if (wu === null) return work // charge trop légère → échauffement inutile
    return [{ w: String(wu), r: '10', done: false, warm: true, w2: '', r2: '' }, ...work]
  }
  // Ferme la séance active : coupe le chrono de repos, vide le brouillon (mémoire +
  // stockage). Appelé quand la séance est terminée (enregistrée) ou abandonnée.
  function clearActive() {
    stopRest() // coupe le chrono de repos (son/vibration/keep-alive)
    activeSession.value = null
    editingRecord.value = null
    previewSession.value = null
    sheetOpen.value = false; sheetClosing.value = false; dragY.value = 0
    for (const k of Object.keys(draft)) delete draft[k]
    for (const k of Object.keys(draftEffort)) delete draftEffort[k]
    for (const k of Object.keys(draftSwap)) delete draftSwap[k]
    for (const k of Object.keys(draftNote)) delete draftNote[k]
    for (const k of Object.keys(draftVariant)) delete draftVariant[k]
    sessionNote.value = ''
    sprintDraft.value = []
    if (import.meta.client) { try { localStorage.removeItem(DRAFT_KEY) } catch { /* stockage indispo */ } }
  }
  function finishSession() {
    if (!activeSession.value || !finishReady.value) return
    const sess = activeSession.value
    const durationMin = Math.round((Date.now() - sessionStart.value) / 60000)
    const entries = sess.exercises.map(e => ({
      exId: e.id,
      sets: (draft[e.id] || []).filter(s => s.done && s.w !== '' && s.r !== '').map(s => ({
        w: parseFloat(s.w), r: parseInt(s.r, 10),
        ...(e.superset && s.w2 !== '' && s.r2 !== '' ? { w2: parseFloat(s.w2), r2: parseInt(s.r2, 10) } : {}),
        ...(s.warm ? { warm: true } : {}),
      })),
      ...(draftEffort[e.id] ? { effort: draftEffort[e.id] } : {}),
      ...(draftSwap[e.id] ? { swap: true as const } : {}),
      ...(draftNote[e.id]?.trim() ? { note: draftNote[e.id].trim() } : {}),
      ...(draftVariant[e.id] ? { variant: draftVariant[e.id] } : {}),
    }))
    const sprintEfforts = sprintDraft.value
      .filter(r => r.duration.trim() || r.intensity.trim())
      .map(r => ({ kind: r.kind, count: parseInt(r.count, 10) || 1, duration: r.duration.trim(), intensity: r.intensity.trim() }))
    // Mode édition : on met à jour l'enregistrement existant au lieu d'en créer un
    // nouveau. On CONSERVE la durée d'origine (le chrono ne tourne pas en édition).
    if (editingRecord.value) {
      const keepMin = editingRecord.value.durationMin
      updateSession(editingRecord.value, entries, keepMin, sprintEfforts, sessionNote.value)
      const back = editReturn.value
      animateSheetDown(() => { clearActive(); void router.push(back); showFlash(keepMin ? `Séance modifiée ✓ (${keepMin} min)` : 'Séance modifiée ✓') })
      return
    }
    const prs = recordSession(entries, durationMin, { sessionId: sess.id, name: sess.name, note: sessionNote.value }, sprintEfforts)
    // Le planning hebdo reste STABLE : on ne réécrit plus le jour avec la séance
    // faite (ça faisait dériver la semaine — mauvais jour, doublons).
    animateSheetDown(() => {
      clearActive()
      void router.push('/')
      showFlash(prs.length ? `Séance enregistrée (${durationMin} min) — 🏆 ${prLabel(prs)}` : `Séance enregistrée ✓ (${durationMin} min)`)
    })
  }
  // Message de records : « charge », « reps » et « 1RM » sont trois progrès distincts.
  const PR_WORDS: Record<PrKind, string> = { charge: 'charge', reps: 'reps', e1rm: '1RM' }
  function prLabel(prs: { name: string; kinds: PrKind[] }[]): string {
    return 'PR ' + prs.map(p => `${p.name} (${p.kinds.map(k => PR_WORDS[k]).join(' + ')})`).join(', ')
  }
  // Décharge conseillée : accumulation de volume, ressenti dégradé ou stagnation
  // généralisée. Détail et raisons dans l'onglet Rapport.
  const deloadAdvised = computed(() => {
    if (!todayISO.value || todayDow.value === null) return false
    return fatigue(todayISO.value, todayDow.value).level === 'deload'
  })

  // Conseil de surcharge progressive. Les reps décident ; le ressenti les qualifie.
  // « à l'échec » ne fait plus redescendre à lui seul — seulement quand les reps
  // sont tombées SOUS la fourchette.
  function overloadHint(ex: Exercise): { cls: string; text: string } | null {
    if (ex.bodyweight || ex.superset) return null // au poids du corps / superset : progression gérée à la main
    // Série au temps : ne rien dire laisserait croire à un bug. On dit pourquoi.
    if (isTimed(ex)) return { cls: 'keep', text: '⏱ Série au temps — la progression se joue sur la durée tenue ou la charge portée, pas sur les reps' }
    const s = suggestWeight(ex, draftVariant[ex.id])
    const felt = lastEffort(ex.id)
    if (s.reason === 'deload') return { cls: 'stall', text: `💥 À l'échec sous la fourchette → on redescend à ${s.weight} kg pour repartir propre` }
    if (s.reason === 'progress') {
      return felt === 'easy' && s.weight === s.base + s.inc
        ? { cls: 'progress', text: `😀 Noté « facile » la dernière fois → passe à ${s.weight} kg` }
        : { cls: 'progress', text: `🎯 Objectif de reps atteint → +${s.inc} kg par série (jusqu'à ${s.weight} kg)` }
    }
    if (s.reason === 'stall') return { cls: 'stall', text: `⏫ Bloqué ${s.streak} séances à ${s.base} kg — on force +${s.inc} kg par série` }
    if (s.reason === 'keep' && felt === 'fail') return { cls: 'keep', text: `💥 À l'échec dans la fourchette → on reste à ${s.base} kg et on va chercher la rep suivante` }
    if (s.reason === 'keep' && felt === 'hard') return { cls: 'keep', text: `😤 C'était dur → on reste à ${s.base} kg et on gagne des reps` }
    return null
  }

  // Exercice aux haltères : on note le poids TOTAL des deux haltères (cohérent avec le
  // total d'une barre), jamais la charge d'un seul. Rappel affiché pour rester constant.
  function isDumbbell(ex: Exercise): boolean {
    return !ex.superset && /haltère/i.test(ex.name)
  }

  /**
   * La dernière pesée connue — celle de la balance, puisque Withings les y déverse.
   *
   * On cherche la date la plus RÉCENTE au lieu de prendre le dernier élément. La liste
   * est tenue triée par `setBodyWeightAt`, mais une sauvegarde restaurée est reprise
   * telle quelle : un fichier dans le désordre aurait alors fait passer une vieille
   * pesée pour la dernière, et le préremplissage des dips avec.
   */
  const latestWeight = computed(() => {
    let best: { date: string, kg: number } | null = null
    for (const e of bodyWeight.value) {
      if (!best || e.date > best.date) best = e
    }
    return best?.kg ?? null
  })
  /**
   * Le poids de corps DU JOUR de la séance — pas la dernière pesée connue.
   *
   * La nuance compte dès qu'on a sauté une pesée : la dernière connue peut dater de
   * trois jours, et c'est elle qui servait à préremplir les dips. Trois jours, ce
   * n'est pas grand-chose sur la balance, mais le chiffre enregistré devient un
   * mélange de deux dates dont on ne peut plus rien déduire.
   *
   * On retombe sur la dernière pesée quand le jour n'en a pas : mieux vaut un poids
   * approché et daté qu'un champ vide qu'on remplira au jugé.
   */
  const seanceIso = computed(() => editingRecord.value?.at.slice(0, 10) ?? todayISO.value ?? null)
  const seanceWeight = computed(() => (seanceIso.value ? bodyWeightAt(seanceIso.value) : null) ?? latestWeight.value)

  /**
   * Le LEST, c'est-à-dire la seule part de la charge qui soit une décision.
   *
   * L'écran demandait le TOTAL : à 91,5 kg de poids de corps, ajouter dix kilos aux
   * dips voulait dire taper 101,5. On faisait donc une addition, en salle, entre deux
   * séries — et une addition faite là se fait un jour de travers.
   *
   * Le stockage, lui, garde le total. Records, courbes, conversions de machine et
   * `rebase` raisonnent dessus depuis le premier jour ; changer l'unité en base
   * réécrirait tout l'historique pour une commodité de saisie. On convertit donc à
   * l'entrée et à la sortie du champ, et nulle part ailleurs.
   */
  function lestOf(w: string): string {
    const bw = seanceWeight.value
    if (bw === null || w === '') return w
    const total = Number(w)
    if (!Number.isFinite(total)) return ''
    const lest = Math.round((total - bw) * 10) / 10
    return lest === 0 ? '' : String(lest)
  }
  function setLest(row: { w: string }, v: string) {
    const bw = seanceWeight.value
    if (bw === null) { row.w = v; return }
    if (v.trim() === '') { row.w = String(bw); return }
    const lest = Number(v)
    row.w = Number.isFinite(lest) ? String(Math.round((bw + lest) * 10) / 10) : ''
  }
  /** Le total réellement enregistré, affiché sous le champ : c'est lui qui fera foi. */
  function totalOf(w: string): string {
    const n = Number(w)
    return Number.isFinite(n) && n > 0 ? `${Math.round(n * 10) / 10} kg` : ''
  }

  /**
   * Ce qu'on a fait la dernière fois, en une expression.
   *
   * C'était la charge maximale, en kilos — juste sur un développé, absurde sur une
   * suspension à la barre, où le maximum de kilos est le poids de corps et ne bouge
   * jamais. On rend donc la meilleure SÉRIE selon l'unité de l'exercice : la plus
   * longue quand il se compte en secondes, la plus lourde sinon.
   */
  function derniere(e: Exercise): string {
    const last = lastPerf(e.id)
    const sets = (last?.sets ?? []).filter(s => !s.warm)
    if (!sets.length) return ''
    const cle = isTimed(e) ? (s: { r?: number }) => s.r ?? 0 : (s: { w?: number }) => s.w ?? 0
    const best = sets.reduce((a, b) => (cle(b) > cle(a) ? b : a))
    return setText(best, e, bodyWeightAt(last!.date))
  }



  // ─────────── Sauvegarde automatique du brouillon ───────────
  // À chaque changement de la séance active (poids, reps, cases cochées, sprint…), on
  // écrit tout dans localStorage. Un refresh accidentel ne fait plus rien perdre.
  if (import.meta.client) {
    watch(
      () => (activeSession.value
        ? JSON.stringify({
            id: activeSession.value.id,
            draft,
            draftEffort,
            draftSwap,
            draftNote,
            draftVariant,
            note: sessionNote.value,
            sprintDraft: sprintDraft.value,
            sessionStart: sessionStart.value,
            openEx: openEx.value,
            editingAt: editingRecord.value?.at ?? null,
            editReturn: editReturn.value,
          })
        : ''),
      (val) => {
        try {
          if (val) localStorage.setItem(DRAFT_KEY, val)
          else localStorage.removeItem(DRAFT_KEY)
        } catch { /* stockage plein/indisponible */ }
      },
    )
  }
  // Restaure le brouillon au démarrage (après un refresh) et rouvre la séance en cours.
  function restoreDraft() {
    let raw: string | null = null
    try { raw = localStorage.getItem(DRAFT_KEY) } catch { return }
    if (!raw) return
    try {
      const s = JSON.parse(raw)
      const sess = prog.value.find(p => p.id === s.id)
      if (!sess) { localStorage.removeItem(DRAFT_KEY); return }
      activeSession.value = sess
      for (const k of Object.keys(draft)) delete draft[k]
      if (s.draft && typeof s.draft === 'object') Object.assign(draft, s.draft)
      for (const k of Object.keys(draftEffort)) delete draftEffort[k]
      if (s.draftEffort && typeof s.draftEffort === 'object') {
        for (const [k, v] of Object.entries(s.draftEffort)) if (isEffort(v)) draftEffort[k] = v
      }
      for (const k of Object.keys(draftSwap)) delete draftSwap[k]
    for (const k of Object.keys(draftNote)) delete draftNote[k]
    for (const k of Object.keys(draftVariant)) delete draftVariant[k]
      if (s.draftSwap && typeof s.draftSwap === 'object') {
        for (const k of Object.keys(s.draftSwap)) draftSwap[k] = true
      }
      if (s.draftVariant && typeof s.draftVariant === 'object') {
        for (const [k, v] of Object.entries(s.draftVariant)) if (typeof v === 'string' && v) draftVariant[k] = v
      }
      if (s.draftNote && typeof s.draftNote === 'object') {
        for (const [k, v] of Object.entries(s.draftNote)) {
          if (typeof v === 'string' && v) draftNote[k] = v
        }
      }
      sessionNote.value = typeof s.note === 'string' ? s.note : ''
      sprintDraft.value = Array.isArray(s.sprintDraft) ? s.sprintDraft : []
      sessionStart.value = typeof s.sessionStart === 'number' ? s.sessionStart : Date.now()
      openEx.value = s.openEx ?? sess.exercises[0].id
      editReturn.value = s.editReturn || '/'
      editingRecord.value = s.editingAt ? (sessionLog().find(r => r.at === s.editingAt) || null) : null
      // L'onglet SOUS la feuille n'est plus forcé à l'accueil : l'URL dit déjà
      // remis celui qu'on avait quitté, et c'est celui-là qu'on retrouve en repliant.
      sheetOpen.value = true // on rouvre directement la séance en cours (feuille ouverte)
    } catch { try { localStorage.removeItem(DRAFT_KEY) } catch { /* ignore */ } }
  }

  return {
    // état
    activeSession, editingRecord, previewSession, openEx, sessionNote,
    draft, draftEffort, draftSwap, draftNote, draftVariant,
    picking, pickingEx, noting, notingEx, notePopup, closeNote, clearNote, previousNote,
    sprintMode, sprintOpen, sprintInfoOpen, sprintDraft, newSprintRows, addSprintRow, removeSprintRow,
    elapsed, fmtClock,
    // feuille
    sheetOpen, sheetClosing, sheetVisible, sheetStyle, scrimStyle, dragY, dragging,
    expandSession, collapseSession, animateSheetDown, requestCollapse,
    onDragStart, onDragMove, onDragEnd,
    // cartes de confirmation
    cancelPromptOpen, askCancel, confirmCancel, swapAsk, swapEx, confirmSwap,
    // saisie
    prefillRows, pickVariant, startSession, editSession, restoreDraft, clearActive,
    doneCount, workCount, isExDone, requiredEx, finishedCount, finishReady, finishSession,
    setEffort, toggleSwap, addSet, addWarmup, removeSet, setLabel, toggleSet, warmupFor,
    // lecture
    deloadAdvised, overloadHint, isDumbbell, latestWeight, seanceIso, seanceWeight,
    lestOf, setLest, totalOf, derniere, rebase,
    // repris des autres magasins, pour que la feuille n'ait qu'un seul interlocuteur
    ratioFor, restLeft, restFmt, addRest, stopRest,
  }
}
