import { computed, ref } from 'vue'
import type { Reglage, Segment } from '~/lib/fractionne'
import {
  REGLAGE_DEFAUT, bilanPartiel, borner, bornesDe, dureeTotale, planDe, segmentA, texteAnnonce,
} from '~/lib/fractionne'
import { debloquerAudio, motifVibration, sonAutorise, sonner, veilleAudio, veilleProchainSon } from '~/composables/useRestTimer'

/**
 * Le chrono de fractionné — la séance de sprint, pilotée à l'oreille.
 *
 * Le sprint était la seule partie du programme qu'on ne pouvait pas suivre sans
 * regarder l'écran : trois minutes de course tranquille, une minute de repos, puis
 * N fois « 30 s de sprint / 2 min de repos ». Sur une piste on tient un téléphone
 * d'une main, ou on court ; pas les deux. Chaque changement de phase se manquait de
 * dix ou quinze secondes, et un repos de 2 min qui en dure 2 min 15 six fois de
 * suite, c'est une séance d'intervalles qui n'en est plus une.
 *
 * Le PLAN (qui vient quand, et combien de temps) vit dans `lib/fractionne.ts`, pur
 * et testé. Ce fichier ne fait que l'égrener dans le temps, et parler.
 */

// ─── Motifs sonores ─────────────────────────────────────────────────────────
// Le timbre porte l'information à lui seul : doux et descendant pour le repos,
// aigu et répété pour le sprint. Le jour où la voix ne part pas — écran verrouillé,
// synthèse occupée, casque bluetooth qui vient de se connecter — l'oreille sait
// quand même ce qui commence.
const TON_SPRINT = [{ f: 1320, t: 0, d: 0.14 }, { f: 1320, t: 0.18, d: 0.14 }, { f: 1760, t: 0.36, d: 0.3 }]
const TON_REPOS = [{ f: 523, t: 0, d: 0.22, type: 'triangle' as OscillatorType }, { f: 392, t: 0.2, d: 0.34, type: 'triangle' as OscillatorType }]
const TON_ECHAUFF = [{ f: 659, t: 0, d: 0.18 }, { f: 784, t: 0.16, d: 0.26 }]
const TON_FIN = [{ f: 784, t: 0, d: 0.18 }, { f: 988, t: 0.16, d: 0.18 }, { f: 1319, t: 0.32, d: 0.42 }]
/** Le tic du décompte : court et sec, pour ne pas mordre sur l'annonce qui suit. */
const TON_TIC = [{ f: 880, t: 0, d: 0.07, peak: 0.9 }]

function tonsDe(s: Segment) {
  if (s.kind === 'sprint') return TON_SPRINT
  if (s.kind === 'repos') return TON_REPOS
  return TON_ECHAUFF
}

const FRACTIONNE_KEY = 'gr-fractionne-v1'

// ─── La voix ────────────────────────────────────────────────────────────────
/**
 * `speechSynthesis` : aucune dépendance, aucun fichier à télécharger.
 *
 * Deux précautions valent d'être écrites. `cancel()` avant chaque annonce, parce que
 * la file d'attente de la synthèse ne se vide pas toute seule : un « Repos » resté
 * en file se fait entendre trente secondes plus tard, au milieu du sprint suivant.
 * Et `lang = 'fr-FR'` explicitement — sur un téléphone configuré en anglais,
 * « Dernier sprint » sort avec une voix anglaise, incompréhensible à l'effort.
 */
function parler(texte: string) {
  if (!import.meta.client || !sonAutorise()) return
  const synth = window.speechSynthesis
  if (!synth) return
  try {
    synth.cancel()
    const u = new SpeechSynthesisUtterance(texte)
    u.lang = 'fr-FR'
    u.rate = 1.05
    u.volume = 1
    synth.speak(u)
  } catch { /* synthèse indisponible */ }
}

function taire() {
  if (!import.meta.client) return
  try { window.speechSynthesis?.cancel() } catch { /* ignore */ }
}

function vibrer(fort: boolean) {
  if (!import.meta.client) return
  try {
    const motif = fort ? motifVibration() : [80]
    if (navigator.vibrate && motif.length) navigator.vibrate(motif)
  } catch { /* vibration indisponible */ }
}

