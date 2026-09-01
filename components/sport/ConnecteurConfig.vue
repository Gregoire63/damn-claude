<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

/**
 * Les identifiants d'une marque : d'où ils viennent, et comment les poser.
 *
 * Ce bloc existe en composant parce qu'il s'affiche à DEUX endroits — déplié dans les
 * réglages, et dans une fenêtre depuis le parcours d'installation. Recopier le
 * formulaire aux deux endroits, c'était la garantie que l'un des deux prenne du retard
 * sur l'autre.
 *
 * Il ne remplace pas tout : l'URL de retour doit être déclarée dans la console de la
 * marque, et aucune API ne permet de le faire à sa place. Ce qu'il supprime, c'est
 * l'aller-retour par l'interface de l'hébergeur et le redéploiement — la marche qui
 * rendait ce dépôt inutilisable par quelqu'un d'autre.
 */
const props = defineProps<{
  marque: {
      id: string
      label: string
      icone: string
      note: string
      /** Adresse de la console développeur de la marque. Publique, et connue sans session. */
      console?: string
      raison?: string
      configurable?: boolean
    }
}>()
const emit = defineEmits<{ flash: [msg: string, ton?: 'ok' | 'echec'], change: [] }>()

interface EtatConfig {
  id: string
  origine: 'env' | 'coffre' | null
  clientId: string
  at: string
  lisible: boolean
  console: string
  env: { id: string, secret: string }
}

const etat = ref<EtatConfig | null>(null)
const erreur = ref('')
/** Vrai quand seule une clé d'accès manque : ce n'est pas une panne, c'est une étape. */
const verrouille = ref(false)
const clientId = ref('')
const secret = ref('')
const enCours = ref(false)
const copie = ref(false)

async function charger() {
  erreur.value = ''
  verrouille.value = false
  try {
    const r = await $fetch<{ marques: EtatConfig[] }>('/api/connect/config')
    etat.value = r.marques.find(m => m.id === props.marque.id) ?? null
  }
  catch (e) {
    // 401 : il faut une clé d'accès. Ce n'est pas une erreur de configuration, et le
    // dire évite de chercher une panne là où il manque simplement une étape.
    if ((e as { status?: number }).status === 401) verrouille.value = true
    else erreur.value = 'Configuration illisible pour l’instant.'
  }
}
onMounted(charger)

const urlRetour = computed(() =>
  (import.meta.client ? `${location.origin}/api/connect/${props.marque.id}/callback` : `/api/connect/${props.marque.id}/callback`))

async function copier() {
  try {
    await navigator.clipboard.writeText(urlRetour.value)
    copie.value = true
    setTimeout(() => { copie.value = false }, 2500)
  }
  catch { emit('flash', 'Copie impossible. Sélectionne l’adresse manuellement.', 'echec') }
}

async function poser() {
  if (!clientId.value.trim() || !secret.value.trim()) {
    emit('flash', 'Identifiant et secret sont requis', 'echec')
    return
  }
  enCours.value = true
  try {
    await $fetch('/api/connect/config', {
      method: 'POST',
      body: { marque: props.marque.id, clientId: clientId.value.trim(), clientSecret: secret.value.trim() },
    })
    clientId.value = ''
    secret.value = ''
    emit('flash', `${props.marque.label} configuré ✓`)
    await charger()
    emit('change')
  }
  catch (e) {
    emit('flash', (e as { data?: { statusMessage?: string } }).data?.statusMessage ?? 'Enregistrement refusé', 'echec')
  }
  finally { enCours.value = false }
}

async function retirer() {
  try {
    await $fetch(`/api/connect/config?marque=${encodeURIComponent(props.marque.id)}`, { method: 'DELETE' })
    emit('flash', `Identifiants de ${props.marque.label} retirés`)
    await charger()
    emit('change')
  }
  catch { emit('flash', 'Suppression impossible', 'echec') }
}

