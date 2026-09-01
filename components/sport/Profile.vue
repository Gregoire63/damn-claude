<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useWorkout } from '~/composables/useWorkout'
import { useNutrition } from '~/composables/useNutrition'
import { useMesures } from '~/composables/useMesures'
import { useProfile } from '~/composables/useProfile'
import { useSnapshot } from '~/composables/useSnapshot'
import { useRestTimer } from '~/composables/useRestTimer'
import { DAY_NAMES } from '~/lib/nutritionStats'
import { useEnergy } from '~/composables/useEnergy'
import { useProgram } from '~/composables/useProgram'
import { phraseBilan, useRestauration } from '~/composables/useRestauration'
import { useDemarrage } from '~/composables/useDemarrage'
import { fmtRest } from '~/lib/rest'

// Vue « Profil » extraite de /sport (chargée à la demande). État partagé via composables.
const props = defineProps<{ todayIso: string | null }>()
const emit = defineEmits<{ flash: [msg: string, ton?: 'ok' | 'echec'] }>()

const { currentWeight, exportJSON, lastExportAt, daysSinceExport, backupDate, restoreBackup } = useWorkout()
// Restaurer touche six modules : la liste est tenue à un seul endroit.
const { restaurerFichier } = useRestauration()
// Un seul assemblage des données, partagé par l'export manuel et par le miroir.
const { buildSnapshot } = useSnapshot()

// Sauvegarde : tout vit dans le navigateur, donc on affiche l'âge du dernier export
// et on propose l'instantané de secours écrit automatiquement (1×/jour).
const EXPORT_STALE_DAYS = 30
const exportAge = computed(() => (props.todayIso ? daysSinceExport(props.todayIso) : null))
const exportStale = computed(() => exportAge.value === null || exportAge.value > EXPORT_STALE_DAYS)
const backupOn = ref<string | null>(null)
onMounted(() => { backupOn.value = backupDate() })
function onRestore() {
  if (!confirm('Remplacer les données actuelles par la sauvegarde automatique ?')) return
  emit('flash', restoreBackup() ? 'Sauvegarde restaurée ✓' : 'Aucune sauvegarde disponible')
}

// Âge et métabolisme : le socle partagé, jamais recalculés ici.
const { age: ageDe, bmrOn, maintenanceFor } = useEnergy()
const { profile, weekPlan, planDays, setHeight, setSex, setBirthYear, resetPlan } = useProfile()
// Le module nutrition part dans la même sauvegarde : une seule sauvegarde à gérer.
const { exportData: nutritionData, week, setWeekDay, resetWeek, hydrate: hydrateNutrition } = useNutrition()
hydrateNutrition()
// Les pesées Withings partent dans la même sauvegarde : c'est le même suivi.
// La connexion et les pesées sont passées dans SportSources ; il ne reste ici que
// ce qui touche à la SAUVEGARDE, qui est la responsabilité de cet écran.
const { snapshot: mesuresData, hydrate: hydrateMesures } = useMesures()
hydrateMesures()
/**
 * Le programme modifié, et le chemin du retour.
 *
 * Les modifications arrivent surtout d'une conversation, validées d'un tap. Sans
 * cette section, une mauvaise idée acceptée trop vite ne se défaisait qu'en
 * redemandant à Claude de proposer l'inverse — c'est-à-dire en dépendant du
 * connecteur pour réparer ce que le connecteur a fait. Un réglage qu'on ne peut
 * pas annuler seul n'est pas un réglage, c'est un engagement.
 *
 * On ne montre RIEN quand rien n'a bougé : le programme livré n'a pas besoin d'être
 * annoncé, il est déjà là, en haut de l'accueil.
 */
const {
  custom: progCustom, exerciseName: progName,
  resetExercise, enableExercise, disableExercise, sessionById: progSession, setOrder,
} = useProgram()

