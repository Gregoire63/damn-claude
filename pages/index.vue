<script setup lang="ts">
import { computed } from 'vue'
import { sessionMuscles } from '~/lib/muscles'
import { shiftIso } from '~/utils/sportStats'
import { useProgram } from '~/composables/useProgram'
import { useProfile } from '~/composables/useProfile'
import { useWorkout } from '~/composables/useWorkout'
import { useJour } from '~/composables/useJour'
import { useSeance } from '~/composables/useSeance'
import { useFlash } from '~/composables/useFlash'

// L'accueil : la semaine en cours, la séance du jour, et de quoi en démarrer une.
// Tout ce qui se superpose — la feuille, la mini-barre, les confirmations — vit dans
// la coque (layouts/default.vue) et ne se démonte pas quand on change d'onglet.

const { weekPlan, sessionIdFor, isPlanMoved } = useProfile()
const { sessionLog } = useWorkout()
const { todayISO, todayDow, todayIndex } = useJour()
const { activeSession, deloadAdvised, startSession, editSession } = useSeance()
const { showFlash } = useFlash()

/**
 * Le libellé court d'un jour de la bande hebdomadaire.
 *
 * C'était une table figée — `{ s1: 'Pecs/Ép', s2: 'Dos/Bic', … }` — écrite à la main
 * pour les quatre séances livrées. Elles n'existent plus : toute séance est
 * désormais créée, et une table figée ne rendait donc RIEN, laissant une case vide
 * là où la bande doit dire ce qu'on fait ce jour-là.
 *
 * On abrège plutôt le nom. La case fait une dizaine de caractères : on garde les
 * deux premiers mots significatifs, ce qui donne « Pecs/Épaules » pour « Pecs,
 * Épaules & Triceps » et laisse « Jambes » intact.
 */
function courtDe(nom: string): string {
  const mots = nom.split(/[\s,&/]+/).filter(w => w.length > 2)
  if (!mots.length) return nom.slice(0, 10)
  return mots.slice(0, 2).join('/')
}
const DOW = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
// LE programme : le livré, plus ce qu'un coach en a fait. Cette page l'affiche, le
// démarre et l'enregistre — elle ne doit jamais lire la version figée du code, sinon
// une séance modifiée s'ouvre avec les anciennes séries.
const { program: prog, sessionById } = useProgram()

/**
 * La semaine affichée est celle des DATES en cours, pas la semaine type.
 *
 * Une séance déplacée depuis le calendrier — « vendredi je ne peux pas, je la fais
 * samedi » — doit apparaître le samedi, ici comme dans la journée du jour. Tant que
 * la bande lisait `weekPlan` directement, elle continuait d'annoncer un vendredi
 * salle et un samedi repos, en contradiction avec les calories déjà ajustées.
 *
 * Avant que la date du client soit connue (rendu initial), on retombe sur la semaine
 * type : c'est le bon défaut, et il ne peut pas être faux plus d'un instant.
 */
const weekIsos = computed<(string | null)[]>(() => {
  if (!todayISO.value || todayIndex.value === null) return [null, null, null, null, null, null, null]
  const monday = shiftIso(todayISO.value, -todayIndex.value)
  return Array.from({ length: 7 }, (_, i) => shiftIso(monday, i))
})
const weekDays = computed(() => weekIsos.value.map((iso, i) => {
  const s = sessionById(iso ? sessionIdFor(iso) : weekPlan.value[i])
  return { dow: DOW[i], session: s, short: s ? courtDe(s.name) : '', sprint: !!s?.sprint, moved: !!iso && isPlanMoved(iso) }
}))
const todayEntry = computed(() => (todayIndex.value === null ? null : weekDays.value[todayIndex.value]))
const todaySession = computed(() => todayEntry.value?.session ?? null)
const nextSession = computed(() => {
  if (todayIndex.value === null) return null
  for (let i = 1; i <= 7; i++) { const e = weekDays.value[(todayIndex.value + i) % 7]; if (e.session) return e }
  return null
})
const otherSessions = computed(() => { const id = todaySession.value?.id; return prog.value.filter(s => s.id !== id) })
const doneToday = computed(() => (todayISO.value ? sessionLog().filter(s => s.at.slice(0, 10) === todayISO.value) : []))
// Séance du jour déjà enregistrée (→ bouton « Modifier » au lieu de « Démarrer »)
const todayRecord = computed(() => {
  if (!todaySession.value) return null
  return doneToday.value.find(s => s.sessionId === todaySession.value!.id) ?? null
})

</script>

