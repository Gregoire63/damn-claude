<script setup lang="ts">
import { computed, ref } from 'vue'
import type { Exercise } from '~/data/sportProgram'
import { variantName, variantsOf } from '~/data/exerciseVariants'

// ─────────────────────────────────────────────────────────────────────────────
// Tout ce qu'on peut faire d'un mouvement, dans UNE fenêtre qui n'en ouvre aucune.
// ─────────────────────────────────────────────────────────────────────────────
//
// L'en-tête de chaque carte portait trois pastilles : « i » pour la fiche, 💬 pour le
// commentaire, ⚙ pour les gestes du jour. Trois cibles de 26 pixels côte à côte, à
// droite d'un nom qu'on touche pour déplier — sur six exercices, dix-huit boutons
// dans une colonne où l'on vient saisir des kilos, le téléphone dans une main.
//
// Elles ont d'abord fusionné en un menu de raccourcis, et ce n'était qu'un dixième du
// chemin : chaque ligne ouvrait ENCORE quelque chose. Choisir une machine posait une
// troisième fenêtre par-dessus, « repris en main » une carte de confirmation, la
// fiche une quatrième fenêtre. Quatre calques empilés pour trois gestes qui vont
// ensemble, et à chaque fois il fallait ressortir de l'un pour entrer dans l'autre.
//
// Tout est donc ICI, et rien ne s'ouvre :
//
//  · le commentaire EN PREMIER, champ ouvert, enregistré à la frappe. C'est le seul
//    de ces gestes qui revienne PENDANT la séance — « épaule qui tire » s'écrit entre
//    deux séries, là où la machine et la reprise en main se décident une fois en
//    arrivant. Le mettre sous les boutons demandait de faire défiler pour trois mots.
//    Il ouvrait une fenêtre de plus, avec un bouton « Terminé » qui ne terminait rien :
//    le brouillon de séance est sauvegardé en continu de toute façon ;
//  · puis les deux gestes du jour sur une ligne — ils se choisissent l'un CONTRE
//    l'autre, « la machine est prise » et « le mouvement a changé pour de bon » étant
//    la même question posée deux fois ;
//  · la liste des machines se DÉPLIE sous le bouton, dans cette fenêtre ;
//  · « repris en main » bascule sur place : c'est réversible d'un second tap, et une
//    confirmation modale pour un interrupteur qu'on peut éteindre ne protège de rien ;
//  · la fiche du mouvement est dépliée en bas, telle quelle (`ExerciseFiche`, partagé
//    avec l'aperçu, qui n'a pas de menu et garde donc sa fenêtre).
//
// La fenêtre est longue, et c'est le prix assumé : elle défile, là où quatre calques
// demandaient de se souvenir d'où l'on venait.

const props = defineProps<{
  ex: Exercise
  /** Le repos prévu, en secondes — la fiche l'annonce, l'appelant le calcule. */
  repos: number | null
  /** Le commentaire du jour — écrit ici même, enregistré à la frappe. */
  note: string
  /** Celui de la dernière fois, s'il y en a un : c'est ce qu'on relit avant d'écrire. */
  notePrecedente: string | null
  /** La machine réellement utilisée aujourd'hui, si elle n'est pas celle du programme. */
  variant: string | null
  /** Le mouvement a-t-il déjà été déclaré « repris en main » sur cette séance ? */
  swap: boolean
  /** Les autres membres du groupe d'alternance — vide si ce mouvement n'alterne pas. */
  alternatives: Exercise[]
}>()

const emit = defineEmits<{
  /** La machine choisie (`null` = celle du programme). */
  'pick-variant': [id: string | null]
  /** Bascule « repris en main » — l'appelant tranche, la fenêtre ne fait que le dire. */
  swap: [id: string]
  /**
   * Le membre du groupe d'alternance à faire à la place. Il porte son identifiant :
   * la fenêtre s'annonce fermée avant d'agir (voir `fermer`), donc l'appelant a déjà
   * oublié de qui il s'agissait au moment où l'action lui arrive.
   */
  alterner: [id: string]
  /** Le commentaire, à chaque frappe : c'est la sauvegarde automatique. */
  'update:note': [texte: string]
  close: []
}>()

const pop = ref<{ dismiss: () => void } | null>(null)

/**
 * Le SEUL geste qui referme, et pourquoi il doit le faire proprement.
 *
 * Changer de machine ou écrire un commentaire laisse la fenêtre ouverte — on vient
 * peut-être y faire autre chose. Prendre l'autre mouvement du roulement, en revanche,
 * remplace l'exercice : la fenêtre parle alors de quelqu'un qui n'est plus là.
 *
 * On referme D'ABORD, on agit ENSUITE : le retrait d'un calque et l'ajout d'un autre
 * dans la même passe est le scénario que `useBackStack` documente — le `popstate`
 * arrive quand le nouveau s'est déjà inscrit, et c'est lui qui se fait refermer.
 */
let suite: (() => void) | null = null
function choisir(action: () => void) {
  suite = action
  pop.value?.dismiss()
}
function fermer() {
  const faire = suite
  suite = null
  emit('close')
  faire?.()
}

const machines = computed(() => variantsOf(props.ex.id))
const machineDite = computed(() => (props.variant ? variantName(props.ex.id, props.variant, props.ex.name) : null))

/** La liste des machines, dépliée sous le bouton. Repliée par défaut : on ne change
 *  pas de machine à chaque série, et dépliée elle pousserait tout le reste dehors. */
const machinesOuvertes = ref(false)
function prendreMachine(id: string | null) {
  emit('pick-variant', id)
  machinesOuvertes.value = false
}
</script>

