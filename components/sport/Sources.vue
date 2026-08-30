<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useWithings } from '~/composables/useWithings'
import { useNutrition } from '~/composables/useNutrition'
import { useWorkout } from '~/composables/useWorkout'
import { useFitbit } from '~/composables/useFitbit'

/**
 * D'où viennent le poids et les pas.
 *
 * L'écran ne connaissait qu'une balance — la mienne — et la saisie à la main était
 * enterrée au fond de la carte Withings, là où personne ne la cherchait. Quelqu'un
 * sans objet connecté se retrouvait donc devant une application dont deux écrans
 * restaient vides sans jamais dire pourquoi.
 *
 * La carte pose la question dans l'autre sens : voilà ce que cette instance sait
 * lire, choisis. Et « à la main » est en premier, parce que c'est le seul choix qui
 * marche partout et qu'il suffit à tout calculer — les carnets papier n'ont jamais
 * eu de balance connectée.
 */
const props = defineProps<{ todayIso: string | null, withingsError?: string | null }>()
const emit = defineEmits<{ flash: [msg: string] }>()

interface Dispo { id: string, label: string, capabilities: string[], note: string }
interface Indispo { id: string, label: string, raison: string }
const dispos = ref<Dispo[]>([])
const indispos = ref<Indispo[]>([])
const chargement = ref(true)

const { connected: withingsOn, connect: connectWithings, disconnect: disconnectWithings, entries: weighIns, addManual } = useWithings()
const { setSteps, dayFor } = useNutrition()
const { bodyWeightAt } = useWorkout()
const fitbit = useFitbit()

onMounted(async () => {
  try {
    const r = await $fetch<{ disponibles: Dispo[], indisponibles: Indispo[] }>('/api/sources')
    dispos.value = r.disponibles
    indispos.value = r.indisponibles
  }
  catch { /* instance sans serveur joignable : la saisie à la main reste possible */ }
  finally { chargement.value = false }
})

const aWithings = computed(() => dispos.value.some(d => d.id === 'withings'))
const aFitbit = computed(() => dispos.value.some(d => d.id === 'fitbit'))

async function syncFitbit() {
  emit('flash', await fitbit.sync() ? 'Fitbit synchronisé ✓' : (fitbit.error.value ?? 'Échec'))
}

// ─── Saisie à la main ────────────────────────────────────────────────────────
// Deux champs, préremplis avec ce qui est DÉJÀ enregistré pour aujourd'hui : on
// corrige plus souvent qu'on ne crée, et retaper un chiffre qu'on voit à l'écran
// est le genre de friction qui fait abandonner la saisie au bout de trois jours.
const poids = ref('')
const pas = ref('')
const poidsDuJour = computed(() => (props.todayIso ? bodyWeightAt(props.todayIso) : null))
const pasDuJour = computed(() => (props.todayIso ? dayFor(props.todayIso).steps : null))

function enregistrerPoids() {
  // `v-model` sur un <input type="number"> rend un NOMBRE, pas une chaîne : appeler
  // `.replace` dessus jetait une TypeError et le bouton ne faisait rien, sans le dire.
  // On repasse par `String` — la virgule décimale reste possible sur un clavier
  // français, et c'est exactement ce qu'on tape en salle.
  const kg = Number(String(poids.value).replace(',', '.'))
  if (!Number.isFinite(kg) || kg < 20 || kg > 400) {
    emit('flash', 'Poids invalide — entre 20 et 400 kg')
    return
  }
  if (!props.todayIso) return
  addManual(Math.round(kg * 100) / 100, props.todayIso)
  poids.value = ''
  emit('flash', 'Pesée enregistrée ✓')
}

function enregistrerPas() {
  if (!props.todayIso) return
  const brut = String(pas.value).trim()
  if (brut === '') { setSteps(props.todayIso, null); emit('flash', 'Pas remis à l\'estimation'); return }
  const n = Number(brut)
  if (!Number.isFinite(n) || n < 0 || n > 100000) {
    emit('flash', 'Nombre de pas invalide')
    return
  }
  setSteps(props.todayIso, Math.round(n))
  pas.value = ''
  emit('flash', 'Pas enregistrés ✓')
}
</script>

