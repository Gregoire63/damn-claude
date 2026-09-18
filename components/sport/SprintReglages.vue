<script setup lang="ts">
import { useFractionne } from '~/composables/useFractionne'

// ─────────────────────────────────────────────────────────────────────────────
// Les cinq nombres du bloc de fractionné.
// ─────────────────────────────────────────────────────────────────────────────
//
// Ils vivaient dans la carte du chrono, dépliés, entre le titre et le bouton
// « Lancer » : cinq champs de saisie traversés à chaque séance pour atteindre le seul
// bouton qu'on touche vraiment. Or on les règle une fois, et on y revient le jour où
// la forme change — pas toutes les semaines.
//
// Ils sont donc dans la fenêtre du sprint, avec le reste de ce qui se décide avant de
// courir. Le composant est à part pour la même raison que `ExerciseFiche` : la fenêtre
// le montre, et rien n'empêche la carte de le remontrer un jour sans qu'il existe en
// deux exemplaires.

const { reglage, definir } = useFractionne()

const champs = [
  { cle: 'echauffementS' as const, label: 'Course tranquille', unite: 'min', pas: 30 },
  { cle: 'reposApresS' as const, label: 'Repos avant les sprints', unite: 'min', pas: 15 },
  { cle: 'sprintS' as const, label: 'Sprint', unite: 's', pas: 5 },
  { cle: 'reposS' as const, label: 'Repos entre sprints', unite: 'min', pas: 15 },
  { cle: 'retourAuCalmeS' as const, label: 'Retour au calme', unite: 'min', pas: 30 },
]

/** Les durées se saisissent en secondes, mais s'affichent en minutes là où c'est naturel. */
function valeurAffichee(cle: keyof typeof reglage.value, unite: string) {
  const v = reglage.value[cle]
  return unite === 'min' ? Math.round((v / 60) * 10) / 10 : v
}
function poser(cle: keyof typeof reglage.value, unite: string, brut: string) {
  const n = Number(String(brut).replace(',', '.'))
  if (!Number.isFinite(n)) return
  definir({ [cle]: unite === 'min' ? Math.round(n * 60) : Math.round(n) })
}
</script>

<template>
  <div class="fr-reglages">
    <label v-for="c in champs" :key="c.cle" class="fr-champ">
      <span class="fr-lab">{{ c.label }}</span>
      <span class="fr-saisie">
        <input
          :value="valeurAffichee(c.cle, c.unite)" type="number" inputmode="decimal"
          :step="c.unite === 'min' ? 0.5 : c.pas" min="0"
          @change="poser(c.cle, c.unite, ($event.target as HTMLInputElement).value)"
        >
        <span class="fr-unite">{{ c.unite }}</span>
      </span>
    </label>
    <label class="fr-champ">
      <span class="fr-lab">Nombre de sprints</span>
      <span class="fr-saisie">
        <input
          :value="reglage.sprints" type="number" inputmode="numeric" step="1" min="1"
          @change="definir({ sprints: Number(($event.target as HTMLInputElement).value) })"
        >
        <span class="fr-unite">×</span>
      </span>
    </label>
  </div>
</template>

<style scoped>
.fr-reglages { display: flex; flex-direction: column; gap: 8px; background: var(--bg-secondary); border: 1px solid var(--bg-accent); border-radius: 12px; padding: 12px; }
.fr-champ { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.fr-lab { font-size: 13px; color: var(--text-secondary); }
.fr-saisie { display: inline-flex; align-items: center; gap: 6px; }
.fr-saisie input {
  width: 72px; padding: 8px; text-align: center; border-radius: 8px;
  border: 1px solid var(--bg-accent); background: var(--bg-primary); color: var(--text-primary);
  font-family: var(--font-mono); font-size: 14px;
}
.fr-unite { font-family: var(--font-mono); font-size: 12px; color: var(--text-muted); width: 26px; }
</style>