// ─── État partagé (module) ──────────────────────────────────────────────────
// Même choix que le minuteur de repos : l'état vit au niveau du module, pas dans le
// composant. La feuille de séance se réduit, se rouvre et change d'onglet ; le
// fractionné, lui, doit continuer à tourner derrière.
const reglage = ref<Reglage>({ ...REGLAGE_DEFAUT })
const plan = ref<Segment[]>([])
const enCours = ref(false)
const enPause = ref(false)
const index = ref(-1)
const resteS = ref(0)
const totalResteS = ref(0)
/** Rempli quand le bloc s'achève : ce que l'écran inscrit alors au journal. */
const bilan = ref<{ sprints: number, sprintS: number, echauffementS: number } | null>(null)

let debutMs = 0
let boucle: ReturnType<typeof setInterval> | null = null
let dernierAnnonce = -1
let dernierTic = -1
let pauseMs = 0
let veille: { release: () => Promise<void> } | null = null

// ─── L'écran reste allumé ───────────────────────────────────────────────────
/**
 * Sans ça, l'écran s'éteint au bout de trente secondes de course. Le son continue —
 * c'est l'essentiel — mais le coup d'œil « combien de sprints restent » demande
 * alors de réveiller le téléphone, de le déverrouiller et de retrouver la feuille.
 *
 * On le REDEMANDE au retour au premier plan : Android révoque le verrou dès que la
 * page passe derrière, et il ne revient pas de lui-même.
 */
async function prendreVeille() {
  if (!import.meta.client) return
  try {
    const wl = (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<typeof veille> } }).wakeLock
    if (!wl) return
    veille = await wl.request('screen')
  } catch { /* refusé ou indisponible : le bloc tourne quand même */ }
}
function rendreVeille() {
  if (!veille) return
  try { void veille.release() } catch { /* ignore */ }
  veille = null
}

let hydrate = false
function hydrater() {
  if (hydrate || !import.meta.client) return
  hydrate = true
  try {
    const raw = localStorage.getItem(FRACTIONNE_KEY)
    if (raw) reglage.value = borner(JSON.parse(raw))
  } catch { /* réglage illisible */ }
}

function ecrire() {
  if (!import.meta.client) return
  try { localStorage.setItem(FRACTIONNE_KEY, JSON.stringify(reglage.value)) } catch { /* ignore */ }
}

function annoncer(i: number) {
  const s = plan.value[i]
  if (!s) return
  sonner(tonsDe(s))
  parler(texteAnnonce(s))
  vibrer(s.kind === 'sprint')
}

function arreterBoucle() {
  if (boucle) clearInterval(boucle)
  boucle = null
}

function terminer() {
  const r = reglage.value
  arreterBoucle()
  rendreVeille()
  veilleAudio(false)
  enCours.value = false
  enPause.value = false
  index.value = plan.value.length
  resteS.value = 0
  totalResteS.value = 0
  sonner(TON_FIN)
  parler('Terminé')
  vibrer(true)
  bilan.value = { sprints: r.sprints, sprintS: r.sprintS, echauffementS: r.echauffementS }
}

function battre() {
  if (!enCours.value || enPause.value) return
  const ecoule = Date.now() - debutMs
  const b = bornesDe(plan.value)
  const i = segmentA(plan.value, ecoule)

  if (i >= plan.value.length) { terminer(); return }

  // Le changement de phase se DÉDUIT du temps écoulé ; il n'est pas déclenché par un
  // minuteur par segment. Un onglet gelé trente secondes en arrière-plan rattrape
  // donc la bonne phase d'un coup, au lieu de dérouler la suite avec trente secondes
  // de retard jusqu'à la fin du bloc.
  const change = i !== dernierAnnonce
  if (change) {
    dernierAnnonce = i
    index.value = i
    dernierTic = -1
    annoncer(i)
  }

  resteS.value = Math.max(0, Math.ceil((b[i + 1] - ecoule) / 1000))
  totalResteS.value = Math.max(0, Math.ceil((b[b.length - 1] - ecoule) / 1000))

  // Le prochain son du bloc, annoncé à la piste de veille : c'est le tic des trois
  // dernières secondes, ou le changement de phase s'il n'y a pas de tic. Sans cette
  // annonce, un bloc passé en arrière-plan attendait le filet des quatre minutes —
  // soit un échauffement et deux sprints courus sans entendre un seul signal.
  if (change) veilleProchainSon(Date.now() + Math.max(0, resteS.value - 3) * 1000)

  // Décompte des trois dernières secondes — sauf sur le dernier segment, où c'est
  // l'annonce de fin qui sonne.
  if (resteS.value <= 3 && resteS.value >= 1 && i < plan.value.length - 1 && resteS.value !== dernierTic) {
    dernierTic = resteS.value
    sonner(TON_TIC)
  }
}

