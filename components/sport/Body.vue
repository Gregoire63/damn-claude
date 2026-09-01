<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useMesures } from '~/composables/useMesures'
import { useConnecteurs } from '~/composables/useConnecteur'
import { providerById } from '~/lib/providers'
import { useNutrition } from '~/composables/useNutrition'
import { useWorkout } from '~/composables/useWorkout'
import { useProfile } from '~/composables/useProfile'
import { IMPEDANCE_CAVEAT, dailySeries, weeklySlope } from '~/lib/mesures'
import { STEPS_ONSITE, STEPS_TT } from '~/lib/nutritionStats'
import { isoOf, shiftIso } from '~/utils/sportStats'

// Suivi du corps, affiché en tête du Rapport : ce que la balance mesure et ce qu'on
// en déduit. C'est le SEUL endroit où le poids se saisit et se lit — il vivait avant
// dans Profil (saisie + courbe), dans Rapport (carte « Corps ») et dans un onglet de
// la nutrition. Trois écrans, trois versions du même chiffre, et une pesée notée à un
// endroit restait invisible aux deux autres.
//
// Le poids brut ne sert à rien au jour le jour ; ce qui compte est la moyenne
// glissante, sa pente, et la répartition gras / muscle de ce qui a été perdu.

const {
  hydrate, entries, latest, addManual, removeEntry, confirmEntry,
  weightSeries, slope, comp, suspects, suspectAts,
} = useMesures()
/**
 * Les marques branchées, vues comme une seule.
 *
 * Cet écran parlait de « la balance » au singulier, et le bouton synchronisait
 * Withings. Avec deux sources, il fallait deviner laquelle était à jour. On agrège
 * donc : un état, un bouton, et les noms de ce qui est branché — qui a une balance et
 * une montre n'a pas envie de les synchroniser à tour de rôle.
 */
const conn = useConnecteurs()
const connected = computed(() => conn.branchees.value.length > 0)
const syncing = conn.occupe
const syncError = conn.erreur
const lastSync = conn.derniere
const needsReconnect = computed(() => conn.aReconnecter.value.length > 0)
const nomsBranches = computed(() =>
  conn.branchees.value.map(c => providerById(c.id)?.label ?? c.id).join(' · '))
const nomsARebrancher = computed(() =>
  conn.aReconnecter.value.map(c => providerById(c.id)?.label ?? c.id).join(' et '))
function reconnecter() {
  conn.aReconnecter.value[0]?.connecter()
}
// stepsFor vient de la NUTRITION : c'est la copie persistée. Le relevé d'une synchro,
// lui, ne survit pas à un rechargement.
const { dayFor, overrides, stepsFor } = useNutrition()
const { addBodyWeight } = useWorkout()
const { profile } = useProfile()

const emit = defineEmits<{ navigate: [view: string] }>()

const today = isoOf(new Date())
const yesterday = shiftIso(today, -1)
const manualKg = ref<number | null>(null)
// Optionnel, et c'est voulu : une pesée sans impédance reste une pesée utile.
const manualFat = ref<number | null>(null)
const manualDate = ref(today)

onMounted(() => {
  hydrate()
  // La synchro d'ouverture vit maintenant dans la page : elle ne doit plus dépendre
  // du fait qu'on passe par cet écran. On la redemande quand même ici — elle se
  // court-circuite d'elle-même si elle a déjà tourné dans l'heure.
  conn.autoSyncTout(today).catch(() => { /* hors ligne */ })
})

/** Le bouton « Synchroniser » : forcé, sans le pas de temps d'une heure. */
const runSync = (complet = false) => conn.synchroniserTout(today, { complet })

function submitManual() {
  if (!manualKg.value || manualKg.value <= 0) return
  addManual(manualKg.value, manualDate.value, undefined, manualFat.value)
  if (manualDate.value === today) addBodyWeight(manualKg.value)
  manualKg.value = null
  manualFat.value = null
}

const series = computed(() => weightSeries.value)

