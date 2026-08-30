import { computed, ref } from 'vue'
import { useWithings } from '~/composables/useWithings'
import { useNutrition } from '~/composables/useNutrition'
import type { BodyEntry } from '~/lib/withings'

// ─────────────────────────────────────────────────────────────────────────────
// Fitbit : la deuxième marque, et la preuve que le raccord tient.
// ─────────────────────────────────────────────────────────────────────────────
//
// Ce fichier ne stocke ni pesées ni pas. Il ne fait que trois choses : garder SES
// jetons, faire le trajet d'autorisation, et verser ce qu'il rapporte dans les
// magasins existants — `adopt` pour les pesées, `setSteps` pour les pas.
//
// C'est délibéré, et c'est tout l'intérêt. Une deuxième marque qui se serait
// construit son propre historique aurait donné deux séries du même poids : la courbe
// en aurait choisi une, le métabolisme de base l'autre, et l'écart se serait
// découvert des semaines plus tard sur un chiffre qui ne colle pas. Le seul endroit
// où une source est particulière, c'est son OAuth ; partout ailleurs, un poids est
// un poids.
//
// ⚠️ NON VÉRIFIÉ DE BOUT EN BOUT. Les points d'entrée et les formats viennent de la
// documentation officielle de Fitbit (vérifiée en août 2026) et le trajet reprend
// celui de Withings, éprouvé lui. Mais aucun compte développeur n'était disponible
// pour dérouler le flux en vrai : le premier qui branche une vraie application doit
// s'attendre à corriger un détail, et les messages d'erreur sont écrits pour ça.

const TOK_KEY = 'gr-fitbit-tok-v1'
const NONCE_KEY = 'gr-fitbit-nonce-v1'
const SYNC_KEY = 'gr-fitbit-sync-v1'

export interface FitbitTokens { accessToken: string, refreshToken: string, expiresAt: number }

const tokens = ref<FitbitTokens | null>(null)
const lastSync = ref(0)
const busy = ref(false)
const error = ref<string | null>(null)
const needsReconnect = ref(false)
let hydrated = false

function safeParse<T>(raw: string | null, fb: T): T {
  if (!raw) return fb
  try { return JSON.parse(raw) as T }
  catch { return fb }
}
function write(key: string, value: unknown) {
  if (!import.meta.client) return
  try { localStorage.setItem(key, JSON.stringify(value)) }
  catch { /* quota ou navigation privée : on continue sans persister */ }
}

