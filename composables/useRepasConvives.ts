import { ref } from 'vue'
import type { ConvivesRepas } from '~/lib/foyer'
import { convivesParDefaut, normaliserRepas } from '~/lib/foyer'
import { useFoyer } from '~/composables/useFoyer'

// ─────────────────────────────────────────────────────────────────────────────
// Qui est à table, repas par repas.
// ─────────────────────────────────────────────────────────────────────────────
//
// Le foyer dit qui vit là. Il ne dit pas qui mange ce soir : on cuisine pour deux le
// mardi, pour quatre le samedi, et seul le dimanche midi. Un facteur unique pour
// toute la semaine se trompe donc tous les jours sauf un.
//
// Rangé par DATE et par créneau, comme les repas choisis. Un repas sans entrée ici
// reprend le foyer courant : c'est le cas ordinaire, et il ne coûte rien à écrire.
// On n'enregistre que les EXCEPTIONS — le samedi où l'on reçoit — ce qui garde le
// stockage minuscule et rend la lecture évidente : ce qui est là est ce qui sort de
// l'ordinaire.

const CLE = 'gr-repas-convives-v1'
type Table = Record<string, Record<string, ConvivesRepas>>
const table = ref<Table>({})
let charge = false

function ecrire() {
  if (!import.meta.client) return
  try { localStorage.setItem(CLE, JSON.stringify(table.value)) }
  catch { /* stockage refusé : les convives valent pour cette session */ }
}

function nettoyer(brut: unknown): Table {
  const out: Table = {}
  if (!brut || typeof brut !== 'object') return out
  for (const [date, parCreneau] of Object.entries(brut as Record<string, unknown>)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !parCreneau || typeof parCreneau !== 'object') continue
    for (const [slot, c] of Object.entries(parCreneau as Record<string, unknown>)) {
      const propre = normaliserRepas(c)
      if (!propre) continue
      out[date] ??= {}
      out[date][slot] = propre
    }
  }
  return out
}

export function useRepasConvives() {
  const foyer = useFoyer()

  function hydrate() {
    if (charge || !import.meta.client) return
    charge = true
    try { table.value = nettoyer(JSON.parse(localStorage.getItem(CLE) || '{}')) }
    catch { table.value = {} }
  }
  if (import.meta.client) hydrate()

  /** Les convives ENREGISTRÉS pour ce repas, ou `null` si c'est l'ordinaire. */
  const exception = (date: string, slot: string): ConvivesRepas | null =>
    table.value[date]?.[slot] ?? null

  /** Ceux qui mangent ce repas : l'exception si elle existe, le foyer sinon. */
  const pour = (date: string, slot: string): ConvivesRepas =>
    exception(date, slot) ?? convivesParDefaut(foyer.convives.value)

  function definir(date: string, slot: string, c: ConvivesRepas): void {
    const propre = normaliserRepas(c)
    if (!propre) return oublier(date, slot)
    table.value = { ...table.value, [date]: { ...(table.value[date] ?? {}), [slot]: propre } }
    ecrire()
  }

  /** Revenir à l'ordinaire : on efface l'exception plutôt que d'en figer une copie. */
  function oublier(date: string, slot: string): void {
    const jour = { ...(table.value[date] ?? {}) }
    delete jour[slot]
    const t = { ...table.value }
    if (Object.keys(jour).length) t[date] = jour
    else delete t[date]
    table.value = t
    ecrire()
  }

  const snapshot = () => ({ repasConvives: table.value })
  function restore(data: Record<string, unknown>) {
    if (data.repasConvives === undefined) return
    table.value = nettoyer(data.repasConvives)
    ecrire()
  }

  return { table, hydrate, pour, exception, definir, oublier, snapshot, restore }
}
