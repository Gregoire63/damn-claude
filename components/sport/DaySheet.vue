<script setup lang="ts">
import { computed, ref } from 'vue'
import { useWorkout } from '~/composables/useWorkout'
import type { SessionRecord } from '~/composables/useWorkout'
import { choicesForSlot } from '~/lib/nutritionStats'
import { useNutrition } from '~/composables/useNutrition'
import { useTraining } from '~/composables/useTraining'
import { useProgram } from '~/composables/useProgram'
import { setText } from '~/lib/setText'
import { useMesures } from '~/composables/useMesures'
import { EFFORT_OPTIONS } from '~/utils/sportStats'
import { variantName } from '~/data/exerciseVariants'
import {
  buildDay, roundMacros, sessionsOn,
} from '~/lib/nutritionStats'
import { useEnergy } from '~/composables/useEnergy'
import { useDayPlan } from '~/composables/useDayPlan'

// Ce qui s'est passé une journée donnée — et deux façons d'y revenir : rouvrir la
// séance, ou rouvrir les repas.
//
// La feuille portait aussi la bascule « salle » et le choix des plats. C'était un
// deuxième endroit pour régler ce qui se règle déjà ailleurs, et ça transformait une
// page de consultation en formulaire.
//
// Le télétravail, lui, reste ici : c'est LE seul endroit où on le déclare. Il vivait
// aussi dans la feuille des repas, où il n'avait rien à faire — on y coche ce qu'on
// mange, pas où l'on travaille. Et il change la cible du jour, donc il appartient au
// planning.
const props = defineProps<{ iso: string, todayIso: string | null }>()
const emit = defineEmits<{ close: [], edit: [rec: SessionRecord] }>()

const { sessionLog, bodyWeightAt } = useWorkout()
const { dayFor, setOverride, dayPlanFor, stepsFor, eatenSlots, library, stock, pickedFor, setPicked, freeMealFor } = useNutrition()
const { burnOn, energyOn } = useEnergy()
const { viewOf } = useDayPlan()
const { entries: bodyEntries, suspectAts } = useMesures()

const DOW = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
// Le programme effectif, retirés compris : une séance de mars doit garder le nom des
// mouvements qu'on ne fait plus, sinon elle affiche des identifiants bruts.
const { program: prog, exerciseName: exName, exerciseById } = useProgram()
/** Une série se lit avec l'unité de SON exercice : « 40 s » pour une suspension,
 *  « +10×8 » pour des dips lestés. « 91.5×40 » disait quarante répétitions. */
const setLine = (exId: string, sets: { w?: number, r?: number, w2?: number, r2?: number }[], iso: string) =>
  sets.map(x => setText(x, exerciseById(exId) ?? {}, bodyWeightAt(iso))).join(' · ')
const effortIcon = (e?: string) => EFFORT_OPTIONS.find(o => o.value === e)?.icon ?? ''
const recColor = (r: SessionRecord) => prog.value.find(p => p.id === r.sessionId)?.color || '#8b6f5c'

const eatSheet = ref(false)

