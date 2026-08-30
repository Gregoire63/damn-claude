<script setup lang="ts">
import { computed, ref } from 'vue'
import { EATING_OUT_GROUPS } from '~/data/eatingOut'
import type { FreeMeal } from '~/lib/freeMeal'
import { useNutrition } from '~/composables/useNutrition'

/**
 * Saisir un repas qu'on n'a pas cuisiné.
 *
 * Elle s'ouvre depuis la feuille de choix d'un plat, parce que c'est là qu'on arrive
 * quand on cherche à changer son déjeuner et qu'on ne trouve rien qui corresponde —
 * la bibliothèque ne contient que ce qu'on prépare soi-même.
 *
 * Le formulaire est court par nécessité : on le remplit debout, avant de manger ou
 * juste après. D'où le catalogue en tête. Toucher « Kebab galette + frites » remplit
 * les quatre champs d'un coup ; on corrige ce qui ne va pas, ou rien.
 *
 * Les quatre valeurs plutôt que les seules calories : les protéines pilotent la
 * conservation du muscle en déficit, et la saisie rapide qui existait déjà les
 * mettait à zéro — un déjeuner à 900 kcal comptait alors pour 0 g de protéines et
 * faisait croire à un manque qui n'existait pas.
 */
const props = defineProps<{
  iso: string
  slotId: string
  slotLabel: string
  /** Le repas déjà saisi sur ce créneau, s'il y en a un — on le modifie alors. */
  current: FreeMeal | null
}>()
const emit = defineEmits<{ close: [], saved: [] }>()

const { setFreeMeal, addFreePreset, removeFreePreset, freePresets } = useNutrition()

const label = ref(props.current?.label ?? '')
const kcal = ref<string | number>(props.current ? props.current.kcal : '')
const p = ref<string | number>(props.current ? props.current.p : '')
const g = ref<string | number>(props.current ? props.current.g : '')
const l = ref<string | number>(props.current ? props.current.l : '')
const keep = ref(false)
const erreur = ref('')
const showCatalogue = ref(!props.current)

/**
 * D'où viennent les chiffres, si on ne les a pas retouchés.
 *
 * On garde l'instantané du pré-remplissage plutôt que de surveiller chaque frappe :
 * au moment d'enregistrer, ou bien les quatre valeurs sont celles du catalogue et la
 * provenance le dit, ou bien elles ont bougé et c'est devenu une saisie. Distinction
 * qui compte à la relecture : « 1050 kcal, ordre de grandeur d'un kebab courant » ne
 * se lit pas comme « 1200 kcal, ce que j'ai estimé ce jour-là ».
 */
const origine = ref<{ from: FreeMeal['from'], kcal: number, p: number, g: number, l: number } | null>(null)

function prefill(m: FreeMeal) {
  label.value = m.label
  kcal.value = m.kcal
  p.value = m.p
  g.value = m.g
  l.value = m.l
  origine.value = { from: m.from ?? 'saisie', kcal: m.kcal, p: m.p, g: m.g, l: m.l }
  showCatalogue.value = false
  erreur.value = ''
}

/**
 * Lit un champ de saisie, qu'il porte un texte ou un nombre.
 *
 * `v-model` sur un `<input type="number">` rend un NOMBRE, pas la chaîne qu'on y a
 * mise au pré-remplissage — Vue applique `.number` d'office sur ce type. Traiter le
 * contenu comme une chaîne marchait donc tant qu'on ne touchait à rien, et cassait
 * au premier caractère tapé. La virgule reste gérée pour les claviers français.
 */
const lire = (v: string | number): number => {
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? n : 0
}

/**
 * Ce que les macros saisies représentent en calories.
 *
 * Affiché, jamais imposé : 4/4/9 est une approximation, et les étiquettes s'en
 * écartent légitimement (fibres, polyols, arrondis du fabricant). Refuser une saisie
 * parce qu'elle ne tombe pas juste reviendrait à refuser la réalité au nom du modèle.
 * En revanche un écart de 300 kcal vient d'une faute de frappe, et le dire évite
 * d'enregistrer un repas faux sans s'en apercevoir.
 */
const controle = computed(() => {
  const k = lire(kcal.value)
  const somme = lire(p.value) * 4 + lire(g.value) * 4 + lire(l.value) * 9
  if (k <= 0 || somme <= 0) return null
  const ecart = Math.round(somme - k)
  return Math.abs(ecart) > Math.max(120, k * 0.25) ? ecart : null
})