const progChanges = computed(() => {
  const c = progCustom.value
  const out: { cle: string, texte: string, defaire: () => void }[] = []
  for (const id of Object.keys(c.patches ?? {})) {
    const q = c.patches![id]
    const quoi = [
      q.sets !== undefined ? `${q.sets} séries` : '',
      q.reps !== undefined ? `${q.reps} reps` : '',
      q.rest !== undefined ? `repos ${fmtRest(q.rest)}` : '',
      q.name !== undefined ? 'nom' : '',
      q.machine !== undefined ? 'machine' : '',
      q.cues !== undefined ? 'consignes' : '',
      q.muscles !== undefined ? 'muscles' : '',
    ].filter(Boolean).join(', ')
    out.push({ cle: `p:${id}`, texte: `${progName(id)} — ${quoi}`, defaire: () => resetExercise(id) })
  }
  for (const id of c.disabled ?? []) {
    out.push({ cle: `d:${id}`, texte: `${progName(id)} — retiré du programme`, defaire: () => enableExercise(id) })
  }
  for (const [sid, ids] of Object.entries(c.order ?? {})) {
    if (!ids.length) continue
    out.push({
      cle: `o:${sid}`,
      texte: `${progSession(sid)?.name ?? sid} — ordre changé`,
      defaire: () => setOrder(sid, []),
    })
  }
  // Défaire un AJOUT, c'est le retirer — pas l'effacer. Si on a déjà chargé dessus,
  // l'effacer emporterait les séries enregistrées ; le retirer les laisse lisibles.
  for (const [sid, list] of Object.entries(c.added ?? {})) {
    for (const e of list) {
      if ((c.disabled ?? []).includes(e.id)) continue
      out.push({
        cle: `a:${e.id}`,
        texte: `${e.name} — ajouté à ${progSession(sid)?.name ?? sid}`,
        defaire: () => disableExercise(e.id),
      })
    }
  }
  return out
})
const { soundEnabled, soundVolume, soundType, testSound, SOUND_OPTIONS, vibrationLevel, VIBRATION_OPTIONS, watchStatus } = useRestTimer()

/**
 * La fin de repos part aussi en notification du système, ce qu'une montre appairée
 * répercute au poignet.
 *
 * Ça s'affichait dans une carte « Montre connectée », avec son propre interrupteur.
 * Deux problèmes : aucune montre n'y était connectée — rien n'est lu, rien n'est
 * synchronisé —, et la carte du chrono portait déjà un interrupteur, si bien qu'on
 * devait en régler deux pour être averti d'une seule chose.
 *
 * Il n'en reste qu'une phrase, affichée UNIQUEMENT quand le navigateur refuse ou n'a
 * pas encore accordé la permission. Quand tout va bien, il n'y a rien à dire.
 */
/**
 * On ne dit RIEN tant que rien n'est cassé.
 *
 * Il y avait « Touche Tester une fois pour autoriser les notifications » : une phrase
 * qui demandait d'appuyer sur le bouton juste au-dessus, alors qu'appuyer dessus est
 * précisément ce qui déclenche la demande. Elle n'apprenait rien et occupait une ligne
 * sur un écran qu'on parcourt.
 *
 * Reste le seul cas où la personne ne peut PAS s'en sortir toute seule : le navigateur
 * a refusé, et aucun bouton de cette application ne le fera revenir dessus.
 */
const notifsBloquees = computed(() => watchStatus.value === 'denied')
const volPct = computed({
  get: () => Math.round(soundVolume.value * 100),
  set: (v: number) => { soundVolume.value = Math.min(1, Math.max(0, (Number(v) || 0) / 100)) },
})

// La pesée du matin vient de `useWorkout`, triée par date — voir lib/weight.ts.
const latestWeight = currentWeight
const bmi = computed(() => { const h = profile.value.heightCm, w = latestWeight.value; return h && w ? +(w / ((h / 100) ** 2)).toFixed(1) : null })
const bmiCat = computed(() => {
  const b = bmi.value
  if (b === null) return null
  if (b < 18.5) return { label: 'Maigreur', color: '#4a6fa5' }
  if (b < 25) return { label: 'Corpulence normale', color: '#3f7a4f' }
  if (b < 30) return { label: 'Surpoids', color: '#a97b1e' }
  return { label: 'Obésité', color: '#b5502f' }
})
const age = computed(() => (props.todayIso ? ageDe(props.todayIso) : null))
const bmr = computed(() => (props.todayIso ? bmrOn(props.todayIso) : null))