const title = computed(() => {
  const d = new Date(props.iso + 'T00:00:00')
  return `${DOW[(d.getDay() + 6) % 7]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
})
const isToday = computed(() => props.iso === props.todayIso)

const resolved = computed(() => dayFor(props.iso))
const records = computed(() => sessionsOn(sessionLog(), props.iso))

// Âge, métabolisme, dépense : la chaîne entière vient du socle partagé, indexée par
// DATE. Le métabolisme d'un mardi de mars se calcule avec le poids de ce mardi-là.
// Et une séance prévue mais jamais enregistrée ne crédite plus le forfait une fois
// la journée passée — voir composables/useEnergy.ts.
const burn = computed(() => burnOn(props.iso))
const energy = computed(() => energyOn(props.iso))

/**
 * LA MÊME journée que l'accueil et que l'onglet Nutrition.
 *
 * Elle était reconstruite ici avec `dayPlanFor`, c'est-à-dire le plan de BASE. Si
 * l'ajustement du soir avait été confirmé ce jour-là — « j'ai bien retiré les 100 g
 * de riz » —, l'accueil et Nutrition montraient le dîner allégé, et le Journal, en
 * relisant la même date, montrait le dîner d'origine. Deux totaux pour une seule
 * assiette, et c'est le Journal qu'on consulte quand on cherche à comprendre une
 * semaine. Voir composables/useDayPlan.ts.
 */
const plan = computed(() => viewOf(props.iso, { past: true }).plan)
const planTotal = computed(() => (plan.value ? roundMacros(plan.value.total) : null))
const done = computed(() => new Set(eatenSlots(props.iso)))
const doneCount = computed(() => plan.value?.meals.filter(m => done.value.has(m.slot)).length ?? 0)

// Pesées du jour, hors quarantaine — l'onglet Rapport gère les cas litigieux.
const weighIns = computed(() =>
  bodyEntries.value.filter(e => e.date === props.iso && !suspectAts.value.has(e.at)))

/**
 * Une journée PASSÉE se complète comme une séance passée se corrige.
 *
 * Les repas ne se cochaient que le jour même. C'était une asymétrie sans raison : on
 * peut rouvrir la séance de mardi dernier pour corriger une charge, mais pas dire
 * qu'on avait bien mangé la boîte. Or c'est exactement là qu'on s'en rend compte —
 * en relisant sa semaine.
 *
 * Le futur reste fermé : on ne coche pas un repas qu'on n'a pas encore mangé.
 */
const isFuture = computed(() => !!props.todayIso && props.iso > props.todayIso)
const canEatEdit = computed(() => !isFuture.value && !plan.value?.off)

/**
 * Changer le plat d'un créneau, n'importe quel jour — passé, présent ou à venir.
 *
 * Le futur était en lecture seule : on ne pouvait que constater ce que le cycle
 * proposait. Or c'est précisément là que le choix sert à quelque chose — « jeudi je
 * mange chez mes parents », « vendredi je finis le saumon ». Décider à l'avance, c'est
 * ce qui permet à la liste de courses et aux quantités d'être justes le jour venu, au
 * lieu de corriger après coup.
 *
 * On réutilise `setPicked`, déjà daté et déjà prioritaire dans la résolution du jour :
 * pas de second mécanisme à maintenir, et le plat choisi compte dans le stock comme
 * une portion engagée.
 */
/**
 * Ce qui est PRÉVU ce jour-là, et les deux gestes qui le changent.
 *
 * La feuille ne racontait que le passé : « aucune séance enregistrée ». Or la
 * question qu'on se pose devant une date à venir est l'inverse — « je ne serai pas
 * dispo vendredi midi, je la fais quand ? ». Y répondre ailleurs (dans la semaine
 * type) aurait réécrit toutes les semaines pour un empêchement d'une seule.
 *
 * Annuler et déplacer touchent le planning ET la journée alimentaire d'un seul
 * geste — cf. `useTraining`.
 */
const { plannedFor, isPlanMoved, cancelTraining, moveTraining, resetTraining } = useTraining()
const planned = computed(() => plannedFor(props.iso))
const planMoved = computed(() => isPlanMoved(props.iso))
const moving = ref(false)
function move(to: string) {
  moveTraining(props.iso, to)
  moving.value = false
}

const swapping = ref<string | null>(null)
const swapable = (slot: string) => choicesForSlot(slot, library.value, stock.value)
const swapMeal = computed(() => plan.value?.meals.find(m => m.slot === swapping.value) ?? null)
function swap(slot: string, id: string | null) {
  setPicked(props.iso, slot, id)
  swapping.value = null
}

// Le repas du dehors, saisissable aussi depuis le calendrier : on rattrape souvent
// un restaurant le lendemain, pas sur le moment.
const libre = ref<string | null>(null)
const libreMeal = computed(() => (libre.value ? freeMealFor(props.iso, libre.value) : null))
const libreLabel = computed(() => plan.value?.meals.find(m => m.slot === libre.value)?.label ?? '')
function openLibre() {
  libre.value = swapping.value
  swapping.value = null
}
</script>

<template>
  <Sheet sheet-class="day-sheet" @close="emit('close')">
    <template #head>
      <div>
        <div class="sheet-title">
          {{ title }}<span v-if="isToday" class="ds-today">aujourd'hui</span>
        </div>
        <div class="muted mono">
          {{ records.length ? `${records.length} séance(s)` : 'aucune séance' }}
          <template v-if="resolved.tt"> · télétravail</template>
        </div>
      </div>
    </template>

    <template #default>
        <!-- Seul réglage de la feuille : il change la dépense du jour (environ
             4 000 pas d'écart), donc la cible. -->
        <button class="ds-tt" :class="{ on: resolved.tt }" @click="setOverride(iso, { tt: !resolved.tt })">
          <span class="ds-tt-ico">🏠</span>
          <span class="ds-tt-l">{{ resolved.tt ? 'Télétravail' : 'Sur site' }}</span>
          <span class="ds-tt-h muted">{{ resolved.tt ? 'moins de pas, cible plus basse' : 'trajets et escaliers comptés' }}</span>
        </button>

        <!-- Énergie du jour -->
        <div v-if="energy" class="ds-energy">
          <div class="ds-target">
            <span class="ds-target-v mono">{{ energy.target }}</span>
            <span class="ds-target-u">kcal à manger</span>
          </div>
          <div class="nu-energy">
            <span><b>{{ energy.baseKcal }}</b> métabolisme</span>
            <span>+ <b>{{ energy.stepsKcal }}</b> pas<template v-if="energy.stepsEstimated"> (estimés)</template></span>
            <span>+ <b>{{ energy.sessionKcal }}</b> séance<template v-if="records.length"> réelle</template></span>
            <span>− <b>{{ energy.deficit }}</b> déficit</span>
          </div>
        </div>
        <div v-else class="muted ds-nokcal">
          Renseigne taille, sexe et année de naissance dans Profil pour voir la cible calorique.
        </div>

        <!-- Séances réellement enregistrées. Rien de « prévu » ici : la feuille
             raconte ce qui a eu lieu, pas ce qui devait avoir lieu. -->
        <div class="ds-section">Séance</div>
        <div v-if="records.length" class="ds-sessions">
          <button
            v-for="(s, i) in records" :key="i"
            class="ds-session" :style="{ '--c': recColor(s) }"
            @click="emit('edit', s)"
          >
            <div class="ds-s-top">
              <span class="ds-s-dot" />
              <span class="ds-s-name">{{ s.name }}</span>
              <span class="mono muted">{{ s.at.slice(11, 16) }}<template v-if="s.durationMin"> · {{ s.durationMin }} min</template></span>
            </div>
            <div class="ds-s-ex">
              <template v-for="e in s.entries" :key="e.exId">
                <span class="ds-s-line">
                  {{ exName(e.exId) }} <span v-if="effortIcon(e.effort)">{{ effortIcon(e.effort) }}</span>
                  <span class="mono muted">{{ setLine(e.exId, e.sets, s.at.slice(0, 10)) }}</span>
                </span>
                <span v-if="e.variant" class="ds-s-exnote">🔁 {{ variantName(e.exId, e.variant, '') }}</span>
                <span v-if="e.note" class="ds-s-exnote">💬 {{ e.note }}</span>
              </template>
            </div>
            <div v-if="s.note" class="ds-s-note">📝 {{ s.note }}</div>
            <div class="ds-s-edit muted">✏️ Touche pour modifier cette séance</div>
          </button>
        </div>
        <!-- Pas de séance enregistrée : c'est le planning qui parle, et il est
             modifiable ici. Une fois la séance faite, ces boutons n'ont plus de
             sens et disparaissent. -->
        <div v-else class="ds-plan" :class="{ rest: !planned }" :style="planned ? { '--c': planned.color } : {}">
          <div class="ds-p-top">
            <span class="ds-p-dot" />
            <span class="ds-p-name">{{ planned ? planned.name : 'Repos' }}</span>
            <span v-if="planMoved" class="ds-p-flag">planning modifié</span>
          </div>
          <p class="ds-p-hint muted">
            {{ planned
              ? 'Prévu, pas encore enregistré. Annuler ou déplacer ajuste les calories des deux journées.'
              : 'Rien de prévu : journée de repos, cible calorique réduite.' }}
          </p>
          <div class="ds-p-acts">
            <button v-if="planned" class="ds-p-act" @click="cancelTraining(iso)">✕ Annuler</button>
            <button v-if="planned" class="ds-p-act" @click="moving = true">⇄ Déplacer</button>
            <button v-if="planMoved" class="ds-p-act ghost" @click="resetTraining(iso)">↺ Reprendre le planning</button>
          </div>
        </div>
        <SportMoveSheet
          v-if="moving && planned"
          :iso="iso"
          :name="planned.name"
          :today-iso="todayIso"
          @pick="move"
          @close="moving = false"
        />

        <!-- Repas -->
        <div class="ds-section">
          Repas
          <span v-if="planTotal" class="mono ds-section-n">{{ doneCount }}/{{ plan!.meals.length }} pris · {{ planTotal.kcal }} kcal prévus</span>
        </div>
        <p v-if="plan?.off" class="muted ds-empty">
          Jour marqué comme une absence dans ta semaine type : aucun repas prévu.
        </p>
        <!-- Même carte que les séances au-dessus : la journée se lit d'un seul geste,
             au lieu d'alterner entre une liste et des cartes. Les macros sont là parce
             que la place est là — c'est ce qu'on vient vérifier en relisant un jour. -->
        <div v-else-if="plan" class="ds-meals">
          <div v-for="m in plan.meals" :key="m.slot" class="ds-meal" :class="{ eaten: done.has(m.slot) }">
            <div class="ds-m-top">
              <span class="ds-m-dot" />
              <span class="ds-m-name">{{ m.name }}</span>
              <span class="ds-m-time mono">{{ m.time }}</span>
            </div>
            <div class="ds-m-sub">
              <span class="ds-m-kcal mono">{{ Math.round(m.macros.kcal) }} kcal</span>
              <span class="ds-m-macros mono">
                {{ Math.round(m.macros.p) }} P · {{ Math.round(m.macros.g) }} G · {{ Math.round(m.macros.l) }} L
              </span>
              <span class="ds-m-state">{{ done.has(m.slot) ? '✓ pris' : '—' }}</span>
            </div>
            <!-- Le choix du plat, à toute date. C'est ce qui permet de dire « ce
                 jour-là je mangerai ça » AVANT le jour, au lieu de corriger après. -->
            <button
              v-if="swapable(m.slot).length"
              class="ds-m-swap" :class="{ set: pickedFor(iso, m.slot) }"
              @click="swapping = swapping === m.slot ? null : m.slot"
            >
              {{ pickedFor(iso, m.slot) ? '✎ plat choisi' : '✎ changer de plat' }}
            </button>

          </div>
        </div>
        <!-- Même feuille de choix qu'à l'accueil : un seul composant, donc un seul
             endroit à corriger. Elle s'empile par-dessus la feuille de date. -->
        <NutritionPickSheet
          v-if="swapping && swapMeal"
          :iso="iso"
          :slot-id="swapping"
          :slot-label="swapMeal.label"
          :current="swapMeal.recipeId"
          :picked="pickedFor(iso, swapping)"
          :has-free="!!freeMealFor(iso, swapping)"
          @pick="swap(swapping, $event)"
          @libre="openLibre()"
          @close="swapping = null"
        />

        <NutritionFreeMealSheet
          v-if="libre"
          :iso="iso"
          :slot-id="libre"
          :slot-label="libreLabel"
          :current="libreMeal"
          @saved="libre = null"
          @close="libre = null"
        />

        <button v-if="canEatEdit" class="btn-primary ds-open" @click="eatSheet = true">
          🍽 {{ isToday ? 'Compléter les repas' : 'Corriger les repas de ce jour' }}
        </button>
        <p v-else-if="isFuture" class="muted ds-empty">
          Journée à venir : les repas se cochent une fois mangés. Tu peux déjà choisir
          ce que tu mangeras — les quantités et les courses suivront.
        </p>

        <!-- Corps -->
        <template v-if="weighIns.length || stepsFor(iso) !== null">
          <div class="ds-section">Corps</div>
          <div class="ds-body">
            <div v-for="e in weighIns" :key="e.at" class="ds-weigh">
              <span class="mono">{{ e.at.slice(11) }}</span>
              <b>{{ e.kg.toFixed(1) }} kg</b>
              <span v-if="e.fatRatio" class="muted">{{ e.fatRatio }} % de gras</span>
              <span v-if="e.muscleMass" class="muted">{{ e.muscleMass }} kg de muscle</span>
            </div>
            <div v-if="stepsFor(iso) !== null" class="ds-weigh">
              <span class="mono">Pas</span><b>{{ stepsFor(iso)!.toLocaleString('fr-FR') }}</b>
            </div>
          </div>
        </template>
    </template>

    <!-- La feuille des repas se superpose : on revient à la journée en la fermant.
         Le verrou de défilement compte les feuilles empilées, donc fermer celle du
         dessus ne rend pas la page mobile sous celle du dessous. -->
    <template #after>
      <Teleport to="body">
        <div class="sport-app sport-portal">
          <transition name="sheet">
            <NutritionEatSheet
              v-if="eatSheet" :today-iso="iso" :past="!isToday"
              @close="eatSheet = false"
            />
          </transition>
        </div>
      </Teleport>
    </template>
  </Sheet>
</template>