<template>
  <Popup ref="pop" popup-class="exopt" :title="ex.name" subtitle="Options du mouvement" @close="fermer">
    <div class="exopt-list">
      <div class="exopt-note">
        <label class="section-label" for="exopt-note">Commentaire</label>
        <p v-if="notePrecedente" class="exopt-dit exopt-avant">La dernière fois : {{ notePrecedente }}</p>
        <textarea
          id="exopt-note"
          class="note-input exopt-champ" rows="3"
          placeholder="Machine occupée, épaule qui tire, prise changée…"
          :value="note"
          @input="emit('update:note', ($event.target as HTMLTextAreaElement).value)"
        ></textarea>
        <p class="exopt-dit">Enregistré à mesure que tu écris. Il se relit dans la carte, et à la séance suivante sous « la dernière fois ».</p>
      </div>

      <!-- Les deux gestes du jour, sur UNE ligne et à parts égales : ils se choisissent
           l'un contre l'autre, et le texte sous la ligne vaut pour les deux. -->
      <div class="exopt-duo">
        <button
          v-if="machines.length"
          class="exopt-btn" :class="{ on: !!variant, ouvert: machinesOuvertes }"
          :aria-expanded="machinesOuvertes"
          @click="machinesOuvertes = !machinesOuvertes"
        >
          <span aria-hidden="true">🔁</span> Autre machine<span v-if="variant" aria-hidden="true"> ✓</span>
        </button>
        <button class="exopt-btn" :class="{ on: swap }" @click="emit('swap', ex.id)">
          <span aria-hidden="true">🔀</span> Repris en main<span v-if="swap" aria-hidden="true"> ✓</span>
        </button>
      </div>
      <!-- La phrase ne parle QUE des boutons présents : un mouvement sans machine de
           remplacement n'affiche pas 🔁, et lire « 🔁 si la tienne est prise » sous un
           bouton qui n'existe pas envoie le chercher. -->
      <p class="exopt-dit">
        <template v-if="machineDite">Aujourd'hui sur <b>{{ machineDite }}</b> : les kilos affichés sont ceux de cette machine-là.</template>
        <template v-else>
          <template v-if="machines.length">🔁 si la tienne est prise — la charge est convertie, la progression continue. </template>
          🔀 si le mouvement a changé pour de bon : records et comparaisons repartent d'ici.
        </template>
      </p>

      <!-- Dépliée ICI, et non dans une fenêtre par-dessus : choisir sa machine fait
           partie du même moment que le reste, et une troisième couche de calques
           obligeait à ressortir pour revenir. -->
      <SportVariantList
        v-if="machinesOuvertes"
        :ex="ex"
        :current="variant"
        @pick="prendreMachine($event)"
      />

      <!-- L'alternance ne s'affiche que là où elle existe. Un mouvement sans groupe
           n'a rien à échanger, et une ligne grisée « aucune alternative » serait du
           bruit sur tous les autres. -->
      <button v-for="a in alternatives" :key="a.id" class="exopt-item" @click="choisir(() => emit('alterner', a.id))">
        <span class="exopt-i" aria-hidden="true">↔</span>
        <span class="exopt-txt">
          <b>Faire {{ a.name }} à la place</b>
          <span class="exopt-dit">Pour aujourd'hui seulement : la semaine prochaine, le roulement reprend son cours.</span>
        </span>
      </button>

      <!-- La fiche en dernier, dépliée : on la lit la première fois, et le jour où
           l'on doute. Rien à ouvrir pour l'atteindre — il suffit de faire défiler. -->
      <div class="exopt-fiche">
        <SportExerciseFiche :ex="ex" :repos="repos" :alternatives="alternatives" choix-machine-ici />
      </div>
    </div>
  </Popup>
</template>

<style scoped>
.exopt-list { display: flex; flex-direction: column; gap: 8px; }
.exopt-item {
  display: flex; align-items: flex-start; gap: 10px; width: 100%; text-align: left;
  background: var(--bg-primary); border: 1px solid var(--bg-accent); border-radius: 12px;
  padding: 11px 12px; font: inherit; color: var(--text-primary); cursor: pointer;
}
.exopt-item.on { border-color: var(--accent-secondary); }
/* `1 1 0` et `min-width: 0` : les deux boutons se partagent la largeur à parts
   égales quelle que soit la longueur du texte. Sans le second, le contenu impose sa
   taille et le plus long déborde de la fenêtre sur un écran étroit. */
.exopt-duo { display: flex; gap: 8px; }
.exopt-btn {
  flex: 1 1 0; min-width: 0;
  background: var(--bg-primary); border: 1px solid var(--bg-accent); border-radius: 12px;
  padding: 11px 8px; font: inherit; font-size: 13px; color: var(--text-primary);
  cursor: pointer; transition: border-color 0.15s;
}
.exopt-btn.on { border-color: var(--accent-secondary); color: var(--accent-primary); font-weight: 600; }
/* Déplié, le bouton se lit comme l'en-tête de ce qu'il a ouvert. */
.exopt-btn.ouvert { background: var(--bg-secondary); border-color: var(--accent-secondary); }
.exopt-i { font-size: 17px; line-height: 1.3; }
.exopt-txt { display: flex; flex-direction: column; gap: 3px; flex: 1; }
.exopt-dit { font-size: 12px; color: var(--text-muted); line-height: 1.45; }
.exopt-note { display: flex; flex-direction: column; gap: 6px; }
.exopt-avant { font-style: italic; }
.exopt-champ { min-height: 84px; }
/* La fiche est un bloc À PART dans la fenêtre : un filet au-dessus dit qu'on quitte
   les gestes pour la lecture, sans avoir à écrire un titre de plus. */
.exopt-fiche { border-top: 1px dashed var(--bg-accent); padding-top: 12px; margin-top: 4px; }
</style>
