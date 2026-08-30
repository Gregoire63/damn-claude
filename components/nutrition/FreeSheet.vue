<script setup lang="ts">
import { computed } from 'vue'
import { useNutrition } from '~/composables/useNutrition'
import { checkFreeMeal } from '~/lib/freeMeal'
import { cookedWeight } from '~/lib/cooked'
import type { FreeMeal } from '~/lib/freeMeal'

// La fiche d'un repas HORS PLAN, quand il en a une.
//
// Un repas libre était un cul-de-sac : quatre chiffres, et « Saisi à la main ». Ça
// convenait au kebab du vendredi, dont il n'y a rien à dire de plus. Ça ne convenait
// pas du tout au cas le plus fréquent — la VARIANTE d'un plat que je connais : même
// recette, 211 g de saumon au lieu de 150, sans la vinaigrette. Une fois validée, la
// variante remplaçait le plat à l'écran et j'y perdais les quantités, exactement au
// moment où j'en avais besoin : devant la balance.
//
// D'où cette fiche. Elle montre la composition DE CE REPAS-LÀ — jamais celle du
// catalogue, ce serait le contresens : ce sont précisément les grammages qu'on n'a
// pas suivis. Le plat d'origine est rappelé, et sa recette standard reste accessible
// à côté, pour comparer.
//
// Elle ne s'ouvre que si le repas porte une composition. Sans `items`, il n'y a
// littéralement rien à afficher de plus que ce que la carte dit déjà.
const props = defineProps<{ meal: FreeMeal, slotLabel: string, time: string }>()
const emit = defineEmits<{ close: [], recette: [id: string] }>()

const { library, cookedRatios } = useNutrition()

const base = computed(() => (props.meal.base ? library.value.recipes[props.meal.base] ?? null : null))
const items = computed(() => props.meal.items ?? [])
const foodName = (id: string) => library.value.foods[id]?.name ?? id

/** Le poids une fois cuit, quand il est connu — féculents seulement. `null` ailleurs. */
const cuit = (food: string, g: number) => cookedWeight(food, g, { mesures: cookedRatios.value })

/**
 * Ce que les ingrédients listés expliquent, face à ce qui a été saisi.
 *
 * Affiché seulement quand les deux divergent nettement, et formulé comme un CONSTAT,
 * pas comme une alerte. Un écart a deux causes également probables : un grammage
 * faux, ou un ingrédient sans identifiant dans le catalogue — un gigot, un burger —
 * qu'on n'a pas pu lister. La première mérite une correction, la seconde non.
 * Trancher à la place de l'utilisateur reviendrait à effacer le gigot du total.
 */
const controle = computed(() => checkFreeMeal(props.meal, library.value.foods))

const M = [
  { k: 'p' as const, label: 'Protéines' },
  { k: 'g' as const, label: 'Glucides' },
  { k: 'l' as const, label: 'Lipides' },
]
</script>

<template>
  <Sheet
    sheet-class="nu-free-sheet"
    :title="meal.label"
    :subtitle="`${time} · ${slotLabel}`"
    @close="emit('close')"
  >
    <template #title-extra>
      <span class="nu-tag nu-tag-free">hors plan</span>
    </template>

    <!-- Le plat d'origine, discret : c'est un repère, pas le sujet de la fiche. -->
    <p v-if="base" class="nu-free-base">
      Variante de <b>{{ base.name }}</b>
      <button class="nu-free-link" @click="emit('recette', base.id)">voir la recette standard →</button>
    </p>

    <div class="nu-free-macros">
      <div class="nu-free-kcal mono">{{ Math.round(meal.kcal) }} kcal</div>
      <div class="nu-free-split">
        <span v-for="m in M" :key="m.k" class="nu-free-m">
          <b class="mono">{{ Math.round(meal[m.k]) }} g</b> {{ m.label }}
        </span>
      </div>
    </div>

    <template v-if="items.length">
      <div class="section-label mt-6">Ce qu'il y avait dedans</div>
      <table class="nu-free-items">
        <tbody>
          <tr v-for="(it, i) in items" :key="i">
            <th>{{ foodName(it.food) }}</th>
            <td class="mono">{{ it.g }} g</td>
            <td class="mono muted">{{ cuit(it.food, it.g) ? `→ ${cuit(it.food, it.g)} g cuits` : '' }}</td>
          </tr>
        </tbody>
      </table>

      <!-- Le constat, pas l'alarme. -->
      <p v-if="controle?.notable" class="nu-free-ecart">
        Les ingrédients listés donnent <b>{{ Math.round(controle.calcule.kcal) }} kcal</b>
        ({{ Math.round(controle.calcule.p) }} g de protéines), pour
        <b>{{ Math.round(controle.saisi.kcal) }} kcal</b> enregistrées
        — {{ controle.ecartPct > 0 ? '+' : '' }}{{ controle.ecartPct }} %.
        Un ingrédient absent du catalogue peut l'expliquer ; un grammage faux aussi.
        Ce sont les chiffres <b>enregistrés</b> qui comptent dans ta journée.
      </p>
    </template>

    <template v-if="meal.steps">
      <div class="section-label mt-6">Préparation<span v-if="base" class="muted"> · adaptée</span></div>
      <p class="nu-free-steps">{{ meal.steps }}</p>
    </template>
    <p v-else-if="base?.steps" class="nu-free-steps muted mt-6">
      Préparation inchangée — voir la recette standard.
    </p>

    <!-- Dit explicitement ce qui N'A PAS changé. C'est la question qu'on se pose en
         voyant des grammages inhabituels : est-ce que je viens d'abîmer ma recette ? -->
    <p class="muted mt-6">
      Cette composition ne vaut que pour ce repas et ce jour.
      <template v-if="base"><b>{{ base.name }}</b> n'a pas bougé dans le catalogue.</template>
      <template v-else>Rien n'a été ajouté au catalogue.</template>
    </p>
  </Sheet>
</template>
