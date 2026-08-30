<script setup lang="ts">
import { ref, computed } from 'vue'

const weight = ref('')
const reps = ref('')

// Epley : 1RM = w × (1 + reps/30)
const orm = computed(() => {
  const w = parseFloat(weight.value)
  const r = parseInt(reps.value, 10)
  if (!w || !r || r < 1) return null
  return Math.round(w * (1 + r / 30))
})

const REP_TARGETS: Record<number, string> = {
  100: '1', 95: '2', 90: '3', 85: '5', 80: '7', 75: '9', 70: '11', 65: '13', 60: '15+',
}

const table = computed(() => {
  if (!orm.value) return []
  return [100, 95, 90, 85, 80, 75, 70, 65, 60].map(pct => ({
    pct,
    kg: Math.round((orm.value! * pct) / 100 / 2.5) * 2.5,
    reps: REP_TARGETS[pct],
  }))
})
</script>

<template>
  <div class="orm card">
    <div class="orm-title">🎯 1RM estimé & zones de charge</div>

    <div class="orm-inputs">
      <input v-model="weight" type="number" inputmode="decimal" placeholder="Charge (kg)">
      <span class="muted">×</span>
      <input v-model="reps" type="number" inputmode="numeric" placeholder="reps">
    </div>

    <template v-if="orm">
      <div class="orm-result">
        <span class="orm-value mono">{{ orm }} kg</span>
        <span class="muted">1RM estimé (Epley)</span>
      </div>
      <div class="orm-table">
        <div v-for="row in table" :key="row.pct" class="orm-row">
          <span class="orm-pct mono">{{ row.pct }}%</span>
          <span class="orm-kg mono">{{ row.kg }} kg</span>
          <span class="orm-reps muted">≈ {{ row.reps }} reps</span>
        </div>
      </div>
    </template>
    <div v-else class="muted orm-hint">Entre une charge et un nombre de reps réalisés.</div>
  </div>
</template>

<style scoped>
.card { background: var(--bg-primary); border: 1px solid var(--bg-accent); border-radius: 16px; padding: 14px; }
.mono { font-family: var(--font-mono); }
.muted { color: var(--text-muted); font-size: 12px; }
.orm-title { font-family: var(--font-display); font-weight: 700; font-size: 15px; color: var(--text-primary); margin-bottom: 10px; }
.orm-inputs { display: flex; gap: 8px; align-items: center; }
.orm-inputs input {
  background: var(--bg-secondary); border: 1px solid var(--bg-accent); color: var(--text-primary);
  border-radius: 8px; padding: 10px 8px; font-size: 16px; text-align: center; flex: 1; min-width: 0;
  -moz-appearance: textfield; appearance: textfield;
}
.orm-inputs input:focus { outline: none; border-color: var(--accent-primary); }
.orm-inputs input::-webkit-outer-spin-button, .orm-inputs input::-webkit-inner-spin-button { -webkit-appearance: none; }
.orm-result { display: flex; align-items: baseline; gap: 8px; margin: 12px 0 8px; }
.orm-value { font-family: var(--font-display); font-size: 24px; font-weight: 800; color: #3f7a4f; }
.orm-table { display: flex; flex-direction: column; gap: 2px; }
.orm-row {
  display: grid; grid-template-columns: 52px 70px 1fr; align-items: center;
  padding: 6px 8px; border-radius: 6px; font-size: 13px;
}
.orm-row:nth-child(odd) { background: var(--bg-secondary); }
.orm-pct { color: var(--accent-primary); font-weight: 700; }
.orm-kg { color: var(--text-primary); font-weight: 600; }
.orm-hint { margin-top: 10px; }
</style>