// Objectif de rythme : entre 0,4 et 0,8 kg/semaine. En dessous, le déficit ne
// mord pas ; au-dessus, la masse maigre part avec.
const paceVerdict = computed(() => {
  const s = slope.value
  if (s === null) return null
  if (s > 0.1) return { tone: 'bad', text: 'Le poids monte. Si ce n\'est pas volontaire, resserre de 150 kcal par jour avant de toucher aux séances.' }
  if (s > -0.2) return { tone: 'warn', text: 'Quasi stable : le déficit réel est plus petit que celui affiché. Vérifie les extras notés et les week-ends.' }
  if (s >= -0.9) return { tone: 'good', text: 'Rythme dans la bonne fenêtre : assez rapide pour avancer, assez lent pour garder le muscle.' }
  return { tone: 'warn', text: 'Perte rapide. Tenable quelques semaines, mais au-delà la masse maigre paie — remonte de 150 à 200 kcal.' }
})

// Séries secondaires : on n'affiche que ce que la balance a vraiment mesuré.
const METRICS = [
  { key: 'fatRatio' as const, label: 'Masse grasse', unit: '%', good: 'down' },
  { key: 'fatMass' as const, label: 'Gras', unit: ' kg', good: 'down' },
  { key: 'muscleMass' as const, label: 'Muscle', unit: ' kg', good: 'up' },
  { key: 'waterMass' as const, label: 'Eau', unit: ' kg', good: 'flat' },
  { key: 'boneMass' as const, label: 'Os', unit: ' kg', good: 'flat' },
  { key: 'heartRate' as const, label: 'FC au repos', unit: ' bpm', good: 'down' },
]

const metrics = computed(() => METRICS.map((m) => {
  const pts = dailySeries(entries.value, m.key)
  if (!pts.length) return null
  const last = pts.at(-1)!
  const first = pts[Math.max(0, pts.length - 28)]
  const delta = Math.round((last.value - first.value) * 100) / 100
  const sl = weeklySlope(pts)
  let tone = 'flat'
  if (Math.abs(delta) >= 0.15) {
    const dir = delta < 0 ? 'down' : 'up'
    tone = m.good === 'flat' ? 'flat' : (dir === m.good ? 'good' : 'bad')
  }
  return { ...m, value: last.value, delta, slope: sl, tone, n: pts.length }
}).filter(Boolean) as { key: string, label: string, unit: string, value: number, delta: number, slope: number | null, tone: string, n: number }[])

// ─── Courbe : valeur brute en points, moyenne glissante en trait ──────────
const W = 440
const H = 190
const PAD = 26
const chart = computed(() => {
  const d = series.value.slice(-90)
  if (d.length < 2) return null
  const vals = d.flatMap(p => [p.value, p.avg!])
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const span = max - min || 1
  const x = (i: number) => PAD + (i * (W - 2 * PAD)) / (d.length - 1)
  const y = (v: number) => H - PAD - ((v - min) * (H - 2 * PAD)) / span
  return {
    dots: d.map((p, i) => ({ cx: x(i), cy: y(p.value), key: p.date })),
    line: d.map((p, i) => `${x(i)},${y(p.avg!)}`).join(' '),
    min: Math.round(min * 10) / 10,
    max: Math.round(max * 10) / 10,
    first: d[0].date.slice(5),
    last: d.at(-1)!.date.slice(5),
  }
})

const stepsToday = computed(() => stepsFor(today))

/**
 * Historique des pas, lu depuis la nutrition — la seule copie qui persiste.
 * Il venait du tampon de synchronisation, ce qui affichait un historique vide
 * après un simple rechargement tant qu'aucune synchro n'avait eu lieu.
 */
const stepsHistory = computed(() => Object.entries(overrides.value)
  .filter(([, o]) => typeof o.steps === 'number' && o.steps > 0)
  .map(([date, o]) => ({ date, steps: o.steps as number }))
  .sort((a, b) => a.date.localeCompare(b.date))
  .slice(-14))
// Estimation par défaut du planning, pour montrer l'écart avec la réalité mesurée.
const plannedSteps = computed(() => (dayFor(today).tt ? STEPS_TT : STEPS_ONSITE))

