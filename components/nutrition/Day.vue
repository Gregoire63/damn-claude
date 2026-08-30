<script setup lang="ts">
import { computed, ref } from 'vue'
import { useNutrition } from '~/composables/useNutrition'
import { useWithings } from '~/composables/useWithings'
import { useWorkout } from '~/composables/useWorkout'
import type { DayMeal, DayStatus } from '~/lib/nutritionStats'
import type { FreeMeal } from '~/lib/freeMeal'
import {
  DAY_NAMES, STATUS_LABELS, adjustRemaining, adjustSignature, applySteps, buildDay, choicesForSlot, dayIntake, dayStatus, dowIndex, extraFromRecipe, fiberIntake, fiberVerdict,
  isDayPlayed, macroSplit, quickExtra, roundMacros, sessionsOn, sumMacros,
} from '~/lib/nutritionStats'
import { useEnergy } from '~/composables/useEnergy'
import { useDayPlan } from '~/composables/useDayPlan'

// Vue « Aujourd'hui » : le tableau de bord du jour.
// Trois postes de dépense explicites — métabolisme, pas, séance — au lieu d'un
// facteur d'activité opaque. Le télétravail n'est donc pas un coefficient magique :
// c'est simplement une journée où on marche beaucoup moins.
/**
 * `past` : on rattrape une journée finie depuis le journal, on ne la vit pas.
 *
 * Deux choses n'ont alors plus de sens et sont masquées : la liste du sac de sport
 * (elle se prépare le matin) et l'ajustement du soir (on ne réduit pas le riz d'un
 * dîner déjà mangé). Cocher les repas, en revanche, est tout l'intérêt.
 */
const props = withDefaults(defineProps<{ todayIso: string, past?: boolean }>(), { past: false })

const {
  dayPlanFor, dayFor, stepsFor, isEaten, toggleEaten, eatenSlots, pickedFor, setPicked, stock,
  extrasFor, addExtra, removeExtra, prepMode, library,
  freeMealFor,
  isAdjustApplied, setAdjustApplied, clearAdjustApplied,
} = useNutrition()
const { currentWeight, sessionLog } = useWorkout()
// Âge, métabolisme, dépense, cible protéique : un seul chemin pour tous les écrans.
const { burnOn, energyOn, proteinTarget } = useEnergy()
const { viewOf } = useDayPlan()
const { bodyComp } = useWithings()

const sheet = ref<DayMeal | null>(null)
/**
 * Le repas hors plan dont on regarde la composition.
 *
 * Séparé de `sheet` parce que ce n'est pas la même fiche : celle d'un plat lit le
 * catalogue par son identifiant, celle-ci n'a pas d'identifiant du tout — sa
 * composition vit dans le repas lui-même, pour ce jour-là seulement.
 */
const freeSheet = ref<{ meal: FreeMeal, slotLabel: string, time: string } | null>(null)
/** Fiche de catalogue ouverte DEPUIS une variante — elle n'a pas de repas derrière. */
const sheetId = ref<string | null>(null)
const fermerFiches = () => { sheet.value = null; sheetId.value = null }
/** La composition d'un créneau, s'il en a une. Sans elle, rien à ouvrir. */
const freeOf = (slot: string) => {
  const f = freeMealFor(props.todayIso, slot)
  return f?.items?.length ? f : null
}
function openMeal(m: DayMeal) {
  const f = m.free ? freeOf(m.slot) : null
  if (f) { freeSheet.value = { meal: f, slotLabel: m.label, time: m.time }; return }
  if (!m.free) sheet.value = m
}
const adding = ref(false)
const quickLabel = ref('')
const quickKcal = ref('')
// Même horloge que l'accueil, sinon les deux écrans ne construisent pas la
// même journée. Voir composables/useNow.ts.
const { nowHour } = useNow()

const resolved = computed(() => dayFor(props.todayIso))

// ─── Profil ──────────────────────────────────────────────────────────────────
const kg = currentWeight

// ─── Séance réellement enregistrée ──────────────────────────────────────────
const todaySessions = computed(() => sessionsOn(sessionLog(), props.todayIso))
const status = computed<DayStatus>(() => vue.value.status)

