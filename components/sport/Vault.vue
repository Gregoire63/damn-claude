<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useVault } from '~/composables/useVault'

/**
 * Le connecteur, vu du téléphone.
 *
 * Trois états, dans cet ordre : pas de passkey → en poser un ; passkey mais pas de
 * session → se déverrouiller ; session → l'état du miroir et la boîte de réception
 * des propositions.
 *
 * Le point délicat est la validation. Une proposition n'est PAS un message : c'est
 * une écriture en attente sur des données qui pilotent des calories et une
 * progression. On montre donc la phrase, le détail brut, et on dit clairement
 * quand l'application ne sait pas l'appliquer toute seule — auquel cas le bouton
 * ne prétend rien faire, il note simplement que c'est réglé.
 */
const props = defineProps<{ snapshot: () => Record<string, unknown> }>()
const emit = defineEmits<{ flash: [msg: string] }>()

const v = useVault()
const bootstrap = ref('')
const labelSecours = ref('')

/**
 * La liste des appareils, jamais indéfinie.
 *
 * `/api/auth/me` peut répondre une forme ANTÉRIEURE — pendant un déploiement, le
 * temps que les fonctions basculent, ou depuis une page restée ouverte. Un
 * `undefined.length` dans un gabarit ne se rattrape pas : tout l'écran disparaît,
 * y compris le bouton qui aurait permis de recharger.
 */
const appareils = computed(() => v.state.value.appareils ?? [])

/** Un passkey de plus, depuis l'appareil qu'on veut autoriser. */
async function doSecours() {
  if (await v.ajouterSecours(labelSecours.value.trim())) {
    labelSecours.value = ''
    emit('flash', 'Clé d’accès ajoutée ✓')
  }
}
const showReset = ref(false)

/**
 * Le diagnostic du serveur, affiché tant que tout n'est pas en place.
 *
 * Une variable d'environnement oubliée se manifestait par « Aucun passkey » —
 * c'est-à-dire exactement ce qu'affiche une installation saine où l'on n'a encore
 * rien fait. On cherchait donc côté navigateur un problème qui était côté serveur.
 */
interface Health {
  pret: boolean
  env: Record<string, boolean>
  bootstrap?: { longueur: number, espaces_parasites: boolean }
  store: string
  driver: string
  miroir?: { pousse_le: string, seances: number, pesees: number } | null
  propositions_en_attente?: number
}
const health = ref<Health | null>(null)

onMounted(async () => {
  await v.hydrate()
  try { health.value = await $fetch<Health>('/api/vault/health') }
  catch { health.value = null }
})

const manquantes = computed(() =>
  Object.entries(health.value?.env ?? {}).filter(([, ok]) => !ok).map(([k]) => k))

async function doReset() {
  try {
    await $fetch('/api/auth/reset', { method: 'POST', body: { bootstrap: bootstrap.value.trim() } })
    bootstrap.value = ''
    showReset.value = false
    await v.refresh()
    emit('flash', 'Clés d’accès effacées')
  }
  catch { emit('flash', 'Code de démarrage invalide') }
}

const statut = computed(() => {
  if (!v.state.value.registered) return 'a-poser'
  return v.state.value.connected ? 'ouvert' : 'verrouille'
})

