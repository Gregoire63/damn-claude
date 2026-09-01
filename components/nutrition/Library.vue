<script setup lang="ts">
import { computed, ref } from 'vue'
import { CAT_LABELS, CAT_ORDER } from '~/data/nutritionProgram'
import type { FoodCat, Recipe, RecipeItem, RecipeKind } from '~/data/nutritionProgram'
import { useNutrition } from '~/composables/useNutrition'
import { usePhotos } from '~/composables/usePhotos'
import { FAT_STEPS, expandItems, macrosOf, roundMacros, validateFood, validateRecipe } from '~/lib/nutritionStats'

// Vue « Plats » : la bibliothèque complète, consultable et extensible.
// Tout ce qui est livré avec le plan est modifiable, et tout ce qui manque peut être
// créé — sinon on reste prisonnier d'une table de 31 aliments.
const {
  library, addRecipe, patchRecipe, removeRecipe, resetRecipe, isCustomRecipe, isRecipePatched,
  toggleRecipeActive, isRecipeActive, addFood, isCustomFood,
  dairyFoods, setFatPct, dairyCost,
} = useNutrition()

// Ménage des photos dont le plat a disparu : sans ça, supprimer un plat laisse son
// image en base pour toujours. Le total occupé, lui, ne s'affiche plus — le poids
// des fichiers n'aide personne à cuisiner.
const { prune, metas } = usePhotos()
const orphans = computed(() => Object.keys(metas.value).filter(id => !library.value.recipes[id]))
const pruning = ref(false)
async function cleanPhotos() {
  pruning.value = true
  await prune(Object.keys(library.value.recipes))
  pruning.value = false
}

type Tab = 'plats' | 'aliments' | 'micros'
const tab = ref<Tab>('plats')

const KINDS: { id: RecipeKind, label: string }[] = [
  { id: 'boite', label: 'Déjeuner (boîte)' },
  { id: 'diner', label: 'Dîner' },
  { id: 'pdj', label: 'Petit-déjeuner' },
  { id: 'collation', label: 'Collation' },
  { id: 'sauce', label: 'Sauce / condiment' },
]

// ─── Filtres ─────────────────────────────────────────────────────────────────
//
// Trente-cinq plats dans une grille, ça ne se parcourt plus : on cherche « du
// poisson » ou « une sauce », pas « la sixième carte ». Deux axes, parce que ce
// sont les deux questions qu'on se pose — à quel moment de la journée, et avec
// quoi dedans.
type Base = 'viande' | 'poisson' | 'oeufs' | 'vege'
const BASES: { id: Base, label: string, foods: string[] }[] = [
  { id: 'viande', label: '🍗 Viande', foods: ['filet-de-poulet', 'escalope-de-dinde', 'steak-hache-5'] },
  { id: 'poisson', label: '🐟 Poisson', foods: ['cabillaud-colin', 'saumon', 'thon-au-naturel-egoutte'] },
  { id: 'oeufs', label: '🥚 Œufs', foods: ['ufs-entiers'] },
  { id: 'vege', label: '🌱 Sans viande', foods: [] },
]
const ANIMAL = new Set(BASES.flatMap(b => b.foods))
const kindFilter = ref<RecipeKind | null>(null)
const baseFilter = ref<Base | null>(null)
const search = ref('')

/** Le plat contient-il cette base ? « Sans viande » se déduit de l'absence des autres. */
function matchesBase(r: Recipe, base: Base): boolean {
  const ids = r.items.map(i => i.food)
  if (base === 'vege') return !ids.some(i => ANIMAL.has(i))
  return ids.some(i => BASES.find(b => b.id === base)!.foods.includes(i))
}

const allRecipes = computed(() => Object.values(library.value.recipes)
  .map(r => ({ r, macros: roundMacros(macrosOf(expandItems(r, library.value), library.value.foods)) }))
  .sort((a, b) => KINDS.findIndex(k => k.id === a.r.kind) - KINDS.findIndex(k => k.id === b.r.kind)
    || a.r.name.localeCompare(b.r.name)))

