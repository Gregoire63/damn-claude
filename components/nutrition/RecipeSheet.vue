<script setup lang="ts">
import { computed, ref } from 'vue'
import { useFoyer } from '~/composables/useFoyer'
import { useNutrition } from '~/composables/useNutrition'
import type { ConvivesRepas } from '~/lib/foyer'
import { convivesParDefaut, facteurRepas, libelleRepas, partDeMoi, pourConvives } from '~/lib/foyer'
import { useRepasConvives } from '~/composables/useRepasConvives'
import { FAT_STEPS, expandItems, keepsOf, macrosOf, rebalanceDairy, roundMacros, splitIngredients } from '~/lib/nutritionStats'
import { cookedWeight } from '~/lib/cooked'

// LA fiche d'un plat : photo, ingrédients, recette. Une seule, ouverte depuis
// n'importe quelle carte de l'application.
//
// Il y en avait une version réduite recopiée dans la journée, et les cartes de la
// bibliothèque ne s'ouvraient pas du tout : on lisait trois lignes d'ingrédients
// tronquées et il fallait passer par le bouton « modifier » pour voir la recette —
// c'est-à-dire ouvrir un formulaire d'édition pour lire un mode d'emploi.
/**
 * `date` et `slot` sont facultatifs, et c'est ce qui distingue deux lectures.
 *
 * Ouverte depuis une JOURNÉE, la fiche sait quel repas on prépare : les convives
 * s'enregistrent pour ce repas-là, et un invité ajouté ce soir ne suit pas la
 * recette pour toujours. Ouverte depuis le catalogue, elle n'a aucun repas sous la
 * main : elle montre alors le foyer courant, sans rien retenir.
 */
const props = defineProps<{ id: string, date?: string, slot?: string }>()
const emit = defineEmits<{ close: [] }>()

const { cookedRatios, library, setFatPct, fatPct, dairyFoods } = useNutrition()

const KIND_LABELS: Record<string, string> = {
  pdj: 'Petit-déjeuner',
  boite: 'Déjeuner (boîte)',
  diner: 'Dîner',
  collation: 'Collation',
  sauce: 'Sauce / condiment',
}

const recipe = computed(() => library.value.recipes[props.id] ?? null)
const sauce = computed(() => {
  const sid = recipe.value?.sauce
  return sid ? library.value.recipes[sid] ?? null : null
})
const foodName = (id: string) => library.value.foods[id]?.name ?? id
const foodBuy = (id: string) => library.value.foods[id]?.buy ?? ''

/** Macros du plat TEL QU'IL SE MANGE, sauce comprise : c'est ce qu'on avale. */
const macros = computed(() => (recipe.value
  ? roundMacros(macrosOf(expandItems(recipe.value, library.value), library.value.foods))
  : null))
const sauceMacros = computed(() => (sauce.value
  ? roundMacros(macrosOf(sauce.value.items, library.value.foods))
  : null))
const keeps = computed(() => (recipe.value ? keepsOf(recipe.value, library.value) : null))

/**
 * Cuisiner pour le foyer, et ce que le facteur ne touche PAS.
 *
 * Les grammages affichés sont ceux à peser : ils suivent la somme des appétits de
 * ceux qui sont au repas (voir lib/foyer.ts). Les MACROS, elles, ne bougent pas —
 * c'est ce que tu manges, ta part, et la seule chose que ce suivi mesure. Les
 * multiplier ferait entrer dans ton bilan ce que quelqu'un d'autre a avalé.
 *
 * Le poids cuit suit les grammages : c'est le même aliment, pesé pour tout le monde.
 */
const foyer = useFoyer()
const repasConvives = useRepasConvives()

/** Le repas préparé, quand on vient d'une journée. Sinon : pas de repas, pas d'enregistrement. */
const ancre = computed(() => (props.date && props.slot ? { date: props.date, slot: props.slot } : null))
const convives = computed<ConvivesRepas>(() => (ancre.value
  ? repasConvives.pour(ancre.value.date, ancre.value.slot)
  : convivesParDefaut(foyer.convives.value)))

