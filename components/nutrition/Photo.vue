<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { usePhotos } from '~/composables/usePhotos'

// Bouton photo d'un plat, réutilisé dans la bibliothèque, la todo de cuisine et
// la journée. Une photo par plat : la nouvelle remplace l'ancienne.

const props = withDefaults(defineProps<{
  /** Identifiant du plat. C'est la clé de stockage. */
  id: string
  /** Nom affiché dans l'aperçu plein écran. */
  label?: string
  /** `sm` en ligne de liste, `md` en pastille de carte, `cover` en bandeau. */
  size?: 'sm' | 'md' | 'cover'
}>(), { label: '', size: 'sm' })

const { has, metaOf, put, remove, urlOf, download, busy, error } = usePhotos()

// Erreur LOCALE : `error` est partagée par le module, l'afficher directement
// ferait apparaître le message sous les vingt boutons photo de la liste à la fois.
const localErr = ref<string | null>(null)
// Deux entrées distinctes, et c'est la seule façon d'offrir les deux : l'attribut
// `capture` ouvre l'appareil photo et interdit alors de choisir une image existante.
// Un seul input obligeait donc à trancher — soit photographier, soit choisir.
const input = ref<HTMLInputElement | null>(null)
const camera = ref<HTMLInputElement | null>(null)
const thumb = ref<string | null>(null)
const fullUrl = ref<string | null>(null)
const open = ref(false)
// L'aperçu plein écran n'est pas une `Sheet` : il n'hérite donc pas du geste
// « retour » que `useOverlay` donne à toutes les feuilles. Sans ça, refermer une
// photo au retour quitterait l'application — le pire endroit pour ça, puisqu'on
// l'ouvre d'un doigt en pleine liste de plats.
useBackGuard(open, () => { open.value = false })

const meta = computed(() => metaOf(props.id))
const loading = computed(() => busy.value === props.id)

// Plus d'illustration de repli. Elles étaient volontairement floues et abstraites
// pour « situer » le plat, mais une image floue reste une image : on la lit comme
// une photo ratée, pas comme un placeholder. Mieux vaut une place vide et un bouton
// clair que du décor qui ment.
const shown = computed(() => thumb.value)

// Une couverture de carte réclame la taille intermédiaire ; une pastille de 38 px
// se contente de la vignette. Servir la vignette partout était la cause du flou.
async function refresh() {
  const kind = props.size === 'cover' ? 'card' : 'thumb'
  thumb.value = has(props.id) ? await urlOf(props.id, kind) : null
}
watch(() => [props.id, props.size, meta.value?.at] as const, refresh, { immediate: true })

/** Choisir une image déjà prise : le plat est souvent photographié avant qu'on pense à l'appli. */
function pick() { input.value?.click() }
/** Photographier maintenant, appareil arrière : le geste normal quand la boîte est devant soi. */
function shoot() { camera.value?.click() }

async function saveToPhone() {
  await download(props.id, props.label || props.id)
}

async function onFile(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  localErr.value = null
  if (file && !(await put(props.id, file))) localErr.value = error.value
  // Réinitialise la valeur : sans ça, reprendre le MÊME fichier ne déclenche
  // aucun événement `change` et la reprise d'une photo semble ne rien faire.
  const el = e.target as HTMLInputElement
  if (el) el.value = ''
}

async function preview() {
  fullUrl.value = await urlOf(props.id, 'full')
  open.value = true
}

async function drop() {
  await remove(props.id)
  open.value = false
}

onUnmounted(() => { open.value = false })
</script>

<template>
  <div class="nu-photo" :class="size">
    <input ref="input" type="file" accept="image/jpeg,image/png,image/webp" class="nu-photo-input" @change="onFile">
    <input ref="camera" type="file" accept="image/*" capture="environment" class="nu-photo-input" @change="onFile">

    <button
      v-if="shown"
      class="nu-photo-thumb" :class="{ demo: isDemo }"
      :title="`Photo — ${meta?.at.replace('T', ' à ')}`"
      @click="preview()"
    >
      <img :src="shown" alt="" loading="lazy">
      <span v-if="loading" class="nu-photo-badge">…</span>
    </button>

    <!-- Sans photo : DEUX boutons, pas un. Photographier maintenant et choisir une
         image existante sont deux gestes différents, et un seul bouton obligeait à
         deviner lequel il déclenchait. -->
    <div v-else-if="size === 'cover'" class="nu-photo-empty">
      <span class="nu-photo-empty-ico">🍽</span>
      <div class="nu-photo-empty-acts">
        <button class="btn" :disabled="loading" @click="shoot">📷 Prendre une photo</button>
        <button class="btn" :disabled="loading" @click="pick">🖼 Choisir une image</button>
      </div>
    </div>
    <button v-else class="nu-photo-add" :disabled="loading" :title="`Photographier${label ? ` — ${label}` : ''}`" @click="shoot">
      {{ loading ? '…' : '📷' }}
    </button>

    <!-- Aperçu plein format + actions. Les blobs pleins ne sont chargés qu'ici :
         la liste ne décode que des vignettes de 192 px. -->
    <Teleport to="body">
      <div v-if="open" class="sport-app sport-portal">
        <div class="nu-photo-overlay" @click.self="open = false">
          <div class="nu-photo-box">
            <img v-if="fullUrl" :src="fullUrl" :alt="label">
            <div class="nu-photo-meta">
              <div>
                <div class="nu-photo-name">{{ label || 'Plat' }}</div>
                <!-- La date, rien de plus : les dimensions et le poids du fichier
                     n'aident personne à cuisiner, et une appli qui affiche des
                     kilo-octets à côté d'une assiette parle d'elle, pas du plat. -->
                <div class="mono">{{ meta?.at.replace('T', ' à ') }}</div>
              </div>
              <div class="nu-photo-acts">
                <button class="btn" :disabled="loading" @click="shoot">📷 Reprendre</button>
                <button class="btn" :disabled="loading" @click="pick">Choisir</button>
                <button class="btn" @click="saveToPhone">⬇ Enregistrer</button>
                <button class="btn ghost danger" @click="drop">Supprimer</button>
                <button class="btn ghost" @click="open = false">Fermer</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Teleport>

    <p v-if="localErr" class="nu-photo-err">{{ localErr }}</p>
  </div>
</template>
