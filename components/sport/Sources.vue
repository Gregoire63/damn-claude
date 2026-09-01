<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useConnecteur, useConnecteurs } from '~/composables/useConnecteur'


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
  console?: string
  raison?: string
  /** Vrai quand un formulaire peut y remédier ; faux quand c'est la marque qui bloque. */
  configurable?: boolean
}
const dispos = ref<Fiche[]>([])
const indispos = ref<Fiche[]>([])
const chargement = ref(true)
/**
 * Le serveur a-t-il répondu ?
 *
 * Une liste vide ne veut pas dire la même chose des deux côtés : sans marque
 * configurée, tout est simplement dans « indisponibles » et l'écran est correct. Ce
 * n'est qu'en cas d'échec de l'appel qu'il faut le dire — confondre les deux affichait
 * « serveur injoignable » à une instance qui allait très bien.
 */
const injoignable = ref(false)
const conn = useConnecteurs()

async function chargerSources() {
  try {
    const r = await $fetch<{ disponibles: Fiche[], indisponibles: Fiche[] }>('/api/sources')
    dispos.value = r.disponibles
    indispos.value = r.indisponibles
    injoignable.value = false
  }
  catch { injoignable.value = true }
  finally { chargement.value = false }
}
onMounted(chargerSources)

/** Branchable : la marque est configurée sur cette instance, et rien ne la bloque. */
const aBrancher = (c: Fiche) => !c.raison
const branche = (id: string) => useConnecteur(id).connecte.value

const CE_QUE_CA_DONNE: Record<string, string> = {
  poids: 'poids', composition: 'masse grasse', pas: 'pas',
}
const apporte = (caps: string[]) => (caps ?? []).map(c => CE_QUE_CA_DONNE[c] ?? c).join(' · ')
const resume = computed(() => {
  const on = dispos.value.filter(d => branche(d.id)).map(d => d.label)
  return on.length ? on.join(' · ') : 'aucun branché'
})

/**
 * La ligne dépliée. Une seule à la fois : les cartes empilées d'avant faisaient
 * défiler l'écran sur trois hauteurs pour deux marques dont une n'était pas branchée.
 * On ouvre ce qu'on vient toucher, le reste se lit d'un coup d'œil.
 */
const ouvert = ref<string | null>(null)
function basculer(c: Fiche) {
  ouvert.value = ouvert.value === c.id ? null : c.id
}

/** Les messages d'un enfant gardent leur ton en remontant. */
function relais(msg: string, ton?: 'ok' | 'echec') { emit('flash', msg, ton) }

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
 * Le formulaire vit dans SportConnecteurConfig : il s'affiche déplié dans les réglages
 * et en fenêtre depuis le parcours, et deux copies auraient divergé.
 *
 * `aConfigurer` est la fenêtre du parcours. Elle existe parce que la liste compacte
 * était MUETTE : quatre marques grisées, « à configurer », et aucun geste possible —
 * on quittait l'étape en pensant que l'application était incomplète, alors qu'il
 * manquait deux champs à remplir.
 */
const aConfigurer = ref<Fiche | null>(null)
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
          <span class="conn-e mono">{{ c.raison ? (c.configurable ? 'à configurer' : 'indisponible') : (branche(c.id) ? 'connecté ✓' : 'à brancher') }}</span>
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
                    <!-- Une marque non configurée doit rester CLIQUABLE, même ici. Sans ça,
                         l'étape n'offrait aucun geste : des lignes grisées, et rien à faire.
                         Le détail vit dans une fenêtre, où il y a la place. -->
                    <button v-else class="btn conn-b" @click="aConfigurer = c">
                      {{ c.configurable ? 'Configurer' : 'Pourquoi ?' }}
                    </button>
        </div>

        <div v-if="!props.compact && ouvert === c.id" class="conn-det">
                  <!-- Non configurée : la raison d'un blocage, ou le formulaire — le même bloc
                       que dans la fenêtre du parcours. -->
                  <template v-if="c.raison">
                    <SportConnecteurConfig :marque="c" @flash="relais" @change="chargerSources()" />
                  </template>
        
                  <!-- Disponible : l'état, les gestes, et de quoi la débrancher. -->
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
            <!-- D'où viennent ses identifiants, et comment les retirer. -->
                        <SportConnecteurConfig :marque="c" @flash="relais" @change="chargerSources()" />
          </template>
        </div>
      </li>
    </ul>

    <p v-if="injoignable" class="muted mt-6">
          Serveur injoignable : la liste des connecteurs n'a pas pu être chargée.
        </p>
        <!-- Rien de configuré n'est pas une panne : c'est l'état d'une instance neuve. Le
             dire évite de chercher ce qui manque, et rappelle que tout marche sans. -->
        <p v-else-if="!chargement && !dispos.length" class="muted mt-6">
          Aucun connecteur branché. Le poids se note à la main dans <b>Rapport</b>, et les pas
          sont estimés à partir de ta semaine type.
        </p>
    
        <!-- La fenêtre du parcours : la liste compacte n'a pas la place du formulaire,
             mais elle ne doit pas pour autant être un cul-de-sac. -->
        <Popup
          v-if="aConfigurer"
          :title="`${aConfigurer.icone} ${aConfigurer.label}`"
          :subtitle="apporte(aConfigurer.capabilities)"
          popup-class="conn-popup"
          @close="aConfigurer = null"
        >
          <SportConnecteurConfig
            :marque="aConfigurer"
            @flash="relais"
            @change="chargerSources(); aConfigurer = null"
          />
        </Popup>
      </div>
    </template>
