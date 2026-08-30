<script setup lang="ts">
import { computed } from 'vue'
import { useRestTimer } from '~/composables/useRestTimer'

const { secondsLeft, totalSeconds, start, stop, addTime } = useRestTimer()

const R = 32
const CIRC = 2 * Math.PI * R
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
const urgent = computed(() => secondsLeft.value > 0 && secondsLeft.value <= 10)
const dash = computed(() => {
  const frac = totalSeconds.value ? secondsLeft.value / totalSeconds.value : 0
  return `${frac * CIRC} ${CIRC}`
})
</script>

<template>
  <div class="rest-timer" :class="{ active: secondsLeft > 0 }">
    <template v-if="secondsLeft > 0">
      <div class="ring-wrap">
        <svg viewBox="0 0 72 72" class="ring">
          <circle cx="36" cy="36" :r="R" class="ring-bg" />
          <circle cx="36" cy="36" :r="R" class="ring-fg" :class="{ urgent }" :stroke-dasharray="dash" />
        </svg>
        <span class="ring-time mono" :class="{ urgent }">{{ fmt(secondsLeft) }}</span>
      </div>
      <div class="ctrls">
        <button class="btn tiny" @click="addTime(-15)">−15</button>
        <button class="btn tiny" @click="addTime(15)">+15</button>
        <button class="btn tiny danger" @click="stop">Stop</button>
      </div>
    </template>
    <template v-else>
      <span class="rest-label">Repos</span>
      <button class="btn" @click="start(60)">1:00</button>
      <button class="btn" @click="start(90)">1:30</button>
      <button class="btn" @click="start(120)">2:00</button>
      <button class="btn" @click="start(180)">3:00</button>
    </template>
  </div>
</template>

<style scoped>
.rest-timer {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-wrap: wrap;
  justify-content: center;
}
.rest-label {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-right: 2px;
}
.mono { font-family: var(--font-mono); }
.ring-wrap { position: relative; width: 72px; height: 72px; }
.ring { width: 72px; height: 72px; transform: rotate(-90deg); }
.ring-bg { fill: none; stroke: var(--bg-accent); stroke-width: 6; }
.ring-fg {
  fill: none;
  stroke: var(--accent-primary);
  stroke-width: 6;
  stroke-linecap: round;
  transition: stroke-dasharray 0.95s linear, stroke 0.3s;
}
.ring-fg.urgent { stroke: #b5502f; }
.ring-time {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--font-mono);
  font-size: 17px;
  font-weight: 700;
  color: var(--text-primary);
}
.ring-time.urgent { color: #b5502f; }
.ctrls { display: flex; gap: 6px; }
.btn {
  background: var(--bg-secondary);
  border: 1px solid var(--bg-accent);
  color: var(--text-primary);
  border-radius: 8px;
  padding: 8px 14px;
  font-family: var(--font-mono);
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}
.btn:hover { border-color: var(--accent-secondary); }
.btn.tiny { padding: 7px 10px; font-size: 12px; }
.btn.danger { border-color: #e3c4b8; color: #b5502f; }
.btn:active { transform: scale(0.97); }
</style>
