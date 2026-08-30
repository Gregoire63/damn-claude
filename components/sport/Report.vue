<script setup lang="ts">
import { computed, ref } from 'vue'
import { useWorkout } from '~/composables/useWorkout'
import { useProfile } from '~/composables/useProfile'
import { useEnergy } from '~/composables/useEnergy'
import { useProgram } from '~/composables/useProgram'
import { secText } from '~/lib/setText'
import { isTimed } from '~/lib/program'
import {
  avgSessionDuration, volumeOf, weeklyStatus, startOfWeek, FATIGUE_LABELS,
  WEEKLY_TARGET_MIN, WEEKLY_TARGET_MAX, SPRINT_SECONDS_MIN, SPEED_PLAN_MAX,
} from '~/utils/sportStats'

// Vue « Rapport » extraite de /sport (chargée à la demande). État partagé via composables.
const props = defineProps<{ todayIso: string | null; todayDow: number | null }>()
const emit = defineEmits<{ navigate: [view: string] }>()

// « Rapport » et « Progrès » répondaient à la même question — est-ce que ça avance —
// pour trois objets différents : le corps, le volume d'entraînement, et la charge par
// exercice. Deux onglets voisins obligeaient à comparer de tête ce qui appartient au
// même bilan. Un seul onglet, trois sections, et la barre du bas passe de six à cinq.
type Part = 'corps' | 'seances' | 'exos'
const PARTS: { id: Part, label: string }[] = [
  { id: 'corps', label: 'Corps' },
  { id: 'seances', label: 'Séances' },
  { id: 'exos', label: 'Exercices' },
]
const part = ref<Part>('corps')

const { logs, currentWeight, sessionLog, recordsOf, bodyWeightAt, muscleSetsWithGaps, daysSinceExport, lastExportAt, fatigue, milestoneOf, sprintObjective } = useWorkout()
const { age: ageDe } = useEnergy()
const { profile } = useProfile()