const recipes = computed(() => {
  const q = search.value.trim().toLowerCase()
  return allRecipes.value.filter(({ r }) => {
    if (kindFilter.value && r.kind !== kindFilter.value) return false
    if (baseFilter.value && !matchesBase(r, baseFilter.value)) return false
    if (q && !r.name.toLowerCase().includes(q)
      && !r.items.some(i => (library.value.foods[i.food]?.name ?? '').toLowerCase().includes(q))) return false
    return true
  })
})
const countOfKind = (k: RecipeKind) => allRecipes.value.filter(x => x.r.kind === k).length
function clearFilters() {
  kindFilter.value = null
  baseFilter.value = null
  search.value = ''
}

// La fiche d'un plat, ouverte au clic sur sa carte.
const sheetId = ref<string | null>(null)

const foods = computed(() => CAT_ORDER
  .map(cat => ({ cat, items: Object.values(library.value.foods).filter(f => f.cat === cat).sort((a, b) => a.name.localeCompare(b.name)) }))
  .filter(g => g.items.length))

// ─── Éditeur de plat ─────────────────────────────────────────────────────────
const draft = ref<(Partial<Recipe> & { items: RecipeItem[] }) | null>(null)
const draftId = ref<string | null>(null)
const errors = ref<string[]>([])
const pickFood = ref('')
const pickG = ref('')

const draftMacros = computed(() => (draft.value ? roundMacros(macrosOf(draft.value.items, library.value.foods)) : null))

function newRecipe() {
  draftId.value = null
  draft.value = { name: '', kind: 'diner', batch: false, steps: '', items: [] }
  errors.value = []
}
function editRecipe(id: string) {
  const r = library.value.recipes[id]
  if (!r) return
  draftId.value = id
  draft.value = { ...r, items: r.items.map(i => ({ ...i })) }
  errors.value = []
}
function addItem() {
  const g = Number.parseInt(pickG.value, 10)
  if (!draft.value || !pickFood.value || !Number.isFinite(g) || g <= 0) return
  draft.value.items = [...draft.value.items.filter(i => i.food !== pickFood.value), { food: pickFood.value, g }]
  pickFood.value = ''
  pickG.value = ''
}
const dropItem = (food: string) => {
  if (draft.value) draft.value.items = draft.value.items.filter(i => i.food !== food)
}

function saveRecipe() {
  if (!draft.value) return
  const errs = validateRecipe(draft.value, library.value)
  errors.value = errs.map(e => e.message)
  if (errs.length) return
  const payload = {
    name: draft.value.name!.trim(),
    kind: draft.value.kind as RecipeKind,
    batch: !!draft.value.batch,
    steps: draft.value.steps?.trim() || '',
    items: draft.value.items,
  }
  if (draftId.value) patchRecipe(draftId.value, payload)
  else addRecipe(payload)
  draft.value = null
  draftId.value = null
}

// ─── Éditeur d'aliment ───────────────────────────────────────────────────────
const foodDraft = ref<{ name: string, cat: FoodCat, kcal: string, p: string, g: string, l: string } | null>(null)
const foodErrors = ref<string[]>([])

const newFood = () => {
  foodDraft.value = { name: '', cat: 'viandes', kcal: '', p: '', g: '', l: '' }
  foodErrors.value = []
}
function saveFood() {
  if (!foodDraft.value) return
  const d = foodDraft.value
  const parsed = {
    name: d.name.trim(),
    cat: d.cat,
    kcal: Number.parseFloat(d.kcal.replace(',', '.')),
    p: Number.parseFloat(d.p.replace(',', '.')),
    g: Number.parseFloat(d.g.replace(',', '.')),
    l: Number.parseFloat(d.l.replace(',', '.')),
  }
  const errs = validateFood(parsed)
  foodErrors.value = errs.map(e => e.message)
  if (errs.length) return
  addFood(parsed)
  foodDraft.value = null
}

const foodName = (id: string) => library.value.foods[id]?.name ?? id
const kindLabel = (k: RecipeKind) => KINDS.find(x => x.id === k)?.label ?? k
</script>

