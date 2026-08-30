<script setup lang="ts">
import { ref } from 'vue'
import { phraseBilan, useRestauration } from '~/composables/useRestauration'

/**
 * Le premier écran, celui d'une application qui ne contient rien.
 *
 * Elle ne livre plus aucune donnée — ni séances, ni aliments, ni recettes, ni menus.
 * C'était le programme et les courses d'une personne, servis à quiconque installait
 * l'application : on ne commençait pas, on effaçait.
 *
 * Mais une application vide sans porte de sortie est pire qu'une application pleine.
 * D'où ces deux chemins, et rien d'autre :
 *
 *  · faire remplir par Claude, parce que c'est ce que ce projet sait faire de
 *    singulier — le message est prêt à coller, avec l'ORDRE des étapes, parce que
 *    créer une recette avant ses aliments échoue et décourage ;
 *  · charger l'exemple, pour voir à quoi ressemble l'application pleine avant de
 *    décider quoi que ce soit.
 *
 * L'exemple passe par `restore()`, comme une sauvegarde : tout arrive en contenu
 * PERSONNEL, donc modifiable et supprimable. Un exemple qu'on ne peut pas retirer
 * n'est pas un exemple, c'est le programme de quelqu'un d'autre.
 */
const emit = defineEmits<{ flash: [msg: string, ton?: 'ok' | 'echec'] }>()

const PROMPT = `Tu as accès à mon application de suivi sportif et nutritionnel par le connecteur « Van Claude ». Elle est VIDE : aucune séance, aucun aliment, aucune recette, aucun menu.

Aide-moi à la remplir, dans cet ordre — chaque étape a besoin de la précédente.

1. Le programme. Demande-moi combien de séances par semaine, le matériel dont je dispose, mon niveau et mon objectif. Puis crée les séances UNE PAR UNE : cible « programme », op « creer-seance ». Chaque exercice veut un nom, des séries, une fourchette de reps et un repos en secondes.

2. La semaine type. Une fois les séances créées, place-les avec la cible « semaine-type » ({ seances: [...7 entrées, lundi en premier] }), et demande-moi mes jours de télétravail.

3. Les aliments. Demande-moi ce que je mange vraiment. Dépose-les un par un avec la cible « aliment » : valeurs pour 100 g, viandes et féculents crus.

4. Les recettes. Compose mes plats à partir de ces aliments — cible « recette » : petit-déjeuner, boîtes du midi, dîners, collations.

5. Les menus. Range les plats dans une semaine avec la cible « semaine », puis cale les créneaux fixes (petit-déjeuner, collations, avant de dormir) avec « semaine-type » et son champ « slots ».

Deux règles : n'invente aucune valeur que je n'aie confirmée, et attends que j'aie validé une étape avant de passer à la suivante. Chaque proposition arrive dans ma boîte de réception — rien n'est écrit tant que je n'ai pas appuyé sur « Appliquer ».`

const copie = ref(false)
async function copier() {
  try {
    await navigator.clipboard.writeText(PROMPT)
    copie.value = true
    setTimeout(() => { copie.value = false }, 2500)
  } catch {
    // Pas de presse-papiers (contexte non sécurisé, permission refusée) : le texte
    // est visible juste au-dessus, on le dit plutôt que de laisser un bouton mort.
    emit('flash', 'Copie impossible — sélectionne le texte à la main', 'echec')
  }
}

const { chargerExemple } = useRestauration()
const enCours = ref(false)
async function charger() {
  if (enCours.value) return
  enCours.value = true
  const b = await chargerExemple()
  enCours.value = false
  emit('flash', phraseBilan(b), b.ok ? 'ok' : 'echec')
}
</script>

<template>
  <div class="stack">
    <div class="card dem-hero">
      <h2 class="dem-t">Ton programme est vide</h2>
      <p class="dem-p">
        C'est voulu. Van Claude ne livre ni séances, ni aliments, ni menus : tu ne
        commences pas par effacer ceux de quelqu'un d'autre.
      </p>
    </div>

    <div class="card">
      <div class="section-label mb-8">Fais-le remplir par Claude</div>
      <p class="dem-p">
        Connecte ton Claude dans <b>Profil → Connecteur Claude</b>, puis colle-lui ce
        message. Il te posera les questions et déposera ses propositions ici — rien
        ne s'écrit sans ta validation.
      </p>
      <pre class="dem-prompt">{{ PROMPT }}</pre>
      <button class="btn dem-btn" @click="copier">{{ copie ? 'Copié ✓' : '⧉ Copier le message' }}</button>
    </div>

    <div class="card">
      <div class="section-label mb-8">Ou pars d'un exemple</div>
      <p class="dem-p">
        Quatre séances, cent cinquante-deux aliments, trente-quatre recettes et deux
        semaines de menus. Tout arrive comme du contenu <b>personnel</b> : tu le
        modifies, tu en retires ce que tu veux.
      </p>
      <button class="btn dem-btn" :disabled="enCours" @click="charger">
        {{ enCours ? 'Chargement…' : '↓ Charger l\'exemple' }}
      </button>
    </div>
  </div>
</template>
