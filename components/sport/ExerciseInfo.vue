<script setup lang="ts">
import type { Exercise } from '~/data/sportProgram'

// ─────────────────────────────────────────────────────────────────────────────
// La fiche d'un mouvement, en fenêtre — pour l'APERÇU, qui n'a pas de menu.
// ─────────────────────────────────────────────────────────────────────────────
//
// Pendant une séance, tout ce qu'on peut faire d'un mouvement tient dans le menu ⚙,
// fiche comprise : rien n'ouvre rien d'autre. L'aperçu, lui, se lit avant d'avoir
// démarré quoi que ce soit — pas de machine du jour, pas de commentaire, pas de
// roulement à inverser — donc son « i » n'a qu'une chose à montrer, et une fenêtre
// est la bonne forme pour une chose.
//
// Le CONTENU vit dans `ExerciseFiche` : c'est lui qui est partagé avec le menu. Cette
// enveloppe ne fait que le poser sur l'écran.

defineProps<{ ex: Exercise, repos?: number | null, alternatives?: Exercise[] }>()
const emit = defineEmits<{ close: [] }>()
</script>

<template>
  <Popup
    popup-class="exinfo"
    :title="ex.name"
    :subtitle="`${ex.sets} × ${ex.reps}`"
    @close="emit('close')"
  >
    <SportExerciseFiche :ex="ex" :repos="repos" :alternatives="alternatives" />
  </Popup>
</template>