export function useFitbit() {
  const { adopt } = useWithings()

  function hydrate() {
    if (hydrated || !import.meta.client) return
    tokens.value = safeParse<FitbitTokens | null>(localStorage.getItem(TOK_KEY), null)
    lastSync.value = safeParse<number>(localStorage.getItem(SYNC_KEY), 0)
    hydrated = true
  }

  const connected = computed(() => !!tokens.value?.accessToken)

  /** 32 caractères du générateur cryptographique : un mot de passe à usage unique. */
  function newNonce(): string {
    const b = new Uint8Array(24)
    crypto.getRandomValues(b)
    return Array.from(b, x => x.toString(36).padStart(2, '0')).join('').slice(0, 32)
  }

  /**
   * Part autoriser chez Fitbit.
   *
   * Le nonce est tiré ici et rangé ici. Le serveur le signe dans le `state`, le
   * retour dépose les jetons sous ce nonce, et l'application vient les chercher à sa
   * prochaine ouverture — c'est le seul fil qui ne quitte jamais le contexte de la
   * PWA, alors que l'autorisation, elle, se fera dans le navigateur du système.
   */
  function connect() {
    if (!import.meta.client) return
    const nonce = newNonce()
    write(NONCE_KEY, { nonce, at: Date.now() })
    window.location.href = `/api/fitbit/authorize?nonce=${encodeURIComponent(nonce)}`
  }

  /** Récupère les jetons déposés par le retour d'autorisation, s'il y en a. Le
   *  silence est le cas NORMAL : on ne connecte pas une montre tous les jours. */
  async function claimPending(): Promise<boolean> {
    if (!import.meta.client) return false
    const raw = safeParse<{ nonce?: string, at?: number } | null>(localStorage.getItem(NONCE_KEY), null)
    if (!raw?.nonce) return false
    // Passé dix minutes, le dépôt a expiré côté serveur de toute façon.
    if (!raw.at || Date.now() - raw.at > 10 * 60 * 1000) {
      try { localStorage.removeItem(NONCE_KEY) }
      catch { /* ignore */ }
      return false
    }
    try {
      const res = await $fetch<{ tokens: Record<string, unknown> }>('/api/fitbit/claim', {
        method: 'POST',
        body: { nonce: raw.nonce },
      })
      try { localStorage.removeItem(NONCE_KEY) }
      catch { /* ignore */ }
      const t = res.tokens ?? {}
      if (!t.access_token) return false
      tokens.value = {
        accessToken: String(t.access_token),
        refreshToken: String(t.refresh_token ?? ''),
        expiresAt: Number(t.expires_at ?? 0),
      }
      write(TOK_KEY, tokens.value)
      needsReconnect.value = false
      return true
    }
    catch {
      // 404 : l'autorisation n'est pas encore terminée dans l'autre navigateur. On
      // GARDE le nonce et on retentera à la prochaine ouverture.
      return false
    }
  }

  /**
   * Va chercher pesées et pas, et les verse dans les magasins communs.
   *
   * `days` par défaut à 90 : assez pour tracer une tendance dès la première synchro,
   * et très en dessous du plafond de 1095 jours de Fitbit.
   */
  async function sync(days = 90): Promise<boolean> {
    if (!import.meta.client || !tokens.value) return false
    busy.value = true
    error.value = null
    try {
      const res = await $fetch<{
        entries: BodyEntry[]
        steps: { date: string, steps: number }[]
        tokens?: FitbitTokens
      }>('/api/fitbit/sync', {
        method: 'POST',
        body: {
          accessToken: tokens.value.accessToken,
          refreshToken: tokens.value.refreshToken,
          days,
        },
      })
      // Le serveur a rafraîchi le jeton : on garde le nouveau, sinon la prochaine
      // synchro repartirait avec celui qui vient d'expirer.
      if (res.tokens?.accessToken) {
        tokens.value = res.tokens
        write(TOK_KEY, tokens.value)
      }
      adopt(res.entries ?? [])
      const { setSteps } = useNutrition()
      for (const s of res.steps ?? []) {
        // Zéro pas est une vraie journée, mais l'écrire écraserait l'estimation d'un
        // jour que Fitbit ne connaît simplement pas. On n'écrit que ce qui est positif.
        if (s.steps > 0) setSteps(s.date, s.steps)
      }
      lastSync.value = Date.now()
      write(SYNC_KEY, lastSync.value)
      return true
    }
    catch (e) {
      const m = (e as { statusMessage?: string, message?: string })
      error.value = m.statusMessage ?? m.message ?? 'Synchronisation impossible'
      // 401 : le refresh_token est mort. C'est un état, pas un incident passager :
      // l'écran doit proposer de réautoriser plutôt qu'un bouton « réessayer » qui
      // échouera à l'identique.
      if ((e as { status?: number }).status === 401) needsReconnect.value = true
      return false
    }
    finally { busy.value = false }
  }

  function disconnect() {
    tokens.value = null
    needsReconnect.value = false
    if (!import.meta.client) return
    // Les pesées déjà récupérées restent : elles sont à la personne, pas à Fitbit.
    for (const k of [TOK_KEY, NONCE_KEY]) {
      try { localStorage.removeItem(k) }
      catch { /* ignore */ }
    }
  }

  hydrate()
  return { hydrate, connected, connect, disconnect, claimPending, sync, busy, error, needsReconnect, lastSync }
}
