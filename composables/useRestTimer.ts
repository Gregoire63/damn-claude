import { ref, watch } from 'vue'
import { KEEPALIVE_WAV } from '~/data/keepAliveAudio'

// Timer de repos partagé (module-scope) : la page peut le démarrer automatiquement
// quand une série est validée, et le composant SportRestTimer l'affiche.
const secondsLeft = ref(0)
const totalSeconds = ref(0)
let interval: ReturnType<typeof setInterval> | null = null
let endAt = 0 // timestamp de fin (ms) : le décompte se recale dessus, robuste à la mise en veille
let finished = false
let audioCtx: AudioContext | null = null
let keepAlive: HTMLAudioElement | null = null
let swReg: ServiceWorkerRegistration | null = null

// ─── Réglages du son / vibration de fin (choisis dans Profil, mémorisés) ─────
const SETTINGS_KEY = 'gr-timer-sound-v1'
const soundEnabled = ref(true)
const soundVolume = ref(0.7) // 0 → 1
const soundType = ref('bip')
const vibrationLevel = ref('strong') // aucune / légère / moyenne / forte
// Notification du système à la fin du repos : voir plus bas. Actif par défaut —
// c'est le comportement attendu en salle ; le réglage sert à le couper, pas à
// l'allumer.
const watchNotify = ref(true)
// Statut affiché à titre d'information : le web ne voit pas la montre, seulement
// si le navigateur nous autorise à poster la notification qu'elle relaiera.
const watchStatus = ref<'unknown' | 'unsupported' | 'default' | 'granted' | 'denied'>('unknown')

// Le web ne permet pas de régler l'AMPLITUDE de la vibration, seulement le motif
// (durées on/off en ms). On simule la « puissance » par des motifs + longs / répétés.
const VIBRATION_LEVELS: Record<string, number[]> = {
  off: [],
  light: [90],
  medium: [260],
  strong: [500, 120, 500, 120, 500],
}
export const VIBRATION_OPTIONS = [
  { key: 'off', label: 'Aucune' },
  { key: 'light', label: 'Légère' },
  { key: 'medium', label: 'Moyenne' },
  { key: 'strong', label: 'Forte' },
]
function vibratePattern(): number[] { return VIBRATION_LEVELS[vibrationLevel.value] ?? VIBRATION_LEVELS.strong }

// Motifs sonores générés à la volée (WebAudio) : { fréquence, départ, durée… }
interface ToneSpec { f: number; t: number; d: number; type?: OscillatorType; peak?: number }
const SOUNDS: Record<string, ToneSpec[]> = {
  bip: [{ f: 880, t: 0, d: 0.22 }, { f: 880, t: 0.28, d: 0.22 }],
  triple: [{ f: 1047, t: 0, d: 0.12 }, { f: 1047, t: 0.16, d: 0.12 }, { f: 1047, t: 0.32, d: 0.16 }],
  montee: [{ f: 523, t: 0, d: 0.16 }, { f: 659, t: 0.14, d: 0.16 }, { f: 784, t: 0.28, d: 0.28 }],
  cloche: [{ f: 660, t: 0, d: 0.6, peak: 0.6 }, { f: 1320, t: 0, d: 0.5, peak: 0.28 }, { f: 1980, t: 0, d: 0.35, peak: 0.14 }],
  doux: [{ f: 440, t: 0, d: 0.5, type: 'triangle', peak: 0.8 }],
}
export const SOUND_OPTIONS = [
  { key: 'bip', label: 'Bip double' },
  { key: 'triple', label: 'Triple bip' },
  { key: 'montee', label: 'Montée' },
  { key: 'cloche', label: 'Cloche' },
  { key: 'doux', label: 'Doux' },
]

let settingsHydrated = false
function hydrateSettings() {
  if (settingsHydrated || !import.meta.client) return
  settingsHydrated = true
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (raw) {
      const s = JSON.parse(raw)
      if (typeof s.enabled === 'boolean') soundEnabled.value = s.enabled
      if (typeof s.volume === 'number') soundVolume.value = Math.min(1, Math.max(0, s.volume))
      if (typeof s.type === 'string' && SOUNDS[s.type]) soundType.value = s.type
      if (typeof s.vibration === 'string' && VIBRATION_LEVELS[s.vibration]) vibrationLevel.value = s.vibration
      if (typeof s.watch === 'boolean') watchNotify.value = s.watch
    }
  } catch { /* réglages illisibles */ }
  refreshWatchStatus()
}
if (import.meta.client) {
  watch([soundEnabled, soundVolume, soundType, vibrationLevel, watchNotify], () => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ enabled: soundEnabled.value, volume: soundVolume.value, type: soundType.value, vibration: vibrationLevel.value, watch: watchNotify.value })) } catch { /* ignore */ }
  })
}

