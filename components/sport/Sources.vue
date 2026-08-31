<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useWithings } from '~/composables/useWithings'
import { useNutrition } from '~/composables/useNutrition'
import { useWorkout } from '~/composables/useWorkout'
import { useFitbit } from '~/composables/useFitbit'

/**
 * Les connecteurs : ce que cette instance sait brancher, et ce qui l'est.
 *
 * Le même écran sert deux fois — dans le parcours d'installation et dans les réglages.
 * Il n'y en a qu'UN. Deux listes de marques affichées à deux endroits divergent au
 * premier ajout : celle qu'on regarde le moins reste en arrière, et c'est justement
 * celle qu'on consulte quand on cherche pourquoi une balance n'apparaît pas.
 *
 * `compact` est la version du parcours : on y répond à une seule question — qu'est-ce
 * que je peux brancher, et est-ce que c'est branché. Les réglages, eux, portent les
 * gestes du quotidien : noter un poids, corriger des pas, resynchroniser, débrancher.
 * Ce sont les mêmes lignes, dépliables.
 */
const props = defineProps<{
  todayIso?: string | null
  withingsError?: string | null
  /** Liste seule, sans les réglages : la version du parcours d'installation. */
  compact?: boolean
}>()
const emit = defineEmits<{ flash: [msg: string, ton?: 'ok' | 'echec'] }>()

interface Fiche { id: string, label: string, icone: string, capabilities: string[], note: string, raison?: string }
const dispos = ref<Fiche[]>([])
const indispos = ref<Fiche[]>([])
const chargement = ref(true)

const { connected: withingsOn, connect: connectWithings, disconnect: disconnectWithings, entries: weighIns, addManual } = useWithings()
const { setSteps, dayFor } = useNutrition()
const { bodyWeightAt } = useWorkout()
const fitbit = useFitbit()

onMounted(async () => {
  try {
    const r = await $fetch<{ disponibles: Fiche[], indisponibles: Fiche[] }>('/api/sources')
    dispos.value = r.disponibles
    indispos.value = r.indisponibles
  }
  catch { /* instance sans serveur joignable : la saisie à la main reste possible */ }
  finally { chargement.value = false }
})

/** Branché ou non. « À la main » n'est pas un fournisseur qu'on branche : c'est le cas par défaut. */
const branche = (id: string) =>
  (id === 'withings' ? withingsOn.value : id === 'fitbit' ? fitbit.connected.value : false)
const aBrancher = (id: string) => id === 'withings' || id === 'fitbit'
function connecter(id: string) {
  if (id === 'withings') connectWithings()
  else if (id === 'fitbit') fitbit.connect()
}

const CE_QUE_CA_DONNE: Record<string, string> = {
  poids: 'poids', composition: 'masse grasse', pas: 'pas',
}
const apporte = (caps: string[]) => (caps ?? []).map(c => CE_QUE_CA_DONNE[c] ?? c).join(' · ')
const resume = computed(() => {
  const on = dispos.value.filter(d => branche(d.id)).map(d => d.label)
  return on.length ? on.join(' · ') : 'À la main'
})

/**
 * La ligne dépliée, dans les réglages.
 *
 * Une seule à la fois : les cartes empilées d'avant faisaient défiler l'écran sur
 * trois hauteurs pour deux marques dont une n'était pas branchée. On ouvre ce qu'on
 * vient toucher, le reste se lit d'un coup d'œil.
 */
const ouvert = ref<string | null>(null)
const basculer = (id: string) => { ouvert.value = ouvert.value === id ? null : id }

async function syncFitbit() {
  emit('flash', await fitbit.sync() ? 'Fitbit synchronisé ✓' : (fitbit.error.value ?? 'Échec'), fitbit.error.value ? 'echec' : 'ok')
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
    emit('flash', 'Poids invalide — entre 20 et 400 kg', 'echec')
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
    emit('flash', 'Nombre de pas invalide', 'echec')
    return
  }
  setSteps(props.todayIso, Math.round(n))
  pas.value = ''
  emit('flash', 'Pas enregistrés ✓')
}
</script>

