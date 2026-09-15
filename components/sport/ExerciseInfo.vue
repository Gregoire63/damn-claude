<script setup lang="ts">
import { computed } from 'vue'
import type { Exercise } from '~/data/sportProgram'
import { exMuscles } from '~/lib/muscles'
import { variantsOf } from '~/data/exerciseVariants'

// ─────────────────────────────────────────────────────────────────────────────
// Tout ce qu'il faut savoir sur un mouvement — et rien de ce qu'il faut y saisir.
// ─────────────────────────────────────────────────────────────────────────────
//
// Photos, schéma musculaire, consignes d'exécution et nom de machine s'ouvraient
// avec la carte de l'exercice, en haut, à chaque fois. C'est-à-dire aussi à la
// quatrième série du développé couché, où on sait déjà à quoi il ressemble : deux
// écrans de rappel à faire défiler pour atteindre le champ de saisie, entre deux
// séries, le téléphone dans une main.
//
// Ce sont deux besoins de fréquences opposées. La saisie revient toutes les
// quatre-vingt-dix secondes ; l'exécution se vérifie une fois, la première fois, ou
// le jour où l'on doute. Le second n'a rien à faire dans le chemin du premier.
//
// D'où le « i » à côté du nom : la carte redevient une page de saisie, et le rappel
// est à un tap — dans une FENÊTRE, qui se pose sur tout et qu'on referme sans perdre
// sa place dans la séance.
//
// La fenêtre en profite pour montrer les deux, là où la carte devait choisir :
// `ExerciseMove` se rabattait sur le schéma musculaire faute de photos. Elles ne
// disent pas la même chose — les photos montrent le geste, le schéma ce qui travaille
// — et ici il y a la place.

const props = defineProps<{ ex: Exercise }>()
const emit = defineEmits<{ close: [] }>()

const muscles = computed(() => exMuscles(props.ex))
/** Les machines de remplacement, pour l'information : le CHOIX reste dans la carte. */
const autres = computed(() => variantsOf(props.ex.id))
</script>

<template>
  <Popup
    popup-class="exinfo"
    :title="ex.name"
    :subtitle="`${ex.sets} × ${ex.reps}`"
    @close="emit('close')"
  >
    <!-- Slot vide, volontairement : le repli sur le schéma musculaire n'a plus lieu
         d'être puisqu'il est affiché juste en dessous dans tous les cas. -->
    <SportExerciseMove :ex-id="ex.id" />
    <SportMuscleMap :muscles="ex.muscles" />

    <div v-if="muscles.length" class="sc-muscles"><span v-for="m in muscles" :key="m" class="sc-chip">{{ m }}</span></div>

    <template v-if="ex.cues && ex.cues.length">
      <div class="section-label">Comment l'exécuter</div>
      <div class="cues">
        <div v-for="(c, i) in ex.cues" :key="i" class="cue"><span class="cue-arrow">›</span>{{ c }}</div>
      </div>
    </template>

    <p v-if="ex.machine" class="exinfo-machine">🏋️ {{ ex.machine }}</p>

    <p v-if="ex.superset" class="exinfo-note">
      Superset : {{ ex.superset[0] }} puis {{ ex.superset[1] }}, enchaînés sans repos entre les deux.
    </p>
    <p v-if="ex.bodyweight" class="exinfo-note">
      Au poids du corps : le champ de la carte demande le <b>lest</b>, pas le total.
    </p>
    <p v-if="ex.optionnel" class="exinfo-note">
      Facultatif : à faire s'il reste du temps. Il ne bloque pas l'enregistrement de la séance.
    </p>

    <!-- Les alternatives sont NOMMÉES ici et se CHOISISSENT dans la carte. Dupliquer
         le bouton ferait deux endroits où changer de machine, donc deux endroits à
         vérifier quand l'un des deux cesse de marcher. -->
    <p v-if="autres.length" class="exinfo-note">
      {{ autres.length > 1 ? 'Machines possibles' : 'Machine possible' }} à la place :
      {{ autres.map(v => v.name).join(', ') }}. Le remplacement se choisit sur la carte, avec 🔁.
    </p>
  </Popup>
</template>

<style scoped>
.exinfo-machine { font-size: 13px; color: var(--text-secondary); font-style: italic; }
.exinfo-note { font-size: 12.5px; color: var(--text-muted); line-height: 1.55; }
</style>
