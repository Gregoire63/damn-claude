import { computed, ref } from 'vue'
import type { Activite, TypeActivite } from '~/lib/activites'
import { activitesDe, idActivite, kcalActivites, normaliserActivite } from '~/lib/activites'

// ─────────────────────────────────────────────────────────────────────────────
// Le sport qui n'est pas une séance : foot du samedi, rando, deux heures de vélo.
// ─────────────────────────────────────────────────────────────────────────────
//
// Voir lib/activites.ts pour le calcul. Ici, il n'y a que le rangement — et une
// décision qui n'en a pas l'air : une LISTE À PLAT, pas une table par date.
//
// Le reste du module nutrition est rangé par date parce qu'il répond toujours à
// « que se passe-t-il ce jour-là ». Les activités répondent aussi à « qu'est-ce que
// j'ai fait ce mois-ci », et une table par date oblige alors à tout parcourir pour
// reconstruire une liste. À trois cents entrées, une liste à plat filtrée reste
// instantanée et se lit d'un coup dans la sauvegarde ; l'inverse n'est pas vrai.

const CLE = 'gr-activites-v1'
const activites = ref<Activite[]>([])
let charge = false

function ecrire() {
  if (!import.meta.client) return
  try { localStorage.setItem(CLE, JSON.stringify(activites.value)) }
  catch { /* stockage refusé : les activités valent pour cette session */ }
}

function nettoyer(brut: unknown): Activite[] {
  const liste = Array.isArray(brut) ? brut : []
  const vus = new Set<string>()
  const out: Activite[] = []
  for (const a of liste) {
    const propre = normaliserActivite(a)
    // Un identifiant en double ferait modifier deux lignes d'un coup, ou en effacer
    // une qu'on ne visait pas. Le second gagne un identifiant neuf plutôt que d'être
    // jeté : c'est une activité réelle, elle a juste mal voyagé.
    if (!propre) continue
    if (vus.has(propre.id)) propre.id = idActivite()
    vus.add(propre.id)
    out.push(propre)
  }
  return out.sort((x, y) => (y.date + y.heure).localeCompare(x.date + x.heure)).slice(0, 2000)
}

export function useActivites() {
  function hydrate() {
    if (charge || !import.meta.client) return
    charge = true
    try { activites.value = nettoyer(JSON.parse(localStorage.getItem(CLE) || '[]')) }
    catch { activites.value = [] }
  }
  if (import.meta.client) hydrate()

  /** Les activités d'une journée, dans l'ordre où elles ont eu lieu. */
  const duJour = (iso: string) => activitesDe(activites.value, iso)
  /** Ce qu'elles ont coûté ce jour-là. C'est ce que la dépense du jour ajoute. */
  const kcalDuJour = (iso: string) => kcalActivites(activites.value, iso)

  /** Les plus récentes d'abord — l'ordre dans lequel on relit son mois. */
  const recentes = computed(() => activites.value)

  function ajouter(a: Omit<Activite, 'id'> & { id?: string }): string | null {
    const propre = normaliserActivite({ ...a, id: a.id || idActivite() })
    if (!propre) return null
    activites.value = nettoyer([propre, ...activites.value])
    ecrire()
    return propre.id
  }

  function modifier(id: string, champs: Partial<Omit<Activite, 'id'>>): boolean {
    const avant = activites.value.find(a => a.id === id)
    if (!avant) return false
    const propre = normaliserActivite({ ...avant, ...champs, id })
    if (!propre) return false
    activites.value = nettoyer(activites.value.map(a => (a.id === id ? propre : a)))
    ecrire()
    return true
  }

  function retirer(id: string): boolean {
    if (!activites.value.some(a => a.id === id)) return false
    activites.value = activites.value.filter(a => a.id !== id)
    ecrire()
    return true
  }

  const snapshot = () => ({ activites: activites.value })
  function restore(data: Record<string, unknown>) {
    if (data.activites === undefined) return
    activites.value = nettoyer(data.activites)
    ecrire()
  }

  return { activites, recentes, hydrate, duJour, kcalDuJour, ajouter, modifier, retirer, snapshot, restore }
}

export type { Activite, TypeActivite }
