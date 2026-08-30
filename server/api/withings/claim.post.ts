import { defineEventHandler, readBody } from 'h3'
import { takeHandover } from '../../utils/vault'

// ─────────────────────────────────────────────────────────────────────────────
// Étape 3 : l'application vient chercher ses jetons.
// ─────────────────────────────────────────────────────────────────────────────
//
// C'est le seul moment du flux qui se passe à coup sûr DANS la PWA — et c'est pour
// ça qu'il existe. L'autorisation, elle, s'est faite dans un navigateur qu'on ne
// choisit pas.
//
// Le nonce fait office de mot de passe à usage unique : tiré par l'application au
// départ, jamais affiché, jamais passé à Withings en clair (il est signé dans le
// `state`). Rien d'autre n'est demandé, et rien d'autre ne serait vérifiable — la
// page publique /sport n'a pas de session.
//
// Le dépôt est retiré à la première lecture, réussie ou non : deux appels avec le
// même nonce ne peuvent pas rendre le jeton deux fois.

export default defineEventHandler(async (event) => {
  const { nonce } = await readBody<{ nonce?: string }>(event).catch(() => ({ nonce: '' }))
  if (typeof nonce !== 'string' || nonce.length < 16) {
    throw createError({ statusCode: 400, statusMessage: 'Nonce absent' })
  }
  const tokens = await takeHandover(nonce, Date.now())
  // 404 et non 200 avec un corps vide : l'application distingue « pas encore
  // autorisé, je repasserai » d'une réponse qu'elle devrait savoir lire.
  if (!tokens) throw createError({ statusCode: 404, statusMessage: 'Aucun jeton en attente' })
  return { tokens }
})
