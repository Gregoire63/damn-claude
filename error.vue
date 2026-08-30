<script setup lang="ts">
import type { NuxtError } from '#app'

/**
 * L'écran des chemins qui n'existent pas.
 *
 * Il est rendu CÔTÉ SERVEUR, contrairement au reste de l'application : c'est ce qui
 * permet de renvoyer un vrai code 404 plutôt qu'un 200 suivi d'une page qui se
 * ravise. Conséquence directe sur ce qu'on peut écrire ici : ni `localStorage`, ni
 * `window`, ni aucun composable de données. Cette page ne sait rien de l'utilisateur,
 * et c'est très bien — elle n'a rien à lui apprendre sur lui-même.
 *
 * Le logo est en `<img>` et non encodé dans la page : ici on peut se permettre une
 * requête, personne n'attend cet écran.
 */
const props = defineProps<{ error: NuxtError }>()

const introuvable = computed(() => props.error?.statusCode === 404)

useHead({
  title: computed(() => (introuvable.value ? 'Page introuvable' : 'Erreur')),
  meta: [{ name: 'robots', content: 'noindex, nofollow' }],
})
</script>

<template>
  <div class="err">
    <img class="err-logo" src="/logo.png" alt="" width="414" height="227">

    <p class="err-code mono">{{ error?.statusCode ?? '???' }}</p>

    <h1 class="err-titre">
      {{ introuvable ? 'Rien à cette adresse' : 'Quelque chose a lâché' }}
    </h1>

    <p class="err-texte">
      <template v-if="introuvable">
        Le grand écart a ses limites. Cette page n'existe pas — vérifie l'adresse,
        ou reviens à l'accueil.
      </template>
      <template v-else>
        L'application n'a pas pu répondre. Tes données sont sur ton téléphone, pas ici :
        elles n'ont rien à craindre de cet écran.
      </template>
    </p>

    <!--
      `clearError` et non un simple lien : il vide l'état d'erreur avant de naviguer.
      Un <NuxtLink> laisserait l'erreur en place et l'écran reviendrait au premier
      changement de route.
    -->
    <button class="err-btn" @click="clearError({ redirect: '/' })">
      Retour à l'accueil
    </button>

    <p v-if="!introuvable && error?.message" class="err-detail mono">{{ error.message }}</p>
  </div>
</template>

<style scoped>
.err {
  min-height: 100dvh;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 14px; padding: 32px 24px; text-align: center;
  background: var(--bg-primary); color: var(--text-primary);
}
.err-logo { width: min(300px, 68vw); height: auto; opacity: 0.9; }
.err-code {
  font-family: var(--font-mono); font-size: 11px; letter-spacing: 0.18em;
  color: var(--accent-strong); margin-top: 6px;
}
.err-titre { font-family: var(--font-display); font-size: 27px; font-weight: 700; line-height: 1.15; }
.err-texte { max-width: 34ch; font-size: 14px; line-height: 1.5; color: var(--text-secondary); }
.err-btn {
  margin-top: 6px; padding: 11px 20px; border: none; border-radius: 10px;
  background: var(--accent-primary); color: var(--bg-primary);
  font-family: var(--font-body); font-size: 14px; font-weight: 600; cursor: pointer;
  transition: background 0.15s;
}
.err-btn:hover { background: var(--accent-strong); }
.err-detail {
  margin-top: 10px; max-width: 46ch; font-size: 11px; line-height: 1.5;
  color: var(--text-muted); word-break: break-word;
}
</style>
