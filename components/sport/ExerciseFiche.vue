<script setup lang="ts">
import { computed } from 'vue'
import type { Exercise } from '~/data/sportProgram'
import { exMuscles } from '~/lib/muscles'
import { variantsOf } from '~/data/exerciseVariants'
import { fmtRest } from '~/lib/rest'
import { phraseAlternance } from '~/lib/rotation'

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
// ── Un CONTENU, pas une fenêtre ─────────────────────────────────────────────
//
// Ce fichier ne porte que le contenu, et c'est ce qui permet de le montrer aux deux
// endroits où il sert sans en tenir deux copies : déplié en bas du menu ⚙ pendant la
// séance, et dans une fenêtre (`ExerciseInfo`) depuis l'aperçu d'une séance qu'on lit
// sans l'avoir démarrée. Deux copies auraient divergé au premier ajout — c'est déjà
// arrivé avec le schéma musculaire, affiché ici et dans la carte, corrigé d'un côté
// seulement.
//
// Il montre les photos ET le schéma, là où la carte devait choisir : `ExerciseMove`
// se rabattait sur le schéma musculaire faute de photos. Elles ne disent pas la même
// chose — les photos montrent le geste, le schéma ce qui travaille.

const props = withDefaults(defineProps<{
  ex: Exercise
  /**
   * Le repos prévu, en secondes — calculé par l'appelant.
   *
   * Il s'affichait en tête des séries, dans la carte, sur la ligne qu'on traverse
   * quarante fois par séance pour atteindre les champs. Or il ne change jamais d'une
   * série à l'autre : c'est une donnée de FICHE, exactement comme les consignes, et
   * le minuteur l'annonce de toute façon en partant.
   *
   * Passé en propriété plutôt que recalculé ici : `restFor` se déduit des reps quand
   * l'exercice ne porte pas de repos explicite, et la carte comme la fiche doivent
   * annoncer la MÊME seconde.
   */
  repos?: number | null
  /** Les autres membres du groupe d'alternance, quand ce mouvement tourne. */
  alternatives?: Exercise[]
  /**
   * Le choix de machine est-il à portée de main ?
   *
   * Déplié dans le menu ⚙, il l'est : la liste est juste au-dessus, et renvoyer
   * ailleurs serait faux. Dans l'aperçu, il ne l'est pas — la séance n'est pas
   * démarrée, il n'y a pas de machine du jour à choisir — donc on se contente de
   * NOMMER les alternatives.
   */
  choixMachineIci?: boolean
}>(), { repos: null, alternatives: () => [], choixMachineIci: false })

const muscles = computed(() => exMuscles(props.ex))
const alternance = computed(() => phraseAlternance([props.ex, ...props.alternatives], props.ex.id))
const autres = computed(() => variantsOf(props.ex.id))
</script>

<template>
  <div class="exfiche">
    <SportExerciseMove :ex-id="ex.id" />
    <SportMuscleMap :muscles="ex.muscles" />

    <div v-if="muscles.length" class="sc-muscles"><span v-for="m in muscles" :key="m" class="sc-chip">{{ m }}</span></div>

    <template v-if="ex.cues && ex.cues.length">
      <div class="section-label">Comment l'exécuter</div>
      <div class="cues">
        <div v-for="(c, i) in ex.cues" :key="i" class="cue"><span class="cue-arrow">›</span>{{ c }}</div>
      </div>
    </template>

    <!-- Le repos AVANT les particularités : c'est la seule ligne de cette fiche qui
         serve pendant la séance et pas seulement la première fois. -->
    <p v-if="repos" class="exinfo-repos mono">⏱ Repos {{ fmtRest(repos) }}<template v-if="ex.superset"> · après les deux mouvements</template></p>

    <p v-if="ex.machine" class="exinfo-machine">🏋️ {{ ex.machine }}</p>

    <p v-if="alternance" class="exinfo-note">↔ {{ alternance }}</p>

    <p v-if="ex.superset" class="exinfo-note">
      Superset : {{ ex.superset[0] }} puis {{ ex.superset[1] }}, enchaînés sans repos entre les deux.
    </p>
    <p v-if="ex.bodyweight" class="exinfo-note">
      Au poids du corps : le champ de la carte demande le <b>lest</b>, pas le total.
    </p>
    <p v-if="ex.optionnel" class="exinfo-note">
      Facultatif : à faire s'il reste du temps. Il ne bloque pas l'enregistrement de la séance.
    </p>

    <!-- Les alternatives ne sont NOMMÉES que là où on ne peut pas les choisir. Sous
         la liste du menu, cette phrase répéterait ce qui est écrit trois centimètres
         plus haut, en moins précis. -->
    <p v-if="autres.length && !choixMachineIci" class="exinfo-note">
      {{ autres.length > 1 ? 'Machines possibles' : 'Machine possible' }} à la place :
      {{ autres.map(v => v.name).join(', ') }}.
    </p>
  </div>
</template>

<style scoped>
/* Le même espacement que le corps d'une fenêtre : la fiche est lue, pas remplie. */
.exfiche { display: flex; flex-direction: column; gap: 14px; }
.exinfo-repos { font-size: 13px; color: var(--text-secondary); }
.exinfo-machine { font-size: 13px; color: var(--text-secondary); font-style: italic; }
.exinfo-note { font-size: 12.5px; color: var(--text-muted); line-height: 1.55; }
</style>
