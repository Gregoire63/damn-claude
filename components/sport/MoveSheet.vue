<script setup lang="ts">
import { computed } from 'vue'
import { useTraining } from '~/composables/useTraining'
import { useEnergy } from '~/composables/useEnergy'
import { shiftIso } from '~/utils/sportStats'

/**
 * Où reporter la séance — et ce que ça change à manger, avant de décider.
 *
 * Une liste de dates seule aurait laissé la moitié de la question sans réponse :
 * déplacer une séance déplace ~440 kcal de dépense, donc la cible du jour qui la
 * perd ET celle du jour qui la reçoit. Chaque ligne annonce donc son « avant →
 * après », parce que c'est exactement ce qu'on veut vérifier au moment de choisir.
 */
const props = defineProps<{ iso: string, name: string, todayIso: string | null }>()
const emit = defineEmits<{ close: [], pick: [iso: string] }>()

const { energyIfTrained } = useEnergy()
const { plannedFor } = useTraining()

const DOW = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
/** Deux jours avant, douze après : de quoi avancer d'un jour comme de repousser
 *  à la semaine suivante, sans faire défiler un calendrier entier. */
const BEFORE = 2
const AFTER = 12

/**
 * Cible calorique d'une date SI l'on s'entraîne (ou non) ce jour-là.
 *
 * C'est bien une HYPOTHÈSE : on cherche où déplacer une séance, elle n'a pas eu
 * lieu. D'où `energyIfTrained` et non `energyOn`, qui répondrait « zéro » pour une
 * séance non enregistrée sur une journée déjà passée.
 */
function targetFor(iso: string, gym: boolean): number | null {
  return energyIfTrained(iso, gym)?.target ?? null
}

function label(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  return `${DOW[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
}
function when(iso: string) {
  if (!props.todayIso) return ''
  if (iso === props.todayIso) return "aujourd'hui"
  if (iso === shiftIso(props.todayIso, 1)) return 'demain'
  if (iso === shiftIso(props.todayIso, -1)) return 'hier'
  return ''
}

interface Option {
  iso: string
  label: string
  when: string
  taken: string | null // séance déjà prévue ce jour-là
  color: string | null
  before: number | null
  after: number | null
}

const options = computed<Option[]>(() => {
  const out: Option[] = []
  for (let i = -BEFORE; i <= AFTER; i++) {
    const iso = shiftIso(props.iso, i)
    if (iso === props.iso) continue
    const s = plannedFor(iso)
    out.push({
      iso,
      label: label(iso),
      when: when(iso),
      taken: s ? s.name : null,
      color: s ? s.color : null,
      before: targetFor(iso, !!s),
      after: targetFor(iso, true), // il reçoit la séance : jour de salle dans tous les cas
    })
  }
  return out
})

/** Ce que devient la journée qu'on quitte — identique quel que soit le jour choisi,
 *  sauf échange, d'où la nuance dans le sous-titre. */
const leaving = computed(() => ({
  label: label(props.iso),
  before: targetFor(props.iso, true),
  after: targetFor(props.iso, false),
}))
const subtitle = computed(() => (leaving.value.before === null
  ? `${props.name} · choisis le jour qui la reçoit`
  : `${leaving.value.label} repasse en repos : ${leaving.value.before} → ${leaving.value.after} kcal`))
</script>

<template>
  <Sheet
    sheet-class="move-sheet"
    :title="`Déplacer « ${name} »`"
    :subtitle="subtitle"
    @close="emit('close')"
  >
    <template #default>
      <div class="mvs-list">
        <button
          v-for="o in options" :key="o.iso"
          class="mvs-opt" :class="{ taken: !!o.taken }"
          :style="o.color ? { '--c': o.color } : {}"
          @click="emit('pick', o.iso)"
        >
          <span class="mvs-day">
            {{ o.label }}<span v-if="o.when" class="mvs-when">{{ o.when }}</span>
          </span>
          <span class="mvs-taken">
            <template v-if="o.taken"><span class="mvs-dot" />{{ o.taken }} — les deux s'échangent</template>
            <template v-else>libre</template>
          </span>
          <span v-if="o.before !== null && o.after !== null" class="mvs-kcal mono">
            {{ o.before }} <span class="mvs-arrow">→</span> <b>{{ o.after }}</b> kcal
          </span>
        </button>
      </div>
      <p class="muted mvs-hint">
        Les calories des deux journées et les heures de repas sont ajustées automatiquement.
      </p>
    </template>
  </Sheet>
</template>