function getCtx(): AudioContext | null {
  if (!import.meta.client) return null
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    audioCtx = audioCtx || new Ctx()
    if (audioCtx.state === 'suspended') audioCtx.resume()
    return audioCtx
  } catch { return null }
}

// Chaîne « master » : saturation douce (WaveShaper tanh). Elle rend le son
// nettement plus FORT et plus riche qu'un simple sinus, sans le clipping brutal
// (les pics sont arrondis) → « 100 % » tape beaucoup plus fort.
let masterInput: GainNode | null = null
function makeSatCurve(drive: number): Float32Array {
  const n = 2048, c = new Float32Array(n)
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(drive * x) }
  return c
}
function getMasterInput(ctx: AudioContext): AudioNode {
  if (!masterInput) {
    masterInput = ctx.createGain()
    masterInput.gain.value = 4.5 // grosse surcharge → onde quasi CARRÉE = beaucoup plus fort
    const shaper = ctx.createWaveShaper()
    shaper.curve = makeSatCurve(3.4)
    shaper.oversample = '4x'
    // Limiteur : plaque le niveau au maximum sans clipper (volume perçu max)
    const comp = ctx.createDynamicsCompressor()
    comp.threshold.value = -2
    comp.knee.value = 0
    comp.ratio.value = 20
    comp.attack.value = 0.001
    comp.release.value = 0.1
    const out = ctx.createGain()
    out.gain.value = 1.0
    masterInput.connect(shaper); shaper.connect(comp); comp.connect(out); out.connect(ctx.destination)
  }
  return masterInput
}

function playTones(ctx: AudioContext, vol: number, tones: ToneSpec[]) {
  const now = ctx.currentTime
  const dest = getMasterInput(ctx)
  for (const s of tones) {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.connect(g); g.connect(dest)
    o.type = s.type || 'sine'
    o.frequency.value = s.f
    const peak = Math.max(0.0002, (s.peak ?? 1.3) * vol)
    g.gain.setValueAtTime(0.0001, now + s.t)
    g.gain.exponentialRampToValueAtTime(peak, now + s.t + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, now + s.t + s.d)
    o.start(now + s.t); o.stop(now + s.t + s.d + 0.02)
  }
}

// ─── Audio « keep-alive » ───────────────────────────────────────────────────
// Un onglet en arrière-plan voit ses timers gelés par Chrome Android… sauf s'il
// joue de l'audio. On boucle donc une piste quasi-inaudible pendant le repos :
// le minuteur reste actif et le bip de fin sonne à l'heure même hors de la page.
function ensureKeepAlive(): HTMLAudioElement | null {
  if (!import.meta.client) return null
  if (!keepAlive) {
    keepAlive = new Audio(KEEPALIVE_WAV)
    keepAlive.loop = true
    keepAlive.preload = 'auto'
  }
  return keepAlive
}
function startKeepAlive() {
  const a = ensureKeepAlive()
  if (!a) return
  try { a.currentTime = 0; const p = a.play(); if (p && typeof p.catch === 'function') p.catch(() => {}) } catch { /* ignore */ }
}
function stopKeepAlive() {
  if (keepAlive) { try { keepAlive.pause() } catch { /* ignore */ } }
}

// Débloque l'audio sur un geste utilisateur (obligatoire sur iOS/mobile)
function unlockAudio() {
  const ctx = getCtx()
  if (!ctx) return
  try {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    g.gain.value = 0.0001
    o.connect(g); g.connect(ctx.destination)
    o.start(); o.stop(ctx.currentTime + 0.02)
  } catch { /* audio indisponible */ }
}

// ─── La notification de fin de repos ────────────────────────────────────────
// Ce n'est PAS une intégration de montre : rien n'est lu, rien n'est synchronisé.
// Les montres d'entrée de gamme n'exposent aucun SDK tiers, et le seul canal ouvert
// est le relais de notifications du téléphone — l'application compagnon de la montre
// répercute la notification et fait vibrer le poignet. Les vraies intégrations, qui
// lisent des données, sont dans server/connecteurs/.
// Or la notification n'était envoyée QUE page masquée : en salle l'app reste
// ouverte, donc rien au poignet. `watchNotify` la déclenche aussi app visible.
const NOTIF_TAG = 'rest-timer'
const TEST_TAG = 'rest-timer-test'
const NOTIF_TITLE = "⏱️ C'est reparti"
const NOTIF_AUTOCLOSE_MS = 12000

