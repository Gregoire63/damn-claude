<script setup lang="ts">
import { ref, computed } from 'vue'
import type { Session } from '~/data/sportProgram'
import { useWorkout } from '~/composables/useWorkout'
import { useProgram } from '~/composables/useProgram'

// Vue « Progrès » extraite de la page /sport (chargée à la demande via <LazySportProgress>).
// L'état est partagé : useWorkout() renvoie les mêmes refs (module-scope).
const { chartData } = useWorkout()

const MUSCLE_LABELS: Record<string, string> = {
  pecs: 'Pecs', 'epaules-av': 'Épaules', 'epaules-lat': 'Épaules', 'epaules-ar': 'Épaules',
  triceps: 'Triceps', biceps: 'Biceps', 'avant-bras': 'Avant-bras', abdos: 'Abdos',
  dos: 'Dos', lombaires: 'Lombaires', quadris: 'Quadris', ischios: 'Ischios', fessiers: 'Fessiers', mollets: 'Mollets',
}
function sessionMuscles(s: Session): string[] {
  const seen: string[] = []
  for (const e of s.exercises) for (const m of e.muscles) {
    const l = MUSCLE_LABELS[m] || m
    if (!seen.includes(l)) seen.push(l)
  }
  return seen.slice(0, 4)
}

const { program: prog } = useProgram()
const progressSession = ref<string | null>(prog.value[0]?.id ?? null)
const progressSessionObj = computed(() => (progressSession.value ? prog.value.find(p => p.id === progressSession.value) ?? null : null))
/**
 * La courbe est en ÉQUIVALENT référence : une séance faite sur une autre machine y
 * est convertie, sinon passer au squat guidé ferait bondir le tracé de 35 % sans
 * avoir gagné un gramme de muscle. On garde donc à part le nombre de machines
 * traversées, pour le dire au lieu de le cacher.
 */
function exStats(exId: string) {
  const d = chartData(exId)
  if (!d.length) return null
  const machines = new Set(d.map(p => p.variant).filter(Boolean))
  const last = d[d.length - 1]
  return {
    max: last.charge,
    gain: Math.round((last.charge - d[0].charge) * 10) / 10,
    e1rm: last.e1rm,
    data: d,
    converted: machines.size > 0,
    lastReal: last.variant ? last.realCharge : null,
  }
}
const progExStats = computed(() => (progressSessionObj.value?.exercises ?? []).map(e => ({ e, stats: exStats(e.id) })))
</script>

<template>
  <div class="stack">
    <div class="section-label">Sélectionne une séance pour afficher la progression de ses exercices</div>
    <div class="prog-grid">
      <button
        v-for="s in prog" :key="s.id"
        class="session-card prog-card" :class="{ active: progressSession === s.id }"
        :style="{ '--c': s.color }"
        @click="progressSession = progressSession === s.id ? null : s.id"
      >
        <div class="sc-top"><span class="sc-day">{{ s.tag }}</span><span v-if="s.sprint" class="sc-sprint">⚡</span></div>
        <div class="sc-name">{{ s.name }}</div>
        <div class="sc-muscles"><span v-for="m in sessionMuscles(s)" :key="m" class="sc-chip">{{ m }}</span></div>
        <div class="sc-foot">
          <span class="sc-count mono">{{ s.exercises.length }} exos</span>
          <span class="sc-go">{{ progressSession === s.id ? 'Masquer ▲' : 'Courbes →' }}</span>
        </div>
      </button>
    </div>

    <template v-if="progressSessionObj">
      <div class="prog-ex-list">
        <div v-for="{ e, stats } in progExStats" :key="e.id" class="card prog-ex">
          <div class="prog-ex-head">
            <div class="prog-ex-name">{{ e.name }}</div>
            <div v-if="stats" class="prog-ex-kpis">
              <span class="pk"><b class="mono">{{ stats.max }}</b> kg max</span>
              <span class="pk" :class="{ pos: stats.gain > 0 }"><b class="mono">{{ stats.gain > 0 ? '+' : '' }}{{ stats.gain }}</b> kg évol.</span>
              <!-- Sur un exercice au temps il n'y a pas de 1RM : afficher « 0 kg 1RM »
                   serait pire que ne rien afficher, on le lirait comme une mesure. -->
              <span v-if="stats.e1rm" class="pk"><b class="mono">{{ stats.e1rm }}</b> kg 1RM</span>
            </div>
          </div>
          <p v-if="stats?.converted" class="muted prog-conv">
            🔁 Courbe en équivalent «&nbsp;{{ e.name }}&nbsp;» : les séances faites sur une autre
                  machine y sont converties, pour qu'un changement de matériel n'apparaisse pas comme
                  une progression.
            <template v-if="stats.lastReal"> Dernière séance&nbsp;: {{ stats.lastReal }} kg réels.</template>
          </p>
          <LazySportSvgChart v-if="stats" :data="stats.data" y-key="charge" :color="progressSessionObj.color" :height="150" />
          <div v-else class="muted prog-empty">Aucune donnée : enregistre une séance avec cet exercice.</div>
        </div>
      </div>
    </template>
    <div v-else class="card empty">Sélectionne une séance ci-dessus pour afficher toutes ses courbes.</div>
  </div>
</template>
