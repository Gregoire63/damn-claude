import { ref } from 'vue'
import { dowIndex } from '~/lib/nutritionStats'

// Profil + planning hebdo éditables, persistés en localStorage.
export interface Profile {
  heightCm: number | null
  sex: 'h' | 'f' | null
  birthYear: number | null
}
// Planning : 7 entrées (index 0 = Lundi … 6 = Dimanche), valeur = id de séance ou null (repos)
export type WeekPlan = (string | null)[]

/**
 * La semaine par défaut : aucune séance.
 *
 * Elle valait `['s1','s2',null,'s3','s4',null,null]` — le rythme d'une personne, sur
 * des identifiants de séances qui n'existent plus au démarrage. Une semaine type qui
 * pointe vers des séances absentes n'est pas un défaut utile : c'est un calendrier
 * qui promet des séances et n'en ouvre aucune.
 */
export const DEFAULT_PLAN: WeekPlan = [null, null, null, null, null, null, null]
const PROFILE_KEY = 'gr-profile-v1'
const PLAN_KEY = 'gr-weekplan-v1'
// Exceptions de planning, par DATE : « cette semaine-là, la séance du vendredi je
// l'ai faite le samedi ». La semaine type reste la règle ; ceci n'en note que les
// écarts, et seulement pour les dates concernées.
//
// Deux stockages séparés, et c'est voulu : réécrire la semaine type parce qu'un
// vendredi ne tombait pas bien, c'est ce que faisait l'ancien planning « adaptatif »
// — il dérivait, et au bout d'un mois plus personne ne savait quel était le plan.
const PLANDAYS_KEY = 'gr-plan-days-v1'

const profile = ref<Profile>({ heightCm: null, sex: null, birthYear: null })
const weekPlan = ref<WeekPlan>([...DEFAULT_PLAN])
// null = repos ce jour-là malgré la semaine type. Absent = pas d'exception.
const planDays = ref<Record<string, string | null>>({})
let hydrated = false

function safeParse<T>(raw: string | null, fb: T): T {
  if (!raw) return fb
  try { return JSON.parse(raw) as T } catch { return fb }
}

export function useProfile() {
  // Hydratation appelée onMounted (côté client) pour éviter tout décalage SSR
  function hydrate() {
    if (hydrated || !import.meta.client) return
    profile.value = { ...profile.value, ...safeParse(localStorage.getItem(PROFILE_KEY), {}) }
    /*
     * Le nettoyage unique du planning a été RETIRÉ.
     *
     * Il réparait une dérive de l'ancien planning « adaptatif » : il réécrivait le
     * planning à chaque séance, et au bout d'un mois plus personne ne savait quel
     * était le plan. Il repartait donc une fois du planning par défaut, puis se
     * marquait fait dans « gr-plan-fixed-v1 ».
     *
     * Ce planning par défaut est devenu VIDE le jour où l'application a cessé de
     * livrer un programme. La réparation s'est retournée : sur un navigateur qui
     * n'avait pas encore le drapeau — une nouvelle machine, un profil restauré
     * depuis une sauvegarde — elle effaçait la semaine au lieu de la remettre
     * droite. Un correctif qui n'a plus rien à corriger et qui peut détruire ne
     * garde aucune valeur d'option.
     */
    const p = safeParse<WeekPlan>(localStorage.getItem(PLAN_KEY), DEFAULT_PLAN)
    if (Array.isArray(p) && p.length === 7) weekPlan.value = p
    planDays.value = safeParse<Record<string, string | null>>(localStorage.getItem(PLANDAYS_KEY), {})
    hydrated = true
  }
  function persistProfile() { if (import.meta.client) localStorage.setItem(PROFILE_KEY, JSON.stringify(profile.value)) }
  function persistPlan() { if (import.meta.client) localStorage.setItem(PLAN_KEY, JSON.stringify(weekPlan.value)) }
  function persistDays() { if (import.meta.client) localStorage.setItem(PLANDAYS_KEY, JSON.stringify(planDays.value)) }

  // ─── Planning à la date ──────────────────────────────────────────────────
  /** Séance prévue à cette date : l'exception si elle existe, sinon la semaine type. */
  function sessionIdFor(iso: string): string | null {
    if (Object.hasOwn(planDays.value, iso)) return planDays.value[iso]
    return weekPlan.value[dowIndex(iso)] ?? null
  }
  /** Y a-t-il une exception posée sur cette date ? (sert à proposer « reprendre le
   *  planning », et à signaler une journée déplacée). */
  const isPlanMoved = (iso: string) => Object.hasOwn(planDays.value, iso)
  /** Pose une exception. `sid = null` = repos ce jour-là. */
  function setDayPlan(iso: string, sid: string | null) {
    planDays.value = { ...planDays.value, [iso]: sid }
    persistDays()
  }
  /** Retire l'exception : la date repasse sous la semaine type. */
  function clearDayPlan(iso: string) {
    if (!Object.hasOwn(planDays.value, iso)) return
    const next = { ...planDays.value }
    delete next[iso]
    planDays.value = next
    persistDays()
  }

  function setHeight(cm: number | null) { profile.value.heightCm = cm && cm > 0 ? cm : null; persistProfile() }
  function setSex(sex: 'h' | 'f' | null) { profile.value.sex = sex; persistProfile() }
  function setBirthYear(y: number | null) { profile.value.birthYear = y && y > 1900 ? y : null; persistProfile() }
  function setDay(i: number, sid: string | null) {
    const copy = [...weekPlan.value]
    copy[i] = sid
    weekPlan.value = copy
    persistPlan()
  }
  function resetPlan() { weekPlan.value = [...DEFAULT_PLAN]; planDays.value = {}; persistPlan(); persistDays() }

  // Restaure profil + planning depuis une sauvegarde importée
  function restore(data: { profile?: Partial<Profile>; weekPlan?: WeekPlan; planDays?: Record<string, string | null> }) {
    if (data.profile && typeof data.profile === 'object') {
      profile.value = { ...profile.value, ...data.profile }
      persistProfile()
    }
    if (Array.isArray(data.weekPlan) && data.weekPlan.length === 7) {
      weekPlan.value = [...data.weekPlan]
      persistPlan()
    }
    if (data.planDays && typeof data.planDays === 'object') {
      planDays.value = { ...data.planDays }
      persistDays()
    }
  }

  return {
    profile, weekPlan, planDays, hydrate, setHeight, setSex, setBirthYear, setDay, resetPlan, restore,
    sessionIdFor, isPlanMoved, setDayPlan, clearDayPlan,
  }
}