const facteur = computed(() => facteurRepas(convives.value, foyer.convives.value))
const pese = (g: number) => pourConvives(g, facteur.value)

/** Ce qui revient à MOI dans la casserole, entre 0 et 1. */
const maPart = computed(() => partDeMoi(convives.value, foyer.convives.value))
const libelle = computed(() => libelleRepas(convives.value, foyer.convives.value))

function majConvives(c: ConvivesRepas) {
  if (ancre.value) { repasConvives.definir(ancre.value.date, ancre.value.slot, c); return }
  /*
   * Hors d'une journée, il n'y a aucun repas à annoter : on règle le foyer lui-même,
   * ce que faisait déjà la fiche ouverte depuis le catalogue. Un invité, lui, n'a
   * nulle part où aller — son bouton ne s'affiche donc pas dans ce cas, plutôt que
   * d'accepter un geste sans effet.
   */
  for (const m of foyer.convives.value) {
    if (m.id === 'moi') continue
    foyer.modifier(m.id, { actif: c.membres.includes(m.id) })
  }
}

function basculerMembre(id: string) {
  if (id === 'moi') return
  const c = convives.value
  majConvives(c.membres.includes(id)
    ? { ...c, membres: c.membres.filter(m => m !== id) }
    : { ...c, membres: [...c.membres, id] })
}

/** Un invité de ce soir : un appétit, un nom facultatif, et rien dans le foyer. */
const nouvelInvite = ref({ nom: '', appetit: 1 })
const ajoutInvite = ref(false)
function ajouterInvite() {
  const c = convives.value
  majConvives({ ...c, invites: [...c.invites, { nom: nouvelInvite.value.nom.trim() || 'Invité', appetit: nouvelInvite.value.appetit }] })
  nouvelInvite.value = { nom: '', appetit: 1 }
  ajoutInvite.value = false
}
function retirerInvite(i: number) {
  const c = convives.value
  majConvives({ ...c, invites: c.invites.filter((_, n) => n !== i) })
}

/**
 * Ce qu'on met dans SON assiette, en poids CUIT.
 *
 * On pèse cru pour cuisiner — c'est la référence des macros — mais on sert cuit :
 * le riz a doublé, la viande a perdu un quart. Annoncer une part en poids cru
 * obligerait à faire la conversion de tête, une louche à la main.
 *
 * Le total est la somme des ingrédients dont on connaît le poids cuit ; ceux qu'on
 * ne sait pas convertir sont comptés tels quels plutôt qu'oubliés — mieux vaut une
 * somme franche qu'un total qui ment par omission.
 */
const monAssiette = computed(() => {
  const lignes = [...split.value.dish, ...split.value.sauce].map((l) => {
    const total = pese(l.total)
    const c = cuit(l.food, l.total)
    const cuitTotal = c === null ? total : pese(c)
    return {
      food: l.food,
      nom: dairy(l.food) ? dairyName(l.food) : foodName(l.food),
      grammes: Math.round(cuitTotal * maPart.value),
      estime: c === null,
    }
  }).filter(l => l.grammes > 0)
  /*
   * « Cuit » n'est vrai que si quelque chose cuit.
   *
   * Un bol de fromage blanc n'a aucun ingrédient qui change à la cuisson : annoncer
   * « g cuit » y serait faux, et répéter « poids cru » sur chacune des cinq lignes
   * ne fait que du bruit. On le dit une fois, en tête, et les mentions par ligne ne
   * servent plus que dans le cas MIXTE — un plat où le riz est converti et l'huile
   * ne l'est pas.
   */
  const converti = lignes.some(l => !l.estime)
  return {
    lignes: lignes.map(l => ({ ...l, estime: l.estime && converti })),
    total: lignes.reduce((n, l) => n + l.grammes, 0),
    cuit: converti,
  }
})
const detailAssiette = ref(false)

