<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { LIBELLE_PHASE, dureeTotale, fmtChrono, fmtDuree } from '~/lib/fractionne'
import { useFractionne } from '~/composables/useFractionne'
import { useOverlay } from '~/composables/useOverlay'

/**
 * L'écran du fractionné — celui qu'on ne regarde pas.
 *
 * Tout ce qui compte passe par l'oreille (voix, bips, vibration) ; l'écran n'est là
 * que pour le coup d'œil entre deux efforts, quand on cherche UN chiffre : combien
 * de sprints restent. D'où les deux tailles de texte et rien entre les deux.
 *
 * Il est TÉLÉPORTÉ dans `<body>`, comme les fenêtres, et pour la même raison : la
 * feuille de séance porte un `transform`, qui fait d'elle le bloc englobant de tout
 * `position: fixed` à l'intérieur. Écrit sur place, le calque se retrouverait
 * découpé aux bords de la feuille et suivrait son défilement.
 */

const emit = defineEmits<{ termine: [{ sprints: number, sprintS: number, echauffementS: number }] }>()

const f = useFractionne()
const {
  reglage, segment, phase, position, fraction, suivant,
  enCours, enPause, resteS, totalResteS, bilan, viderBilan,
  lancer, arreter, basculerPause, passer,
} = f

/** Le calque plein écran. Se réduit sans arrêter le bloc — le chrono continue derrière. */
const affiche = ref(false)

const total = computed(() => dureeTotale(reglage.value))
const resume = computed(() => {
  const r = reglage.value
  const bouts = []
  if (r.echauffementS) bouts.push(`${fmtDuree(r.echauffementS)} de course`)
  bouts.push(`${r.sprints} × ${fmtDuree(r.sprintS)}`)
  bouts.push(`repos ${fmtDuree(r.reposS)}`)
  return bouts.join(' · ')
})

function demarrer() {
  affiche.value = true
  lancer()
}

function stopper() {
  arreter()
  affiche.value = false
}

/**
 * Le bloc fini, on remonte ce qui a été couru pour que le journal se remplisse seul.
 *
 * C'est le seul moment où on connaît le compte exact — après, il faudrait s'en
 * souvenir en reprenant son souffle, et c'est précisément ce qu'on ne fait pas.
 */
watch(bilan, (b) => {
  if (!b) return
  emit('termine', b)
  viderBilan()
})

// Échap et le bouton retour RÉDUISENT, ils n'arrêtent pas : couper un bloc de
// quinze minutes sur un geste ambigu ne se rattrape pas.
useOverlay(() => { affiche.value = false })

const couleur = computed(() => {
  if (phase.value === 'sprint') return 'sprint'
  if (phase.value === 'repos') return 'repos'
  return 'calme'
})
const R = 86
const CIRC = 2 * Math.PI * R
const dash = computed(() => `${(1 - fraction.value) * CIRC} ${CIRC}`)
</script>

<template>
  <div class="fr-bloc">
    <div class="sprint-block-title">⏱️ Chrono fractionné</div>

    <!-- Bloc en cours, calque réduit : la bande reste vivante dans la carte -->
    <button v-if="enCours && !affiche" class="fr-bande" :class="couleur" @click="affiche = true">
      <span class="fr-bande-phase">{{ phase ? LIBELLE_PHASE[phase] : '' }}</span>
      <span class="fr-bande-temps mono">{{ fmtChrono(resteS) }}</span>
      <span v-if="position" class="fr-bande-pos mono">{{ position }}</span>
    </button>

    <template v-else-if="!enCours">
      <button class="fr-go" @click="demarrer">▶ Lancer le fractionné</button>
      <div class="muted fr-resume">{{ resume }} — {{ fmtDuree(total) }} en tout</div>
    </template>

    <Teleport to="body">
      <div v-if="affiche && enCours" class="sport-app sport-portal">
        <div class="fr-plein" :class="couleur">
          <div class="fr-plein-haut">
            <button class="fr-reduire" @click="affiche = false">▾ Réduire</button>
            <span v-if="position" class="fr-compte mono">{{ position }}</span>
          </div>

          <div class="fr-anneau-wrap">
            <svg viewBox="0 0 200 200" class="fr-anneau">
              <circle cx="100" cy="100" :r="R" class="fr-anneau-bg" />
              <circle cx="100" cy="100" :r="R" class="fr-anneau-fg" :stroke-dasharray="dash" />
            </svg>
            <div class="fr-centre">
              <div class="fr-phase">{{ phase ? LIBELLE_PHASE[phase] : '' }}</div>
              <div class="fr-temps mono">{{ fmtChrono(resteS) }}</div>
            </div>
          </div>

          <div class="fr-suite">
            <template v-if="suivant">Ensuite · {{ LIBELLE_PHASE[suivant.kind] }} {{ fmtDuree(suivant.dureeS) }}</template>
            <template v-else>Dernière phase</template>
          </div>
          <div class="fr-restant mono">Reste {{ fmtChrono(totalResteS) }} sur le bloc</div>

          <div class="fr-actions">
            <button class="fr-btn" @click="basculerPause">{{ enPause ? '▶ Reprendre' : '⏸ Pause' }}</button>
            <button class="fr-btn" @click="passer">⏭ Passer</button>
            <button class="fr-btn danger" @click="stopper">■ Arrêter</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.fr-bloc { display: flex; flex-direction: column; gap: 10px; border-top: 1px dashed var(--bg-accent); padding-top: 12px; }