<template>
  <div class="stack">
    <!--
      Le parcours d'installation reste tant qu'il reste une étape ; l'accueil, lui, ne
      disparaît que si le PROFIL manque. C'est la seule étape qui barre la route, parce
      que sans taille, sexe et année de naissance il n'y a pas de métabolisme de base :
      tout l'écran n'aurait que des tirets à montrer, et trois cadres vides ressemblent
      à une panne bien plus qu'à un départ. Les trois autres étapes sont des
      invitations — on peut se servir de l'application sans elles.

      `ClientOnly` parce que le programme vit dans `localStorage` : rendu côté serveur,
      l'écran d'accueil annoncerait « ton programme est vide » à quelqu'un qui a des
      séances, l'espace d'un battement.
    -->
    <!-- La séance du jour est passée EN SLOT du bandeau nutrition : les deux
         partagent la première ligne, et les compteurs s'étalent en dessous. -->
    <ClientOnly>
      <LazyNutritionHero :today-iso="todayISO">
        <template #session>
        <section v-if="todaySession" class="today card" :style="{ '--c': todaySession.color }">
          <div class="today-eyebrow"><span class="today-dot"></span> {{ todayEntry!.dow }}</div>
          <h2 class="today-name">{{ todaySession.name }}</h2>
          <div v-if="doneToday.length" class="done-badge">✓ Déjà fait aujourd'hui : {{ doneToday.map(s => s.name).join(', ') }}</div>
          <div class="sc-muscles"><span v-for="m in sessionMuscles(todaySession)" :key="m" class="sc-chip">{{ m }}</span></div>
          <div class="today-foot">
            <span class="muted">{{ todaySession.exercises.length }} exercices<template v-if="todaySession.sprint"> · ⚡ sprint</template></span>
            <button v-if="activeSession" class="btn-primary today-go" :style="{ background: todaySession.color }" @click="startSession(todaySession)">{{ activeSession.id === todaySession.id ? 'Reprendre →' : 'Aperçu' }}</button>
            <button v-else-if="todayRecord" class="btn-primary today-go" :style="{ background: todaySession.color }" @click="editSession(todayRecord!)">✏️ Modifier la séance →</button>
            <button v-else class="btn-primary today-go" :style="{ background: todaySession.color }" @click="startSession(todaySession)">Démarrer la séance →</button>
          </div>
        </section>

        <section v-else-if="todayIndex !== null" class="today card rest">
          <h2 class="today-name">Repos 💤</h2>
          <p class="muted rest-txt">Récupération.<template v-if="nextSession"> Prochaine séance : <b>{{ nextSession.dow }}</b> · {{ nextSession.session!.name }}.</template></p>
          <button v-if="nextSession" class="btn today-go" @click="startSession(nextSession.session!)">Faire {{ nextSession.session!.name }} maintenant →</button>
        </section>
        </template>
      </LazyNutritionHero>
    </ClientOnly>

    <!-- Décharge conseillée : l'info n'est utile qu'ici, avant de démarrer -->
    <div v-if="deloadAdvised" class="deload-banner">
      <span>🔴</span>
      <span><b>Semaine de décharge conseillée.</b> Mêmes charges, environ 40 % de séries en moins, arrêt 3 reps avant l'échec. <button class="link-btn" @click="navigateTo('/progres')">En savoir plus →</button></span>
    </div>

    <div class="section-label">{{ todaySession ? 'Ou commence une autre séance' : 'Toutes les séances' }}</div>
    <div class="session-grid">
      <button v-for="s in otherSessions" :key="s.id" class="session-card" :style="{ '--c': s.color }" @click="startSession(s)">
        <div class="sc-top">
          <span class="sc-day">{{ s.tag }}</span>
          <span v-if="s.sprint" class="sc-sprint">⚡ sprint</span>
        </div>
        <div class="sc-name">{{ s.name }}</div>
        <div class="sc-muscles"><span v-for="m in sessionMuscles(s)" :key="m" class="sc-chip">{{ m }}</span></div>
        <div class="sc-foot"><span class="sc-count mono">{{ s.exercises.length }} exercices</span><span class="sc-go">{{ activeSession ? (activeSession.id === s.id ? 'Reprendre →' : 'Aperçu') : 'Démarrer →' }}</span></div>
      </button>
    </div>

    <div class="card week-card">
      <div class="section-label mb-8">Semaine type <span class="muted week-hint">· déplaçable depuis le calendrier</span></div>
      <div class="week">
        <div v-for="(d, i) in weekDays" :key="i" class="week-day" :class="{ rest: !d.session, today: i === todayIndex, moved: d.moved }" :style="d.session ? { '--c': d.session.color } : {}">
          <span class="week-dow">{{ d.dow }}<span v-if="d.moved" class="week-moved" title="Planning modifié pour cette date">⇄</span></span>
          <template v-if="d.session">
            <span class="week-dot"></span>
            <span class="week-label">{{ d.short }}</span>
            <span v-if="d.sprint" class="week-sprint">⚡</span>
          </template>
          <span v-else class="week-rest">repos</span>
        </div>
      </div>
    </div>
  </div>
</template>
