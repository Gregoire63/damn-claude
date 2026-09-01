import { bootstrapArme, origineBootstrap, readMirror, readProposals } from '../../utils/vault'
import { session } from '../auth/_auth'
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
export default defineEventHandler(async (event) => {
  const raw = (k: string) => process.env[k] || ''
  /**
   * `NUXT_VAULT_BOOTSTRAP` n'est PLUS dans cette liste, et c'est une correction.
   *
   * Le code de démarrage est fabriqué au build et imprimé dans le journal de
   * déploiement : il n'y a plus de variable à poser. La laisser ici faisait afficher
   * « le serveur n'est pas prêt » avec un nom de variable en rouge, sur une
   * installation parfaitement correcte — et envoyait créer une variable dont le seul
   * effet est de revenir à un secret permanent.
   */
  const env = {
    NUXT_VAULT_SECRET: raw('NUXT_VAULT_SECRET').trim().length >= 24,
  }

  /**
   * Les identifiants MCP ne sont plus OBLIGATOIRES, et c'est ce qui a changé.
   *
   * Ils étaient dans `env`, donc leur absence rendait `pret` faux : sur une
   * installation neuve, l'écran annonçait « Serveur incomplet » et barrait la
   * création de la clé d'accès tant qu'on n'avait pas inventé deux valeurs et
   * recopié la seconde dans Claude.
   *
   * Depuis que les clients s'inscrivent tout seuls (RFC 7591, voir
   * server/api/oauth/register.post.ts), il n'y a plus rien à inventer ni à recopier.
   * La paire reste acceptée — une instance déjà branchée continue de marcher — mais
   * elle est le VIEUX chemin, et rien ne doit plus s'arrêter parce qu'elle manque.
   */
  const clientManuel = {
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
    /** « build » = à lire dans le journal du dernier déploiement ; « env » = posé à la main. */
    origine: origineBootstrap(),
    /** Encore utilisable ? Consommé, il faut redéployer — ou changer la variable. */
    arme: await bootstrapArme(),
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
    /** Le client OAuth recopié à la main : facultatif depuis l'inscription automatique. */
    client_manuel: clientManuel,
    /** L'inscription automatique des clients est-elle disponible ? */
    inscription_auto: true,
    bootstrap,
    store,
    driver,
    // Le manque le plus fréquent après l'installation : le serveur va bien, mais le
    // téléphone n'a jamais poussé ses données. Vu du connecteur, ça ressemble à une
    // panne ; vu d'ici, ça se lit en un coup d'œil.
    miroir,
    propositions_en_attente: propositions,
    /*
     * Le bloc de diagnostic ne sort QUE pour une session ouverte.
     *
     * Le reste de ce point d'entrée est volontairement public : il répond
     * « pourquoi ça ne marche pas » à quelqu'un qui n'a pas encore de clé d'accès, ce
     * qui est précisément le moment où l'on en a besoin. Mais la trace, elle, dit qui
     * appelle et qui s'inscrit — des noms de clients, des adresses de retour. Rien de
     * secret, et pourtant : ça n'a aucune raison d'être lisible par un passant, et un
     * point d'entrée public qui s'enrichit avec le temps finit toujours par en dire
     * plus qu'on ne voulait.
     *
     * `null` plutôt qu'une absence de clé : l'écran qui la lit doit pouvoir dire
     * « déverrouille pour voir » au lieu de croire le serveur muet.
     */
    instance: session(event) ? trace() : null,
  }
})