<template>
  <div :class="{ card: !props.compact }">
    <div v-if="!props.compact" class="row-between mb-8">
      <div class="section-label">Connecteurs</div>
      <span class="muted">{{ resume }}</span>
    </div>

    <ul class="conn">
      <li v-for="c in [...dispos, ...indispos]" :key="c.id" :class="{ on: branche(c.id), off: !!c.raison, open: ouvert === c.id }">
        <!-- Dans les réglages l'en-tête OUVRE la ligne, donc c'est un bouton, et les
             actions vivent dans le dépliant : un <button> dans un <button> est du
             balisage que le navigateur répare à sa façon — il sort le bouton
             intérieur, et le clic ne fait plus ce que le gabarit dit. -->
        <button v-if="!props.compact" class="conn-row" @click="basculer(c.id)">
          <span class="conn-i" aria-hidden="true">{{ c.icone }}</span>
          <span class="conn-t">
            <b>{{ c.label }}</b>
            <small>{{ apporte(c.capabilities) }}</small>
          </span>
          <span class="conn-e mono">{{ c.raison ? 'indisponible' : (branche(c.id) ? 'connecté ✓' : (aBrancher(c.id) ? 'à brancher' : 'par défaut')) }}</span>
          <span class="conn-chev" aria-hidden="true">{{ ouvert === c.id ? '▴' : '▾' }}</span>
        </button>
        <div v-else class="conn-row">
          <span class="conn-i" aria-hidden="true">{{ c.icone }}</span>
          <span class="conn-t">
            <b>{{ c.label }}</b>
            <small>{{ c.raison || apporte(c.capabilities) }}</small>
          </span>
          <span v-if="branche(c.id)" class="conn-e mono">connecté ✓</span>
          <button v-else-if="!c.raison && aBrancher(c.id)" class="btn conn-b" @click="connecter(c.id)">Connecter</button>
          <span v-else-if="!c.raison" class="conn-e mono">par défaut</span>
        </div>

        <div v-if="!props.compact && ouvert === c.id" class="conn-det">
          <!-- Indisponible : la raison, et rien qui ressemble à un bouton. -->
          <p v-if="c.raison" class="muted">{{ c.raison }}</p>

          <!-- La saisie manuelle N'EST PAS un repli : c'est le seul mode qui marche
               partout, et il reste utile même avec une balance — pour corriger une
               pesée aberrante, ou noter un poids pris ailleurs. -->
          <template v-else-if="c.id === 'manual'">
            <div class="src-manual">
              <div class="src-field">
                <label class="src-lab" for="src-kg">Poids du jour</label>
                <div class="src-row">
                  <!-- Un exemple, jamais la valeur du jour : un chiffre gris dans un
                       champ se lit comme une saisie déjà faite, on quitte l'écran en
                       croyant avoir noté. Ce qui est enregistré se dit en dessous, en
                       toutes lettres. -->
                  <input id="src-kg" v-model="poids" type="number" inputmode="decimal" step="0.1" placeholder="ex. 78,4">
                  <button class="btn" @click="enregistrerPoids()">Noter</button>
                </div>
                <span v-if="poidsDuJour" class="muted src-cur">Déjà noté aujourd'hui : {{ poidsDuJour }} kg</span>
              </div>
              <div class="src-field">
                <label class="src-lab" for="src-pas">Pas</label>
                <div class="src-row">
                  <input id="src-pas" v-model="pas" type="number" inputmode="numeric" placeholder="ex. 8 400">
                  <button class="btn" @click="enregistrerPas()">Noter</button>
                </div>
                <span class="muted src-cur">
                  <template v-if="pasDuJour">Déjà noté aujourd'hui : {{ pasDuJour }} pas. </template>
                  Noter à vide repart de l'estimation selon ta semaine type. Les pas comptent
                  dans la dépense, donc dans la cible à manger.
                </span>
              </div>
            </div>
          </template>

          <template v-else-if="c.id === 'withings'">
            <p v-if="props.withingsError" class="muted export-warn">
              ⚠️ La dernière tentative a échoué ({{ props.withingsError }}). Réessaie : le code
              d'autorisation n'est valable que quelques secondes.
            </p>
            <p v-if="withingsOn" class="muted">
              {{ weighIns.length }} pesée(s) récupérée(s), avec masse grasse, muscle, eau et os.
              Le détail est dans <b>Rapport</b>.
            </p>
            <p v-else class="muted">
              {{ c.note }} Une seule autorisation, puis chaque pesée arrive toute seule. Les
              jetons restent sur ce téléphone — le serveur n'en garde aucun.
            </p>
            <div class="nav-row mt-6">
              <button v-if="!withingsOn" class="btn-primary flex-1" @click="connectWithings()">⚖️ Connecter la balance</button>
              <button v-else class="btn flex-1" @click="disconnectWithings()">Déconnecter</button>
            </div>
            <p v-if="withingsOn" class="muted">
              Se déconnecter ne supprime rien : les pesées déjà récupérées sont à toi, elles restent.
            </p>
          </template>

          <template v-else-if="c.id === 'fitbit'">
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
              {{ c.note }} Une autorisation, puis les pesées et les pas arrivent à l'ouverture.
              Les jetons restent sur ce téléphone.
            </p>
            <div class="nav-row mt-6">
              <button v-if="!fitbit.connected.value" class="btn-primary flex-1" @click="fitbit.connect()">⌚ Connecter Fitbit</button>
              <template v-else>
                <button class="btn flex-1" :disabled="fitbit.busy.value" @click="syncFitbit()">↻ Synchroniser</button>
                <button class="btn flex-1" @click="fitbit.disconnect()">Déconnecter</button>
              </template>
            </div>
          </template>

          <p v-else class="muted">{{ c.note }}</p>
        </div>
      </li>
    </ul>

    <p v-if="!chargement && !dispos.length" class="muted mt-6">
      Serveur injoignable : impossible de savoir ce que cette instance sait brancher.
      La saisie à la main, elle, marche toujours — dans <b>Rapport</b>.
    </p>
  </div>
</template>
