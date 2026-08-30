import type { Session } from '~/data/sportProgram'
import { useProfile } from '~/composables/useProfile'
import { useNutrition } from '~/composables/useNutrition'
import { useProgram } from '~/composables/useProgram'

/**
 * Le planning des séances et la journée alimentaire, tenus ensemble.
 *
 * Ce sont deux stockages distincts, et ils doivent l'être : la séance dit ce que je
 * soulève, la journée dit ce que je mange. Mais ils partagent UN fait — « ce jour-là
 * je vais à la salle » — et c'est ce fait qui vaut environ 440 kcal de dépense, donc
 * un déjeuner d'après-séance au lieu d'un déjeuner de repos, et une heure de repas
 * décalée.
 *
 * Tant que ce fait s'écrivait à deux endroits, il pouvait diverger : annuler la
 * séance du vendredi laissait un vendredi à 2 320 kcal et un sac de sport à préparer.
 * Tout passe donc par ici, où déplacer une séance est UNE opération sur deux dates —
 * jamais deux réglages à penser à faire dans le bon ordre.
 */
export function useTraining() {
  const { sessionIdFor, isPlanMoved, setDayPlan, clearDayPlan } = useProfile()
  const { setOverride } = useNutrition()

  // Le programme EFFECTIF, pas celui du code : une séance dont un exercice a été
  // retiré doit s'ouvrir sans ce mouvement, que ce soit depuis le calendrier ou
  // depuis une proposition.
  const { sessionById } = useProgram()

  /** La séance prévue à cette date — exception du jour, sinon semaine type. */
  const plannedFor = (iso: string): Session | null => sessionById(sessionIdFor(iso))

  /**
   * Le seul écrivain : planning et journée changent ensemble, ou pas du tout.
   *
   * Exporté, parce que ce n'est pas seulement le calendrier qui pose une séance :
   * une proposition venue du connecteur passe par le même chemin. Deux appelants,
   * une seule façon d'écrire — c'est ce qui garantit que les calories suivent d'où
   * que vienne le geste.
   */
  function assign(iso: string, sid: string | null) {
    setDayPlan(iso, sid)
    setOverride(iso, { gym: !!sid })
  }

  /** Plus de séance ce jour-là : la journée repasse en repos, cible calorique comprise. */
  function cancelTraining(iso: string) {
    assign(iso, null)
  }

  /**
   * Déplace la séance de `from` vers `to`.
   *
   * Si `to` avait déjà une séance, les deux s'ÉCHANGENT. Écraser aurait perdu une
   * séance sans le dire — et « je décale jeudi et vendredi » est justement le cas où
   * l'on déplace vers un jour occupé.
   */
  function moveTraining(from: string, to: string) {
    if (from === to) return
    const leaving = sessionIdFor(from)
    const arriving = sessionIdFor(to)
    assign(to, leaving)
    assign(from, arriving)
  }

  /** Retour à la semaine type sur cette date, calories comprises. */
  function resetTraining(iso: string) {
    clearDayPlan(iso)
    setOverride(iso, { gym: undefined })
  }

  return { sessionById, plannedFor, sessionIdFor, isPlanMoved, assign, cancelTraining, moveTraining, resetTraining }
}