// IMC : calculé ici et nulle part ailleurs. Il l'était dans Profil ET dans Rapport,
// avec le même code copié deux fois.
const bmi = computed(() => {
  const h = profile.value.heightCm
  const w = latest.value?.kg
  return h && w ? Math.round((w / (h / 100) ** 2) * 10) / 10 : null
})
const bmiCat = computed(() => {
  const b = bmi.value
  if (b === null) return null
  if (b < 18.5) return { label: 'Maigreur', color: '#4a6fa5' }
  if (b < 25) return { label: 'Corpulence normale', color: '#3f7a4f' }
  if (b < 30) return { label: 'Surpoids', color: '#a97b1e' }
  return { label: 'Obésité', color: '#b5502f' }
})

const fmt = (n: number, d = 1) => (n > 0 ? '+' : '') + n.toFixed(d)
</script>

<template>
  <div class="stack">
    <!-- La connexion elle-même vit dans Profil, avec les autres réglages d'appareil.
         Ici on ne montre que l'état et le bouton de synchronisation : cet écran sert
         à lire ses mesures, pas à administrer un compte OAuth. -->
    <section v-if="!connected" class="card nu-wi-connect">
      <h3 class="nu-mode">Aucun connecteur branché</h3>
      <p class="nu-note">
        Les pesées se saisissent à la main, et tout fonctionne comme ça. Brancher une
        balance ou une montre une fois, et l'application récupère seule le poids, la
        composition et les pas — sans rien avoir à noter.
      </p>
      <button class="btn primary" @click="emit('navigate', 'profil')">⚙️ Voir les connecteurs</button>
    </section>

    <section v-else class="card nu-wi-bar">
      <div>
        <div class="mono nu-wi-state">{{ nomsBranches }}</div>
        <div class="nu-wi-sub">
          {{ entries.length }} pesée(s) · dernière synchro
          {{ lastSync ? new Date(lastSync * 1000).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) : 'jamais' }}
        </div>
      </div>
      <div class="nu-wi-actions">
        <button class="btn" :disabled="syncing" @click="runSync(false)">
          {{ syncing ? 'Synchro…' : 'Synchroniser' }}
        </button>
        <button class="btn ghost" :disabled="syncing" @click="runSync(true)">Tout reprendre</button>
      </div>
    </section>

    <!-- Autorisation révoquée : ce n'est pas un message d'erreur, c'est un état qui
         appelle UNE action. Affiché comme les autres textes rouges, il se serait
         perdu — et rien n'aurait dit que la réponse tient en un bouton. -->
    <section v-if="needsReconnect" class="card nu-wi-reco">
      <h3 class="nu-mode">🔌 Autorisation à renouveler</h3>
      <p class="nu-note">
        {{ nomsARebrancher }} a révoqué l'accès de l'application. Ça arrive quand une
        autorisation expire ou qu'une synchro s'est interrompue au mauvais moment.
        <b>Tes mesures déjà récupérées ne bougent pas</b> — elles sont sur ce téléphone,
        pas chez la marque.
      </p>
      <button class="btn primary" @click="reconnecter()">Reconnecter {{ nomsARebrancher }}</button>
    </section>

    <p v-else-if="syncError" class="nu-note nu-wi-err">{{ syncError }}</p>

    <!-- Balance partagée : elle reconnaît l'utilisateur au poids et peut se tromper
         entre deux personnes proches. On ne supprime rien, on met de côté et on
         demande — écarter en silence une vraie pesée serait pire que le problème. -->
    <section v-if="suspects.length" class="card nu-wi-quar">
      <h3 class="nu-mode">{{ suspects.length }} pesée(s) mise(s) de côté</h3>
      <p class="nu-note">
        Trop loin de ta tendance pour être toi. Sur une balance partagée, c'est
        généralement quelqu'un d'autre que l'appareil t'a attribué. Ces mesures ne
        comptent ni dans la courbe ni dans la cible calorique tant que tu n'as pas tranché.
      </p>
      <div class="nu-wi-list">
        <div v-for="e in suspects" :key="e.at" class="nu-wi-item">
          <span class="mono">{{ e.at.replace('T', ' ') }}</span>
          <b>{{ e.kg.toFixed(1) }} kg</b>
          <button class="btn" @click="confirmEntry(e.at)">C'est moi</button>
          <button class="btn ghost danger" @click="removeEntry(e.at)">Supprimer</button>
        </div>
      </div>
    </section>

    <!-- Chiffres du jour -->
    <section v-if="latest" class="card nu-wi-head">
      <div class="nu-wi-kg">
        <span class="nu-wi-num">{{ latest.kg.toFixed(1) }}</span><small>kg</small>
      </div>
      <div class="nu-wi-meta">
        <div class="mono">
          {{ latest.at.replace('T', ' à ') }}
          <template v-if="bmi"> · IMC <b :style="{ color: bmiCat!.color }">{{ bmi }}</b> {{ bmiCat!.label.toLowerCase() }}</template>
        </div>
        <div v-if="slope !== null" class="nu-wi-slope" :class="paceVerdict?.tone">
          {{ fmt(slope, 2) }} kg / semaine
        </div>
        <div v-else class="nu-wi-sub">Encore quelques pesées avant de pouvoir donner une tendance.</div>
      </div>
    </section>

    <p v-if="paceVerdict" class="nu-note" :class="`nu-tone-${paceVerdict.tone}`">{{ paceVerdict.text }}</p>

    <!-- Courbe -->
    <section v-if="chart" class="card">
      <h3 class="nu-mode">Poids — 90 jours</h3>
      <svg :viewBox="`0 0 ${W} ${H}`" class="nu-wi-chart">
        <polyline :points="chart.line" fill="none" stroke="var(--accent-primary)" stroke-width="2.5" stroke-linejoin="round" />
        <circle v-for="p in chart.dots" :key="p.key" :cx="p.cx" :cy="p.cy" r="2" fill="var(--text-muted)" opacity="0.55" />
        <text :x="4" :y="PAD - 8" class="nu-wi-ax">{{ chart.max }}</text>
        <text :x="4" :y="H - PAD + 14" class="nu-wi-ax">{{ chart.min }}</text>
        <text :x="PAD" :y="H - 4" class="nu-wi-ax">{{ chart.first }}</text>
        <text :x="W - PAD" :y="H - 4" class="nu-wi-ax" text-anchor="end">{{ chart.last }}</text>
      </svg>
      <p class="nu-wi-legend mono">Trait = moyenne 7 jours · points = pesées brutes</p>
    </section>

    <!-- Répartition de la perte -->
    <section class="card nu-wi-comp" :class="comp.quality">
      <h3 class="nu-mode">D'où vient la perte ?</h3>
      <div v-if="comp.fatShare !== null" class="nu-wi-split">
        <div class="nu-wi-bar-track">
          <div class="nu-wi-bar-fat" :style="{ width: `${Math.round(comp.fatShare * 100)}%` }" />
        </div>
        <div class="nu-wi-split-legend">
          <span><b>{{ Math.round(comp.fatShare * 100) }} %</b> gras</span>
          <span>{{ 100 - Math.round(comp.fatShare * 100) }} % masse maigre</span>
        </div>
      </div>
      <div class="nu-wi-deltas">
        <div><span class="mono">Poids</span><b>{{ fmt(comp.kg, 2) }} kg</b></div>
        <div v-if="comp.fat !== null"><span class="mono">Gras</span><b>{{ fmt(comp.fat, 2) }} kg</b></div>
        <div v-if="comp.lean !== null"><span class="mono">Maigre</span><b>{{ fmt(comp.lean, 2) }} kg</b></div>
        <div><span class="mono">Sur</span><b>{{ comp.days }} j</b></div>
      </div>
      <p class="nu-note">{{ comp.advice }}</p>
    </section>

    <!-- Toutes les autres mesures -->
    <section v-if="metrics.length" class="card">
      <h3 class="nu-mode">Ce que la balance mesure</h3>
      <div class="nu-wi-metrics">
        <div v-for="m in metrics" :key="m.key" class="nu-wi-metric" :class="m.tone">
          <span class="nu-wi-metric-l mono">{{ m.label }}</span>
          <span class="nu-wi-metric-v">{{ m.value }}{{ m.unit }}</span>
          <span class="nu-wi-metric-d">{{ fmt(m.delta, 2) }} sur 28 j</span>
        </div>
      </div>
      <p class="nu-note">{{ IMPEDANCE_CAVEAT }}</p>
    </section>

    <!-- Pas -->
    <section v-if="stepsHistory.length" class="card">
      <h3 class="nu-mode">Pas</h3>
      <p class="nu-note">
        <template v-if="stepsToday !== null">
          {{ stepsToday.toLocaleString('fr-FR') }} pas aujourd'hui, au-dessus des
          {{ plannedSteps.toLocaleString('fr-FR') }} estimés : la cible du jour a été relevée
          en conséquence.
        </template>
        <template v-else>
          Le compteur du jour est encore sous l'estimation de {{ plannedSteps.toLocaleString('fr-FR') }} pas,
          donc la cible ne bouge pas. Elle ne sera relevée que si tu dépasses cette estimation —
          un compteur partiel ne doit pas faire baisser ce que tu manges le matin.
        </template>
      </p>
      <div class="nu-wi-steps">
        <div v-for="a in stepsHistory" :key="a.date" class="nu-wi-step">
          <span class="mono">{{ a.date.slice(5) }}</span>
          <span class="nu-wi-step-bar" :style="{ width: `${Math.min(100, a.steps / 120)}%` }" />
          <b>{{ a.steps.toLocaleString('fr-FR') }}</b>
        </div>
      </div>
    </section>

    <!-- Saisie manuelle -->
    <section class="card nu-wi-manual">
      <h3 class="nu-mode">Ajouter une pesée à la main</h3>
      <p class="nu-note">Pour les jours sans balance, ou en attendant de la recevoir.</p>
      <div class="nu-wi-form">
        <label class="field nu-datefield">
          <span>Date</span>
          <input v-model="manualDate" type="date" :max="today">
        </label>
        <label class="field nu-kgfield">
          <span>Poids</span>
          <input v-model.number="manualKg" type="number" inputmode="decimal" step="0.1" min="30" max="250" placeholder="92,6">
        </label>
        <label class="field nu-kgfield">
          <span>Masse grasse</span>
          <input v-model.number="manualFat" type="number" inputmode="decimal" step="0.1" min="3" max="70" placeholder="26,5 %">
        </label>
        <button class="btn-primary nu-wi-go" :disabled="!manualKg" @click="submitManual">Ajouter</button>
      </div>
      <p class="nu-note mt-6">
        La masse grasse est facultative, mais c'est elle qui permet de calculer les
        protéines sur la <b>masse maigre</b> plutôt que sur le poids total — plus juste
        tant qu'il reste du gras à perdre. La masse grasse en kg et la masse maigre en
        sont déduites.
      </p>
      <!-- Raccourcis : neuf pesées sur dix sont celle du jour ou celle d'hier soir
           qu'on avait oublié de noter. -->
      <div class="nu-wi-shortcuts">
        <button class="btn" :class="{ sel: manualDate === today }" @click="manualDate = today">Aujourd'hui</button>
        <button class="btn" :class="{ sel: manualDate === yesterday }" @click="manualDate = yesterday">Hier</button>
      </div>
      <div v-if="entries.length" class="nu-wi-list">
        <div v-for="e in entries.slice(-8).reverse()" :key="e.at" class="nu-wi-item" :class="{ quar: suspectAts.has(e.at) }">
          <span class="mono">{{ e.at.replace('T', ' ') }}</span>
          <b>{{ e.kg.toFixed(1) }} kg</b>
          <span class="nu-wi-src">{{ suspectAts.has(e.at) ? 'écartée' : e.source === 'withings' ? 'balance' : 'saisie' }}</span>
          <button class="nu-wi-del" title="Supprimer" @click="removeEntry(e.at)">×</button>
        </div>
      </div>
    </section>
  </div>
</template>
