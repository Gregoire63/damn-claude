<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useNutrition } from '~/composables/useNutrition'
import { useProfile } from '~/composables/useProfile'
import { useMesures } from '~/composables/useMesures'
import { useEnergy } from '~/composables/useEnergy'
import { useDayPlan } from '~/composables/useDayPlan'
import { useWorkout } from '~/composables/useWorkout'
import {
  adjustRemaining, adjustSignature, applySteps, buildDay, carryAdjustedTarget, dayIntake, donutArcs, hhmm, isDayPlayed, macroTargets, mondayOf, nextMeal, sessionsOn, sumMacros, timelineOf, weekBalance,
} from '~/lib/nutritionStats'
import { shiftIso } from '~/utils/sportStats'

// Bandeau d'accueil : où j'en suis, et une saisie en trois secondes.
//
// C'est le seul écran qu'on regarde plusieurs fois par jour. Il répond donc à une
// seule question — combien il me reste — et propose un seul geste : remplir. Le
// détail des repas s'ouvre en feuille, comme une séance : c'est une action, pas
// une destination, et ça n'a jamais mérité un onglet permanent.
const props = defineProps<{ todayIso: string }>()

const {
  hydrate, dayPlanFor, dayFor, stepsFor, toggleEaten, eatenSlots, extrasFor, addExtra,
  removeExtra, prepMode, library, isAdjustApplied,
} = useNutrition()

// Le bandeau peut être monté sans passer par l'onglet Nutrition : il hydrate lui-même.
onMounted(hydrate)
const { profile } = useProfile()
const { currentWeight, sessionLog } = useWorkout()
const { bodyComp } = useMesures()
// Âge, métabolisme, dépense, cible protéique : le socle partagé.
const { burnOn, energyOn, proteinTarget } = useEnergy()
const { viewOf } = useDayPlan()

const open = ref(false)
const eatSheet = ref(false)
const macroSheet = ref(false)
const label = ref('')
const kcal = ref('')
const time = ref(hhmm(new Date()))
// Horloge partagée : voir composables/useNow.ts. Figer l'heure ici faisait
// diverger l'accueil de la feuille des repas passé 15 h.
const { nowHour, nowMin } = useNow()

const kg = currentWeight


/**
 * Bilan d'une journée quelconque : sert pour aujourd'hui et pour le report hebdo.
 *
 * La règle de dépense qui vivait ici — enregistré, sinon forfait tant que la journée
 * n'est pas finie, sinon zéro — était la BONNE. Elle est simplement devenue celle de
 * tout le monde : deux autres écrans oubliaient la dernière clause et créditaient
 * quatre cents calories à une séance jamais faite. Voir composables/useEnergy.ts.
 */
function energyOf(iso: string) {
  const energy = energyOn(iso)
  if (!energy) return null
  return { r: dayFor(iso), burn: burnOn(iso), energy }
}


const today = computed(() => energyOf(props.todayIso))

// Ce qui a déjà été avalé : repas validés + extras. L'ajustement ne doit porter que
// sur les repas restants, sinon un écart déjà encaissé se paierait deux fois.
/**
 * La journée d'aujourd'hui, construite par le socle partagé.
 *
 * Tout ce bloc — déjà avalé, séance en attente, ajustement conseillé, plan
 * effectif — existait à l'identique dans l'onglet Nutrition. Deux écrans qui
 * calculent séparément les calories restantes de la MÊME journée finissent par en
 * afficher deux. Voir composables/useDayPlan.ts.
 */
const vue = computed(() => viewOf(props.todayIso))
const eatenSoFar = computed(() => vue.value.eatenKcal)

/**
 * Séance prévue mais pas encore enregistrée. Tant qu'on est dans cet état, la
 * dépense du jour est une estimation (DEFAULT_BURN) : ajuster les repas dessus
 * reviendrait à retirer du riz ce soir sur la foi d'une séance qui n'a pas eu lieu.
 * L'écran Jour s'en garde déjà ; Hero ne le faisait pas, et les deux affichaient
 * donc des « kcal restantes » différentes au même moment.
 */
// « Séance prévue, pas encore enregistrée » : c'est exactement ce que dit
// `dayStatus`, qui était réimplémenté ici à la main.
const pending = computed(() => vue.value.status === 'pending')

const day = computed(() => vue.value.plan)