function notifSupported(): boolean {
  return import.meta.client && 'Notification' in window
}

function refreshWatchStatus() {
  if (!import.meta.client) return
  watchStatus.value = notifSupported() ? (Notification.permission as 'default' | 'granted' | 'denied') : 'unsupported'
}

async function getSwReg(): Promise<ServiceWorkerRegistration | null> {
  if (swReg) return swReg
  if (!import.meta.client || !('serviceWorker' in navigator)) return null
  try { swReg = await navigator.serviceWorker.ready } catch { swReg = null }
  return swReg
}

// Demande la permission si elle n'a jamais été tranchée (doit partir d'un tap).
async function askNotifPermission(): Promise<boolean> {
  if (!notifSupported()) return false
  if (Notification.permission === 'default') {
    try { await Notification.requestPermission() } catch { /* refus */ }
  }
  refreshWatchStatus()
  return watchStatus.value === 'granted'
}

async function showRestNotification(body: string, silent: boolean, autoClose: boolean, tag = NOTIF_TAG) {
  if (!notifSupported() || Notification.permission !== 'granted') return
  // vibrate/renotify : hors du type DOM NotificationOptions mais gérés par Android via le SW
  const opts = {
    body,
    tag,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    silent,
    vibrate: vibratePattern(),
    renotify: true,
  } as NotificationOptions
  const reg = await getSwReg()
  try {
    if (reg && reg.showNotification) await reg.showNotification(NOTIF_TITLE, opts)
    else new Notification(NOTIF_TITLE, opts) // desktop sans service worker
  } catch { return }
  // App sous les yeux : la notification n'a servi qu'à faire vibrer la montre.
  // On la retire pour ne pas empiler des lignes dans le volet du téléphone.
  if (autoClose && reg) {
    setTimeout(() => {
      reg.getNotifications({ tag }).then((ns) => ns.forEach((n) => n.close())).catch(() => {})
    }, NOTIF_AUTOCLOSE_MS)
  }
}

// Prépare la notification système (son + vibration en arrière-plan sur Android)
function prepareNotify() {
  if (!import.meta.client) return
  try {
    if (notifSupported() && Notification.permission === 'default') {
      Notification.requestPermission().then(refreshWatchStatus).catch(() => {})
    }
    getSwReg()
  } catch { /* notifications indisponibles */ }
}

// Active le relais montre : la permission de notifier doit être demandée depuis
// le tap qui l'active, sinon le navigateur ignore la demande.
async function setWatchNotify(on: boolean): Promise<boolean> {
  watchNotify.value = on
  if (!on) return false
  const ok = await askNotifPermission()
  if (ok) getSwReg()
  return ok
}

// Essai du relais : envoie exactement la notification de fin de repos telle
// qu'elle partira app ouverte, réglages courants compris.
async function testWatch(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!notifSupported()) { watchStatus.value = 'unsupported'; return 'unsupported' }
  if (!(await askNotifPermission())) return 'denied'
  const reg = await getSwReg()
  // Android ré-alerte plus fiablement sur une notification neuve que sur le
  // remplacement d'une notification encore affichée → on retire l'essai précédent.
  if (reg) {
    try { (await reg.getNotifications({ tag: TEST_TAG })).forEach((n) => n.close()) } catch { /* ignore */ }
  }
  await showRestNotification('Essai — ta montre doit vibrer ⌚', !soundEnabled.value, true, TEST_TAG)
  return 'granted'
}

function beep() {
  if (!import.meta.client || !soundEnabled.value) return
  const ctx = getCtx()
  if (!ctx) return
  try { playTones(ctx, soundVolume.value, SOUNDS[soundType.value] || SOUNDS.bip) } catch { /* audio indisponible */ }
}

// Bouton « Tester » : joue le son choisi (même si désactivé) + la vibration choisie
function testSound() {
  unlockAudio()
  const ctx = getCtx()
  if (ctx) { try { playTones(ctx, soundVolume.value, SOUNDS[soundType.value] || SOUNDS.bip) } catch { /* ignore */ } }
  try { const vp = vibratePattern(); if (import.meta.client && navigator.vibrate && vp.length) navigator.vibrate(vp) } catch { /* ignore */ }
}