/**
 * Les ingrédients, en DEUX listes titrées : le plat, puis le pot.
 *
 * Elles portent les grammages RÉELLEMENT à peser, taux de matière grasse déclaré
 * compris. `rebalanceDairy` est appliqué ici comme il l'est dans la journée : sans lui,
 * la fiche annoncerait 200 g de fromage blanc pendant que le plan en sert 100, et on
 * pèserait le chiffre de la fiche.
 */
const split = computed(() => {
  const r = recipe.value
  if (!r) return { dish: [], sauce: [], sauceName: null }
  const balanced = { ...r, items: rebalanceDairy(r.items, library.value.foods) }
  return splitIngredients(balanced, library.value)
})

/**
 * Le poids une fois cuit, quand il est connu. `null` partout ailleurs.
 *
 * On passe le total SAUCE COMPRISE, parce que c'est bien tout ce qui finit dans la
 * casserole qu'on va peser. Aucun féculent n'entre dans une sauce aujourd'hui, mais
 * s'y fier reviendrait à laisser le chiffre devenir faux le jour où ça change.
 */
const cuit = (foodId: string, totalG: number) =>
  cookedWeight(foodId, totalG, { mesures: cookedRatios.value })

/**
 * Les laitiers de ce plat dont le taux se règle, avec le taux déclaré.
 *
 * On interroge `dairyFoods`, qui juge sur la fiche AVANT application du taux — et pas
 * `library`, qui la porte après. La nuance a coûté un bug : `isAdjustableDairy` exige
 * un produit maigre au départ (moins de 1 g de lipides), donc dès qu'on déclarait 5 %
 * le fromage blanc cessait d'être « réglable » et le bouton disparaissait. On se
 * retrouvait bloqué sur son propre choix, sans moyen de revenir à 0 %.
 */
const adjustable = computed(() => new Map(dairyFoods.value.map(d => [d.base.id, d])))
const dairy = (id: string) => adjustable.value.get(id) ?? null

/**
 * Le nom sans son « 0 % » quand un autre taux est déclaré : « Fromage blanc 0 % »
 * affiché à côté d'un bouton « 5 % de MG », c'est la fiche qui se contredit.
 */
const dairyName = (id: string) => {
  const d = dairy(id)
  const name = library.value.foods[id]?.name ?? id
  return d && d.pct ? name.replace(/\s*\d+([.,]\d+)?\s*%\s*$/, '') : name
}
const openFat = ref<string | null>(null)
</script>

