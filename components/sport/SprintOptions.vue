<script setup lang="ts">
import type { SprintPlan } from '~/data/sportProgram'

// ─────────────────────────────────────────────────────────────────────────────
// Le sprint : ce qui se décide AVANT de courir, dans une fenêtre qui n'ouvre rien.
// ─────────────────────────────────────────────────────────────────────────────
//
// La carte du sprint empilait tout : le protocole, un bouton « Détails » qui dépliait
// trois blocs de texte, les cinq réglages du chrono, le chrono lui-même, puis la
// saisie de ce qu'on avait couru. Le seul morceau qu'on touche essoufflé — les lignes
// à remplir — se trouvait tout en bas, après deux écrans de lecture.
//
// Même partage que pour un mouvement, et pour la même raison : la carte garde ce qui
// se fait PENDANT (lancer le chrono, noter ce qui a été couru), la fenêtre porte ce
// qui se décide UNE FOIS (les durées, le nombre de sprints, et tout le protocole —
// échauffement, piste ou tapis, technique, retour au calme).
//
// Les réglages en premier : c'est la seule partie qu'on vient VRAIMENT changer, le
// reste se lit. Le même ordre que la fenêtre d'un mouvement, où le commentaire ouvre
// et la fiche ferme.

defineProps<{ sprint: SprintPlan, mode: 'exterieur' | 'tapis' }>()
const emit = defineEmits<{ 'update:mode': [m: 'exterieur' | 'tapis'], close: [] }>()
</script>

<template>
  <Popup popup-class="exopt" :title="sprint.title" subtitle="Réglages et protocole" @close="emit('close')">
    <div class="exopt-list">
      <div class="sprint-reg">
        <div class="section-label">Le bloc</div>
        <SportSprintReglages />
        <p class="exopt-dit">Ces durées sont celles du chrono de la carte. Elles se gardent d'une séance à l'autre.</p>
      </div>

      <!-- Le protocole prévu par la séance, en chiffres : il ne se règle pas ici, il
           dit ce que la fiche recommande. Les deux cohabitent sans se contredire —
           l'un est le plan, l'autre ce qu'on va réellement faire aujourd'hui. -->
      <div class="sprint-protocol">
        <div v-for="p in sprint.protocol" :key="p.label" class="sp-stat">
          <div class="sp-val mono">{{ p.value }}</div>
          <div class="sp-lab">{{ p.label }}</div>
        </div>
      </div>

      <div class="sprint-info">
        <div class="sprint-goal">{{ sprint.goal }}</div>
        <div class="sprint-block">
          <div class="sprint-block-title">🔥 Échauffement</div>
          <ul class="sprint-list"><li v-for="(w, i) in sprint.warmup" :key="i">{{ w }}</li></ul>
        </div>
        <div class="sprint-block">
          <div class="sprint-block-title">Où cours-tu ?</div>
          <div class="sprint-toggle">
            <button :class="{ active: mode === 'exterieur' }" @click="emit('update:mode', 'exterieur')">🏟️ Extérieur</button>
            <button :class="{ active: mode === 'tapis' }" @click="emit('update:mode', 'tapis')">🏃 Tapis</button>
          </div>
          <ul class="sprint-list">
            <li v-for="(s, i) in (mode === 'exterieur' ? sprint.exterieur : sprint.tapis)" :key="i">{{ s }}</li>
          </ul>
          <div v-if="mode === 'tapis'" class="sprint-note">⚠️ {{ sprint.tapisNote }}</div>
        </div>
        <div class="sprint-block">
          <div class="sprint-block-title">Technique</div>
          <ul class="sprint-list"><li v-for="(c, i) in sprint.cues" :key="i">{{ c }}</li></ul>
        </div>
        <div class="sprint-cooldown">🧊 Retour au calme — {{ sprint.cooldown }}</div>
      </div>
    </div>
  </Popup>
</template>

<style scoped>
.sprint-reg { display: flex; flex-direction: column; gap: 6px; }
.exopt-dit { font-size: 12px; color: var(--text-muted); line-height: 1.45; }
/* Le protocole et le détail sont séparés des réglages par un filet, comme la fiche
   d'un mouvement l'est de ses gestes : au-dessus on règle, en dessous on lit. */
.sprint-info { border-top: 1px dashed var(--bg-accent); padding-top: 12px; }
</style>