const miroirLabel = computed(() => {
  if (!v.mirrorAt.value) return 'jamais envoyé'
  const d = new Date(v.mirrorAt.value)
  const min = Math.round((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'à l’instant'
  if (min < 60) return `il y a ${min} min`
  const h = Math.round(min / 60)
  return h < 36 ? `il y a ${h} h` : `le ${d.toLocaleDateString('fr-FR')}`
})

/**
 * Un code refusé ne dit rien tout seul.
 *
 * « 403 » laisse chercher entre une faute de frappe, un remplissage automatique du
 * navigateur et un retour à la ligne collé dans la variable Netlify. Comparer les
 * deux LONGUEURS tranche en une seconde, et ne révèle rien du code.
 */
const indice = computed(() => {
  const b = health.value?.bootstrap
  if (!b || !b.longueur) return ''
  const tape = bootstrap.value.trim().length
  if (b.espaces_parasites) return `⚠️ La variable Netlify contient un espace ou un retour à la ligne parasite — retire-le.`
  if (!tape) return `Le serveur attend un code de ${b.longueur} caractères.`
  if (tape !== b.longueur) return `Tu tapes ${tape} caractères, le serveur en attend ${b.longueur}.`
  return `${tape} caractères des deux côtés : la longueur correspond.`
})

const nom = ref('')
async function doRegister() {
  if (await v.register(bootstrap.value.trim(), nom.value.trim())) {
    bootstrap.value = ''
    emit('flash', 'Clé d’accès créée ✓')
    await v.push(props.snapshot, true)
  }
}
/** Renommer après coup : le nom se corrige sans redéployer ni retoucher au passkey. */
const renommage = ref(false)
const nouveauNom = ref('')
async function doRename() {
  if (await v.rename(nouveauNom.value.trim())) {
    renommage.value = false
    emit('flash', 'Nom mis à jour ✓')
  }
  else emit('flash', v.error.value ?? 'Échec')
}
async function doLogin() {
  if (await v.login()) emit('flash', 'Déverrouillé ✓')
}
async function doPush() {
  emit('flash', (await v.push(props.snapshot, true)) ? 'Données envoyées ✓' : (v.error.value ?? 'Envoi impossible'))
}
</script>

<template>
  <div class="card">
    <div class="row-between mb-8">
      <div class="section-label">Connecteur Claude</div>
      <span class="muted" :class="{ 'export-warn': statut !== 'ouvert' }">
        {{ statut === 'ouvert' ? 'Déverrouillé' : statut === 'verrouille' ? 'Verrouillé' : 'À configurer' }}
      </span>
    </div>

    <!-- À qui appartient cette instance. Visible une fois déverrouillé seulement :
         sur une page publique, ce serait donner un nom à un inconnu. -->
    <div v-if="statut === 'ouvert'" class="vt-owner">
      <template v-if="!renommage">
        <span class="muted">Compte de <b>{{ v.state.value.ownerName || 'sans nom' }}</b></span>
        <button class="vt-p-toggle" @click="nouveauNom = v.state.value.ownerName || ''; renommage = true">renommer</button>
      </template>
      <template v-else>
        <input v-model="nouveauNom" class="note-input" type="text" placeholder="Ton prénom" maxlength="40">
        <div class="nav-row mt-6">
          <button class="btn-primary flex-1" :disabled="v.busy.value" @click="doRename">Enregistrer</button>
          <button class="btn flex-1" @click="renommage = false">Annuler</button>
        </div>
        <p class="muted vt-txt">
          Ce nom apparaît à la demande de clé d'accès et dans les réponses de Claude.
        </p>
      </template>
    </div>

    <!-- Ce qui manque côté serveur, dit avant qu'on cherche ailleurs -->
    <div v-if="health && !health.pret" class="vt-warn">
      <b>Serveur incomplet.</b>
                <template v-if="manquantes.length">
                  Variables manquantes chez l'hébergeur : <b>{{ manquantes.join(', ') }}</b>.
                </template>
      <template v-if="health.store !== 'ok'">
        Stockage ({{ health.driver }}) : {{ health.store }}.
      </template>
    </div>

    <!-- Le serveur va bien mais n'a rien à lire.
         C'est le manque qui se diagnostique le plus mal : côté conversation, Claude
         dit « je n'ai pas accès à tes données », ce qui se lit comme une panne du
         connecteur. Vu d'ici, c'est un bouton à presser une fois. -->
    <div v-else-if="health && health.pret && health.miroir === null" class="vt-warn">
      <b>Aucune donnée envoyée.</b> Claude ne pourra rien lire tant que la copie n'a pas été
              transmise : déverrouille, puis touche <b>⬆ Envoyer maintenant</b>.
    </div>

    <!-- 1. Poser le premier passkey -->
    <template v-if="statut === 'a-poser'">
      <p class="muted vt-txt">
        Crée une clé d'accès pour autoriser Claude à lire tes données. Le code de démarrage
                ne sert qu'une fois ; les clés suivantes s'ajoutent depuis cet écran, sans code.
      </p>
      <p v-if="v.state.value.bootstrapSource !== 'env'" class="muted vt-txt">
        <b>Où le trouver :</b> dans le journal du dernier déploiement, à la ligne
                « Code de démarrage de ce déploiement ». Il est renouvelé à chaque déploiement.
      </p>
      <p v-else class="muted vt-txt">
        <b>Où le trouver :</b> c'est la valeur de <b>NUXT_VAULT_BOOTSTRAP</b>, dans les
                variables de ton hébergeur.
      </p>
      <div v-if="!v.state.value.bootstrapReady" class="vt-warn">
        ⚠️ Le code de démarrage a déjà servi. Relance un déploiement pour en obtenir un
                  nouveau.
      </div>
      <template v-else>
        <!-- Le prénom est demandé ICI, et pas dans une variable d'hébergement : c'est
             le moment où l'on déclare que cette instance est la sienne, et la fenêtre
             du système va l'afficher dans la seconde qui suit. -->
        <input v-model="nom" class="note-input mt-6" type="text" placeholder="Prénom (facultatif)" autocomplete="given-name" maxlength="40">
        <input v-model="bootstrap" class="note-input mono mt-6" type="text" inputmode="text" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Code de démarrage">
        <p v-if="indice" class="muted vt-hint mono">{{ indice }}</p>
        <button class="btn-primary vt-go mt-6" :disabled="v.busy.value || !bootstrap.trim()" @click="doRegister">
          🔐 Créer une clé d'accès
        </button>
        <p class="muted vt-txt">
          Ton appareil demandera ensuite ton empreinte, ton visage ou ton code de
                    déverrouillage.
        </p>
      </template>
    </template>

    <!-- 2. Se déverrouiller -->
    <template v-else-if="statut === 'verrouille'">
      <p class="muted vt-txt">
        Déverrouille pour envoyer tes données et relever les propositions de Claude.
      </p>
      <button class="btn-primary vt-go mt-6" :disabled="v.busy.value" @click="doLogin">
        🔓 Déverrouiller
      </button>
    </template>

    <!-- 3. Ouvert -->
    <template v-else>
      <div class="row-between vt-row">
        <span class="muted">Copie des données</span>
        <span class="mono">{{ miroirLabel }}</span>
      </div>
      <p class="muted vt-txt">
        Copie de tes données que Claude peut lire. Elle sert aussi de sauvegarde.
      </p>
      <div class="nav-row mt-6">
        <button class="btn flex-1" :disabled="v.busy.value" @click="doPush">⬆ Envoyer maintenant</button>
        <button class="btn flex-1" @click="v.loadPending()">↻ Relever</button>
        <button class="btn flex-1" @click="v.logout()">Verrouiller</button>
      </div>
      <!-- Le double des clés, et c'est un PASSKEY, plus un mot de passe.
           Tant qu'il n'y en avait qu'un, perdre son téléphone imposait de garder
           valide pour toujours un code capable de tout rouvrir. Le second passkey
           supprime ce besoin : le code de démarrage redevient un code d'installation. -->
      <div class="vt-keys mt-6">
        <div class="row-between">
          <span class="muted">Appareils autorisés</span>
          <span class="mono">{{ appareils.length || v.state.value.passkeys || 1 }}</span>
        </div>
        <ul v-if="appareils.length" class="vt-keys-l">
          <li v-for="a in appareils" :key="a.id">
            <span>{{ a.label || 'Appareil' }} <small class="muted mono">· {{ a.at.slice(0, 10) }}</small></span>
            <button
              v-if="appareils.length > 1"
              class="vt-p-toggle"
              :disabled="v.busy.value"
              @click="v.revoquer(a.id)"
            >retirer</button>
          </li>
        </ul>
        <div v-if="appareils.length < 2" class="vt-warn mt-6">
          <b>Un seul appareil autorisé.</b> Le perdre coûterait un passage par l'hébergeur pour
                    revenir. Ajoute une clé d'accès depuis un autre appareil.
        </div>
        <input v-model="labelSecours" class="note-input mt-6" type="text" placeholder="Nom de l'appareil" maxlength="30">
        <button class="btn vt-go mt-6" :disabled="v.busy.value" @click="doSecours">
          ➕ Ajouter une clé d'accès
        </button>
        <p class="muted vt-txt">
          À faire depuis l'appareil à autoriser. Aucun code n'est demandé.
        </p>
      </div>

      <!-- Le dernier recours, quand TOUS les passkeys sont perdus. -->
      <button class="vt-p-toggle mt-6" @click="showReset = !showReset">
        {{ showReset ? '▲ Annuler' : 'Tout perdu ? Repartir de zéro' }}
      </button>
      <template v-if="showReset">
        <p class="muted vt-txt">
          Efface toutes les clés d'accès pour pouvoir en recréer une. Il faut le code du
                    dernier déploiement, lisible dans son journal.
        </p>
        <input v-model="bootstrap" class="note-input mono mt-6" type="text" inputmode="text" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Code du dernier déploiement">
        <button class="btn mt-6 vt-go" :disabled="!bootstrap.trim()" @click="doReset">🗝 Effacer les clés d'accès</button>
      </template>

      <!-- La boîte de réception n'est plus ici : elle s'ouvre depuis la cloche de
           l'en-tête, atteignable de tous les écrans. C'est la seule chose de
           l'application qui ATTEND quelque chose ; la ranger en bas des réglages
           revenait à espérer qu'on pense à venir voir. -->
    </template>

    <p v-if="v.error.value" class="vt-warn mt-6">{{ v.error.value }}</p>
  </div>

</template>