// ─── Report hebdomadaire ─────────────────────────────────────────────────────
// Un écart ne se rattrape pas le lendemain : il se lisse sur les jours qui restent.
const balance = computed(() => {
  const monday = mondayOf(props.todayIso)
  const rows = Array.from({ length: 7 }, (_, i) => {
    const iso = shiftIso(monday, i)
    const e = energyOf(iso)
    if (!e) return null
    // Le plan EFFECTIF de chaque jour, ajustement confirmé compris : le bilan de la
    // semaine doit additionner ce qui a été mangé, pas ce qui était prévu.
    const intake = dayIntake(viewOf(iso, { past: iso < props.todayIso }).plan, eatenSlots(iso), extrasFor(iso), e.energy.target)
    return { iso, target: e.energy.target, eaten: intake.eaten.kcal, closed: iso < props.todayIso }
  }).filter(Boolean) as { iso: string, target: number, eaten: number, closed: boolean }[]
  return rows.length ? weekBalance(rows) : null
})

const target = computed(() => (today.value
  ? carryAdjustedTarget(today.value.energy.target, balance.value?.perDay ?? 0)
  : null))

// Sans profil complet on ne peut pas donner de cible, mais on affiche quand même
// la journée : mieux vaut une frise sans compteur qu'un écran vide.
const intake = computed(() => dayIntake(day.value, eatenSlots(props.todayIso), extrasFor(props.todayIso), target.value ?? 0))

const line = computed(() => timelineOf(day.value, eatenSlots(props.todayIso), extrasFor(props.todayIso)))
const next = computed(() => nextMeal(line.value, nowMin.value))

// ─── Camembert ───────────────────────────────────────────────────────────────
const R = 52
const C = 2 * Math.PI * R
const over = computed(() => intake.value.progress > 1)

const targets = computed(() => (kg.value && target.value ? macroTargets(kg.value, target.value, bodyComp.value) : null))

/**
 * Un arc par macro, bout à bout : leur somme est la progression totale, donc le
 * cercle répond aux deux questions d'un coup — où j'en suis, et de quoi c'est fait.
 * Un anneau d'une seule couleur disait le combien sans jamais dire le quoi, alors
 * que c'est le quoi qui décide si la perte vient du gras ou du muscle.
 */
const arcs = computed(() => {
  if (!target.value) return []
  return donutArcs(intake.value.eaten, target.value).map(a => ({
    ...a,
    // Tronqué à un tour : au-delà, les arcs se superposeraient et deviendraient illisibles.
    dash: `${C * Math.max(0, Math.min(1, a.to) - Math.min(1, a.from))} ${C}`,
    offset: -C * Math.min(1, a.from),
  })).filter(a => a.to > a.from)
})

// ─── Statistiques de tête ───────────────────────────────────────────────────
// Même source que dans Day.vue, pour que les deux écrans ne se contredisent jamais.
const pTarget = computed(() => proteinTarget.value?.g ?? null)
const stepsToday = computed(() => stepsFor(props.todayIso))
const doneCount = computed(() => line.value.filter(e => e.done).length)
const totalMeals = computed(() => line.value.filter(e => e.kind === 'plan').length)
const sessionToday = computed(() => sessionsOn(sessionLog(), props.todayIso)[0] ?? null)

const stats = computed(() => [
  {
    key: 'prot',
    label: 'Protéines',
    value: `${intake.value.eaten.p}`,
    unit: pTarget.value ? `/ ${pTarget.value} g` : 'g',
    // La protéine est le garde-fou de la masse maigre en déficit : elle mérite
    // d'être verte ou pas, contrairement aux glucides qui ne se pilotent pas.
    tone: pTarget.value && intake.value.eaten.p >= pTarget.value ? 'good' : '',
  },
  { key: 'repas', label: 'Repas pris', value: `${doneCount.value}`, unit: `/ ${totalMeals.value}`, tone: '' },
  {
    key: 'seance',
    label: 'Séance',
    value: sessionToday.value ? '✓' : (today?.value?.r.gym ? '—' : '·'),
    unit: sessionToday.value ? `${today?.value?.burn ?? 0} kcal` : (today?.value?.r.gym ? 'prévue' : 'repos'),
    tone: sessionToday.value ? 'good' : '',
  },
  {
    key: 'pas',
    label: 'Pas',
    value: stepsToday.value !== null ? stepsToday.value.toLocaleString('fr-FR') : '—',
    unit: stepsToday.value !== null ? 'mesurés' : 'estimés',
    tone: '',
  },
])

function addNow() {
  const v = Number.parseInt(kcal.value, 10)
  if (!Number.isFinite(v) || v <= 0) return
  addExtra(props.todayIso, { label: label.value.trim() || 'Extra', kcal: v, p: 0, g: 0, l: 0, time: time.value })
  label.value = ''
  kcal.value = ''
  open.value = false
}
</script>