.fr-go { background: #b5502f; border: none; color: #fff; border-radius: 12px; padding: 14px; font-family: var(--font-body); font-size: 15px; font-weight: 700; cursor: pointer; }
.fr-go:active { transform: scale(0.99); }
.fr-resume { font-size: 12px; line-height: 1.5; }

.fr-bande { display: flex; align-items: center; gap: 10px; width: 100%; border: 1px solid var(--bg-accent); border-radius: 12px; padding: 12px; cursor: pointer; background: var(--bg-secondary); }
.fr-bande.sprint { border-color: #b5502f; background: #f6ece1; }
.fr-bande-phase { font-family: var(--font-mono); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; color: var(--text-secondary); }
.fr-bande-temps { margin-left: auto; font-size: 20px; font-weight: 700; color: var(--text-primary); }
.fr-bande-pos { font-size: 12px; color: var(--text-muted); }

/* Le calque plein écran : peu d'éléments, très gros, fort contraste — il se lit
   d'un coup d'œil, essoufflé, à bout de bras. */
.fr-plein { position: fixed; inset: 0; z-index: 88; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px; padding: 24px; background: #17110d; color: #f7efe6; }
.fr-plein.sprint { background: #3a1409; }
.fr-plein.repos { background: #10201f; }
.fr-plein-haut { position: absolute; top: 0; left: 0; right: 0; display: flex; align-items: center; justify-content: space-between; padding: 16px 18px; }
.fr-reduire { background: none; border: none; color: #cbbdae; font-family: var(--font-mono); font-size: 13px; cursor: pointer; padding: 6px; }
.fr-compte { font-size: 15px; color: #f0d8bf; letter-spacing: 0.06em; }

.fr-anneau-wrap { position: relative; width: min(70vw, 260px); aspect-ratio: 1; }
.fr-anneau { width: 100%; height: 100%; transform: rotate(-90deg); }
.fr-anneau-bg { fill: none; stroke: rgba(255, 255, 255, 0.12); stroke-width: 10; }
.fr-anneau-fg { fill: none; stroke: #e8a13c; stroke-width: 10; stroke-linecap: round; transition: stroke-dasharray 0.25s linear; }
.fr-plein.sprint .fr-anneau-fg { stroke: #ff7a45; }
.fr-centre { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; }
.fr-phase { font-family: var(--font-mono); font-size: 13px; text-transform: uppercase; letter-spacing: 0.14em; color: #d8c4ad; }
.fr-temps { font-size: clamp(44px, 15vw, 76px); font-weight: 700; line-height: 1; }

.fr-suite { font-size: 14px; color: #cbb8a2; text-align: center; }
.fr-restant { font-size: 12px; color: #8d7d6e; }
.fr-actions { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; margin-top: 4px; }
.fr-btn { background: rgba(255, 255, 255, 0.09); border: 1px solid rgba(255, 255, 255, 0.18); color: #f7efe6; border-radius: 10px; padding: 13px 18px; font-family: var(--font-mono); font-size: 14px; cursor: pointer; }
.fr-btn:active { transform: scale(0.98); }
.fr-btn.danger { border-color: #a2503a; color: #ffb59a; }
.mono { font-family: var(--font-mono); }
</style>
