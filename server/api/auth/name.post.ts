import { requireSession } from './_auth'
import { addCredential, readCredential } from '../../utils/vault'

/**
 * Corriger le nom du propriétaire.
 *
 * Derrière la session : ce n'est pas une donnée sensible, mais c'est ce que le
 * connecteur raconte à Claude et ce qu'affiche la fenêtre de passkey. Laisser
 * n'importe qui le changer sur une page publique serait une petite porte ouverte
 * pour rien.
 *
 * Un nom vide efface le champ plutôt que d'écrire une chaîne vide : l'instance
 * retombe alors sur la variable d'environnement, puis sur « Moi ». C'est la même
 * cascade que partout, et elle doit rester réversible.
 */
export default defineEventHandler(async (event) => {
  requireSession(event)
  const { nom } = await readBody<{ nom?: string }>(event) ?? {}
  const cred = await readCredential()
  if (!cred) throw createError({ statusCode: 409, statusMessage: 'Aucun passkey enregistré' })

  const propre = String(nom ?? '').trim().slice(0, 40)
  const { ownerName: _, ...reste } = cred
  // Le nom vit sur le PREMIER passkey — celui posé à l'installation. `addCredential`
  // remplace l'entrée de même identifiant sans toucher aux autres.
  await addCredential(propre ? { ...reste, ownerName: propre } : reste)
  return { ok: true, ownerName: propre }
})
