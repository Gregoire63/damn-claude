import { useEnergy } from '~/composables/useEnergy'
import { useNow } from '~/composables/useNow'
import { useNutrition } from '~/composables/useNutrition'
import { adjustRemaining, adjustSignature, applySteps, dayStatus, isDayPlayed, sumMacros } from '~/lib/nutritionStats'
import type { AdjustPlan, DayPlan, DayStatus } from '~/lib/nutritionStats'

// ─────────────────────────────────────────────────────────────────────────────
// La journée alimentaire, telle qu'elle sera vraiment mangée.
// ─────────────────────────────────────────────────────────────────────────────
//
// Deux écrans la construisaient : l'accueil et l'onglet Nutrition. Même séquence —
// le plan de base, ce qui est déjà avalé, l'ajustement du soir conseillé, puis le
// plan effectif si l'ajustement a été confirmé — mais deux fois, avec des gardes qui
// ne coïncidaient pas tout à fait.
//
// C'est la même journée. Elle ne peut pas afficher deux nombres de calories
// restantes selon l'écran par lequel on la regarde, et pourtant rien n'empêchait
// qu'elle le fasse : il suffisait qu'une des deux copies gagne une condition que
// l'autre n'aurait pas.
//
// L'ajustement mérite une mention particulière, parce que c'est là que le risque est
// le plus sournois. Ce n'est PAS une correction automatique : c'est un conseil —
// « retire 100 g de riz du dîner » — et tant qu'on n'a pas confirmé l'avoir suivi,
// les compteurs doivent afficher le plan D'ORIGINE. Un écran qui l'appliquerait
// d'office pendant que l'autre attend la confirmation ferait mentir l'un des deux
// toute la soirée, dans le sens qui pousse à se resservir.

export interface DayView {
  /** Le plan tel que la semaine le prévoit, avant tout ajustement. */
  base: DayPlan
  /** Le plan EFFECTIF : ajustement appliqué seulement s'il a été confirmé. */
  plan: DayPlan
  /** Calories déjà avalées : repas cochés + extras notés. */
  eatenKcal: number
  /**
   * Le conseil du soir, calculé même sur une journée passée — c'est lui qu'on
   * réapplique quand il a été confirmé, le stockage n'en gardant que l'empreinte.
   */
  adjustment: AdjustPlan | null
  /** Le conseil à AFFICHER. `null` sur une journée déjà vécue : il n'y a plus rien
   *  à proposer, seulement à constater. */
  suggestion: AdjustPlan | null
  /** Empreinte du conseil : une confirmation expire si le conseil change. */
  signature: string
  /** Le conseil a-t-il été confirmé comme suivi ? */
  confirmed: boolean
  /** État de la séance du jour — `pending` tant qu'elle est prévue et pas faite. */
  status: DayStatus
  /** A-t-on (ou va-t-on) s'entraîner ? Décide des portions de féculents. */
  trained: boolean
}

export function useDayPlan() {
  const {
    dayPlanFor, dayFor, eatenSlots, extrasFor, prepMode, library, isAdjustApplied,
  } = useNutrition()
  const { energyOn, burnOn, recordsOn, today } = useEnergy()
  const { nowHour } = useNow()

  /**
   * La journée d'une date.
   *
   * @param past Journée rattrapée depuis le Journal, et non vécue. On ne conseille
   *   alors aucun ajustement : le dîner est déjà mangé, retirer du riz après coup
   *   n'a pas de sens et fausserait le compte de ce qui a été avalé.
   */
  function viewOf(iso: string, opts: { past?: boolean } = {}): DayView {
    const burn = burnOn(iso)
    const trained = burn > 0
    const base = dayPlanFor(iso, trained)

    const done = new Set(eatenSlots(iso))
    const extras = extrasFor(iso).map(e => ({ kcal: e.kcal, p: e.p, g: e.g, l: e.l }))
    const eatenKcal = sumMacros([
      ...base.meals.filter(m => done.has(m.slot)).map(m => m.macros),
      ...extras,
    ]).kcal

    const j = dayFor(iso)
    const status = dayStatus({
      planned: j.gym,
      recorded: recordsOn(iso).length,
      skipped: !j.gym,
      isPast: isDayPlayed(iso, today(), nowHour.value),
    })

    const energy = energyOn(iso)
    /**
     * Le conseil se CALCULE toujours, même sur une journée passée.
     *
     * On ne le PROPOSE pas pour autant — c'est ce que fait `suggestion` plus bas.
     * Mais il faut le calculer, parce que c'est lui qu'on réapplique quand il a été
     * confirmé ce jour-là : le stockage ne garde qu'une empreinte, pas le plan. Ne
     * pas le recalculer revenait à oublier, en relisant le Journal, qu'on avait
     * vraiment retiré 100 g de riz ce soir-là — et à relire des macros qui n'ont
     * jamais été dans l'assiette.
     *
     * Tant que la séance n'a pas eu lieu, en revanche, rien : sa dépense réelle peut
     * encore doubler ou s'annuler, et un dîner allégé sur une estimation qui bouge
     * est un dîner allégé pour rien.
     */
    const adjustment = (!energy || status === 'pending')
      ? null
      : adjustRemaining(base, energy.target, eatenSlots(iso), eatenKcal, prepMode.value, library.value.foods)

    const signature = adjustSignature(adjustment)
    const confirmed = isAdjustApplied(iso, signature)

    return {
      base,
      // Appliqué DÈS QU'IL A ÉTÉ CONFIRMÉ, hier comme aujourd'hui. Un conseil non
      // confirmé reste un conseil : les compteurs montrent le plan d'origine.
      plan: applySteps(base, confirmed ? adjustment : null, library.value.foods),
      eatenKcal,
      adjustment,
      // Ce qu'on OFFRE de faire. Sur une journée déjà vécue, il n'y a plus rien à
      // proposer : le dîner est mangé, alléger après coup n'a pas de sens.
      suggestion: opts.past ? null : adjustment,
      signature,
      confirmed,
      status,
      trained,
    }
  }

  return { viewOf }
}