<template>
  <div class="stack">
    <div class="nav-row">
      <button class="btn" :class="{ sel: tab === 'plats' }" @click="tab = 'plats'">Plats</button>
      <button class="btn" :class="{ sel: tab === 'aliments' }" @click="tab = 'aliments'">Aliments</button>
      <button class="btn" :class="{ sel: tab === 'micros' }" @click="tab = 'micros'">Micros</button>
    </div>

    <NutritionMicros v-if="tab === 'micros'" />

    <!-- ─── Plats ─────────────────────────────────────────────────────── -->
    <template v-if="tab === 'plats'">
      <button class="btn-primary" @click="newRecipe()">＋ Créer un plat</button>
      <p class="muted">
        Calories et macros sont calculées à partir des ingrédients. Un plat mis de côté
                reste consultable mais n'apparaît plus dans le planning.
      </p>

      <!-- Ne reste que ce sur quoi on peut agir. Le total occupé s'affichait ici :
           un chiffre qu'on ne peut ni changer ni utiliser, à côté de photos de
           gamelles. Les orphelines, elles, se nettoient d'un bouton. -->
      <div v-if="orphans.length" class="nu-photo-usage">
        <span class="flex-1">📷 {{ orphans.length }} photo(s) de plats supprimés à nettoyer.</span>
        <button class="btn" :disabled="pruning" @click="cleanPhotos">Nettoyer</button>
      </div>

      <!-- Deux axes de filtre : le moment de la journée, et ce qu'il y a dedans.
           Ce sont les deux seules questions qu'on se pose devant trente-cinq plats. -->
      <div class="card nu-filters">
        <input v-model="search" class="nu-search" type="search" placeholder="Chercher un plat ou un ingrédient…">
        <div class="nu-filt-row">
          <button class="nu-filt" :class="{ on: !kindFilter }" @click="kindFilter = null">Tout</button>
          <button
            v-for="k in KINDS" :key="k.id"
            class="nu-filt" :class="{ on: kindFilter === k.id }"
            @click="kindFilter = kindFilter === k.id ? null : k.id"
          >
            {{ k.label }} <span class="nu-filt-n mono">{{ countOfKind(k.id) }}</span>
          </button>
        </div>
        <div class="nu-filt-row">
          <button
            v-for="b in BASES" :key="b.id"
            class="nu-filt" :class="{ on: baseFilter === b.id }"
            @click="baseFilter = baseFilter === b.id ? null : b.id"
          >
            {{ b.label }}
          </button>
          <button v-if="kindFilter || baseFilter || search" class="nu-filt clear" @click="clearFilters()">✕ Effacer</button>
        </div>
      </div>

      <p v-if="!recipes.length" class="muted center">
        Aucun plat ne correspond. <button class="btn" @click="clearFilters()">Effacer les filtres</button>
      </p>

      <!-- Grille qui se réorganise seule : une liste d'une carte par ligne obligeait
           à faire défiler seize écrans pour retrouver un plat, alors qu'on les
           reconnaît à leur image bien avant de lire leur nom. -->
      <div class="nu-grid">
        <article v-for="{ r, macros } in recipes" :key="r.id" class="card nu-plat" :class="{ off: !isRecipeActive(r.id) }">
          <NutritionPhoto :id="r.id" :label="r.name" size="cover" />
          <div class="nu-plat-body">
            <div class="nu-plat-kind mono">
              {{ kindLabel(r.kind) }}<template v-if="r.batch"> · à l'avance</template>
              <span v-if="isCustomRecipe(r.id)" class="nu-tag mine">perso</span>
            </div>
            <h4 class="nu-plat-name">{{ r.name }}</h4>
            <div class="nu-plat-macros">
              <span class="nu-plat-kcal mono">{{ macros.kcal }}</span>
              <span class="mono muted">{{ macros.p }} P · {{ macros.g }} G · {{ macros.l }} L</span>
            </div>
            <!-- Le corps de la carte ouvre la fiche. Les boutons du bas restent des
                 actions à part : on ne supprime pas un plat en voulant le lire. -->
            <button class="nu-plat-open" @click="sheetId = r.id">
              <span class="nu-plat-items muted">{{ r.items.map(i => `${foodName(i.food)} ${i.g} g`).join(' · ') }}</span>
              <span class="nu-plat-more">Voir la recette →</span>
            </button>
            <!-- La sauce se prépare à part mais se mange bien : ses calories sont
                 déjà dans le compteur ci-dessus, il faut donc la voir. -->
            <p v-if="r.sauce" class="nu-plat-sauce">🥣 avec {{ library.recipes[r.sauce]?.name ?? r.sauce }}</p>
            <div class="nu-plat-acts">
              <button class="btn" @click="editRecipe(r.id)">✎</button>
              <button class="btn" :class="{ sel: !isRecipeActive(r.id) }" @click="toggleRecipeActive(r.id)">
                {{ isRecipeActive(r.id) ? 'De côté' : 'Réactiver' }}
              </button>
              <button v-if="isCustomRecipe(r.id)" class="btn" @click="removeRecipe(r.id)">✕</button>
              <!-- Uniquement sur les plats RÉELLEMENT modifiés : leurs grammages
                   locaux écrasent ceux du programme, y compris après une mise à
                   jour. Affiché partout, ce bouton ne disait rien ; affiché ici, il
                   pointe exactement les plats qui ne suivent plus le plan. -->
              <button
                v-else-if="isRecipePatched(r.id)" class="btn warn"
                title="Ce plat a été modifié : il garde tes grammages et ignore les mises à jour du programme"
                @click="resetRecipe(r.id)"
              >↺ modifié</button>
            </div>
          </div>
        </article>
      </div>
    </template>

    <!-- ─── Aliments ──────────────────────────────────────────────────── -->
    <template v-else-if="tab === 'aliments'">
      <button class="btn-primary" @click="newFood()">＋ Ajouter un aliment</button>
      <p class="muted">
        Valeurs pour 100 g, telles qu'indiquées sur l'emballage. Pour les viandes, poissons
                et féculents, utilise celles du produit <b>cru</b> : c'est la base de tous les calculs.
      </p>

      <!-- Le plan est écrit en 0 %, le rayon n'en a pas toujours. Sans ce réglage,
           acheter du 3 % ajoute 154 kcal par jour que rien n'affiche. -->
      <div class="card nu-fat">
        <div class="section-label mb-8">Taux de matière grasse acheté</div>
        <p class="muted mb-8">
          Les recettes supposent la version la plus maigre. Indique ici le taux réellement
                    acheté : les quantités sont ajustées en conséquence.
        </p>
        <div v-for="d in dairyFoods" :key="d.food.id" class="nu-fat-row">
          <div class="nu-fat-name">
            <span>
              {{ d.base.name }}
              <span v-if="d.pct" class="nu-tag mine">acheté en {{ d.pct }} %</span>
            </span>
            <small class="mono">{{ d.food.kcal }} kcal · {{ d.food.p }} P / {{ d.food.l }} L</small>
          </div>
          <div class="nu-fat-steps">
            <button
              v-for="step in FAT_STEPS" :key="step"
              class="nu-fat-step" :class="{ on: d.pct === step }"
              :aria-pressed="d.pct === step"
              @click="setFatPct(d.food.id, step)"
            >{{ step }} %</button>
          </div>
        </div>
        <div v-if="dairyCost" class="nu-fat-cost">
          <b>Ce que ça coûte, par jour</b>
          <div class="nu-fat-cost-grid mono">
            <span>Laitier</span><span>{{ dairyCost.grams }} g</span>
            <span>Calories</span><span>{{ dairyCost.kcal > 0 ? '+' : '' }}{{ dairyCost.kcal }} kcal</span>
            <span>Protéines</span><span>{{ dairyCost.p > 0 ? '+' : '' }}{{ dairyCost.p }} g</span>
            <span>Lipides</span><span>{{ dairyCost.l > 0 ? '+' : '' }}{{ dairyCost.l }} g</span>
          </div>
          <small>
            Sans ajustement, ce taux ajouterait <b>{{ dairyCost.rawKcal }} kcal</b> par jour.
                        La réduction des quantités en compense la majeure partie ; il reste
                        <b>{{ dairyCost.kcal > 0 ? '+' : '' }}{{ dairyCost.kcal }} kcal</b>, absorbées par
                        l'ajustement du soir.
            <template v-if="dairyCost.l > 6">
              Les lipides restent élevés : ils viennent du produit lui-même.
            </template>
          </small>
        </div>
      </div>

      <div v-for="g in foods" :key="g.cat" class="card no-pad">
        <h4 class="nu-cat-title">{{ CAT_LABELS[g.cat] }}</h4>
        <div v-for="f in g.items" :key="f.id" class="nu-foodline">
          <span class="flex-1">
            {{ f.name }}
            <span v-if="isCustomFood(f.id)" class="nu-tag mine">perso</span>
          </span>
          <span class="mono muted">{{ f.kcal }} kcal · {{ f.p }} P / {{ f.g }} G / {{ f.l }} L</span>
        </div>
      </div>
    </template>

    <!-- ─── Éditeur de plat ───────────────────────────────────────────── -->
    <Teleport to="body">
      <div class="sport-app sport-portal">
        <transition name="sheet">
          <NutritionRecipeSheet v-if="sheetId" :id="sheetId" @close="sheetId = null" />
        </transition>
      </div>
    </Teleport>

    <transition name="sheet">
      <!-- `persistent` : un formulaire à moitié rempli ne doit pas disparaître sur un
           clic à côté. On en sort par la croix, Échap ou le glissement — trois gestes
           délibérés. -->
      <Sheet
        v-if="draft" persistent
        :title="draftId ? 'Modifier le plat' : 'Nouveau plat'"
        @close="draft = null"
      >

          <div class="field"><span>Nom</span><input v-model="draft.name" type="text" placeholder="Poulet, riz, brocolis"></div>
          <div class="field">
            <span>Type de repas</span>
            <SportSelect v-model="draft.kind" :options="KINDS.map(k => ({ key: k.id, label: k.label }))" />
          </div>

          <div class="section-label">Ingrédients</div>
          <div v-for="it in draft.items" :key="it.food" class="nu-ing">
            <span>{{ foodName(it.food) }}</span>
            <span class="mono">{{ it.g }} g
              <button class="nu-del" aria-label="Retirer" @click="dropItem(it.food)">×</button>
            </span>
          </div>
          <div class="nu-quick">
            <select v-model="pickFood" class="select">
              <option value="">Choisir un aliment…</option>
              <optgroup v-for="g in foods" :key="g.cat" :label="CAT_LABELS[g.cat]">
                <option v-for="f in g.items" :key="f.id" :value="f.id">{{ f.name }}</option>
              </optgroup>
            </select>
            <input v-model="pickG" type="number" inputmode="numeric" min="0" step="5" placeholder="g">
            <button class="btn" @click="addItem()">＋</button>
          </div>

          <div v-if="draftMacros" class="nu-energy">
            <span><b>{{ draftMacros.kcal }}</b> kcal</span>
            <span><b>{{ draftMacros.p }}</b> g prot.</span>
            <span><b>{{ draftMacros.g }}</b> g gluc.</span>
            <span><b>{{ draftMacros.l }}</b> g lip.</span>
          </div>

          <div class="field"><span>Préparation</span><textarea v-model="draft.steps" rows="3" placeholder="Comment tu le fais" /></div>
          <label class="nu-task">
            <input v-model="draft.batch" type="checkbox">
            <span>Se prépare à l'avance en batch cooking</span>
          </label>

          <div v-if="errors.length" class="nu-errors">
            <div v-for="(e, i) in errors" :key="i">⚠️ {{ e }}</div>
          </div>
          <button class="btn-primary" @click="saveRecipe()">Enregistrer</button>
      </Sheet>
    </transition>

    <!-- ─── Éditeur d'aliment ─────────────────────────────────────────── -->
    <transition name="sheet">
      <Sheet v-if="foodDraft" persistent title="Nouvel aliment" @close="foodDraft = null">
          <div class="field"><span>Nom</span><input v-model="foodDraft.name" type="text" placeholder="Skyr nature"></div>
          <div class="field">
            <span>Rayon</span>
            <SportSelect v-model="foodDraft.cat" :options="CAT_ORDER.map(c => ({ key: c, label: CAT_LABELS[c] }))" />
          </div>
          <div class="nu-quad">
            <label class="field"><span>kcal / 100 g</span><input v-model="foodDraft.kcal" type="number" inputmode="decimal" step="1"></label>
            <label class="field"><span>Protéines</span><input v-model="foodDraft.p" type="number" inputmode="decimal" step="0.1"></label>
            <label class="field"><span>Glucides</span><input v-model="foodDraft.g" type="number" inputmode="decimal" step="0.1"></label>
            <label class="field"><span>Lipides</span><input v-model="foodDraft.l" type="number" inputmode="decimal" step="0.1"></label>
          </div>
          <div v-if="foodErrors.length" class="nu-errors">
            <div v-for="(e, i) in foodErrors" :key="i">⚠️ {{ e }}</div>
          </div>
          <p class="muted">
            Un contrôle vérifie la cohérence entre les macros et les calories saisies.
          </p>
          <button class="btn-primary" @click="saveFood()">Enregistrer</button>
      </Sheet>
    </transition>
  </div>
</template>
