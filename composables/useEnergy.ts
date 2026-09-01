import { computed } from 'vue'
import { useNow } from '~/composables/useNow'
import { useNutrition } from '~/composables/useNutrition'
import { useProfile } from '~/composables/useProfile'
import { useMesures } from '~/composables/useMesures'
import { useWorkout } from '~/composables/useWorkout'
import { SESSION_FORFAIT, ageOn, sessionBurn } from '~/lib/energy'
import { bmrMifflin, dayEnergy, isDayPlayed, proteinPlan, sessionsOn } from '~/lib/nutritionStats'
import { isoOf } from '~/utils/sportStats'
import type { DayEnergy, ProteinPlan } from '~/lib/nutritionStats'

// ─────────────────────────────────────────────────────────────────────────────
// Tout ce qui découle du corps : âge, métabolisme, dépense, cible protéique.
// ─────────────────────────────────────────────────────────────────────────────
//
// Sept écrans reconstruisaient cette chaîne chacun de leur côté — le poids, puis
// l'âge, puis le métabolisme, puis la dépense, puis la cible. Sept fois la même
// séquence, avec sept occasions de diverger, et elles avaient divergé.
//
// Ce composable est la seule porte. Il ne calcule rien lui-même : la règle est dans
// lib/energy.ts, où elle se teste sans navigateur. Il se contente de brancher les
// bonnes sources sur elle — et c'est justement le branchement qui se trompait.
//
// Deux principes, tous les deux appris à nos dépens :
//
//   · TOUT est indexé par DATE. Pas de « le poids actuel » quand on relit un mardi
//     de mars : le métabolisme de ce mardi-là se calcule avec le poids de ce
//     mardi-là. Le calendrier et la feuille qu'il ouvre affichaient deux chiffres
//     différents pour la même case, faute de cette règle.
//   · Ce qui est HYPOTHÉTIQUE porte un nom différent de ce qui est RÉEL. Demander
//     « quelle serait la cible si je m'entraînais ce jour-là » et « quelle est la
//     cible de ce jour-là » sont deux questions distinctes, et les confondre est
//     exactement ce qui créditait une séance jamais faite.

export function useEnergy() {
  const { profile } = useProfile()
  const { sessionLog, bodyWeightAt, currentWeight } = useWorkout()
  const { dayFor, stepsFor } = useNutrition()
  const { bodyComp } = useMesures()
  const { nowHour } = useNow()

  /** Aujourd'hui, calculé ici et pas reçu en prop : « la journée est-elle finie »
   *  est une propriété de l'horloge, pas de l'écran qui pose la question. */
  const today = () => isoOf(new Date())

  const age = (iso: string) => ageOn(iso, profile.value.birthYear)

  /**
   * Le métabolisme de base à une date, sur le poids connu À CETTE DATE.
   *
   * Pour aujourd'hui, c'est la pesée du matin. Pour une date passée, la pesée de ce
   * jour-là — relire mars avec le poids d'août fausserait toute la semaine relue.
   * Pour une date future, la dernière pesée connue, faute de mieux.
   */
  const bmrOn = (iso: string) =>
    bmrMifflin(bodyWeightAt(iso), profile.value.heightCm, age(iso), profile.value.sex)

  /** Les séances enregistrées ce jour-là. */
  const recordsOn = (iso: string) => sessionsOn(sessionLog(), iso)

  /** La journée est-elle derrière nous ? Décide si une séance non enregistrée
   *  compte encore comme « à venir » ou comme « pas faite ». */
  const played = (iso: string) => isDayPlayed(iso, today(), nowHour.value)

  /** Ce que la séance de ce jour-là a coûté — la règle unique, voir lib/energy.ts. */
  function burnOn(iso: string): number {
    const kg = bodyWeightAt(iso)
    return sessionBurn({
      records: recordsOn(iso) as never,
      kg,
      bmr: bmrOn(iso),
      gymPlanned: dayFor(iso).gym,
      played: played(iso),
    })
  }

  /**
   * Le bilan énergétique RÉEL d'une journée. `null` sans poids ni profil complet :
   * mieux vaut un écran muet qu'une cible calculée sur un corps inventé.
   */
  function energyOn(iso: string): DayEnergy | null {
    const kg = bodyWeightAt(iso)
    const bmr = bmrOn(iso)
    if (bmr === null || !kg) return null
    const j = dayFor(iso)
    return dayEnergy({ bmr, kg, tt: j.tt, steps: stepsFor(iso), sessionKcal: burnOn(iso) })
  }

  /**
   * Le bilan SI l'on s'entraînait ce jour-là — une question hypothétique, posée
   * quand on cherche où déplacer une séance.
   *
   * Volontairement séparée de `energyOn` : c'est en mélangeant les deux qu'on
   * finissait par créditer une séance qui n'avait pas eu lieu. Ici l'hypothèse est
   * assumée, elle est dans le nom.
   */
  function energyIfTrained(iso: string, gym: boolean): DayEnergy | null {
    const kg = bodyWeightAt(iso)
    const bmr = bmrOn(iso)
    if (bmr === null || !kg) return null
    return dayEnergy({
      bmr, kg,
      tt: dayFor(iso).tt,
      steps: stepsFor(iso),
      sessionKcal: gym ? SESSION_FORFAIT : 0,
    })
  }

  /**
   * La cible protéique, sur la MASSE MAIGRE dès que la balance la donne.
   *
   * Calculer sur le poids total revient à prescrire des protéines pour du tissu
   * adipeux, qui n'en demande pas. Deux écrans portaient déjà ce repli à
   * l'identique, et le connecteur, lui, l'avait oublié : il conseillait dix-huit
   * grammes de plus que l'application.
   */
  const proteinTarget = computed<ProteinPlan | null>(() => {
    const c = bodyComp.value
    if (c?.kg) return proteinPlan(c.kg, c)
    return currentWeight.value ? proteinPlan(currentWeight.value) : null
  })

  /**
   * La dépense d'une journée TYPE — salle ou repos, télétravail ou non.
   *
   * Ce n'est ni une journée réelle ni une hypothèse sur une date : c'est le repère
   * affiché dans les réglages, à comparer à une moyenne d'apports. Il se calcule sur
   * la pesée du jour et les pas par défaut, sans regarder le calendrier.
   *
   * Il valait `métabolisme × 1,55` — un facteur d'activité forfaitaire hérité des
   * tables génériques, qui annonçait cinq cents calories de plus que le modèle du
   * jour. De quoi croire à un déficit de sept cents calories là où il y en avait
   * deux cent cinquante.
   */
  function maintenanceFor(opts: { gym: boolean, tt: boolean }): number | null {
    const kg = currentWeight.value
    const bmr = bmrOn(today())
    if (bmr === null || !kg) return null
    return dayEnergy({
      bmr, kg,
      tt: opts.tt,
      sessionKcal: opts.gym ? SESSION_FORFAIT : 0,
    }).need
  }

  return { age, bmrOn, recordsOn, played, burnOn, energyOn, energyIfTrained, maintenanceFor, proteinTarget, today }
}