if (import.meta.client) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    if (enCours.value && !enPause.value && !veille) void prendreVeille()
    if (enCours.value) battre()
  })
}

// ─── L'API ──────────────────────────────────────────────────────────────────
function lancer() {
  hydrater()
  const p = planDe(reglage.value)
  if (!p.length) return
  arreterBoucle()
  plan.value = p
  bilan.value = null
  dernierAnnonce = -1
  dernierTic = -1
  index.value = -1
  enPause.value = false
  enCours.value = true
  debutMs = Date.now()
  totalResteS.value = dureeTotale(reglage.value)
  resteS.value = p[0].dureeS
  debloquerAudio() // parti d'un tap : c'est ce qui autorise le son sur mobile
  veilleAudio(true)
  void prendreVeille()
  boucle = setInterval(battre, 200)
  battre()
}

function arreter() {
  const tournait = enCours.value
  // AVANT la remise à zéro de `index` : c'est lui qui dit où on s'est arrêté.
  const fait = tournait ? bilanPartiel(plan.value, index.value, reglage.value) : null
  arreterBoucle()
  rendreVeille()
  if (tournait) veilleAudio(false)
  enCours.value = false
  enPause.value = false
  index.value = -1
  resteS.value = 0
  totalResteS.value = 0
  // Couper le bloc ne doit pas effacer ce qui a été couru. Quatre sprints sur six
  // restent quatre sprints, et personne n'a envie de les retaper à la main.
  bilan.value = fait
  taire()
}

function basculerPause() {
  if (!enCours.value) return
  if (enPause.value) {
    // On repart en DÉCALANT le départ : le temps passé en pause n'a pas compté.
    debutMs += Date.now() - pauseMs
    enPause.value = false
    battre()
    return
  }
  pauseMs = Date.now()
  enPause.value = true
  taire()
}

/** Passer la phase en cours — l'échauffement était déjà fait, ce repos est de trop. */
function passer() {
  if (!enCours.value || enPause.value) return
  const b = bornesDe(plan.value)
  const i = segmentA(plan.value, Date.now() - debutMs)
  if (i >= plan.value.length) { terminer(); return }
  // On avance le départ pour que le temps écoulé tombe juste APRÈS la borne visée.
  debutMs = Date.now() - b[i + 1]
  battre()
}

/** L'écran efface le bilan après avoir rempli le journal. */
function viderBilan() { bilan.value = null }

export function useFractionne() {
  hydrater()

  const segment = computed<Segment | null>(() => plan.value[index.value] ?? null)
  const phase = computed(() => segment.value?.kind ?? null)
  /** « 3 / 6 » — le seul chiffre qu'on cherche des yeux en reprenant son souffle. */
  const position = computed(() => {
    const s = segment.value
    return s?.num ? `${s.num} / ${reglage.value.sprints}` : ''
  })
  /** Avancement du segment courant, pour l'anneau. */
  const fraction = computed(() => {
    const s = segment.value
    return s?.dureeS ? Math.min(1, Math.max(0, 1 - resteS.value / s.dureeS)) : 0
  })
  const suivant = computed<Segment | null>(() => plan.value[index.value + 1] ?? null)

  function definir(patch: Partial<Reglage>) {
    reglage.value = borner({ ...reglage.value, ...patch })
    ecrire()
  }

  /**
   * Les réglages partent dans la sauvegarde, comme ceux du minuteur de repos.
   *
   * Même raison, et elle a déjà coûté une fois : cinq nombres qu'on met deux séances
   * à caler, qui disparaissent au changement de téléphone sans que rien ne le
   * signale. On s'en aperçoit sur la piste, au moment de lancer le bloc.
   */
  function snapshot() {
    return { fractionne: { ...reglage.value } }
  }

  /** Restauration TOLÉRANTE : une sauvegarde d'avant ce réglage passe sans erreur. */
  function restore(data: Record<string, unknown>) {
    const f = data?.fractionne as Partial<Reglage> | undefined
    if (!f || typeof f !== 'object') return
    reglage.value = borner(f)
    ecrire()
  }

  return {
    reglage, definir, plan, segment, phase, position, fraction, suivant,
    enCours, enPause, index, resteS, totalResteS, bilan, viderBilan,
    lancer, arreter, basculerPause, passer,
    snapshot, restore,
  }
}
