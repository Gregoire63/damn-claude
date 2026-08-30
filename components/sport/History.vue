<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useWorkout } from '~/composables/useWorkout'
import type { SessionRecord } from '~/composables/useWorkout'
import { useNutrition } from '~/composables/useNutrition'
import { useEnergy } from '~/composables/useEnergy'
import { useProgram } from '~/composables/useProgram'

// Vue « Journal » : UN calendrier, rien d'autre. Le détail d'une journée s'ouvre en
// feuille au clic.
//
// L'écran empilait avant le calendrier, la liste des séances de la semaine et le
// planning nutrition de cette même semaine — trois vues qui répondaient à la même
// question pour trois jours différents, et qu'il fallait relire de haut en bas pour
// savoir ce qui s'était passé un mardi. Une case, une feuille, tout est dedans.
const props = defineProps<{ todayIso: string | null }>()
const emit = defineEmits<{ edit: [rec: SessionRecord] }>()

const { sessionLog } = useWorkout()
const { hydrate, ttConfirmed } = useNutrition()
// Âge, métabolisme et dépense : une seule chaîne, partagée — voir composables/useEnergy.ts.
const { energyOn } = useEnergy()

const MONTHS = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre']
const p2 = (n: number) => String(n).padStart(2, '0')
const { program: prog } = useProgram()
const recColor = (rec: SessionRecord) => prog.value.find(p => p.id === rec.sessionId)?.color || '#8b6f5c'

const sessions = computed(() => sessionLog())
const calMonth = ref<{ y: number, m: number }>({ y: 2024, m: 0 })
const openIso = ref<string | null>(null)

const sessionsByDay = computed(() => {
  const m: Record<string, SessionRecord[]> = {}
  for (const s of sessions.value) { const d = s.at.slice(0, 10); (m[d] ||= []).push(s) }
  return m
})
interface Cell {
  iso: string
  day: number
  outside: -1 | 0 | 1 // mois précédent / courant / suivant
  sessions: SessionRecord[]
  tt: boolean
  future: boolean
  kcal: number | null
}

/**
 * Cible calorique du jour, telle que la feuille l'affichera.
 *
 * Lit `sessionsByDay`, l'index déjà construit pour les pastilles, au lieu de
 * rappeler `sessionsOn(sessionLog(), …)`. Avec 42 cases, cela faisait 42 tris
 * complets de l'historique à chaque rendu du calendrier — et le calendrier se
 * réévalue au moindre changement réactif.
 */
function targetOf(iso: string): number | null {
  return energyOn(iso)?.target ?? null
}

/**
 * Le calendrier ne montre que du RÉEL : les séances effectivement enregistrées et
 * les jours de télétravail confirmés ce jour-là. Afficher aussi le prévisionnel
 * revenait à relire son historique à travers ses intentions — et une case pleine
 * de « prévu » ne dit rien de ce qui s'est passé.
 */
function makeCell(y: number, m: number, d: number, outside: -1 | 0 | 1): Cell {
  const iso = `${y}-${p2(m + 1)}-${p2(d)}`
  return {
    iso,
    day: d,
    outside,
    sessions: sessionsByDay.value[iso] || [],
    tt: ttConfirmed(iso),
    future: !!props.todayIso && iso > props.todayIso,
    kcal: targetOf(iso),
  }
}

/**
 * Six semaines pleines, débordements compris.
 *
 * Les cases vides d'avant étaient invisibles : une grille qui commence un jeudi
 * laissait trois trous, et on perdait le fil de la semaine. Les jours des mois
 * voisins sont donc affichés en gris, et cliquer dessus bascule de mois.
 */
