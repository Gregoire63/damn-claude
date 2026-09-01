<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useConnecteur, useConnecteurs } from '~/composables/useConnecteur'
import { useMesures } from '~/composables/useMesures'
import { useNutrition } from '~/composables/useNutrition'
import { useWorkout } from '~/composables/useWorkout'
import { useVault } from '~/composables/useVault'

/**
 * Les connecteurs : ce que cette instance sait brancher, ce qui est branché, et
 * comment brancher le reste.
 *
 * Le même écran sert deux fois — dans le parcours d'installation et dans les réglages.
 * Il n'y en a qu'UN. Deux listes de marques affichées à deux endroits divergent au
 * premier ajout : celle qu'on regarde le moins reste en arrière, et c'est justement
 * celle qu'on consulte quand on cherche pourquoi une balance n'apparaît pas.
 *
 * `compact` est la version du parcours : on y répond à une seule question — qu'est-ce
 * que je peux brancher, et est-ce que c'est branché. Les réglages, eux, portent les
 * gestes du quotidien et la configuration.
 *
 * Aucune marque n'est écrite en dur ici. La liste vient de /api/sources, les gestes de
 * `useConnecteur(id)` : ajouter un connecteur ne touche pas ce fichier.
 */
const props = defineProps<{
  todayIso?: string | null
  /** Liste seule, sans les réglages : la version du parcours d'installation. */
  compact?: boolean
}>()
const emit = defineEmits<{ flash: [msg: string, ton?: 'ok' | 'echec'] }>()

interface Fiche {
  id: string
  label: string
  icone: string
  capabilities: string[]
  note: string
  raison?: string
  /** Vrai quand un formulaire peut y remédier ; faux quand c'est la marque qui bloque. */
  configurable?: boolean
}
const dispos = ref<Fiche[]>([])
const indispos = ref<Fiche[]>([])
const chargement = ref(true)

const { setSteps, dayFor } = useNutrition()
const { bodyWeightAt } = useWorkout()
const { addManual } = useMesures()
const conn = useConnecteurs()
const vault = useVault()

async function chargerSources() {
  try {
    const r = await $fetch<{ disponibles: Fiche[], indisponibles: Fiche[] }>('/api/sources')
    dispos.value = r.disponibles
    indispos.value = r.indisponibles
  }
  catch { /* instance sans serveur joignable : la saisie à la main reste possible */ }
  finally { chargement.value = false }
}
onMounted(chargerSources)

/** Branché ou non. « À la main » n'est pas un fournisseur qu'on branche : c'est le cas
 *  par défaut, et le seul qui marche sans rien configurer. */
const aBrancher = (c: Fiche) => c.id !== 'manual' && !c.raison
const branche = (id: string) => (id === 'manual' ? false : useConnecteur(id).connecte.value)

const CE_QUE_CA_DONNE: Record<string, string> = {
  poids: 'poids', composition: 'masse grasse', pas: 'pas',
}
const apporte = (caps: string[]) => (caps ?? []).map(c => CE_QUE_CA_DONNE[c] ?? c).join(' · ')
const resume = computed(() => {
  const on = dispos.value.filter(d => branche(d.id)).map(d => d.label)
  return on.length ? on.join(' · ') : 'À la main'
})

/**
 * La ligne dépliée. Une seule à la fois : les cartes empilées d'avant faisaient
 * défiler l'écran sur trois hauteurs pour deux marques dont une n'était pas branchée.
 * On ouvre ce qu'on vient toucher, le reste se lit d'un coup d'œil.
 */
const ouvert = ref<string | null>(null)
function basculer(c: Fiche) {
  ouvert.value = ouvert.value === c.id ? null : c.id
  // À chaque ouverture, pas seulement pour une marque à configurer : une marque DÉJÀ
  // configurée doit pouvoir dire d'où viennent ses identifiants et se laisser retirer.
  // Sans ça, poser des identifiants puis recharger la page faisait disparaître le
  // bouton « Retirer » — et il ne restait plus aucun chemin pour les changer.
  if (ouvert.value && c.id !== 'manual') void chargerConfig()
}

