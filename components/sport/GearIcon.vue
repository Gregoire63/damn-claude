<script setup lang="ts">
import type { Gear } from '~/data/exerciseVariants'
import { GEAR_LABELS } from '~/data/exerciseVariants'

/**
 * La silhouette du matériel, dessinée.
 *
 * Ce n'est pas une illustration décorative : c'est ce qui permet de reconnaître
 * l'engin dans l'allée avant d'avoir lu son nom. « Machine assise » et « chariot
 * incliné » ne se distinguent pas en lisant, elles se distinguent en regardant.
 *
 * Pourquoi un dessin et pas une photo : une photo de catalogue montre le modèle
 * d'UN fabricant, et la V-Squat d'une salle donnée ne lui ressemble pas forcément
 * — sans compter que ces photos ne sont pas libres de droits. Le trait dit la
 * forme générale, ce qui suffit à s'orienter ; la vraie photo est celle qu'on
 * prend sur place, et elle remplace celle-ci dès qu'elle existe.
 *
 * Tout est en `currentColor` et sans remplissage : le pictogramme suit la couleur
 * du texte, donc le thème, sans deuxième jeu d'icônes à maintenir.
 */
defineProps<{ gear: Gear }>()
</script>

<template>
  <svg
    class="gear-ico" viewBox="0 0 48 36" role="img"
    :aria-label="GEAR_LABELS[gear]" fill="none"
    stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
  >
    <!-- Barre : la barre et ses disques -->
    <g v-if="gear === 'barre'">
      <line x1="6" y1="18" x2="42" y2="18" />
      <rect x="11" y="10" width="4" height="16" rx="1" />
      <rect x="33" y="10" width="4" height="16" rx="1" />
      <line x1="6" y1="14" x2="6" y2="22" />
      <line x1="42" y1="14" x2="42" y2="22" />
    </g>

    <!-- Haltères : deux blocs, une poignée courte -->
    <g v-else-if="gear === 'halteres'">
      <line x1="17" y1="18" x2="31" y2="18" />
      <rect x="9" y="10" width="8" height="16" rx="2" />
      <rect x="31" y="10" width="8" height="16" rx="2" />
    </g>

    <!-- Barre guidée : deux montants verticaux, la barre entre les deux -->
    <g v-else-if="gear === 'guidee'">
      <line x1="11" y1="4" x2="11" y2="32" />
      <line x1="37" y1="4" x2="37" y2="32" />
      <line x1="7" y1="32" x2="41" y2="32" />
      <line x1="11" y1="15" x2="37" y2="15" />
      <rect x="15" y="11" width="3" height="8" rx="1" />
      <rect x="30" y="11" width="3" height="8" rx="1" />
    </g>

    <!-- Poulie : colonne, poulie en haut, câble et poignée -->
    <g v-else-if="gear === 'poulie'">
      <line x1="12" y1="4" x2="12" y2="32" />
      <line x1="7" y1="32" x2="17" y2="32" />
      <rect x="8" y="12" width="8" height="14" rx="1" />
      <circle cx="30" cy="7" r="3" />
      <line x1="12" y1="4" x2="30" y2="4" />
      <line x1="30" y1="10" x2="30" y2="22" />
      <line x1="25" y1="24" x2="35" y2="24" />
    </g>

    <!-- Chariot incliné (V-Squat, hack) : le rail, le dossier qui coulisse dessus,
         le coussin d'épaule en haut, la plaque de pieds en bas -->
    <g v-else-if="gear === 'rail'">
      <line x1="6" y1="32" x2="42" y2="32" />
      <line x1="13" y1="30" x2="37" y2="9" />
      <rect x="19" y="13" width="17" height="8" rx="1.5" transform="rotate(-41 27.5 17)" />
      <circle cx="34" cy="7" r="2.5" />
      <rect x="8" y="26" width="13" height="4" rx="1" />
    </g>

    <!-- Presse : le siège en bas à gauche, le rail incliné, la grande plaque de
         pieds en haut, perpendiculaire au rail -->
    <g v-else-if="gear === 'presse'">
      <line x1="6" y1="32" x2="42" y2="32" />
      <path d="M11 28 v-10 M11 28 h10" />
      <line x1="17" y1="26" x2="34" y2="12" />
      <line x1="30" y1="6" x2="39" y2="17" />
      <line x1="28" y1="8" x2="37" y2="19" />
      <line x1="14" y1="28" x2="14" y2="32" />
    </g>

    <!-- Machine à bras (convergente) : le dossier, l'assise, et les deux bras
         terminés par leurs poignées -->
    <g v-else-if="gear === 'convergente'">
      <rect x="15" y="8" width="6" height="16" rx="2" />
      <line x1="15" y1="24" x2="26" y2="24" />
      <line x1="21" y1="12" x2="32" y2="12" />
      <line x1="21" y1="20" x2="32" y2="20" />
      <line x1="32" y1="9" x2="32" y2="15" />
      <line x1="32" y1="17" x2="32" y2="23" />
      <line x1="10" y1="32" x2="38" y2="32" />
      <line x1="19" y1="24" x2="19" y2="32" />
    </g>

    <!-- Machine assise : le siège, et la pile de poids derrière -->
    <g v-else-if="gear === 'assise'">
      <path d="M14 26 h12 M14 26 v-9" />
      <line x1="14" y1="17" x2="10" y2="12" />
      <rect x="30" y="8" width="10" height="18" rx="1" />
      <line x1="30" y1="14" x2="40" y2="14" />
      <line x1="30" y1="20" x2="40" y2="20" />
      <line x1="35" y1="4" x2="35" y2="8" />
      <line x1="8" y1="32" x2="42" y2="32" />
      <line x1="20" y1="26" x2="20" y2="32" />
    </g>

    <!-- Banc : le plateau légèrement incliné et ses pieds -->
    <g v-else-if="gear === 'banc'">
      <line x1="8" y1="20" x2="40" y2="14" />
      <line x1="12" y1="19" x2="12" y2="30" />
      <line x1="36" y1="15" x2="36" y2="30" />
      <line x1="8" y1="30" x2="16" y2="30" />
      <line x1="32" y1="30" x2="40" y2="30" />
    </g>

    <!-- Machine à mollets : plateforme basse, montant, coussins d'épaules -->
    <g v-else-if="gear === 'mollets'">
      <line x1="24" y1="10" x2="24" y2="27" />
      <line x1="16" y1="8" x2="32" y2="8" />
      <rect x="13" y="5" width="6" height="6" rx="2" />
      <rect x="29" y="5" width="6" height="6" rx="2" />
      <rect x="16" y="27" width="16" height="5" rx="1" />
    </g>

    <!-- Poids du corps : la barre de traction et ses montants -->
    <g v-else>
      <line x1="10" y1="9" x2="38" y2="9" />
      <line x1="12" y1="9" x2="12" y2="32" />
      <line x1="36" y1="9" x2="36" y2="32" />
      <line x1="20" y1="9" x2="20" y2="17" />
      <line x1="28" y1="9" x2="28" y2="17" />
      <line x1="8" y1="32" x2="40" y2="32" />
    </g>
  </svg>
</template>

<style scoped>
.gear-ico { width: 100%; height: 100%; display: block; color: var(--text-secondary); }
</style>