// ─── Sac de sport ───────────────────────────────────────────────────────────
// Visible seulement tant que la séance est à venir : une fois qu'elle est
// enregistrée, la liste n'a plus rien à dire et n'occuperait que le haut de l'écran.

// ─── Énergie du jour ─────────────────────────────────────────────────────────
// La chaîne complète — âge, métabolisme, dépense, cible — vient du socle partagé.
// Elle était recopiée ici comme dans six autres écrans, et les six ne disaient pas
// tout à fait la même chose. Voir composables/useEnergy.ts.
const burn = computed(() => burnOn(props.todayIso))
const energy = computed(() => energyOn(props.todayIso))

/**
 * La journée, construite UNE fois pour toute l'application.
 *
 * Le plan de base, ce qui est déjà avalé, l'ajustement du soir et le plan effectif
 * étaient reconstruits ici ET sur l'accueil, avec des gardes qui ne coïncidaient pas
 * tout à fait. C'est la même journée : elle ne peut pas afficher deux nombres de
 * calories restantes selon l'écran par lequel on la regarde.
 * Voir composables/useDayPlan.ts.
 */
const vue = computed(() => viewOf(props.todayIso, { past: props.past }))
const trained = computed(() => vue.value.trained)
const base = computed(() => vue.value.base)
const eatenSoFar = computed(() => vue.value.eatenKcal)
const adjustment = computed(() => vue.value.suggestion)
/**
 * L'ajustement n'est plus appliqué d'office : c'est un conseil tant qu'il n'est pas
 * confirmé.
 *
 * Avant, l'app retirait 100 g de riz dans ses calculs et affichait des kcal
 * corrigées, que l'assiette réelle les reflète ou non. Un compteur qui suppose un
 * geste qu'on n'a pas fait ment doucement toute la soirée. Maintenant, on ne touche
 * à rien tant que « C'est fait » n'a pas été pressé — et la confirmation expire
 * d'elle-même si le conseil change (voir `adjustSignature`).
 */
const adjustSig = computed(() => vue.value.signature)
const adjustDone = computed(() => vue.value.confirmed)
const day = computed(() => vue.value.plan)

function confirmAdjust() {
  if (adjustSig.value) setAdjustApplied(props.todayIso, adjustSig.value)
}
function undoAdjust() {
  clearAdjustApplied(props.todayIso)
}

// ─── Ce qui a été mangé ──────────────────────────────────────────────────────
const extras = computed(() => extrasFor(props.todayIso))
const intake = computed(() => (energy.value
  ? dayIntake(day.value, eatenSlots(props.todayIso), extras.value, energy.value.target)
  : null))
const split = computed(() => (intake.value ? macroSplit(intake.value.eaten) : null))
/**
 * Cible protéique. Elle suit la masse maigre dès que la balance la donne : calculer
 * sur le poids total revient à prescrire des protéines pour du tissu adipeux, qui
 * n'en demande pas.
 *
 * `bodyComp` fait le travail délicat : poids du jour, taux de masse grasse de la
 * dernière pesée qui en avait un. Une pesée sans impédance ne fait donc plus bondir
 * la cible du jour au lendemain.
 */
const pPlan = proteinTarget
const pTarget = computed(() => pPlan.value?.g ?? null)

/**
 * Les fibres ne vivaient que dans la moyenne des micronutriments, sur quatorze
 * jours. C'est pourtant un poste qui se juge au jour le jour : on ne ressent pas une
 * moyenne, on ressent la journée où l'on est passé de 20 à 45 g d'un coup.
 */
const fiber = computed(() => fiberIntake(day.value, eatenSlots(props.todayIso), library.value.foods))
const fiberSaid = computed(() => fiberVerdict(fiber.value.planned))

