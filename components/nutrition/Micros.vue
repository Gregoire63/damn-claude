<script setup lang="ts">
import { computed } from 'vue'
import { SUPPLEMENTS } from '~/data/nutritionProgram'
import { useNutrition } from '~/composables/useNutrition'
import { microCoverage, weekDayPlans } from '~/lib/nutritionStats'

// Vue « Micros » : ce que le plan couvre réellement en micronutriments, et les seuls
// compléments qui se justifient. L'intérêt est de montrer ce qui va BIEN autant que
// ce qui manque — c'est ce qui évite d'empiler des gélules par précaution.
const { library, activeWeek, gymDays } = useNutrition()

// La couverture se calcule sur TA semaine, pas sur les quatorze jours livrés. Elle
// décrivait sinon le plan d'origine, c'est-à-dire l'assiette de personne dès qu'on
// avait changé un plat.
const coverage = computed(() => (activeWeek.value
  ? microCoverage(weekDayPlans(activeWeek.value, gymDays.value, library.value), library.value.foods)
  : []))
const gaps = computed(() => coverage.value.filter(c => c.status !== 'ok'))

// Barre plafonnée : au-delà de 200 % l'information utile est « largement couvert ».
const width = (pct: number) => Math.min(100, pct / 2)
</script>

<template>
  <div class="stack">
    <div class="card">
      <div class="section-label">Couverture de ta semaine</div>
      <p class="mt-6 muted">
        Moyenne par jour sur les sept jours de la semaine que tu as choisie — les jours
        d'absence ne comptent pas. Vitamine C des légumes minorée de 35 % pour la cuisson.
        Comparé aux références ANSES pour un homme adulte.
      </p>
    </div>

    <div v-if="gaps.length" class="card nu-gap">
      <div class="nu-gap-title">
        {{ gaps.length === 1 ? 'Un seul nutriment n\'est pas couvert' : `${gaps.length} nutriments ne sont pas couverts` }}
      </div>
      <p class="nu-note">
        <template v-for="(g, i) in gaps" :key="g.key">
          <strong>{{ g.label }}</strong> à {{ g.pct }} %<span v-if="i < gaps.length - 1">, </span>
        </template>.
        Tout le reste est au-dessus de la référence — l'assiette fait déjà le travail,
        ce n'est pas la peine d'empiler des compléments « par sécurité ».
      </p>
    </div>

    <div class="card no-pad">
      <div v-for="c in coverage" :key="c.key" class="nu-micro" :class="c.status">
        <div class="nu-micro-top">
          <span class="nu-micro-name">{{ c.label }}</span>
          <span class="mono nu-micro-val">
            {{ c.perDay }} / {{ c.ref }} {{ c.unit }}
            <strong>{{ c.pct }} %</strong>
          </span>
        </div>
        <div class="nu-micro-track">
          <div class="nu-micro-fill" :style="{ width: `${width(c.pct)}%` }" />
          <div class="nu-micro-ref" />
        </div>
      </div>
    </div>
    <p class="muted center">Le trait vertical marque 100 % de la référence. L'échelle s'arrête à 200 %.</p>

    <div class="section-label">Ce qui vaut la peine d'être complété</div>
    <div v-for="s in SUPPLEMENTS" :key="s.id" class="card nu-supp">
      <div class="row-between">
        <strong class="nu-supp-name">{{ s.name }}</strong>
        <span class="mono nu-supp-dose">{{ s.dose }}</span>
      </div>
      <div class="muted">{{ s.when }}</div>
      <p class="nu-supp-why">{{ s.why }}</p>
      <p v-if="s.caution" class="nu-steps">⚠️ {{ s.caution }}</p>
    </div>

    <div class="card nu-warn">
      <div class="section-label">À garder en tête</div>
      <p class="nu-note">
        Ces chiffres sont calculés sur des tables de composition, pas sur ton sang. Ils
        disent que le plan <em>apporte</em> de quoi couvrir tes besoins — pas que tu
        <em>absorbes</em> tout, ni où tu en es aujourd'hui. Si tu veux savoir, une prise de
        sang avec vitamine D, ferritine et NFS répond en une fois, et coûte moins cher
        qu'un an de compléments pris à l'aveugle.
      </p>
      <p class="nu-note">
        Sel : ce plan est cuisiné maison, donc naturellement pauvre en sodium. Avec 3 L d'eau
        par jour et de la transpiration en salle, sale tes plats normalement — l'excès de
        restriction n'a pas d'intérêt ici.
      </p>
    </div>
  </div>
</template>