const { exercises: exos, exerciseName: exName } = useProgram()
const fmtVol = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)} t` : `${Math.round(v)} kg`)
const fmtDate = (iso: string) => (iso ? iso.slice(8, 10) + '/' + iso.slice(5, 7) : '')

// Poids : lu seulement pour le métabolisme. L'affichage complet est dans <SportBody>.
const latestWeight = currentWeight
const age = computed(() => (props.todayIso ? ageDe(props.todayIso) : null))
const bmr = computed(() => {
  const w = latestWeight.value, h = profile.value.heightCm, a = age.value, s = profile.value.sex
  if (!w || !h || !a || !s) return null
  const base = 10 * w + 6.25 * h - 5 * a
  return Math.round(s === 'h' ? base + 5 : base - 161)
})
const maintenance = computed(() => (bmr.value ? Math.round(bmr.value * 1.55) : null))

const sessions = computed(() => sessionLog())
const totalSessions = computed(() => sessions.value.length)
const startOfWeekISO = computed(() => (props.todayIso && props.todayDow !== null ? startOfWeek(props.todayIso, props.todayDow) : null))
const sessionsThisWeek = computed(() => (startOfWeekISO.value ? sessions.value.filter(s => s.at.slice(0, 10) >= startOfWeekISO.value!).length : 0))
const avgDuration = computed(() => avgSessionDuration(sessions.value.map(s => s.durationMin)))
const volumeSince = (from: string | null) => {
  let v = 0
  for (const ss of Object.values(logs.value)) for (const s of ss) if (!from || s.date >= from) v += volumeOf(s.sets)
  return v
}
const totalVolume = computed(() => volumeSince(null))
const volumeThisWeek = computed(() => volumeSince(startOfWeekISO.value))

// ─── Volume par muscle ───────────────────────────────────────────────────────
// Par défaut la SEMAINE : c'est la seule fenêtre qui permet de repérer un trou.
// Le cumul « depuis toujours » ne bouge plus après quelques mois et n'alerte sur rien.
const muscleRange = ref<'week' | 'all'>('week')
const muscleFrom = computed(() => (muscleRange.value === 'week' ? startOfWeekISO.value : null))
const muscleVolume = computed(() => muscleSetsWithGaps(muscleFrom.value))
const muscleMax = computed(() => Math.max(WEEKLY_TARGET_MAX, ...muscleVolume.value.map(m => m[1])) || 1)
// Position de la zone cible (10–20 séries/semaine) sur la barre
const targetLo = computed(() => (WEEKLY_TARGET_MIN / muscleMax.value) * 100)
const targetHi = computed(() => (WEEKLY_TARGET_MAX / muscleMax.value) * 100)
const statusOf = (n: number) => weeklyStatus(n)
const weakSpots = computed(() => (muscleRange.value === 'week' ? muscleVolume.value.filter(m => m[1] < WEEKLY_TARGET_MIN).map(m => m[0]) : []))

// ─── Records ─────────────────────────────────────────────────────────────────
// Charge max, mais aussi 1RM estimé et meilleures reps à la charge record : à charge
// égale, faire plus de reps est une vraie progression.
const records = computed(() => exos.value.map((ex) => {
  const r = recordsOf(ex.id)
  if (!r || !r.charge) return null
  // Exos au poids du corps : la charge saisie inclut le poids de corps → on
  // affiche le LEST réellement ajouté, seul indicateur qui progresse vraiment.
  const bw = ex.bodyweight ? bodyWeightAt(r.chargeDate) : null
  const lest = bw !== null ? Math.round((r.charge - bw) * 10) / 10 : null
  return { id: ex.id, name: ex.name, ...r, lest, timed: isTimed(ex) }
}).filter((r): r is NonNullable<typeof r> => r !== null).sort((a, b) => b.charge - a.charge))

// ─── Fatigue & récupération ──────────────────────────────────────────────────
// La semaine en cours est PARTIELLE : elle est affichée à part et ne participe
// pas à la tendance, sinon on lirait une chute de volume tous les lundis.
const fat = computed(() => (props.todayIso && props.todayDow !== null ? fatigue(props.todayIso, props.todayDow) : null))
const fatWeeks = computed(() => {
  const f = fat.value
  if (!f) return []
  const shown = f.weeks.slice(-6)
  const max = Math.max(1, ...shown.map(w => w.volume), f.current.volume)
  return [
    ...shown.map(w => ({ label: fmtDate(w.start), volume: w.volume, pct: (w.volume / max) * 100, current: false })),
    { label: fmtDate(f.current.start), volume: f.current.volume, pct: (f.current.volume / max) * 100, current: true },
  ]
})
const FATIGUE_ICON: Record<string, string> = { unknown: '·', fresh: '🟢', building: '🟡', high: '🟠', deload: '🔴' }

// ─── Objectifs atteignables ──────────────────────────────────────────────────
// Projeté sur la progression réellement mesurée, jamais sur un barème : la vitesse
// à laquelle on avance dépend du niveau, du nombre de séances et du déficit en
// cours, et tout ça est déjà dans les points enregistrés. Cf. `nextMilestone`.
const PACE_LABEL: Record<string, string> = {
  ahead: 'En avance',
  ontrack: 'Dans les temps',
  slow: 'Lent',
  stalled: 'À débloquer',
  unknown: 'Pas encore lisible',
}
const PACE_ICON: Record<string, string> = { ahead: '🟢', ontrack: '🟢', slow: '🟡', stalled: '🟠', unknown: '·' }

const goals = computed(() => {
  const today = props.todayIso
  if (!today) return []
  return exos.value
    .map((ex) => {
      const m = milestoneOf(ex, today)
      return m ? { id: ex.id, name: ex.name, unit: ex.bodyweight ? 'kg (poids de corps compris)' : 'kg', ...m } : null
    })
    .filter((g): g is NonNullable<typeof g> => g !== null)
    // Ceux qui ont une date d'abord, du plus proche au plus lointain ; les autres
    // ensuite. On vient chercher « c'est pour quand », pas une liste alphabétique.
    .sort((a, b) => {
      if (a.etaIso && b.etaIso) return a.etaIso.localeCompare(b.etaIso)
      if (a.etaIso) return -1
      if (b.etaIso) return 1
      return b.from - a.from
    })
})
const goalsDated = computed(() => goals.value.filter(g => g.etaIso))
const goalsWaiting = computed(() => goals.value.filter(g => !g.etaIso))
const goalsSkipped = computed(() => goals.value.filter(g => g.skipped > 0))
const showAllGoals = ref(false)

const sprint = computed(() => (props.todayIso ? sprintObjective(props.todayIso) : null))

// ─── Sauvegarde ──────────────────────────────────────────────────────────────
// Tout vit dans le navigateur : vider les données du site effacerait tout. On
// rappelle donc l'âge de la dernière sauvegarde.
const EXPORT_STALE_DAYS = 30
const exportAge = computed(() => (props.todayIso ? daysSinceExport(props.todayIso) : null))
const exportStale = computed(() => exportAge.value === null || exportAge.value > EXPORT_STALE_DAYS)
const hasData = computed(() => totalSessions.value > 0 || latestWeight.value !== null)
</script>

<template>
  <div class="stack">
    <div v-if="!hasData" class="card empty">Ta progression se construit au fil des séances.<br>Renseigne ta taille dans <b>Profil</b>, pèse-toi, et enregistre une séance.</div>
    <template v-else>
      <nav class="nav-row rp-nav">
        <button
          v-for="pt in PARTS" :key="pt.id"
          class="btn flex-1" :class="{ sel: part === pt.id }"
          @click="part = pt.id"
        >{{ pt.label }}</button>
      </nav>
      <!-- Suivi du corps : pesées, composition, pas. Le poids se saisit ICI et
           nulle part ailleurs — il servait aux séances comme à la nutrition, il
           avait fini par exister en trois exemplaires. -->
      <SportBody v-if="part === 'corps'" @navigate="emit('navigate', $event)" />

      <div v-if="part === 'corps'" class="card">
        <div class="section-label mb-8">Énergie</div>
        <div class="stat-grid">
          <div class="stat"><div class="stat-v mono">{{ bmr ?? '—' }}<span v-if="bmr" class="stat-u">kcal</span></div><div class="stat-l">Métabolisme de base</div></div>
          <div class="stat"><div class="stat-v mono">{{ maintenance ?? '—' }}<span v-if="maintenance" class="stat-u">kcal</span></div><div class="stat-l">Maintien estimé</div></div>
        </div>
        <div class="muted mt-6">
          Le maintien affiché ici est une moyenne large (Mifflin-St Jeor × 1,55). La cible
          du jour, elle, est recalculée dans le Journal à partir des pas réellement marchés
          et de la séance réellement enregistrée : c'est elle qui fait foi.
        </div>
      </div>
      <div v-if="part === 'seances'" class="card">
        <div class="section-label mb-8">Activité</div>
        <div class="stat-grid">
          <div class="stat"><div class="stat-v mono">{{ totalSessions }}</div><div class="stat-l">Séances totales</div></div>
          <div class="stat"><div class="stat-v mono">{{ sessionsThisWeek }}</div><div class="stat-l">Cette semaine</div></div>
          <div class="stat"><div class="stat-v mono">{{ avgDuration }}<span class="stat-u">min</span></div><div class="stat-l">Durée moyenne</div></div>
          <div class="stat"><div class="stat-v mono">{{ fmtVol(totalVolume) }}</div><div class="stat-l">Volume total</div></div>
        </div>
        <div class="muted mt-6">Volume cette semaine : <b>{{ fmtVol(volumeThisWeek) }}</b></div>
      </div>
      <div v-if="part === 'seances' && muscleVolume.length" class="card">
        <div class="row-between mb-8">
          <div class="section-label">Séries par muscle</div>
          <div class="mv-toggle">
            <button class="mv-tab" :class="{ active: muscleRange === 'week' }" @click="muscleRange = 'week'">Cette semaine</button>
            <button class="mv-tab" :class="{ active: muscleRange === 'all' }" @click="muscleRange = 'all'">Depuis le début</button>
          </div>
        </div>
        <div class="mv-list">
          <div v-for="[label, count] in muscleVolume" :key="label" class="mv-row">
            <span class="mv-label">{{ label }}</span>
            <div class="mv-bar">
              <!-- Zone cible 10–20 séries/semaine, en repère derrière la barre -->
              <div v-if="muscleRange === 'week'" class="mv-target" :style="{ left: targetLo + '%', width: (targetHi - targetLo) + '%' }"></div>
              <div class="mv-fill" :class="muscleRange === 'week' ? statusOf(count) : ''" :style="{ width: Math.min(100, count / muscleMax * 100) + '%' }"></div>
            </div>
            <span class="mv-count mono" :class="muscleRange === 'week' ? statusOf(count) : ''">{{ count }}</span>
          </div>
        </div>
        <div v-if="muscleRange === 'week'" class="muted mt-6">
          Cible <b>{{ WEEKLY_TARGET_MIN }}–{{ WEEKLY_TARGET_MAX }} séries/semaine</b> par muscle. Le muscle principal d'un exercice compte 1, les muscles assistants 0,5 — une série de développé couché n'est pas une série de triceps.
          <template v-if="weakSpots.length"><br>⚠️ Sous la cible cette semaine : <b>{{ weakSpots.join(', ') }}</b>.</template>
        </div>
        <div v-else class="muted mt-6">Cumul depuis le début — utile pour l'équilibre global, mais c'est la vue « cette semaine » qui révèle un manque.</div>
      </div>
      <div v-if="part === 'seances' && records.length" class="card">
        <div class="section-label mb-8">Records</div>
        <div class="rec-list">
          <div v-for="r in records" :key="r.id" class="rec-row rec-row-wide">
            <div class="rec-main">
              <span class="rec-name">{{ r.name }}</span>
              <span class="rec-when muted">{{ fmtDate(r.chargeDate) }}</span>
            </div>
            <div class="rec-vals">
              <span class="mono rec-val">{{ r.charge }} kg</span>
              <span v-if="r.lest !== null" class="rec-sub muted">dont {{ r.lest > 0 ? '+' + r.lest + ' kg de lest' : 'poids du corps' }}</span>
              <span v-if="r.reps > 1" class="rec-sub muted">{{ r.timed ? secText(r.reps) + ' tenues' : r.reps + ' reps' }} à cette charge</span>
              <span v-if="r.e1rm" class="rec-sub muted">1RM estimé {{ r.e1rm }} kg</span>
            </div>
          </div>
        </div>
      </div>
      <div v-if="part === 'seances' && fat" class="card" :class="'fat-' + fat.level">
        <div class="row-between mb-8">
          <div class="section-label">Fatigue &amp; récupération</div>
          <span class="fat-badge" :class="fat.level">{{ FATIGUE_ICON[fat.level] }} {{ FATIGUE_LABELS[fat.level] }}</span>
        </div>
        <div v-if="fat.level !== 'unknown'" class="fat-gauge"><div class="fat-gauge-fill" :class="fat.level" :style="{ width: fat.score + '%' }"></div></div>
        <div class="fat-advice">{{ fat.advice }}</div>
        <ul v-if="fat.reasons.length" class="fat-reasons">
          <li v-for="(r, i) in fat.reasons" :key="i">{{ r }}</li>
        </ul>
        <!-- Volume par semaine : la dernière barre est la semaine en cours, encore incomplète -->
        <div class="fat-weeks">
          <div v-for="(w, i) in fatWeeks" :key="i" class="fat-week" :class="{ current: w.current }">
            <div class="fat-week-bar"><div class="fat-week-fill" :style="{ height: Math.max(2, w.pct) + '%' }"></div></div>
            <span class="fat-week-lbl mono">{{ w.label }}</span>
          </div>
        </div>
        <div class="muted">
          Volume par semaine (la dernière barre est la semaine en cours, encore incomplète — elle ne compte pas dans la tendance).
          <template v-if="fat.dropRatio !== null"><br><b>{{ fat.dropped }}</b> exercice{{ fat.dropped > 1 ? 's' : '' }} sur {{ fat.tracked }} en baisse à charge identique — c'est ce qui pèse dans le score.</template>
          <template v-if="fat.hardRatio !== null"><br>Façon de t'entraîner : {{ Math.round(fat.hardRatio * 100) }} % des exercices poussés au bout (« dur » ou « à l'échec »). Descriptif, pas compté dans le score.</template>
          <template v-else><br>Note le ressenti de tes exercices pour affiner cet indicateur.</template>
          <br><span class="fat-caveat">Indicateur composite construit sur ton volume, tes baisses de performance à charge identique et ta stagnation — un repère pour décider, pas une mesure physiologique.</span>
        </div>
      </div>
      <!-- Les courbes de charge, ex-onglet « Progrès ». Chargées à la demande :
           elles ne servent qu'ici, et elles tirent le composant de graphique. -->
      <!-- Objectifs : la seule section qui regarde devant. Le reste du rapport dit
           d'où on vient ; celle-ci dit quand le prochain palier tombe, et si on est
           dans les temps pour l'atteindre. -->
      <div v-if="part === 'exos' && goals.length" class="card">
        <div class="section-label mb-8">Prochains paliers</div>
        <div v-if="goalsDated.length" class="ob-list">
          <div v-for="g in goalsDated" :key="g.id" class="ob-row" :class="g.pace">
            <div class="ob-main">
              <div class="ob-name">{{ g.name }}</div>
              <div class="ob-step mono">{{ g.from }} <span class="ob-arrow">→</span> <b>{{ g.to }}</b> kg</div>
            </div>
            <div class="ob-when">
              <div class="ob-eta mono">{{ fmtDate(g.etaIso!) }}</div>
              <div class="ob-sub">{{ g.weeks }} sem · {{ g.perWeek }} kg/sem</div>
            </div>
            <div class="ob-pace" :title="PACE_LABEL[g.pace]">{{ PACE_ICON[g.pace] }}</div>
          </div>
        </div>
        <div v-else class="muted">
          Aucun palier datable pour l'instant : il faut au moins trois séances sur un
          exercice, et une tendance qui monte.
        </div>

        <button v-if="goalsWaiting.length" class="ob-more" @click="showAllGoals = !showAllGoals">
          {{ showAllGoals ? '▲ Masquer' : '▼ Voir' }} les {{ goalsWaiting.length }} exercices sans date
        </button>
        <div v-if="showAllGoals" class="ob-list mt-8">
          <div v-for="g in goalsWaiting" :key="g.id" class="ob-row" :class="g.pace">
            <div class="ob-main">
              <div class="ob-name">{{ g.name }}</div>
              <div class="ob-step mono">{{ g.from }} <span class="ob-arrow">→</span> <b>{{ g.to }}</b> kg</div>
            </div>
            <div class="ob-when"><div class="ob-sub">{{ PACE_LABEL[g.pace] }}<template v-if="g.pace === 'unknown'"> ({{ g.points }}/3 séances)</template></div></div>
            <div class="ob-pace">{{ PACE_ICON[g.pace] }}</div>
          </div>
        </div>

        <div class="muted mt-8">
          Projeté sur ta progression <b>réellement mesurée</b> (pente du 1RM estimé), pas
          sur un barème : c'est ce qui tient compte de ton nombre de séances et du déficit
          en cours. Plafonné au double de la progression usuelle pour ne pas extrapoler une
          poussée de reprise.
          <template v-if="goalsSkipped.length">
            <br>⚠️ <b>{{ goalsSkipped.length }}</b> exercice{{ goalsSkipped.length > 1 ? 's' : '' }} avec une séance écartée du calcul,
            charge hors de proportion — probablement une faute de frappe à corriger :
            <b>{{ goalsSkipped.map(g => g.name).join(', ') }}</b>.
          </template>
        </div>
      </div>

      <!-- Sprint : enregistré depuis le début, relu par personne jusqu'ici. -->
      <div v-if="part === 'exos' && sprint" class="card">
        <div class="section-label mb-8">Sprint</div>
        <div class="stat-grid">
          <div class="stat"><div class="stat-v mono">{{ sprint.topSpeed }}<span class="stat-u">km/h</span></div><div class="stat-l">Vitesse max</div></div>
          <div class="stat"><div class="stat-v mono">{{ sprint.seconds }}<span class="stat-u">s</span></div><div class="stat-l">Temps d'effort</div></div>
          <div class="stat"><div class="stat-v mono">{{ sprint.reps }}</div><div class="stat-l">Sprints</div></div>
        </div>
        <div v-if="sprint.kind === 'volume'" class="ob-goal vol">
          <b>Objectif : remonter le volume à {{ sprint.target }} s d'effort</b>
          <small>
            Le plan demande 5 à 6 sprints de 10 à 15 s. Tu es à {{ sprint.reps }} × pour {{ sprint.seconds }} s au total.
            <template v-if="sprint.topSpeed >= SPEED_PLAN_MAX">Tu es déjà au plafond de vitesse du plan ({{ SPEED_PLAN_MAX }} km/h) : c'est le volume qui progresse maintenant.</template>
            <template v-else-if="sprint.seconds < SPRINT_SECONDS_MIN">Monter la vitesse sur un effort plus court n'est pas une progression — c'est un raccourci. Le temps d'abord, le chrono ensuite.</template>
          </small>
        </div>
        <div v-else class="ob-goal spd">
          <b>Objectif : {{ sprint.target }} km/h</b>
          <small v-if="sprint.etaIso">Atteignable vers le <b>{{ fmtDate(sprint.etaIso) }}</b> — {{ sprint.weeks }} semaine(s) au rythme de {{ sprint.perWeek }} km/h par semaine.</small>
          <small v-else>Pas encore de tendance exploitable : il faut au moins trois séances avec sprint ({{ sprint.points }} pour l'instant).</small>
        </div>
      </div>

      <LazySportProgress v-if="part === 'exos'" />

      <div class="card" :class="{ 'backup-warn': exportStale }">
        <div class="section-label mb-8">Sauvegarde</div>
        <div v-if="exportAge === null" class="muted">
          ⚠️ <b>Jamais sauvegardé.</b> Tout est stocké dans ce navigateur : vider les données du site effacerait tout ton historique. Fais un export depuis <b>Profil → Données</b>.
        </div>
        <div v-else class="muted">
          <template v-if="exportStale">⚠️ Dernière sauvegarde il y a <b>{{ exportAge }} jours</b> ({{ lastExportAt }}) — pense à refaire un export depuis <b>Profil → Données</b>.</template>
          <template v-else>✓ Dernière sauvegarde il y a {{ exportAge }} jour(s) ({{ lastExportAt }}).</template>
        </div>
      </div>
    </template>
  </div>
</template>