<template>
  <div class="card">
    <div class="row-between mb-8">
      <div class="section-label">Poids et pas</div>
      <span class="muted">{{ withingsOn ? 'Balance connectée' : 'À la main' }}</span>
    </div>

    <!-- La saisie manuelle N'EST PAS un repli : c'est le seul mode qui marche
         partout, et il reste utile même avec une balance — pour corriger une pesée
         aberrante, ou noter un poids pris ailleurs. -->
    <div class="src-manual">
      <div class="src-field">
        <label class="src-lab" for="src-kg">Poids du jour</label>
        <div class="src-row">
          <input
            id="src-kg" v-model="poids" type="number" inputmode="decimal" step="0.1"
            :placeholder="poidsDuJour ? String(poidsDuJour) : 'kg'"
          >
          <button class="btn" @click="enregistrerPoids()">Noter</button>
        </div>
        <span v-if="poidsDuJour" class="muted src-cur">Déjà noté aujourd'hui : {{ poidsDuJour }} kg</span>
      </div>
      <div class="src-field">
        <label class="src-lab" for="src-pas">Pas</label>
        <div class="src-row">
          <input
            id="src-pas" v-model="pas" type="number" inputmode="numeric"
            :placeholder="pasDuJour ? String(pasDuJour) : 'estimés'"
          >
          <button class="btn" @click="enregistrerPas()">Noter</button>
        </div>
        <span class="muted src-cur">
          Vide = on repart de l'estimation selon ta semaine type. Les pas comptent dans
          la dépense, donc dans la cible à manger.
        </span>
      </div>
    </div>

    <!-- Les marques que CETTE instance sait lire. Rien n'est proposé qui ne soit
         configuré : un bouton qui mène à une 503 se lit comme une panne. -->
    <div v-if="!chargement && aWithings" class="src-provider">
      <div class="row-between">
        <span><b>Withings</b> — balances Body et montres ScanWatch</span>
        <span class="muted" :class="{ 'export-warn': !withingsOn }">{{ withingsOn ? 'Connectée' : 'Non connectée' }}</span>
      </div>
      <p v-if="props.withingsError" class="muted export-warn">
        ⚠️ La dernière tentative a échoué ({{ props.withingsError }}). Réessaie : le code
        d'autorisation n'est valable que quelques secondes.
      </p>
      <p v-if="withingsOn" class="muted">
        {{ weighIns.length }} pesée(s) récupérée(s), avec masse grasse, muscle, eau et os.
        Le détail est dans <b>Rapport</b>.
      </p>
      <p v-else class="muted">
        Une seule autorisation, puis chaque pesée arrive toute seule. Les jetons restent
        sur ce téléphone — le serveur n'en garde aucun.
      </p>
      <div class="nav-row mt-6">
        <button v-if="!withingsOn" class="btn-primary flex-1" @click="connectWithings()">⚖️ Connecter la balance</button>
        <button v-else class="btn flex-1" @click="disconnectWithings()">Déconnecter</button>
      </div>
      <p v-if="withingsOn" class="muted mt-6">
        Se déconnecter ne supprime rien : les pesées déjà récupérées sont à toi, elles restent.
      </p>
    </div>

    <div v-if="!chargement && aFitbit" class="src-provider">
      <div class="row-between">
        <span><b>Fitbit</b> — montres, bracelets et balance Aria</span>
        <span class="muted" :class="{ 'export-warn': !fitbit.connected.value }">{{ fitbit.connected.value ? 'Connecté' : 'Non connecté' }}</span>
      </div>
      <p v-if="fitbit.needsReconnect.value" class="muted export-warn">
        ⚠️ L'autorisation a expiré. Reconnecte le compte : le jeton de rafraîchissement
        n'est plus valable, réessayer ne servirait à rien.
      </p>
      <p v-else-if="fitbit.error.value" class="muted export-warn">⚠️ {{ fitbit.error.value }}</p>
      <p v-if="fitbit.connected.value" class="muted">
        Poids et pas récupérés à chaque synchro. La masse grasse suit si la balance
        sait la mesurer.
      </p>
      <p v-else class="muted">
        Une autorisation, puis les pesées et les pas arrivent à l'ouverture. Les jetons
        restent sur ce téléphone.
      </p>
      <div class="nav-row mt-6">
        <button v-if="!fitbit.connected.value" class="btn-primary flex-1" @click="fitbit.connect()">⌚ Connecter Fitbit</button>
        <template v-else>
          <button class="btn flex-1" :disabled="fitbit.busy.value" @click="syncFitbit()">↻ Synchroniser</button>
          <button class="btn flex-1" @click="fitbit.disconnect()">Déconnecter</button>
        </template>
      </div>
    </div>

    <!-- Montrer ce qui manque, plutôt que de faire comme si ça n'existait pas :
         celui qui héberge ce code doit savoir ce qu'il POURRAIT brancher. -->
    <details v-if="!chargement && indispos.length" class="src-more">
      <summary class="muted">Autres marques ({{ indispos.length }})</summary>
      <div v-for="i in indispos" :key="i.id" class="src-off">
        <b>{{ i.label }}</b> — <span class="muted">{{ i.raison }}</span>
      </div>
    </details>
  </div>
</template>
