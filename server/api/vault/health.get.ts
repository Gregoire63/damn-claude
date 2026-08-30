import { readMirror, readProposals } from '../../utils/vault'
import { trace } from '../../utils/trace'

/**
 * « Pourquoi ça ne marche pas ? » — répondu par le serveur lui-même.
 *
 * Sans ce point d'entrée, une variable oubliée ou un stockage injoignable se
 * manifestaient de la pire façon : l'écran affichait « Aucun passkey », c'est-à-dire
 * exactement ce qu'il affiche quand tout va bien mais qu'on n'a rien fait encore. On
 * cherchait alors du côté du navigateur un problème qui était côté serveur.
 *
 * Rien de sensible n'en sort : des booléens de PRÉSENCE, jamais une valeur. Savoir
 * qu'un secret est configuré n'aide personne à le deviner.
 */
export default defineEventHandler(async () => {
  const raw = (k: string) => process.env[k] || ''
  const env = {
    NUXT_VAULT_SECRET: raw('NUXT_VAULT_SECRET').trim().length >= 24,
    NUXT_VAULT_BOOTSTRAP: !!raw('NUXT_VAULT_BOOTSTRAP').trim(),
    NUXT_MCP_CLIENT_ID: !!raw('NUXT_MCP_CLIENT_ID').trim(),
    NUXT_MCP_CLIENT_SECRET: !!raw('NUXT_MCP_CLIENT_SECRET').trim(),
  }

  /**
   * De quoi diagnostiquer un code de demarrage refuse, sans le reveler.
   *
   * Un 403 sur l'enregistrement ne dit qu'une chose — « ce n'est pas la bonne
   * valeur » — et laisse chercher entre une faute de frappe, un remplissage
   * automatique et un retour a la ligne colle dans la variable. La LONGUEUR
   * repond a la question en une seconde : on compte ce qu'on tape et on compare.
   * Elle ne donne rien a qui voudrait deviner le code : connaitre « 12 » ne reduit
   * pas un espace de 62^12 possibilites.
   */
  const bootstrap = {
    longueur: raw('NUXT_VAULT_BOOTSTRAP').trim().length,
    espaces_parasites: raw('NUXT_VAULT_BOOTSTRAP') !== raw('NUXT_VAULT_BOOTSTRAP').trim(),
  }
  const driver = process.env.NETLIFY || process.env.NETLIFY_BLOBS_CONTEXT ? 'netlify-blobs' : 'fichier local'

  // On teste la LECTURE, jamais l'écriture : un diagnostic qui écrit peut casser ce
  // qu'il diagnostique. La lecture suffit à distinguer « stockage injoignable » de
  // « stockage vide », qui sont deux situations très différentes.
  let store = 'ok'
  let miroir: { pousse_le: string, seances: number, pesees: number } | null = null
  let propositions = 0
  try {
    const m = await readMirror()
    if (m) {
      const data = m.data as Record<string, unknown>
      miroir = {
        pousse_le: m.at,
        seances: Array.isArray(data.sessions) ? data.sessions.length : 0,
        pesees: Array.isArray(data.bodyWeight) ? data.bodyWeight.length : 0,
      }
    }
    propositions = (await readProposals()).filter(p => p.status === 'pending').length
  }
  catch (e) { store = `erreur : ${e instanceof Error ? e.message : String(e)}`.slice(0, 160) }

  return {
    pret: Object.values(env).every(Boolean) && store === 'ok',
    env,
    bootstrap,
    store,
    driver,
    // Le manque le plus fréquent après l'installation : le serveur va bien, mais le
    // téléphone n'a jamais poussé ses données. Vu du connecteur, ça ressemble à une
    // panne ; vu d'ici, ça se lit en un coup d'œil.
    miroir,
    propositions_en_attente: propositions,
    // De quoi trancher « la requête n'arrive pas » contre « elle arrive et échoue ».
    // Voir server/utils/trace.ts : rien n'est écrit, tout est en mémoire du processus.
    instance: trace(),
  }
})