<template>
  <div class="card nu-hero">
    <!-- Sur large écran, le camembert et la séance partagent la première ligne.
         Sur téléphone, tout est en colonne et la séance passe APRÈS le bouton des
         repas : on ouvre l'appli pour manger cinq fois par jour et pour s'entraîner
         une, l'ordre de lecture doit suivre. C'est une grille nommée plutôt que des
         `order` en flex, pour que les deux dispositions restent lisibles côte à côte. -->
    <div class="nu-hero-left">
      <div class="section-label duo-title"><Glyphe nom="couverts" :taille="14" />Nutrition</div>
      <div class="nu-hero-top">
        <button
          v-if="target" class="nu-donut-btn" :title="`${intake.eaten.kcal} kcal sur ${target} — voir le détail par macro`"
          @click="macroSheet = true"
        >
          <svg class="nu-donut" viewBox="0 0 128 128" role="img" :aria-label="`${intake.eaten.kcal} kcal sur ${target}`">
            <circle class="nu-donut-bg" cx="64" cy="64" :r="R" />
            <circle
              v-for="a in arcs" :key="a.key"
              class="nu-donut-arc" :class="[a.key, { over }]" cx="64" cy="64" :r="R"
              :stroke-dasharray="a.dash" :stroke-dashoffset="a.offset" transform="rotate(-90 64 64)"
            />
            <text class="nu-donut-v" x="64" y="58">{{ intake.remaining }}</text>
            <text class="nu-donut-l" x="64" y="74">kcal restantes</text>
            <text class="nu-donut-s" x="64" y="88">{{ intake.eaten.kcal }} / {{ target }}</text>
          </svg>
          <span class="nu-donut-legend mono">
            <i class="p" />P <i class="g" />G <i class="l" />L · détail →
          </span>
        </button>
        <div v-else class="nu-donut nu-donut-empty">—</div>

        <div class="nu-hero-side">
          <div v-if="next" class="nu-hero-next-big">
            <div class="mono nu-hero-next-t">{{ next.time }}</div>
            <div class="nu-hero-next-l">{{ next.label }}</div>
            <button class="btn-primary nu-hero-eat" @click="toggleEaten(props.todayIso, next.slot!)">✓ Mangé</button>
          </div>
          <div v-else class="muted">Tous les repas du plan sont validés.</div>
        </div>
      </div>
      <NuxtLink v-if="!target" to="/" class="muted nu-hero-warn">
        Renseigne ton profil et pèse-toi pour calculer la cible.
      </NuxtLink>
    </div>

    <div class="nu-hero-sep" />

    <div class="nu-hero-right">
      <div class="section-label duo-title"><Glyphe nom="haltere" :taille="14" />Séance du jour</div>
      <slot name="session" />
    </div>

    <!-- Les quelques chiffres qui disent si la journée est sur les rails -->
    <div class="nu-stats">
      <div v-for="st in stats" :key="st.key" class="nu-stat" :class="st.tone">
        <span class="nu-stat-v mono">{{ st.value }}</span>
        <span class="nu-stat-u">{{ st.unit }}</span>
        <span class="nu-stat-l">{{ st.label }}</span>
      </div>
    </div>

    <!-- Le report hebdomadaire, seulement quand il y a quelque chose à dire -->
    <p v-if="balance && (balance.perDay !== 0 || balance.giveUp)" class="nu-note">
      {{ balance.advice }}
    </p>

    <div class="nu-hero-actions">
      <button class="btn-primary flex-1" @click="eatSheet = true">🍽 Remplir les repas</button>
      <button v-if="!open" class="btn" @click="open = true; time = hhmm(new Date())">＋ Extra</button>
    </div>
    <div v-if="open" class="nu-quick">
      <input v-model="time" type="time" aria-label="Heure">
      <input v-model="label" type="text" placeholder="Quoi ?">
      <input v-model="kcal" type="number" inputmode="numeric" min="0" step="10" placeholder="kcal">
      <button class="btn-primary" @click="addNow()">OK</button>
    </div>

    <!-- Téléporté dans <body> pour échapper aux transformations des cartes parentes,
         mais DANS un .sport-app : sinon la feuille sort de la portée du CSS du module
         et s'affiche sans aucun style. -->
    <Teleport to="body">
      <div class="sport-app sport-portal">
        <transition name="sheet">
          <NutritionEatSheet v-if="eatSheet" :today-iso="props.todayIso" @close="eatSheet = false" />
        </transition>
        <transition name="sheet">
          <NutritionMacroSheet
            v-if="macroSheet && targets"
            :eaten="intake.eaten" :targets="targets" :remaining="intake.remaining"
            @close="macroSheet = false"
          />
        </transition>
      </div>
    </Teleport>
  </div>
</template>
