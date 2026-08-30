<script setup lang="ts">
import { ref, computed } from 'vue'

// Disques standard (kg) et couleurs indicatives
const PLATES = [
  { w: 25, c: '#b5502f' },
  { w: 20, c: '#4a6fa5' },
  { w: 15, c: '#b07d2e' },
  { w: 10, c: '#5f7a6b' },
  { w: 5, c: '#6e5747' },
  { w: 2.5, c: '#9d9691' },
  { w: 1.25, c: '#c9b299' },
]

const target = ref('')
const bar = ref(20)

const result = computed(() => {
  const t = parseFloat(target.value)
  if (!t || Number.isNaN(t)) return null
  if (t < bar.value) return { error: `Barre = ${bar.value} kg`, perSide: [], total: bar.value, leftover: 0 }
  let each = (t - bar.value) / 2
  const perSide: { w: number; c: string; n: number }[] = []
  for (const p of PLATES) {
    const n = Math.floor(each / p.w)
    if (n > 0) {
      perSide.push({ ...p, n })
      each = +(each - n * p.w).toFixed(3)
    }
  }
  return { error: '', perSide, total: t, leftover: +each.toFixed(2) }
})

const bars = [
  { label: 'Barre 20', v: 20 },
  { label: '15', v: 15 },
  { label: 'EZ 10', v: 10 },
]
</script>

<template>
  <div class="plate-calc card">
    <div class="pc-head">
      <span class="pc-title">🏋️ Calcul de barre</span>
    </div>

    <div class="pc-inputs">
      <input v-model="target" type="number" inputmode="decimal" placeholder="Poids cible (kg)" class="pc-target">
      <div class="pc-bars">
        <button
          v-for="b in bars"
          :key="b.v"
          class="btn tiny"
          :class="{ sel: bar === b.v }"
          @click="bar = b.v"
        >{{ b.label }}</button>
      </div>
    </div>

    <div v-if="result && !result.error" class="pc-out">
      <div class="pc-side-label">Par côté :</div>
      <div v-if="result.perSide.length" class="pc-plates">
        <span
          v-for="(p, i) in result.perSide"
          :key="i"
          class="pc-plate"
          :style="{ '--pc': p.c }"
        >{{ p.n }} × {{ p.w }}</span>
      </div>
      <div v-else class="muted">Barre à vide.</div>
      <div v-if="result.leftover > 0" class="pc-warn">
        Non atteignable exactement (reste {{ result.leftover }} kg/côté).
      </div>
    </div>
    <div v-else-if="result?.error" class="muted pc-out">{{ result.error }}</div>
  </div>
</template>

<style scoped>
.card { background: var(--bg-primary); border: 1px solid var(--bg-accent); border-radius: 16px; padding: 14px; }
.muted { color: var(--text-muted); font-size: 12px; }
.pc-head { margin-bottom: 10px; }
.pc-title { font-family: var(--font-display); font-weight: 700; font-size: 15px; color: var(--text-primary); }
.pc-inputs { display: flex; flex-direction: column; gap: 8px; }
.pc-target {
  background: var(--bg-secondary); border: 1px solid var(--bg-accent); color: var(--text-primary);
  border-radius: 8px; padding: 10px; font-size: 16px; width: 100%;
  -moz-appearance: textfield; appearance: textfield;
}
.pc-target:focus { outline: none; border-color: var(--accent-primary); }
.pc-target::-webkit-outer-spin-button, .pc-target::-webkit-inner-spin-button { -webkit-appearance: none; }
.pc-bars { display: flex; gap: 6px; }
.btn {
  background: var(--bg-secondary); border: 1px solid var(--bg-accent); color: var(--text-secondary);
  border-radius: 8px; padding: 8px 12px; font-family: var(--font-mono); font-size: 13px; cursor: pointer;
}
.btn.tiny { padding: 7px 10px; font-size: 12px; flex: 1; }
.btn.sel { border-color: var(--accent-primary); color: var(--bg-primary); background: var(--accent-primary); }
.pc-out { margin-top: 12px; }
.pc-side-label { font-family: var(--font-mono); font-size: 12px; color: var(--text-muted); margin-bottom: 6px; }
.pc-plates { display: flex; flex-wrap: wrap; gap: 6px; }
.pc-plate {
  font-family: var(--font-mono);
  font-size: 13px; font-weight: 700; color: var(--text-primary);
  border: 1px solid var(--bg-accent); border-left: 4px solid var(--pc);
  border-radius: 6px; padding: 5px 9px; background: var(--bg-secondary);
}
.pc-warn { margin-top: 8px; font-size: 12px; color: #a97b1e; }
</style>
