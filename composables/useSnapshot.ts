import { useWorkout } from '~/composables/useWorkout'
import { useProfile } from '~/composables/useProfile'
import { useNutrition } from '~/composables/useNutrition'
import { useMesures } from '~/composables/useMesures'
import { useRestTimer } from '~/composables/useRestTimer'
import { useFractionne } from '~/composables/useFractionne'
import { useFoyer } from '~/composables/useFoyer'
import { useProgram } from '~/composables/useProgram'
import { useRepasConvives } from '~/composables/useRepasConvives'
import { useActivites } from '~/composables/useActivites'

/**
 * L'instantané complet des données, en un seul endroit.
 *
 * Il alimente DEUX choses : l'export manuel et le miroir envoyé au coffre. Les
 * assembler séparément, c'était la garantie qu'un jour l'un des deux oublierait une
 * clé — et qu'on ne s'en apercevrait qu'en essayant de restaurer, ou en voyant le
 * connecteur répondre « je n'ai aucune séance ». C'est d'ailleurs exactement ce qui
 * s'est produit à la première version : le miroir partait sans `logs`, `sessions`
 * ni `bodyWeight`.
 *
 * Ce qui n'y est PAS, et ne doit jamais y être : les jetons Withings. `snapshot()`
 * du module Withings ne rend que les pesées, et c'est délibéré depuis le début —
 * un jeton dans un export, c'est un jeton dans un fichier qui traîne.
 */
export function useSnapshot() {
  const { logs, bodyWeight, sessionHistory } = useWorkout()
  const { profile, weekPlan, planDays } = useProfile()
  const { exportData } = useNutrition()
  const { snapshot: mesuresData } = useMesures()
  const { snapshot: timerData } = useRestTimer()
  const { snapshot: fractionneData } = useFractionne()
  const { snapshot: programData } = useProgram()
  const foyer = useFoyer()
  const repasConvives = useRepasConvives()
  const activites = useActivites()

  function buildSnapshot(): Record<string, unknown> {
    return {
      logs: logs.value,
      bodyWeight: bodyWeight.value,
      sessions: sessionHistory.value,
      profile: profile.value,
      weekPlan: weekPlan.value,
      planDays: planDays.value,
      nutrition: exportData(),
      ...mesuresData(),
      ...timerData(),
      ...fractionneData(),
      ...programData(),
      /*
       * Le foyer part avec le reste, et ça débloque deux choses d'un coup.
       *
       * Il est dans la sauvegarde, donc il survit à un changement de téléphone comme
       * le reste. Et il est dans le miroir, donc Claude le LIT — et peut proposer d'y
       * ajouter quelqu'un ou d'y corriger un appétit par le chemin d'écriture
       * générique, sans qu'on ait à inventer une action de plus. Ces propositions se
       * relisent, se valident et se défont comme toutes les autres.
       */
      foyer: foyer.convives.value,
      // Qui est à table, repas par repas. Seules les EXCEPTIONS y figurent : un
      // repas absent d'ici se lit avec le foyer courant.
      ...repasConvives.snapshot(),
      /*
       * Le sport hors séance. Il part dans la sauvegarde ET dans le miroir, donc
       * Claude le lit et peut en proposer l'ajout ou la correction — un foot noté
       * de tête pèse sur la dépense du jour, et c'est justement ce qu'on veut
       * pouvoir dicter plutôt que de saisir à la main.
       */
      ...activites.snapshot(),
    }
  }

  return { buildSnapshot }
}