function save() {
  const o = origine.value
  const intact = !!o && lire(kcal.value) === o.kcal && lire(p.value) === o.p
    && lire(g.value) === o.g && lire(l.value) === o.l
  const meal = {
    label: label.value,
    kcal: kcal.value,
    p: p.value,
    g: g.value,
    l: l.value,
    from: intact ? o!.from : 'saisie',
  } as unknown as Partial<FreeMeal>
  if (!setFreeMeal(props.iso, props.slotId, meal)) {
    erreur.value = 'Il faut au moins un nom et des calories.'
    return
  }
  if (keep.value) addFreePreset(meal)
  emit('saved')
}

function clear() {
  setFreeMeal(props.iso, props.slotId, null)
  emit('saved')
}
</script>

<template>
  <Sheet
    persistent
    sheet-class="free-sheet"
    :title="current ? 'Modifier ce repas' : 'Repas du dehors'"
    :subtitle="slotLabel"
    @close="emit('close')"
  >
    <template #default>
      <!-- Mes repas gardés d'abord : s'il y en a, c'est presque toujours l'un d'eux. -->
      <template v-if="freePresets.length">
        <div class="section-label">Mes repas du dehors</div>
        <div class="pk-list">
          <div v-for="m in freePresets" :key="m.label" class="pk-opt fm-opt">
            <button class="fm-pick" @click="prefill(m)">
              <span class="pk-name">{{ m.label }}</span>
              <span class="pk-left mono">{{ m.kcal }} kcal · {{ m.p }} g P</span>
            </button>
            <button class="nu-del" aria-label="Oublier" @click="removeFreePreset(m.label)">×</button>
          </div>
        </div>
      </template>

      <button class="fm-toggle" @click="showCatalogue = !showCatalogue">
        {{ showCatalogue ? '▲ Masquer les repas courants' : '▼ Partir d’un repas courant' }}
      </button>
      <template v-if="showCatalogue">
        <p class="muted fm-note">
          Des ordres de grandeur pour une portion courante, pas des valeurs d’étiquette.
          Touche pour remplir, puis corrige ce qui ne colle pas.
        </p>
        <template v-for="grp in EATING_OUT_GROUPS" :key="grp.nom">
          <div class="section-label">{{ grp.nom }}</div>
          <div class="pk-list">
            <button v-for="m in grp.plats" :key="m.id" class="pk-opt fm-opt" @click="prefill(m)">
              <span class="pk-name">{{ m.label }}</span>
              <span class="pk-left mono">{{ m.kcal }} kcal · {{ m.p }} g P</span>
            </button>
          </div>
        </template>
      </template>

      <div class="section-label mt-6">Ce que j’ai mangé</div>
      <div class="field"><span>Nom</span><input v-model="label" type="text" placeholder="Kebab galette + frites"></div>
      <div class="fm-grid">
        <label class="fm-num"><span>kcal</span><input v-model="kcal" type="number" inputmode="numeric" min="0" step="10" placeholder="1050"></label>
        <label class="fm-num"><span>Prot. (g)</span><input v-model="p" type="number" inputmode="numeric" min="0" step="1" placeholder="45"></label>
        <label class="fm-num"><span>Gluc. (g)</span><input v-model="g" type="number" inputmode="numeric" min="0" step="1" placeholder="95"></label>
        <label class="fm-num"><span>Lip. (g)</span><input v-model="l" type="number" inputmode="numeric" min="0" step="1" placeholder="50"></label>
      </div>

      <p v-if="controle" class="muted fm-note">
        ⚠️ Tes macros font {{ controle > 0 ? '+' : '' }}{{ controle }} kcal d’écart avec le total.
        Ça peut être normal, mais vérifie qu’il n’y a pas une faute de frappe.
      </p>

      <label v-if="!current" class="nu-task">
        <input v-model="keep" type="checkbox">
        <span>Garder ce repas pour le resservir</span>
      </label>

      <p v-if="erreur" class="nu-errors">⚠️ {{ erreur }}</p>

      <button class="btn-primary fm-save" :disabled="!label.trim() || !lire(kcal)" @click="save()">
        {{ current ? 'Mettre à jour' : 'Enregistrer ce repas' }}
      </button>
      <button v-if="current" class="btn fm-save" @click="clear()">↺ Revenir au plat prévu</button>
    </template>
  </Sheet>
</template>