async function connecter(id: string) {
  useConnecteur(id).connecter()
}
async function deconnecter(c: Fiche) {
  useConnecteur(c.id).deconnecter()
  conn.rafraichir()
  emit('flash', `${c.label} déconnecté. Les mesures déjà récupérées sont conservées.`)
}
async function synchroniser(c: Fiche) {
  const k = useConnecteur(c.id)
  const ok = await k.synchroniser(props.todayIso ?? new Date().toISOString().slice(0, 10))
  emit('flash', ok ? `${c.label} synchronisé ✓` : (k.erreur.value ?? 'Échec'), ok ? 'ok' : 'echec')
}

// ─── Configuration d'une marque ──────────────────────────────────────────────
/**
 * Brancher une marque sans passer par l'hébergeur.
 *
 * C'est la marche qui rendait ce dépôt inutilisable par quelqu'un d'autre : il fallait
 * poser deux variables d'environnement et REDÉPLOYER pour voir apparaître un bouton.
 * Le formulaire ne remplace pas TOUT — l'URL de retour doit toujours être déclarée
 * chez la marque, aucune API ne permet de le faire à sa place — mais il affiche
 * l'adresse exacte à recopier, ce qui est déjà la moitié des échecs évités.
 *
 * Le secret part vers le serveur et n'en revient jamais. Le champ affiche ce qui est
 * posé, pas sa valeur : un secret qu'on peut relire finit dans un journal, une capture
 * d'écran ou un cache de navigateur.
 */
interface EtatConfig {
  id: string
  origine: 'env' | 'coffre' | null
  clientId: string
  at: string
  lisible: boolean
  console: string
  env: { id: string, secret: string }
}
const config = ref<Record<string, EtatConfig>>({})
const configErr = ref('')
const saisie = ref<Record<string, { clientId: string, secret: string }>>({})
const enregistre = ref('')

async function chargerConfig() {
  configErr.value = ''
  try {
    const r = await $fetch<{ marques: EtatConfig[] }>('/api/connect/config')
    config.value = Object.fromEntries(r.marques.map(m => [m.id, m]))
  }
  catch (e) {
    // 401 : il faut un passkey. Ce n'est pas une panne, c'est la réponse — et le dire
    // évite de chercher une erreur de configuration là où il manque une connexion.
    configErr.value = (e as { status?: number }).status === 401
      ? 'Déverrouille l’application pour configurer les connecteurs.'
      : 'Configuration illisible pour l’instant.'
  }
}

const champs = (id: string) => (saisie.value[id] ??= { clientId: '', secret: '' })
const urlRetour = (id: string) =>
  (import.meta.client ? `${location.origin}/api/connect/${id}/callback` : `/api/connect/${id}/callback`)

const copie = ref('')
async function copier(texte: string, marqueur: string) {
  try {
    await navigator.clipboard.writeText(texte)
    copie.value = marqueur
    setTimeout(() => { copie.value = '' }, 2500)
  }
  catch { emit('flash', 'Copie impossible. Sélectionne l’adresse manuellement.', 'echec') }
}

async function poser(c: Fiche) {
  const v = champs(c.id)
  if (!v.clientId.trim() || !v.secret.trim()) {
    emit('flash', 'Identifiant et secret sont requis', 'echec')
    return
  }
  enregistre.value = c.id
  try {
    await $fetch('/api/connect/config', {
      method: 'POST',
      body: { marque: c.id, clientId: v.clientId.trim(), clientSecret: v.secret.trim() },
    })
    saisie.value[c.id] = { clientId: '', secret: '' }
    emit('flash', `${c.label} configuré ✓`)
    await Promise.all([chargerSources(), chargerConfig()])
    ouvert.value = c.id
  }
  catch (e) {
    emit('flash', (e as { data?: { statusMessage?: string } }).data?.statusMessage ?? 'Enregistrement refusé', 'echec')
  }
  finally { enregistre.value = '' }
}

