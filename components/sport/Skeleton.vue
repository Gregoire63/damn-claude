<script setup lang="ts">
// Placeholder affiché pendant le chargement du chunk d'un onglet : la page ne
// reste plus vide entre le clic et l'arrivée du composant.
withDefaults(defineProps<{ cards?: number; chart?: boolean }>(), { cards: 3, chart: false })
</script>

<template>
  <div class="stack" aria-busy="true" aria-live="polite">
    <span class="sr-only">Chargement…</span>
    <div v-for="c in cards" :key="c" class="card">
      <div class="sk sk-label"></div>
      <div class="sk sk-line w-90"></div>
      <div class="sk sk-line w-70"></div>
      <div v-if="chart && c === 1" class="sk sk-chart"></div>
    </div>
  </div>
</template>

<style scoped>
.sk { background: var(--bg-accent); border-radius: 6px; opacity: 0.55; animation: sk-pulse 1.3s ease-in-out infinite; }
.sk-label { height: 10px; width: 38%; border-radius: 4px; margin-bottom: 14px; }
.sk-line { height: 13px; margin-top: 9px; }
.sk-chart { height: 150px; border-radius: 12px; margin-top: 14px; }
.w-90 { width: 90%; } .w-70 { width: 68%; }

/* Décalage de phase : l'ondulation parcourt la carte au lieu de clignoter d'un bloc. */
.sk-line:nth-child(3) { animation-delay: 0.12s; }
.sk-chart { animation-delay: 0.2s; }

@keyframes sk-pulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 0.75; }
}
@media (prefers-reduced-motion: reduce) {
  .sk { animation: none; opacity: 0.45; }
}

.sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}
</style>