const calCells = computed<Cell[]>(() => {
  const { y, m } = calMonth.value
  const lead = (new Date(y, m, 1).getDay() + 6) % 7
  const days = new Date(y, m + 1, 0).getDate()
  const prevDays = new Date(y, m, 0).getDate()
  const prev = m === 0 ? { y: y - 1, m: 11 } : { y, m: m - 1 }
  const next = m === 11 ? { y: y + 1, m: 0 } : { y, m: m + 1 }

  const cells: Cell[] = []
  for (let i = lead; i > 0; i--) cells.push(makeCell(prev.y, prev.m, prevDays - i + 1, -1))
  for (let d = 1; d <= days; d++) cells.push(makeCell(y, m, d, 0))
  // Toujours 42 cases : la hauteur du calendrier ne saute plus d'un mois à l'autre.
  for (let d = 1; cells.length < 42; d++) cells.push(makeCell(next.y, next.m, d, 1))
  return cells
})
const monthLabel = computed(() => `${MONTHS[calMonth.value.m]} ${calMonth.value.y}`)

function calShift(delta: number) {
  let m = calMonth.value.m + delta
  let y = calMonth.value.y
  if (m < 0) { m = 11; y-- }
  else if (m > 11) { m = 0; y++ }
  calMonth.value = { y, m }
}
/**
 * Un jour du mois voisin ne fait que changer de mois : ouvrir sa feuille dans la
 * foulée enchaînait deux actions pour un seul geste, et on se retrouvait devant
 * une journée qu'on n'avait pas demandée.
 */
function pick(c: Cell) {
  if (c.outside) { calShift(c.outside); return }
  openIso.value = c.iso
}
function onEdit(rec: SessionRecord) {
  openIso.value = null
  emit('edit', rec)
}

onMounted(() => {
  hydrate()
  const now = new Date()
  // On ouvre sur le mois COURANT, pas sur la dernière séance : le planning des jours
  // à venir compte autant que l'historique, maintenant qu'il vit dans le calendrier.
  calMonth.value = props.todayIso
    ? { y: +props.todayIso.slice(0, 4), m: +props.todayIso.slice(5, 7) - 1 }
    : { y: now.getFullYear(), m: now.getMonth() }
})
</script>

<template>
  <div class="stack">
    <div class="card cal-card">
      <div class="cal-head">
        <button class="cal-nav" aria-label="Mois précédent" @click="calShift(-1)">‹</button>
        <div class="cal-month">{{ monthLabel }}</div>
        <button class="cal-nav" aria-label="Mois suivant" @click="calShift(1)">›</button>
      </div>
      <div class="cal-dow-row"><span v-for="(d, i) in ['L', 'M', 'M', 'J', 'V', 'S', 'D']" :key="i" class="cal-dow">{{ d }}</span></div>
      <div class="cal-grid">
        <!-- Chaque case dit trois choses : le jour, ce qui est prévu ou fait, et
             combien manger. Un point de couleur seul n'expliquait rien — il fallait
             ouvrir la journée pour savoir de quoi elle était faite. -->
        <button
          v-for="(c, i) in calCells" :key="i"
          class="cal-cell"
          :class="{
            outside: c.outside !== 0, today: c.iso === todayIso, sel: c.iso === openIso,
            done: c.sessions.length, tt: c.tt, future: c.future,
          }"
          :style="c.sessions.length ? { '--c': recColor(c.sessions[0]) } : {}"
          @click="pick(c)"
        >
          <!-- Deux signaux, deux canaux distincts : la pastille dit la séance
               réellement faite, le fond dit le télétravail confirmé. Un jour peut
               être les deux, ils ne doivent donc pas se disputer la même ligne. -->
          <span class="cal-pill">{{ c.day }}</span>
          <span class="cal-kcal mono">{{ c.kcal ?? '' }}</span>
        </button>
      </div>
      <div class="cal-legend">
        <span><i class="lg done" /> séance faite</span>
        <span><i class="lg tt" /> télétravail</span>
        <span class="cal-legend-note">le chiffre = kcal à manger</span>
      </div>
    </div>

    <p class="muted cal-hint">Seul le réel est affiché : séances enregistrées, télétravail confirmé. Les jours grisés changent de mois.</p>

    <transition name="sheet">
      <SportDaySheet
        v-if="openIso"
        :iso="openIso"
        :today-iso="todayIso"
        @close="openIso = null"
        @edit="onEdit"
      />
    </transition>
  </div>
</template>