async function retirer(c: Fiche) {
  try {
    await $fetch(`/api/connect/config?marque=${encodeURIComponent(c.id)}`, { method: 'DELETE' })
    emit('flash', `Identifiants de ${c.label} retirés`)
    await Promise.all([chargerSources(), chargerConfig()])
  }
  catch { emit('flash', 'Suppression impossible', 'echec') }
}

// ─── Saisie à la main ────────────────────────────────────────────────────────
// Deux champs, et ce qui est DÉJÀ noté aujourd'hui affiché en dessous : on corrige
// plus souvent qu'on ne crée.
const poids = ref('')
const pas = ref('')
const poidsDuJour = computed(() => (props.todayIso ? bodyWeightAt(props.todayIso) : null))
const pasDuJour = computed(() => (props.todayIso ? dayFor(props.todayIso).steps : null))

function enregistrerPoids() {
  // `v-model` sur un <input type="number"> rend un NOMBRE, pas une chaîne : appeler
  // `.replace` dessus jetait une TypeError et le bouton ne faisait rien, sans le dire.
  const kg = Number(String(poids.value).replace(',', '.'))
  if (!Number.isFinite(kg) || kg < 20 || kg > 400) {
    emit('flash', 'Poids invalide : entre 20 et 400 kg', 'echec')
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
        <button v-if="!props.compact" class="conn-row" @click="basculer(c)">
          <span class="conn-i" aria-hidden="true">{{ c.icone }}</span>
          <span class="conn-t">
            <b>{{ c.label }}</b>
            <small>{{ apporte(c.capabilities) }}</small>
          </span>
          <span class="conn-e mono">{{ c.raison ? (c.configurable ? 'à configurer' : 'indisponible') : (branche(c.id) ? 'connecté ✓' : (aBrancher(c) ? 'à brancher' : 'par défaut')) }}</span>
          <span class="conn-chev" aria-hidden="true">{{ ouvert === c.id ? '▴' : '▾' }}</span>
        </button>
        <div v-else class="conn-row">
          <span class="conn-i" aria-hidden="true">{{ c.icone }}</span>
          <span class="conn-t">
            <b>{{ c.label }}</b>
            <small>{{ apporte(c.capabilities) }}</small>
          </span>
          <span v-if="branche(c.id)" class="conn-e mono">connecté ✓</span>
                    <button v-else-if="aBrancher(c)" class="btn conn-b" @click="connecter(c.id)">Connecter</button>
                    <span v-else-if="!c.raison" class="conn-e mono">par défaut</span>
                    <!-- Le détail de ce qu'il reste à faire vit dans les réglages, où il y a la
                         place et le formulaire. Ici, il se répétait sur chaque marque et noyait
                         la seule information utile : qu'est-ce qui est déjà branché. -->
                    <span v-else class="conn-e mono">{{ c.configurable ? 'à configurer' : 'indisponible' }}</span>
        </div>

        <div v-if="!props.compact && ouvert === c.id" class="conn-det">
          <!-- 1. La saisie manuelle. Ce N'EST PAS un repli : c'est le seul mode qui
               marche partout, et il reste utile même avec une balance — pour corriger
               une pesée aberrante, ou noter un poids pris ailleurs. -->
          <template v-if="c.id === 'manual'">
            <div class="src-manual">
              <div class="src-field">
                <label class="src-lab" for="src-kg">Poids du jour</label>
                <div class="src-row">
                  <!-- Un exemple, jamais la valeur du jour : un chiffre gris dans un
                       champ se lit comme une saisie déjà faite, on quitte l'écran en
                       croyant avoir noté. Ce qui est enregistré se dit en dessous. -->
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
                                    Laisser vide revient à l'estimation. Les pas entrent dans ta dépense du jour.
                </span>
              </div>
            </div>
          </template>

          <!-- 2. Une marque que la marque elle-même bloque : la raison, et rien qui
               ressemble à un bouton. -->
          <template v-else-if="c.raison && !c.configurable">
            <p class="muted">{{ c.raison }}</p>
          </template>

          <!-- 3. Une marque configurable : le formulaire. -->
          <template v-else-if="c.raison">
            <p class="muted">{{ c.note }}</p>
            <p v-if="configErr" class="muted export-warn">⚠️ {{ configErr }}</p>
            <template v-else>
              <ol class="conn-pas">
                <li>
                  Crée une application chez la marque
                                    <a v-if="config[c.id]?.console" :href="config[c.id].console" target="_blank" rel="noopener">— sa console</a>.
                </li>
                <li>
                  Déclare cette URL de retour, à l'identique :
                  <code class="conn-url mono">{{ urlRetour(c.id) }}</code>
                  <button class="btn conn-mini" @click="copier(urlRetour(c.id), c.id)">
                    {{ copie === c.id ? 'Copié ✓' : '⧉ Copier' }}
                  </button>
                </li>
                <li>Reporte ici l'identifiant et le secret obtenus.</li>
              </ol>
              <label class="field"><span>Identifiant (client ID)</span>
                <input v-model="champs(c.id).clientId" type="text" autocomplete="off" spellcheck="false" placeholder="Identifiant"></label>
              <label class="field"><span>Secret (client secret)</span>
                <input v-model="champs(c.id).secret" type="password" autocomplete="off" placeholder="Secret"></label>
              <button class="btn-primary btn-bloc" :disabled="enregistre === c.id" @click="poser(c)">
                {{ enregistre === c.id ? 'Enregistrement…' : '🔐 Enregistrer' }}
              </button>
              <p class="muted">
                Le secret est chiffré et n'est jamais renvoyé au navigateur. Il peut aussi être
                                posé chez l'hébergeur — <b>{{ config[c.id]?.env.id }}</b> et
                                <b>{{ config[c.id]?.env.secret }}</b> —, qui restent prioritaires.
              </p>
            </template>
          </template>

          <!-- 4. Une marque disponible : l'état, les gestes, et de quoi la débrancher. -->
          <template v-else>
            <p v-if="useConnecteur(c.id).reconnecter.value" class="muted export-warn">
              ⚠️ Autorisation expirée ou révoquée. Reconnecte le compte.
            </p>
            <p v-else-if="useConnecteur(c.id).erreur.value" class="muted export-warn">
              ⚠️ {{ useConnecteur(c.id).erreur.value }}
            </p>
            <p class="muted">{{ c.note }}</p>
            <p v-if="!branche(c.id)" class="muted">
              Une autorisation suffit : les mesures arrivent ensuite à chaque ouverture. Les
                            jetons restent sur cet appareil.
            </p>
            <div class="nav-row mt-6">
              <button v-if="!branche(c.id)" class="btn-primary flex-1" @click="connecter(c.id)">
                {{ c.icone }} Connecter
              </button>
              <template v-else>
                <button class="btn flex-1" :disabled="useConnecteur(c.id).occupe.value" @click="synchroniser(c)">↻ Synchroniser</button>
                <button class="btn flex-1" @click="deconnecter(c)">Déconnecter</button>
              </template>
            </div>
            <p v-if="branche(c.id)" class="muted">
              La déconnexion ne supprime aucune mesure déjà récupérée.
            </p>
            <!-- Les identifiants posés depuis l'application se retirent depuis
                 l'application. Ceux de l'hébergeur, non : ils ne sont pas ici. -->
            <p v-if="config[c.id]?.origine === 'coffre'" class="muted">
              Identifiants enregistrés le {{ (config[c.id].at || '').slice(0, 10) }}
              <button class="btn conn-mini" @click="retirer(c)">Retirer</button>
            </p>
            <p v-else-if="config[c.id]?.origine === 'env'" class="muted">
              Configuré par l'hébergeur (<b>{{ config[c.id].env.id }}</b>).
            </p>
            <p v-else-if="configErr && vault.state.value.registered" class="muted">{{ configErr }}</p>
          </template>
        </div>
      </li>
    </ul>

    <p v-if="!chargement && !dispos.length" class="muted mt-6">
      Serveur injoignable : la liste des connecteurs n'a pas pu être chargée. La saisie
            manuelle reste disponible dans <b>Rapport</b>.
    </p>
  </div>
</template>
