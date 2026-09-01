<script setup lang="ts">
import { computed } from 'vue'
import type { Exercise } from '~/data/sportProgram'
import { EXERCISE_GEAR, GEAR_LABELS, variantsOf } from '~/data/exerciseVariants'
import type { Gear } from '~/data/exerciseVariants'
import { useWorkout } from '~/composables/useWorkout'
import { usePhotos, gearPhotoId } from '~/composables/usePhotos'
import { topWeight } from '~/utils/sportStats'

/**
 * « Je ne peux pas le faire ici » — et la suite de la phrase.
 *
 * Le rack est pris, la machine est occupée, une épaule tire. Jusqu'ici la seule
 * réponse de l'app était de cocher « autre matériel », ce qui coupait l'historique
 * en deux : records remis à zéro, courbe interrompue, conseil de charge amnésique.
 * Le jour où l'on a le plus besoin d'un repère, on le perdait.
 *
 * Cette feuille répond aux deux questions qu'on se pose vraiment devant la machine
 * de remplacement : qu'est-ce qui travaille les mêmes muscles, et JE METS COMBIEN.
 * Le second chiffre est le seul qui compte sur le moment ; le premier est ce qui
 * permet à la courbe de rester lisible ensuite.
 */
const props = defineProps<{ ex: Exercise, current: string | null }>()
const emit = defineEmits<{ close: [], pick: [id: string | null] }>()

const { suggestWeight, ratioFor, lastOn } = useWorkout()
const { put, remove, has, busy } = usePhotos()

/**
 * La photo de LA machine, prise sur place.
 *
 * `capture="environment"` ouvre directement l'appareil arrière sur mobile : le
 * geste utile est « je suis devant l'engin, je le prends », pas « je fouille ma
 * galerie ». Elle est rangée dans le même stockage que les photos de plats — même
 * redimensionnement, même persistance — dans un espace de noms séparé, pour que le
 * nettoyage de la bibliothèque de plats ne les emporte pas.
 */
async function shoot(id: string, ev: Event) {
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = '' // pour que reprendre la même photo redéclenche l'événement
  if (file) await put(gearPhotoId(id), file)
}

interface Row {
  id: string | null
  /** Clé de photo : la variante, ou l'exercice lui-même pour la référence. */
  key: string
  gear: Gear
  name: string
  hint: string
  why: string
  weight: number
  ratio: number
  source: 'reference' | 'measured' | 'default'
  sessions: number
  lastKg: number | null
}

function rowFor(id: string | null, gear: Gear, name: string, hint: string, why: string): Row {
  const v = id ?? undefined
  const r = ratioFor(props.ex.id, v)
  const last = lastOn(props.ex.id, v)
  return {
    id,
    key: id ?? props.ex.id,
    gear,
    name,
    hint,
    why,
    weight: suggestWeight(props.ex, v).weight,
    ratio: r.ratio,
    source: r.source,
    sessions: r.sessions,
    lastKg: last ? topWeight(last.sets) : null,
  }
}

const rows = computed<Row[]>(() => [
  rowFor(
    null,
    EXERCISE_GEAR[props.ex.id] ?? 'barre',
    props.ex.name,
    props.ex.machine || `${props.ex.sets} × ${props.ex.reps}`,
    'C\'est le mouvement du programme : tout le reste se compare à lui.',
  ),
  ...variantsOf(props.ex.id).map(v => rowFor(v.id, v.gear, v.name, v.hint, v.why)),
])

const nf = (n: number) => n.toLocaleString('fr-FR', { maximumFractionDigits: 2 })

/** Le coefficient ET sa provenance. Un chiffre sans provenance ne se conteste pas. */
function ratioLabel(r: Row): string {
  if (r.source === 'reference') return 'référence'
  if (r.source === 'measured') return `×${nf(r.ratio)} · mesuré sur ${r.sessions} séance${r.sessions > 1 ? 's' : ''}`
  return `×${nf(r.ratio)} · estimé`
}
</script>

<template>
  <!-- Une FENÊTRE, pas une feuille : elle s'ouvre par-dessus la feuille de séance,
       et deux feuilles du bas empilées se confondent. Et téléportée dans <body> par
       Popup — écrite ici, au milieu de la séance, elle était découpée aux bords de
       la feuille qui défile. Voir components/Popup.vue. -->
  <Popup
    popup-class="variant-popup"
    title="Remplacer cet exercice"
    :subtitle="`${ex.name} · ${rows.length} façons de travailler les mêmes muscles`"
    @close="emit('close')"
  >
    <template #default>
      <div class="vr-list">
        <div
          v-for="r in rows" :key="r.id ?? 'ref'"
          class="vr-opt" :class="{ on: (r.id ?? null) === current, ref: r.id === null }"
        >
          <!-- La vignette EST le bouton photo : on est devant la machine, un tap
               l'ouvre à l'appareil arrière. -->
          <label class="vr-shot" :class="{ busy: busy === gearPhotoId(r.key) }">
            <SportGearThumb :id="r.key" :gear="r.gear" :label="r.name" />
            <span class="vr-cam">{{ has(gearPhotoId(r.key)) ? '🔄' : '📷' }}</span>
            <input type="file" accept="image/*" capture="environment" class="vr-file" @change="shoot(r.key, $event)">
          </label>
          <button
            v-if="has(gearPhotoId(r.key))"
            class="vr-del" aria-label="Supprimer la photo"
            @click="remove(gearPhotoId(r.key))"
          >✕</button>

          <button class="vr-pick" @click="emit('pick', r.id)">
            <span class="vr-top">
              <span class="vr-name">{{ r.name }}</span>
              <span v-if="(r.id ?? null) === current" class="vr-check">✓</span>
            </span>
            <span class="vr-load">
              <span v-if="r.weight" class="vr-kg mono">{{ nf(r.weight) }} kg</span>
              <span v-else class="vr-kg mono muted">à toi de voir</span>
              <span class="vr-ratio mono" :class="r.source">{{ ratioLabel(r) }}</span>
              <span class="vr-gear mono muted">{{ GEAR_LABELS[r.gear] }}</span>
              <span v-if="r.lastKg" class="vr-last mono muted">déjà fait à {{ nf(r.lastKg) }} kg</span>
            </span>
            <span class="vr-hint">{{ r.hint }}</span>
            <span v-if="r.id" class="vr-why muted">↳ {{ r.why }}</span>
          </button>
        </div>
      </div>

      <p class="muted vr-foot">
        📷 Le dessin donne la silhouette du matériel. Touche-le pour le remplacer par une
                <b>photo de la machine de ta salle</b>. La photo reste sur cet appareil.
      </p>

      <!-- Dire ce que le choix fait, et ce qu'il ne fait pas. -->
      <p class="muted vr-foot">
        La charge affichée est celle <b>de cette machine</b>. Courbe et paliers restent
                calculés en équivalent «&nbsp;{{ ex.name }}&nbsp;» pour rester continus ; les
                <b>records</b> sont conservés par machine.
      </p>
      <p class="muted vr-foot">
        Les coefficients marqués <b>estimé</b> sont des ordres de grandeur. Ils seront
                remplacés par ton rapport réel dès que les deux mouvements auront été faits dans
                les mêmes semaines.
      </p>
    </template>
  </Popup>
</template>