// Alerte de fin : vibration au premier plan + notification (son + vibration) en arrière-plan
function alertEnd() {
  if (!import.meta.client) return
  const hidden = document.hidden
  const silentNotif = !soundEnabled.value

  beep()
  const vp = vibratePattern()
  try { if (navigator.vibrate && vp.length) navigator.vibrate(vp) } catch { /* ignore */ }
  if (hidden || watchNotify.value) {
    showRestNotification('Repos terminé — série suivante 💪', silentNotif, !hidden)
  }
}

function clear() {
  if (interval) clearInterval(interval)
  interval = null
}

function tick() {
  const remainMs = endAt - Date.now()
  secondsLeft.value = Math.max(0, Math.ceil(remainMs / 1000))
  if (remainMs <= 0 && !finished) {
    finished = true
    clear()
    secondsLeft.value = 0
    stopKeepAlive()
    alertEnd()
  }
}

function stop() {
  clear()
  stopKeepAlive()
  finished = true
  secondsLeft.value = 0
  totalSeconds.value = 0
}

function start(sec: number) {
  clear()
  finished = false
  unlockAudio()    // appelé depuis un tap → autorise le son de fin sur mobile
  prepareNotify()  // demande la permission de notifier (pour l'arrière-plan)
  startKeepAlive() // garde l'onglet actif en arrière-plan
  endAt = Date.now() + sec * 1000
  totalSeconds.value = sec
  secondsLeft.value = sec
  // tick fréquent : le décompte se recale sur endAt au retour de veille/arrière-plan
  interval = setInterval(tick, 250)
}

function addTime(delta: number) {
  if (secondsLeft.value <= 0) return
  endAt += delta * 1000
  const remain = Math.max(1, Math.ceil((endAt - Date.now()) / 1000))
  secondsLeft.value = remain
  if (remain > totalSeconds.value) totalSeconds.value = remain
}

// Recale immédiatement l'affichage quand on revient sur l'onglet
if (import.meta.client) {
  document.addEventListener('visibilitychange', () => { if (interval) tick() })
}

export function useRestTimer() {
  hydrateSettings()
  /**
   * Les réglages partent dans la sauvegarde, et en reviennent.
   *
   * Ils étaient écrits en localStorage et NULLE PART ailleurs : ni dans l'export
   * manuel, ni dans le miroir. Restaurer sur un téléphone neuf remettait donc le son
   * par défaut, le volume par défaut, la vibration par défaut — et surtout coupait le
   * relais vers la montre, silencieusement. On croit avoir tout récupéré, et le
   * minuteur de repos ne vibre plus au poignet sans qu'on comprenne pourquoi.
   *
   * Aucun secret là-dedans : cinq réglages d'interface, rien qui identifie ni qui
   * ouvre quoi que ce soit.
   */
  function snapshot() {
    return {
      restTimer: {
        enabled: soundEnabled.value,
        volume: soundVolume.value,
        type: soundType.value,
        vibration: vibrationLevel.value,
        watch: watchNotify.value,
      },
    }
  }

  /** Restauration TOLÉRANTE : une sauvegarde d'avant ce champ passe sans erreur. */
  function restore(data: Record<string, unknown>) {
    const s = data?.restTimer as Record<string, unknown> | undefined
    if (!s || typeof s !== 'object') return
    if (typeof s.enabled === 'boolean') soundEnabled.value = s.enabled
    if (typeof s.volume === 'number') soundVolume.value = Math.min(1, Math.max(0, s.volume))
    if (typeof s.type === 'string' && SOUNDS[s.type]) soundType.value = s.type
    if (typeof s.vibration === 'string' && VIBRATION_LEVELS[s.vibration as keyof typeof VIBRATION_LEVELS]) vibrationLevel.value = s.vibration as typeof vibrationLevel.value
    if (typeof s.watch === 'boolean') watchNotify.value = s.watch
  }

  return {
    secondsLeft, totalSeconds, start, stop, addTime,
    soundEnabled, soundVolume, soundType, testSound, SOUND_OPTIONS,
    vibrationLevel, VIBRATION_OPTIONS,
    watchNotify, watchStatus, setWatchNotify, testWatch,
    snapshot, restore,
  }
}