/**
 * Le maintien, calculé COMME L'ÉCRAN DU JOUR le calcule.
 *
 * Il valait `bmr × 1,55` — le facteur d'activité « modérément actif » des tables
 * génériques, appliqué tel quel à toutes les journées. Le reste de l'application
 * n'a jamais fonctionné comme ça : `dayEnergy` décompose la dépense en trois postes
 * explicites — métabolisme, pas, séance — précisément pour éviter un coefficient
 * qu'on ne peut ni vérifier ni discuter.
 *
 * Les deux ne tombaient pas au même endroit, et l'écart n'était pas anecdotique :
 * à 91,6 kg, le forfait annonçait 2937 kcal quand le modèle du jour en calculait
 * 2446 un jour sans salle. Cinq cents calories d'écart sur le chiffre auquel on
 * compare ce qu'on mange — de quoi croire à un déficit de 700 kcal là où il y en a
 * 250, et se resservir « pour compenser ».
 *
 * On affiche donc les DEUX journées, parce qu'il n'existe pas de maintien unique
 * quand quatre jours sur sept comportent une séance. Un seul chiffre aurait forcé à
 * choisir lequel mentir.
 */
const maintienSalle = computed(() => maintenanceFor({ gym: true, tt: false }))
const maintienRepos = computed(() => maintenanceFor({ gym: false, tt: false }))
/**
 * La moyenne pondérée par sa semaine type : c'est ELLE qu'il faut comparer à une
 * moyenne d'apports sur la semaine, et c'est la comparaison qu'on fait naturellement.
 */
const maintienMoyen = computed(() => {
  const salle = maintienSalle.value, repos = maintienRepos.value
  if (salle === null || repos === null) return null
  const jours = weekPlan.value.filter(Boolean).length
  return Math.round((salle * jours + repos * (7 - jours)) / 7)
})

/**
 * L'import dit ce qu'il a fait, avec des chiffres.
 *
 * Il affichait « Données importées ✓ » quoi qu'il arrive — même le jour où une
 * sauvegarde d'avant le vidage de `data/` a rendu une application vide. La coche
 * verte ne se confronte à rien ; « 4 séances, 34 plats » se confronte à ce qu'on
 * attendait, et se voit faux tout de suite.
 *
 * La liste des modules à restaurer vit dans `useRestauration` : recopiée ici, il en
 * manquait deux — les réglages du minuteur, et le programme modifié, écrasé par le
 * programme livré à chaque import.
 */
async function onImport(ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const b = await restaurerFichier(file)
    emit('flash', phraseBilan(b), b.ok ? 'ok' : 'echec')
  } catch (e) {
    emit('flash', `Import impossible : ${e instanceof Error ? e.message : 'fichier illisible'}`, 'echec')
  }
  // Sans ça, réimporter LE MÊME fichier ne déclenche pas « change » et ne fait rien.
  input.value = ''
}
/**
 * Revoir l'installation.
 *
 * Le parcours ne revient pas tout seul, et c'est très bien : une liste de tâches finie
 * qui reste accrochée à l'accueil se lit comme un reproche. Mais il n'existait AUCUN
 * chemin de retour — une balance achetée après coup, un passkey à poser sur un second
 * navigateur, ou simplement l'envie de revoir ce qu'on fait lire à quelqu'un qui
 * installe le dépôt, et il fallait vider le stockage du site à la main.
 *
 * Rien n'est effacé : seules les décisions de reporter le sont. Ce qui est fait reste
 * fait, et ses étapes se rouvrent déjà cochées.
 */
const demarrage = useDemarrage()
function revoirInstallation() {
  demarrage.rejouer()
  emit('flash', 'Configuration rouverte')
}

/** Un message d'enfant garde son ton : « Poids invalide » n'est pas un succès. */
function relayer(msg: string, ton?: 'ok' | 'echec') { emit('flash', msg, ton) }

function onHeight(ev: Event) { setHeight(parseFloat((ev.target as HTMLInputElement).value) || null) }
function onYear(ev: Event) { setBirthYear(parseInt((ev.target as HTMLInputElement).value, 10) || null) }
</script>

