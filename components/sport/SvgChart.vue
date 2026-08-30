<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(defineProps<{
  data: Record<string, any>[]
  yKey: string
  color?: string
  height?: number
  unit?: string
}>(), { color: '#3D6BFF', height: 180, unit: '' })

const W = 440
const P = 30

const geometry = computed(() => {
  const d = props.data
  if (d.length < 2) return null
  const vals = d.map(p => p[props.yKey] as number)
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const span = max - min || 1
  const H = props.height
  const x = (i: number) => P + (i * (W - 2 * P)) / (d.length - 1)
  const y = (v: number) => H - P - ((v - min) * (H - 2 * P)) / span
  return {
    points: d.map((p, i) => `${x(i)},${y(p[props.yKey])}`).join(' '),
    dots: d.map((p, i) => ({ cx: x(i), cy: y(p[props.yKey]), v: p[props.yKey], label: p.date })),
  }
})
</script>

<template>
  <div>
    <svg v-if="geometry" :viewBox="`0 0 ${W} ${height}`" style="width:100%">
      <polyline :points="geometry.points" fill="none" :stroke="color" stroke-width="2.5" />
      <template v-for="(d, i) in geometry.dots" :key="i">
        <circle :cx="d.cx" :cy="d.cy" r="3.5" :fill="color" />
        <text :x="d.cx" :y="d.cy - 8" fill="#6b6560" font-size="10" font-weight="600" text-anchor="middle">{{ d.v }}{{ unit }}</text>
        <text :x="d.cx" :y="height - 8" fill="#9d9691" font-size="9" text-anchor="middle">{{ d.label }}</text>
      </template>
    </svg>
    <div v-else class="chart-empty">Encore {{ 2 - data.length }} mesure(s) pour tracer la courbe.</div>
  </div>
</template>

<style scoped>
.chart-empty { color: var(--text-muted); font-size: 12px; padding: 12px 0; font-family: var(--font-mono); }
</style>