// Plus de « semaine A / B » : le cycle de 14 jours n'est qu'un pré-remplissage,
// l'afficher revenait à mettre en scène une mécanique interne.
const dayLabel = computed(() => DAY_NAMES[dowIndex(props.todayIso)])
const statusIcon: Record<DayStatus, string> = {
  rest: '🛋️', pending: '⏳', done: '✅', bonus: '⭐', missed: '⚠️', skipped: '✕',
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/** Plats de la bibliothèque proposés en extra, les plus légers d'abord. */
const addable = computed(() => Object.values(library.value.recipes)
  .map(r => ({ recipe: r, macros: roundMacros(extraFromRecipe(r, library.value, 'preview')) }))
  .sort((a, b) => a.macros.kcal - b.macros.kcal))

function addFromLibrary(id: string) {
  const r = library.value.recipes[id]
  if (!r) return
  const e = extraFromRecipe(r, library.value, 'tmp')
  addExtra(props.todayIso, { label: e.label, kcal: e.kcal, p: e.p, g: e.g, l: e.l, recipeId: e.recipeId })
  adding.value = false
}
function addQuick() {
  const kcal = Number.parseInt(quickKcal.value, 10)
  if (!Number.isFinite(kcal) || kcal <= 0) return
  const e = quickExtra(quickLabel.value.trim() || 'Extra', kcal, 'tmp')
  addExtra(props.todayIso, { label: e.label, kcal: e.kcal, p: e.p, g: e.g, l: e.l })
  quickLabel.value = ''
  quickKcal.value = ''
  adding.value = false
}

const swapping = ref<string | null>(null)

/**
 * Tout ce qu'on peut mettre à ce créneau — pas seulement ce qui a été cuisiné.
 *
 * Le stock filtrait la liste : impossible de dire « aujourd'hui je mange autre chose »
 * si cet autre chose n'avait pas été coché à la session de cuisine. Or ce choix ne sert
 * pas à gérer un frigo, il sert à donner les bonnes quantités pour la journée en
 * fonction de ce qu'on va réellement manger. Le stock est toujours affiché quand il est
 * connu : il informe, il n'interdit plus.
 *
 * Et ça marche maintenant sur TOUS les créneaux, pas seulement midi et soir : on peut
 * changer de petit-déjeuner ou de collation le matin même.
 */
const swapable = (slot: string) => choicesForSlot(slot, library.value, stock.value)
/** Le repas en cours de remplacement : la feuille a besoin de son nom et de son plat. */
const swapMeal = computed(() => day.value?.meals.find(m => m.slot === swapping.value) ?? null)
function swap(slot: string, id: string | null) {
  setPicked(props.todayIso, slot, id)
  swapping.value = null
}

/**
 * Le créneau dont on saisit un repas du dehors.
 *
 * Stocké à part de `swapping` : on passe de la feuille de choix au formulaire, et
 * garder les deux ouvertes en même temps empilerait deux feuilles.
 */
const libre = ref<string | null>(null)
const libreMeal = computed(() => (libre.value ? freeMealFor(props.todayIso, libre.value) : null))
const libreLabel = computed(() => day.value?.meals.find(m => m.slot === libre.value)?.label ?? '')
function openLibre() {
  libre.value = swapping.value
  swapping.value = null
}

const foodName = (id: string) => library.value.foods[id]?.name ?? id
</script>

<template>
  <div class="stack">
    <!-- Le compteur : la seule chose à regarder dans la journée -->
    <div v-if="energy && intake" class="card nu-counter">
      <div class="row-between">
        <div>
          <div class="section-label">{{ dayLabel }}</div>
          <div class="nu-mode">{{ statusIcon[status] }} {{ STATUS_LABELS[status] }}</div>
        </div>
        <div class="nu-counter-big">
          <span class="mono">{{ intake.remaining }}</span>
          <small>kcal restantes</small>
        </div>
      </div>

      <div class="nu-progress">
        <div
          class="nu-progress-fill" :class="{ over: intake.progress > 1 }"
          :style="{ width: `${Math.min(100, intake.progress * 100)}%` }"
        />
      </div>
      <div class="nu-progress-legend mono">
        <span>{{ intake.eaten.kcal }} mangées</span>
        <span>cible {{ energy.target }}</span>
      </div>

      <!-- Le détail de la dépense, poste par poste : aucun chiffre ne sort d'un chapeau -->
      <div class="nu-energy">
        <span><b>{{ energy.baseKcal }}</b> métabolisme</span>
        <span>+ <b>{{ energy.stepsKcal }}</b> pas</span>
        <span>+ <b>{{ energy.sessionKcal }}</b> séance</span>
        <span>− <b>{{ energy.deficit }}</b> déficit</span>
        <span class="nu-energy-eq">= <b>{{ energy.target }}</b> kcal</span>
      </div>
    </div>
    <div v-else class="card empty">
      Renseigne taille, sexe et année de naissance dans <b>Profil</b>, puis pèse-toi
      depuis <b>Rapport</b> : sans ces trois-là, aucune cible ne peut être calculée sur
      tes vraies données.
    </div>



    <div v-if="todaySessions.length" class="card nu-sessions">
      <div v-for="(s, i) in todaySessions" :key="i" class="nu-session">
        <span class="mono">{{ s.at.slice(11, 16) }}</span>
        <span class="flex-1">{{ s.name }}</span>
        <span class="mono">{{ s.durationMin ? `${s.durationMin} min` : '—' }}</span>
      </div>
    </div>

    <!-- L'ajustement -->
    <div v-if="adjustment" class="card nu-adjust" :class="{ up: adjustment.covered > 0 }">
      <div class="nu-adjust-head">
        <span class="nu-adjust-delta mono">{{ adjustment.covered > 0 ? '+' : '' }}{{ adjustment.covered }} kcal</span>
        <span class="nu-adjust-title">
          {{ adjustment.covered > 0 ? 'Tu peux manger un peu plus' : 'Allège les repas d\'aujourd\'hui' }}
        </span>
      </div>
      <p v-if="adjustment.portion" class="nu-adjust-label">{{ adjustment.portion.label }}</p>
      <ul v-else class="nu-adjust-steps">
        <li v-for="(st, i) in adjustment.steps" :key="i">{{ st.label }}</li>
      </ul>
      <!-- Rien n'est appliqué tant que ce bouton n'a pas été pressé. Un compteur qui
           suppose un geste qu'on n'a pas fait ment doucement toute la soirée. -->
      <div v-if="adjustSig" class="nu-adjust-confirm">
        <template v-if="adjustDone">
          <span class="nu-adjust-ok">✓ Pris en compte</span>
          <button type="button" class="btn nu-adjust-undo" @click="undoAdjust">
            Finalement non
          </button>
        </template>
        <template v-else>
          <button type="button" class="btn-primary" @click="confirmAdjust">
            {{ adjustment.covered > 0 ? 'C\'est noté, je mange plus' : 'C\'est fait, j\'ai réduit' }}
          </button>
          <span class="nu-adjust-hint">
            Tant que tu ne confirmes pas, le compteur reste sur les quantités prévues.
          </span>
        </template>
      </div>
    </div>

    <!-- Les repas à valider -->
    <div class="section-label">Les repas — coche au fur et à mesure</div>
    <!-- Journée marquée absente dans la semaine type : rien n'a été acheté ni
         cuisiné pour elle. Le dire explicitement évite de croire à un bug. -->
    <p v-if="day.off" class="nu-note">
      Tu as marqué ce jour comme une absence dans ta semaine type : aucun repas n'est
      prévu, et rien n'a été acheté pour lui. Note ce que tu manges en repas hors plan.
    </p>
    <div class="nu-meals">
      <div v-for="m in day.meals" :key="m.slot" class="card nu-meal" :class="{ done: isEaten(props.todayIso, m.slot) }">
        <!-- Un repas hors plan n'était PAS cliquable : il n'y avait rien derrière.
             Il l'est redevenu dès qu'il porte une composition — c'est justement là
             qu'on a besoin des grammages, et c'était le seul endroit où l'on ne
             pouvait pas les lire. -->
        <button class="nu-meal-main" :disabled="m.free && !freeOf(m.slot)" @click="openMeal(m)">
          <div class="nu-meal-top">
            <span class="nu-time mono">{{ m.time }}</span>
            <span class="nu-slot">{{ m.label }}</span>
            <span v-if="m.adjusted" class="nu-tag">ajusté</span>
            <!-- Dit d'où viennent les chiffres. Un repas du dehors est saisi de
                 mémoire ; le lire comme une portion pesée fausserait la confiance
                 qu'on accorde au total du jour. -->
            <span v-if="m.free" class="nu-tag nu-tag-free">du dehors</span>
            <span class="nu-kcal mono">{{ Math.round(m.macros.kcal) }} kcal</span>
          </div>
          <div class="nu-meal-name">{{ m.name }}</div>
          <!-- Les grammages ne sont plus ici : ils tiennent sur trois lignes tassées
               pour une information qu'on ne lit pas en cochant un repas, et qui est
               de toute façon dans la fiche, à un clic. Reste ce qui identifie le
               plat — son nom et sa photo. -->
          <div class="muted nu-meal-more">
            {{ m.free ? (freeOf(m.slot) ? 'Voir la composition →' : 'Saisi à la main') : 'Voir la recette →' }}
          </div>
        </button>
        <div class="nu-meal-side">
          <!-- Photo en lecture seule, et en grand : c'est elle qu'on reconnaît d'un
               coup d'œil quand on ouvre la liste, bien avant de lire un nom. La
               prise de vue se fait dans la fiche du plat, une seule fois, puisqu'une
               photo appartient à la recette et pas au jour. -->
          <NutritionThumb :id="m.recipeId" :label="m.name" variant="card" class="nu-meal-photo" />
          <!-- Le plat est PROPOSÉ, pas imposé : quand on cuisine sept boîtes à
               l'avance, on prend celle dont on a envie. Un geste pour corriger,
               et c'est ce qui a été mangé qui compte ensuite dans le stock. -->
          <button
            v-if="swapable(m.slot).length" class="nu-swap"
            :aria-label="`Changer le plat de ${m.label}`"
            @click="swapping = swapping === m.slot ? null : m.slot"
          >⇄</button>
          <button
            class="check" :class="{ ok: isEaten(props.todayIso, m.slot) }"
            :aria-label="isEaten(props.todayIso, m.slot) ? 'Marquer comme non pris' : 'Marquer comme pris'"
            @click="toggleEaten(props.todayIso, m.slot)"
          >
            {{ isEaten(props.todayIso, m.slot) ? '✓' : '○' }}
          </button>
        </div>


      </div>
    </div>

    <!-- La feuille de choix : dix-sept plats ne tiennent pas dépliés sous la carte,
         et une liste qui pousse le repas hors de l'écran fait perdre le contexte. -->
    <NutritionPickSheet
      v-if="swapping && swapMeal"
      :iso="props.todayIso"
      :slot-id="swapping"
      :slot-label="swapMeal.label"
      :current="swapMeal.recipeId"
      :picked="pickedFor(props.todayIso, swapping)"
      :has-free="!!freeMealFor(props.todayIso, swapping)"
      @pick="swap(swapping, $event)"
      @libre="openLibre()"
      @close="swapping = null"
    />

    <!-- Le repas qu'on n'a pas cuisiné : il remplace celui du plan sur ce créneau. -->
    <NutritionFreeMealSheet
      v-if="libre"
      :iso="props.todayIso"
      :slot-id="libre"
      :slot-label="libreLabel"
      :current="libreMeal"
      @saved="libre = null"
      @close="libre = null"
    />

    <!-- Ce qui a été mangé en plus du plan -->
    <div class="section-label">En plus du plan</div>
    <div v-if="extras.length" class="card no-pad">
      <div v-for="e in extras" :key="e.id" class="nu-extra">
        <span class="flex-1">{{ e.label }}</span>
        <span class="mono">{{ e.kcal }} kcal</span>
        <button class="nu-del" aria-label="Retirer" @click="removeExtra(props.todayIso, e.id)">×</button>
      </div>
    </div>
    <button v-if="!adding" class="btn" @click="adding = true">＋ Ajouter ce que j'ai mangé</button>

    <div v-else class="card nu-addbox">
      <div class="section-label">Saisie rapide</div>
      <div class="nu-quick">
        <input v-model="quickLabel" type="text" placeholder="Restaurant, part de gâteau…">
        <input v-model="quickKcal" type="number" inputmode="numeric" min="0" step="10" placeholder="kcal">
        <button class="btn-primary" @click="addQuick()">Ajouter</button>
      </div>
      <div class="section-label mt-6">Ou un plat de la bibliothèque</div>
      <div class="nu-pick">
        <button v-for="a in addable" :key="a.recipe.id" class="btn" @click="addFromLibrary(a.recipe.id)">
          {{ a.recipe.name }} <span class="mono muted">{{ a.macros.kcal }}</span>
        </button>
      </div>
      <button class="btn mt-6" @click="adding = false">Annuler</button>
    </div>

    <!-- Bilan macros de ce qui a réellement été mangé -->
    <div v-if="split && intake" class="card nu-macros">
      <div class="section-label">Ce que tu as mangé aujourd'hui</div>
      <div class="nu-bar mt-6">
        <div class="nu-seg p" :style="{ flex: Math.max(1, split.p) }">{{ intake.eaten.p }} g</div>
        <div class="nu-seg g" :style="{ flex: Math.max(1, split.g) }">{{ intake.eaten.g }} g</div>
        <div class="nu-seg l" :style="{ flex: Math.max(1, split.l) }">{{ intake.eaten.l }} g</div>
      </div>
      <div class="nu-legend mono">
        <span><i class="nu-sw p" />Protéines {{ intake.eaten.p }} g<template v-if="pTarget"> / {{ pTarget }}</template></span>
        <span><i class="nu-sw g" />Glucides {{ intake.eaten.g }} g</span>
        <span><i class="nu-sw l" />Lipides {{ intake.eaten.l }} g</span>
        <span class="nu-fib" :class="fiberSaid.tone">
          <i class="nu-sw f" />Fibres {{ fiber.eaten }} g / {{ fiberSaid.ref }}
        </span>
      </div>
      <!-- D'où sort la cible protéique. Un chiffre qui bouge quand la balance bouge
           doit dire sur quoi il s'appuie, sinon il passe pour arbitraire. -->
      <p v-if="pPlan" class="nu-basis mt-6">
        <template v-if="pPlan.basis === 'lean'">
          Cible <b>{{ pPlan.g }} g</b> — {{ pPlan.perKg }} g par kilo de masse maigre,
          soit <b>{{ pPlan.leanKg }} kg</b> ({{ pPlan.fatRatio }} % de masse grasse<template
            v-if="bodyComp?.carried"
          >, mesurés le {{ bodyComp.measuredOn }} et reportés sur ton poids d'aujourd'hui</template>).
        </template>
        <template v-else>
          Cible <b>{{ pPlan.g }} g</b>, calculée sur le poids de corps faute de mesure de
          masse grasse. Une pesée à impédance la recalculera sur ta masse maigre, ce qui
          est plus juste tant qu'il reste du gras à perdre.
        </template>
      </p>
      <!-- Le conseil ne s'affiche que quand il y a quelque chose à faire : une
           journée dans la fourchette n'a pas besoin d'un paragraphe pour le dire. -->
      <p v-if="fiberSaid.tone !== 'ok'" class="nu-note mt-6">
        <b>{{ fiberSaid.tone === 'low' ? 'Peu de fibres' : 'Beaucoup de fibres' }}</b>
        — {{ fiberSaid.grams }} g prévus aujourd'hui. {{ fiberSaid.advice }}
      </p>
    </div>

    <!-- Une seule fiche de plat dans toute l'appli : celle-ci montre la photo, les
         ingrédients ET la recette. La version recopiée ici n'avait ni photo ni
         sauce, et il fallait la corriger deux fois à chaque changement. -->
    <Teleport to="body">
      <div class="sport-app sport-portal">
        <transition name="sheet">
          <NutritionRecipeSheet v-if="sheet || sheetId" :id="sheetId ?? sheet!.recipeId" @close="fermerFiches()" />
        </transition>
        <!-- La composition d'un repas hors plan. « voir la recette standard »
             enchaîne sur la fiche du catalogue : les deux se lisent en regard, ce
             qui est tout l'intérêt d'une variante. -->
        <transition name="sheet">
          <NutritionFreeSheet
            v-if="freeSheet"
            :meal="freeSheet.meal" :slot-label="freeSheet.slotLabel" :time="freeSheet.time"
            @close="freeSheet = null"
            @recette="sheetId = $event; freeSheet = null"
          />
        </transition>
      </div>
    </Teleport>
  </div>
</template>