<template>
  <Sheet v-if="recipe" sheet-class="rs" @close="emit('close')">
      <!-- La photo occupe le bord haut de la feuille et lui sert de poignée : on la
           tire vers le bas pour fermer. Le composant Sheet porte le découpage aux
           coins arrondis et le geste. -->
      <template #cover>
        <NutritionPhoto :id="recipe.id" :label="recipe.name" size="cover" />
      </template>

      <template #head>
        <div>
          <div class="rs-kind mono">
            {{ KIND_LABELS[recipe.kind] ?? recipe.kind }}
            <template v-if="recipe.batch"> · se prépare à l'avance</template>
          </div>
          <div class="sheet-title">{{ recipe.name }}</div>
          <div v-if="macros" class="muted mono">
            {{ macros.kcal }} kcal · {{ macros.p }} P / {{ macros.g }} G / {{ macros.l }} L
            <template v-if="facteur !== 1"> · <b>ta part</b></template>
            <template v-if="keeps"> · se garde {{ keeps }} j au frigo</template>
          </div>
        </div>
      </template>

      <template #default>
        <!-- DEUX listes titrées. Une annotation collée au nom ne portait pas la
             distinction « dans la poêle » / « dans le pot » : elle se lisait comme une
             note de bas de page alors que c'est une étape de la recette. -->
        <!--
          Qui mange, coché ICI et pas dans les réglages : c'est le geste qui change
          d'un soir à l'autre, et il doit se faire là où l'on pèse. L'appétit de
          chacun, lui, se déclare une fois pour toutes dans Réglages → Foyer.

          La barre ne s'affiche que si le foyer compte quelqu'un d'autre : pour qui
          cuisine seul, cette notion n'existe pas et n'a pas à occuper une ligne.
        -->
        <div class="rs-convives">
          <button
            v-for="c in foyer.convives.value" :key="c.id"
            class="rs-conv" :class="{ on: convives.membres.includes(c.id), fige: c.id === 'moi' }"
            :disabled="c.id === 'moi'"
            :aria-pressed="convives.membres.includes(c.id)"
            @click="basculerMembre(c.id)"
          >
            {{ c.nom }}<span v-if="c.id !== 'moi'" class="mono rs-conv-p">{{ Math.round(c.appetit * 100) }}%</span>
          </button>
          <!-- Un invité ne rentre pas dans le foyer pour un dîner : on l'ajoute ici,
               il repart avec le repas. Le bouton n'apparaît que si l'on prépare un
               repas identifié — sinon il n'y aurait nulle part où le ranger. -->
          <button
            v-for="(i, n) in convives.invites" :key="`i${n}`"
            class="rs-conv on rs-invite" @click="retirerInvite(n)"
          >
            {{ i.nom }}<span class="mono rs-conv-p">{{ Math.round(i.appetit * 100) }}%</span> ✕
          </button>
          <button v-if="ancre && !ajoutInvite" class="rs-conv rs-plus" @click="ajoutInvite = true">+ invité</button>
          <span v-if="facteur !== 1" class="mono rs-facteur">×{{ facteur.toFixed(2).replace(/[.,]?0+$/, '').replace('.', ',') }}</span>
        </div>

        <div v-if="ajoutInvite" class="rs-ajout">
          <input v-model="nouvelInvite.nom" class="note-input flex-1" placeholder="Prénom (facultatif)" maxlength="24">
          <div class="fo-appetit">
            <button class="btn fo-pm" aria-label="Moins" @click="nouvelInvite.appetit = Math.max(0.1, Math.round((nouvelInvite.appetit - 0.1) * 100) / 100)">−</button>
            <span class="fo-part mono">{{ Math.round(nouvelInvite.appetit * 100) }} %</span>
            <button class="btn fo-pm" aria-label="Plus" @click="nouvelInvite.appetit = Math.min(3, Math.round((nouvelInvite.appetit + 0.1) * 100) / 100)">+</button>
          </div>
          <button class="btn-primary" @click="ajouterInvite">Ajouter</button>
        </div>

        <!--
          Ce qu'on met dans SON assiette, et pourquoi c'est en poids CUIT.

          On pèse cru pour cuisiner — c'est la référence des macros — mais on sert
          cuit : le riz a doublé, la viande a perdu un quart. Une part annoncée en
          poids cru obligerait à faire la conversion de tête, une louche à la main.

          Sans ce bloc, la fiche donnait les quantités pour tout le monde et des
          macros « pour ta part » sans jamais dire quelle fraction de la casserole
          c'était : on servait à vue, donc on mangeait autre chose que ce que
          l'application comptait.
        -->
        <div v-if="maPart < 1 && monAssiette.total" class="rs-assiette">
          <button class="rs-assiette-h" @click="detailAssiette = !detailAssiette">
            <span>
              <b>Dans ton assiette</b>
              <span class="muted"> · {{ Math.round(maPart * 100) }} % du plat</span>
            </span>
            <span class="mono rs-assiette-t">≈ {{ monAssiette.total }} g{{ monAssiette.cuit ? ' cuit' : '' }}</span>
            <span class="rs-assiette-c" aria-hidden="true">{{ detailAssiette ? '▲' : '▼' }}</span>
          </button>
          <ul v-if="detailAssiette" class="rs-items rs-assiette-l">
            <li v-for="l in monAssiette.lignes" :key="l.food" class="rs-item">
              <span class="rs-q mono">{{ l.grammes }} g</span>
              <span class="rs-n">{{ l.nom }}<span v-if="l.estime" class="muted"> · poids cru, cuisson inconnue</span></span>
            </li>
          </ul>
        </div>

        <div class="section-label">
          {{ sauce ? 'Pour le plat' : 'Ingrédients' }}
          <span v-if="facteur !== 1" class="muted">· pour {{ libelle.toLowerCase() }}</span>
        </div>
        <ul class="rs-items">
          <li v-for="l in split.dish" :key="l.food" class="rs-item">
            <span class="rs-q mono">
              {{ pese(l.g) }} g
              <!-- Le poids une fois cuit, pour les féculents seulement : ce sont les
                   seuls qu'on ne peut pas répartir en les comptant. -->
              <small v-if="cuit(l.food, l.total)" class="rs-cuit">≈ {{ pese(cuit(l.food, l.total)!) }} g cuit</small>
            </span>
            <span class="rs-n">
              {{ dairy(l.food) ? dairyName(l.food) : foodName(l.food) }}
              <span v-if="l.total > l.g" class="muted">{{ pese(l.total) }} g en tout avec la sauce</span>
              <span v-else-if="foodBuy(l.food)" class="muted">{{ foodBuy(l.food) }}</span>
              <!-- Le taux se règle ICI, sur l'ingrédient, au moment où on a le pot en
                   main. Le réglage existait déjà mais vivait dans un autre onglet :
                   inutilisable à 9 h du matin devant un fromage blanc à 3 %. -->
              <button
                v-if="dairy(l.food)"
                class="rs-fat" :class="{ set: dairy(l.food)!.pct }"
                @click="openFat = openFat === l.food ? null : l.food"
              >{{ dairy(l.food)!.pct ? `${dairy(l.food)!.pct} % de MG` : 'autre taux de MG ?' }}</button>
              <span v-if="openFat === l.food" class="rs-fat-steps">
                <button
                  v-for="step in FAT_STEPS" :key="step"
                  class="rs-fat-step" :class="{ on: dairy(l.food)!.pct === step }"
                  @click="setFatPct(l.food, step); openFat = null"
                >{{ step }} %</button>
              </span>
            </span>
          </li>
        </ul>
        <p class="muted italic rs-raw">
          Viandes, poissons et féculents sont pesés crus : c'est la référence des macros.
        </p>

        <!-- La sauce a sa propre liste ET sa préparation : c'est un pot à part, on ne
             la mélange pas au plat. -->
        <template v-if="sauce">
          <div class="section-label">Pour la sauce — {{ sauce.name }}</div>
          <ul class="rs-items">
            <li v-for="l in split.sauce" :key="l.food" class="rs-item">
              <span class="rs-q mono">{{ pese(l.g) }} g</span>
              <span class="rs-n">
                {{ dairy(l.food) ? dairyName(l.food) : foodName(l.food) }}
                <span v-if="l.total > l.g" class="muted">{{ l.total }} g en tout avec le plat</span>
                <!-- Le yaourt grec des sauces est un laitier comme un autre : il se
                     règle ici aussi, sinon le réglage manquerait sur tous les dîners. -->
                <button
                  v-if="dairy(l.food)"
                  class="rs-fat" :class="{ set: dairy(l.food)!.pct }"
                  @click="openFat = openFat === `s:${l.food}` ? null : `s:${l.food}`"
                >{{ dairy(l.food)!.pct ? `${dairy(l.food)!.pct} % de MG` : 'autre taux de MG ?' }}</button>
                <span v-if="openFat === `s:${l.food}`" class="rs-fat-steps">
                  <button
                    v-for="step in FAT_STEPS" :key="step"
                    class="rs-fat-step" :class="{ on: dairy(l.food)!.pct === step }"
                    @click="setFatPct(l.food, step); openFat = null"
                  >{{ step }} %</button>
                </span>
              </span>
            </li>
          </ul>
          <p class="nu-note">{{ sauce.steps }}</p>
          <p v-if="sauceMacros" class="muted mono rs-raw">
            Elle compte pour {{ sauceMacros.kcal }} kcal et {{ sauceMacros.p }} g de protéines,
            déjà inclus dans le total en haut de la fiche.
          </p>
        </template>

        <div class="section-label">La recette</div>
        <p class="nu-steps rs-steps">{{ recipe.steps }}</p>

        <button class="btn rs-done" @click="emit('close')">Fermer</button>
    </template>
  </Sheet>
</template>
