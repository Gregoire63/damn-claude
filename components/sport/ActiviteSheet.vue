<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { Activite, TypeActivite } from '~/lib/activites'
import { MINUTES_MAX, MINUTES_MIN, TYPES_ACTIVITE, bornerMinutes, estimerKcal, ficheActivite } from '~/lib/activites'
import { useEnergy } from '~/composables/useEnergy'
import { useWorkout } from '~/composables/useWorkout'

// ─────────────────────────────────────────────────────────────────────────────
// Noter un sport qui n'est pas une séance.
// ─────────────────────────────────────────────────────────────────────────────
//
// L'estimation est un POINT DE DÉPART, jamais un verdict. Le MET d'une activité est
// une moyenne de population : deux heures de vélo, c'est une balade ou une sortie de
// club, et le même chiffre couvre les deux. Le champ reste donc ouvert, et le
// formulaire garde la trace de qui a tranché — sans quoi corriger « 620 » en « 450 »
// se ferait écraser à la seconde suivante, dès qu'on touche à la durée.
//
// C'est toute la subtilité de cet écran : l'estimation se recalcule à chaque
// changement de type ou de durée TANT QU'ON N'A PAS corrigé le chiffre. Après, plus
// jamais — jusqu'à ce qu'on redemande explicitement l'estimation.

const props = defineProps<{
  /** L'activité à modifier, ou `null` pour en créer une. */
  activite?: Activite | null
  /** Le jour proposé par défaut, quand on crée depuis une journée. */
  iso: string
}>()
const emit = defineEmits<{
  close: []
  valider: [a: Omit<Activite, 'id'>]
  supprimer: [id: string]
}>()

const { bmrOn } = useEnergy()
const { bodyWeightAt } = useWorkout()

const type = ref<TypeActivite>(props.activite?.type ?? 'course')
const nom = ref(props.activite?.nom ?? '')
const date = ref(props.activite?.date ?? props.iso)
const heure = ref(props.activite?.heure ?? '18:00')
const minutes = ref(String(props.activite?.minutes ?? 60))
const kcal = ref(String(props.activite?.kcal ?? ''))
/** Le chiffre affiché vient-il encore de l'estimation ? Faux dès qu'on le corrige. */
const estime = ref(props.activite ? props.activite.estime : true)

const min = computed(() => bornerMinutes(minutes.value))

/**
 * L'estimation, sur le poids et le métabolisme DE CE JOUR-LÀ.
 *
 * Pas ceux d'aujourd'hui : noter un foot d'il y a trois semaines doit le chiffrer
 * avec le corps qu'on avait alors, comme tout le reste de l'application.
 */
const propose = computed(() => estimerKcal(type.value, min.value, bodyWeightAt(date.value), bmrOn(date.value)))

/** Tant que le chiffre est celui de l'app, il suit. Corrigé, il ne bouge plus. */
watch([type, minutes, date], () => {
  if (!estime.value) return
  kcal.value = propose.value === null ? '' : String(propose.value)
}, { immediate: !props.activite })

function corriger(brut: string) {
  kcal.value = brut
  estime.value = false
}
/** Reprendre le chiffre de l'app après l'avoir corrigé : sinon la correction est
 *  définitive et il faut retaper de tête ce qu'elle proposait. */
function reprendreEstimation() {
  estime.value = true
  kcal.value = propose.value === null ? '' : String(propose.value)
}

const fiche = computed(() => ficheActivite(type.value))
const valide = computed(() => /^\d{4}-\d{2}-\d{2}$/.test(date.value) && Number(kcal.value) >= 0 && kcal.value !== '')

function valider() {
  if (!valide.value) return
  emit('valider', {
    type: type.value,
    nom: nom.value.trim(),
    date: date.value,
    heure: heure.value,
    minutes: min.value,
    kcal: Math.max(0, Math.round(Number(kcal.value) || 0)),
    estime: estime.value,
  })
}
</script>

<template>
  <Popup
    persistent
    popup-class="act-popup"
    :title="activite ? 'Modifier l’activité' : 'Autre activité'"
    subtitle="Compte dans la dépense du jour"
    @close="emit('close')"
  >
    <div class="act-types">
      <button
        v-for="t in TYPES_ACTIVITE" :key="t.id"
        class="act-type" :class="{ on: type === t.id }"
        :aria-pressed="type === t.id"
        @click="type = t.id"
      >{{ t.icone }} {{ t.label }}</button>
    </div>

    <div class="field">
      <span>Nom <span class="muted">· facultatif</span></span>
      <input v-model="nom" type="text" :placeholder="fiche.label" maxlength="40">
    </div>

    <div class="act-quand">
      <label class="field"><span>Date</span><input v-model="date" type="date"></label>
      <label class="field"><span>Heure</span><input v-model="heure" type="time"></label>
    </div>

    <label class="field">
      <span>Durée <span class="muted">· minutes</span></span>
      <input v-model="minutes" type="number" inputmode="numeric" :min="MINUTES_MIN" :max="MINUTES_MAX" step="5">
    </label>

    <label class="field">
      <span>Calories brûlées</span>
      <input
        class="mono" type="number" inputmode="numeric" min="0" step="10"
        :value="kcal"
        @input="corriger(($event.target as HTMLInputElement).value)"
      >
    </label>

    <!-- Ce que l'app a proposé, et pourquoi c'est approximatif. Dit ici et pas dans
         une note de bas de page : c'est au moment de lire le chiffre qu'il faut
         savoir d'où il vient. -->
    <p v-if="estime && propose !== null" class="muted act-dit">
      Estimé depuis ton poids de ce jour-là et l'intensité moyenne de l'activité
      ({{ fiche.met }} MET). Une sortie vraiment dure vaut plus : corrige le chiffre, il
      ne bougera plus.
    </p>
    <p v-else-if="propose === null" class="hint-pill bw act-dit">
      Pas de pesée ni de profil complet pour le {{ date }} : impossible d'estimer. Donne
      le chiffre toi-même — mieux vaut le tien qu'un calcul sur un corps inventé.
    </p>
    <p v-else class="muted act-dit">
      Chiffre corrigé à la main.
      <button v-if="propose !== null" class="link-btn" @click="reprendreEstimation()">
        Reprendre l'estimation ({{ propose }} kcal)
      </button>
    </p>

    <button class="btn-primary" :disabled="!valide" @click="valider()">
      {{ activite ? 'Enregistrer' : 'Ajouter' }}
    </button>
    <button v-if="activite" class="btn danger btn-bloc" @click="emit('supprimer', activite.id)">✕ Supprimer</button>
  </Popup>
</template>