/** Les variables d'hébergement, à afficher même sans session : elles sont l'autre
 *  chemin, et c'est le seul disponible tant qu'aucune clé d'accès n'existe. */
/** L'adresse de la console vient de la fiche publique ; le coffre ne fait que la
 *  confirmer. Sans ça, la première étape n'était cliquable qu'une fois authentifié —
 *  c'est-à-dire trop tard. */
const console = computed(() => props.marque.console || etat.value?.console || '')

const noms = computed(() => {
  const M = props.marque.id.toUpperCase().replace(/[^A-Z0-9]/g, '_')
  return etat.value?.env ?? { id: `NUXT_${M}_CLIENT_ID`, secret: `NUXT_${M}_CLIENT_SECRET` }
})
</script>

<template>
  <div class="cc">
    <!-- 1. La marque elle-même bloque : la raison, et rien qui ressemble à un bouton. -->
    <template v-if="props.marque.raison && props.marque.configurable === false">
      <p class="muted">{{ props.marque.raison }}</p>
    </template>

    <!-- 2. Déjà configuré : par qui, et comment le défaire. -->
    <template v-else-if="etat?.origine === 'env'">
      <p class="muted">
        Configuré par ton hébergeur, avec la variable <b>{{ noms.id }}</b>. Elle reste
        prioritaire : rien à faire ici.
      </p>
    </template>
    <template v-else-if="etat?.origine === 'coffre'">
      <p class="muted">
        Identifiants enregistrés le {{ (etat.at || '').slice(0, 10) }}.
        <template v-if="!etat.lisible">
          <b class="export-warn">Illisibles</b> : ils ont été chiffrés avec une autre valeur
          de NUXT_VAULT_SECRET. Ressaisis-les.
        </template>
      </p>
      <button class="btn btn-bloc" @click="retirer">Retirer les identifiants</button>
    </template>

    <!-- 3. À configurer : la marche à suivre, puis le formulaire. -->
    <template v-else>
      <p class="muted">{{ props.marque.note }}</p>
      <ol class="conn-pas">
        <li>
                  <template v-if="console">
                    <a :href="console" target="_blank" rel="noopener">Crée une application</a> chez la marque.
                  </template>
                  <template v-else>Crée une application chez la marque.</template>
                </li>
        <li>
          Déclare cette URL de retour, à l'identique :
          <code class="conn-url mono">{{ urlRetour }}</code>
          <button class="btn conn-mini" @click="copier">{{ copie ? 'Copié ✓' : '⧉ Copier' }}</button>
        </li>
        <li>Reporte ici l'identifiant et le secret obtenus.</li>
      </ol>

      <!-- Sans clé d'accès, le formulaire ne peut pas aboutir : on le dit, et on donne
           l'autre chemin plutôt que d'afficher deux champs qui échoueront. -->
      <div v-if="verrouille" class="vt-warn">
        <b>Clé d'accès requise.</b> Crée-la à l'étape <b>Claude</b>, ou déverrouille
        l'application, pour enregistrer des identifiants depuis ici.
      </div>
      <template v-else>
        <p v-if="erreur" class="muted export-warn">⚠️ {{ erreur }}</p>
        <label class="field"><span>Identifiant (client ID)</span>
          <input v-model="clientId" type="text" autocomplete="off" spellcheck="false" placeholder="Identifiant"></label>
        <label class="field"><span>Secret (client secret)</span>
          <input v-model="secret" type="password" autocomplete="off" placeholder="Secret"></label>
        <button class="btn-primary btn-bloc" :disabled="enCours" @click="poser">
          {{ enCours ? 'Enregistrement…' : '🔐 Enregistrer' }}
        </button>
      </template>

      <p class="muted">
        Le secret est chiffré et n'est jamais renvoyé au navigateur. Il peut aussi être
        posé chez l'hébergeur — <b>{{ noms.id }}</b> et <b>{{ noms.secret }}</b> —, qui
        restent prioritaires.
      </p>
    </template>
  </div>
</template>
