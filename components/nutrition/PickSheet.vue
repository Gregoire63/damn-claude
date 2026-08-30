<script setup lang="ts">
import { computed } from 'vue'
import { useNutrition } from '~/composables/useNutrition'
import { KIND_GROUP_LABELS, choicesForSlot } from '~/lib/nutritionStats'

/**
 * La feuille de choix d'un plat, pour un créneau et une date.
 *
 * Elle existe parce que la liste dépliée sous le repas ne tenait plus : trois boîtes
 * passaient, dix-sept plats non. Une liste qui pousse la carte du repas hors de
 * l'écran fait perdre le contexte au moment précis où on en a besoin — on ne voit
 * plus ce qu'on est en train de remplacer.
 *
 * Un seul composant pour l'accueil ET le calendrier : c'était deux listes recopiées,
 * donc deux endroits à corriger. La feuille prend la date en paramètre, le reste est
 * identique.
 */
const props = defineProps<{
  iso: string
  slotId: string
  slotLabel: string
  current: string | null
  picked: string | null
  /** Un repas du dehors occupe déjà ce créneau : le bouton propose de le modifier. */
  hasFree?: boolean
}>()
const emit = defineEmits<{ close: [], pick: [id: string | null], libre: [] }>()

const { library, stock } = useNutrition()

/** Les plats groupés par famille, celle du créneau en premier. */
const groups = computed(() => {
  const out: { kind: string, label: string, items: ReturnType<typeof choicesForSlot> }[] = []
  for (const c of choicesForSlot(props.slotId, library.value, stock.value)) {
    const g = out.find(x => x.kind === c.kind)
    if (g) g.items.push(c)
    else out.push({ kind: c.kind, label: KIND_GROUP_LABELS[c.kind] ?? c.kind, items: [c] })
  }
  return out
})
const total = computed(() => groups.value.reduce((n, g) => n + g.items.length, 0))
</script>

<template>
  <Sheet
    sheet-class="pick-sheet"
    :title="slotLabel"
    :subtitle="`${total} plats · celui d'aujourd'hui est coché`"
    @close="emit('close')"
  >
    <template #default>
      <!-- En tête, et pas en bas de dix-sept plats : quand on ouvre cette feuille
           parce qu'on mange dehors, aucun de ces plats ne convient — les faire
           défiler d'abord, c'est faire défiler la mauvaise réponse. -->
      <button class="pk-opt fm-new" @click="emit('libre')">
        <span class="fm-plus">＋</span>
        <span class="pk-name">
          <b>{{ hasFree ? 'Modifier mon repas du dehors' : 'Autre chose (restaurant, kebab…)' }}</b>
          <small class="muted">Saisir les calories d’un repas que tu n’as pas cuisiné</small>
        </span>
      </button>

      <template v-for="g in groups" :key="g.kind">
        <div class="section-label">{{ g.label }}</div>
        <div class="pk-list">
          <button
            v-for="c in g.items" :key="c.id"
            class="pk-opt" :class="{ on: c.id === current }"
            @click="emit('pick', c.id)"
          >
            <NutritionThumb :id="c.id" :label="c.name" variant="card" class="pk-thumb" />
            <span class="pk-name">{{ c.name }}</span>
            <span v-if="c.left !== null" class="pk-left mono">reste {{ c.left }}</span>
            <span v-if="c.id === current" class="pk-check">✓</span>
          </button>
        </div>
      </template>

      <!-- Revenir au plat du planning : seulement s'il a été remplacé, sinon le
           bouton propose d'annuler quelque chose qui n'a pas eu lieu. -->
      <button v-if="picked" class="btn pk-reset" @click="emit('pick', null)">
        ↺ Reprendre le plat prévu
      </button>
    </template>
  </Sheet>
</template>