<template>
  <div class="stack">
    <div class="card">
      <div class="section-label mb-8">Profil</div>
      <div class="form-grid">
        <label class="field"><span>Taille (cm)</span><input type="number" inputmode="numeric" :value="profile.heightCm ?? ''" placeholder="180" @change="onHeight"></label>
        <label class="field"><span>Année de naissance</span><input type="number" inputmode="numeric" :value="profile.birthYear ?? ''" placeholder="1998" @change="onYear"></label>
        <div class="field">
          <span>Sexe</span>
          <div class="segmente" role="group">
            <button :class="{ sel: profile.sex === 'h' }" @click="setSex('h')">Homme</button>
            <button :class="{ sel: profile.sex === 'f' }" @click="setSex('f')">Femme</button>
          </div>
        </div>
      </div>
      <div v-if="bmi || age || bmr" class="profil-summary">
        <span v-if="bmi" class="ps-item">IMC <b :style="{ color: bmiCat!.color }">{{ bmi }}</b> · {{ bmiCat!.label }}</span>
        <span v-if="age" class="ps-item">{{ age }} ans</span>
        <span v-if="bmr" class="ps-item">Métabolisme de base <b>{{ bmr }} kcal</b></span>
        <span v-if="maintienMoyen" class="ps-item">Maintien moyen <b>{{ maintienMoyen }} kcal</b></span>
      </div>
      <!-- Deux chiffres et non un seul : avec quatre séances par semaine, il n'existe
           pas de maintien unique. Un chiffre moyen affiché seul se compare à une
           journée précise, et se trompe des deux côtés selon le jour. -->
      <div v-if="maintienSalle && maintienRepos" class="muted mt-6">
        <b>{{ maintienSalle }} kcal</b> un jour de salle, <b>{{ maintienRepos }} kcal</b> un jour
                sans. La cible à manger, affichée dans Nutrition, est ce maintien moins le déficit.
      </div>
      <div v-else class="muted">Renseigne taille, sexe et année de naissance. La pesée se fait dans <b>Rapport</b>.</div>
    </div>

    <!-- Ma semaine type : c'est un réglage, pas un suivi. Il pilote le calendrier du
         Journal (jours de salle, jours de télétravail) sans qu'on ait à le retoucher. -->
    <div class="card">
      <div class="row-between mb-8">
        <div class="section-label">Semaine type</div>
        <button class="btn" @click="resetWeek()">↺ Défaut</button>
      </div>
      <div class="nu-weekgrid">
        <div v-for="(n, i) in DAY_NAMES" :key="i" class="nu-weekday">
          <div class="nu-weekday-name mono">{{ n.slice(0, 3) }}</div>
          <button class="nu-chip" :class="{ on: week.gym[i] }" @click="setWeekDay(i, 'gym', !week.gym[i])">🏋️</button>
          <button class="nu-chip tt" :class="{ on: week.tt[i] }" @click="setWeekDay(i, 'tt', !week.tt[i])">🏠</button>
        </div>
      </div>
      <div class="muted mt-6">
        🏋️ salle, 🏠 télétravail. Un jour peut être les deux. Pour modifier une date
                précise, touche-la dans le calendrier du Journal.
      </div>
    </div>

    <!-- Programme modifié : n'apparaît que s'il l'est. Ce n'est pas un éditeur,
         c'est le chemin du retour — les modifications, elles, arrivent d'une
         conversation, et il faut pouvoir en défaire une sans redemander. -->
    <div v-if="progChanges.length" class="card">
      <div class="section-label mb-8">Programme modifié</div>
      <div v-for="c in progChanges" :key="c.cle" class="row-between pg-line">
        <span>{{ c.texte }}</span>
        <button class="btn" @click="c.defaire()">↺</button>
      </div>
      <div class="muted mt-6">
        ↺ rétablit la version d'origine. Un exercice retiré reste dans les séances déjà
                enregistrées, avec ses records.
      </div>
    </div>

        <!-- Tout ce qui se déclenche à la fin d'un repos : son, vibration, notification. -->
        <div class="card">
          <div class="row-between mb-8">
            <div class="section-label">Fin de repos</div>
        <button class="btn" :class="{ sel: soundEnabled }" @click="soundEnabled = !soundEnabled">{{ soundEnabled ? 'Activé' : 'Désactivé' }}</button>
      </div>
      <div class="form-grid">
        <div class="field">
          <span>Son</span>
          <SportSelect v-model="soundType" :options="SOUND_OPTIONS" />
        </div>
        <label class="field">
          <span>Volume · {{ volPct }} %</span>
          <input v-model.number="volPct" type="range" min="0" max="100" step="5" class="range" :style="{ '--fill': volPct + '%' }">
        </label>
        <div class="field">
          <span>Vibration</span>
          <SportSelect v-model="vibrationLevel" :options="VIBRATION_OPTIONS" />
        </div>
      </div>
            <div class="nav-row mt-6">
                      <button class="btn flex-1" @click="testSound">🔊 Tester</button>
            </div>
            <div class="muted mt-6">« Légère / Moyenne / Forte » jouent des vibrations de plus en plus longues : la force exacte n'est pas réglable.<template v-if="!soundEnabled"> Son coupé, la vibration reste active.</template></div>
      
                  <!-- Rien sur la notification quand elle fonctionne : elle part avec le son et la
                       vibration, et le bouton « Tester » les envoie tous les trois. On ne parle que
                       du cas où le navigateur l'empêche. -->
                        <div v-if="notifsBloquees" class="muted mt-6 export-warn">
                          Notifications bloquées par le navigateur : rien n'arrivera au poignet.
                        </div>
                </div>

    <!-- Appareils : la balance se branche ici, avec la montre. C'est un réglage
         d'appareil, pas une donnée de suivi — le Rapport affiche les mesures et
         renvoie vers cet écran quand rien n'est connecté. -->
        <!-- Ce que cette instance sait brancher, et ce qui l'est. La saisie du poids, elle,
                 vit dans Rapport → Corps, avec la courbe qu'elle alimente. -->
    <SportSources :today-iso="props.todayIso" @flash="relayer" />

    <!-- Le coffre : miroir des données et boîte de réception des propositions -->
    <SportVault :snapshot="buildSnapshot" @flash="emit('flash', $event)" />

    <!-- Les rappels de repas ont été retirés.
         Un minuteur posé dans la page suppose que la page vive jusqu'à l'heure du
         repas. Elle ne vit pas : Android gèle un onglet en arrière-plan au bout de
         quelques minutes. Le rappel de 11 h 45 arrivait donc à 12 h 20, au moment
         de rouvrir l'application — c'est-à-dire quand on n'en avait plus besoin.
         Faire sonner à l'heure exigeait un serveur (Web Push, clés VAPID, tâche
         planifiée) : beaucoup d'installation pour un rappel qu'on peut poser en
         deux gestes dans l'horloge du téléphone. Le module a donc été supprimé
         plutôt que laissé en place à moitié fiable. -->

    <div class="card">
      <div class="section-label mb-8">Données</div>
      <div class="nav-row">
        <button class="btn flex-1" @click="exportJSON(buildSnapshot())">⬇ Exporter</button>
        <label class="btn flex-1 center">⬆ Importer<input type="file" accept=".json" class="hidden-input" @change="onImport"></label>
        <button class="btn flex-1" @click="resetPlan()">↺ Réinit. planning</button>
      </div>
      <div class="muted mt-6" :class="{ 'export-warn': exportStale }">
        <template v-if="lastExportAt">{{ exportStale ? '⚠️' : '✓' }} Dernière sauvegarde : <b>{{ lastExportAt }}</b><template v-if="exportAge !== null"> (il y a {{ exportAge }} j)</template>.</template>
        <template v-else>⚠️ <b>Aucune sauvegarde.</b> Les données sont stockées dans ce navigateur : vider les données du site effacerait tout l'historique.</template>
      </div>
      <div v-if="backupOn" class="muted mt-6">
        Sauvegarde automatique du <b>{{ backupOn }}</b>, conservée dans ce navigateur.
        <button class="btn restore-btn" @click="onRestore">↩ Restaurer cet instantané</button>
      </div>
      <div class="muted mt-6">Le planning indique quelle séance est prévue quel jour. N'importe quelle séance peut être démarrée à tout moment sans le modifier. « Réinit. » rétablit le planning du programme.</div>
    </div>

    <!-- Le parcours d'installation, à la demande. En bas : on y revient une fois
         tous les six mois, et jamais dans l'urgence. -->
    <div class="card">
      <div class="section-label mb-8">Configuration</div>
      <div class="muted">
        Profil, accès Claude, connecteurs, contenu : les étapes du premier lancement.
                Les rouvrir ne défait rien.
      </div>
      <button class="btn btn-bloc" @click="revoirInstallation">↺ Revoir la configuration</button>
    </div>
  </div>
</template>