import { addProposal, readMirror, readProposals, verifyToken } from '../utils/vault'
import { classerErreur, noteCall, noteOutcome } from '../utils/trace'
import { DAY_NAMES, KIND_GROUP_LABELS, bmrMifflin, builtinWeeks, dayEnergy, dowIndex, expandItems, isDayPlayed, keepsOf, macrosOf, mergeRecipes, mergeFoods, mondayOf, normalizeWeek, proteinPlan, recipeForSlot, resolveDay, roundMacros } from '~/lib/nutritionStats'
import { cookedWeight } from '~/lib/cooked'
import { dayBudget, fitInto } from '~/lib/dayBudget'
import type { SlotState } from '~/lib/dayBudget'
import { SLOTS_GYM, SLOTS_REST } from '~/data/nutritionProgram'
import { getAt } from '~/lib/pointer'
import { checkFieldFix, foodFor, planFor, programFor, recipeFor, twinPath } from '~/lib/proposals'
import { weightTrend } from '~/lib/bilan'
import { carriedComp } from '~/lib/mesures'
import { weightOn } from '~/lib/weight'
import { ageOn, sessionBurn } from '~/lib/energy'
import { PROGRAM } from '~/data/sportProgram'
import type { Exercise, Session } from '~/data/sportProgram'
import { mergeProgram, retiredExercises } from '~/lib/program'
import { restFor } from '~/lib/rest'
import { ownerName } from './auth/_auth'
import { repsGap } from '~/lib/repsGap'
import type { ProgramCustom } from '~/lib/program'
import { VARIANTS } from '~/data/exerciseVariants'

// ─────────────────────────────────────────────────────────────────────────────
// Le connecteur : ce que Claude peut voir, et ce qu'il ne peut pas faire.
// ─────────────────────────────────────────────────────────────────────────────
//
// Un serveur MCP, c'est-à-dire du JSON-RPC sur une URL, avec trois méthodes qui
// comptent : se présenter (`initialize`), annoncer ses outils (`tools/list`), les
// exécuter (`tools/call`).
//
// La règle qui structure tout le fichier : les outils de LECTURE lisent le miroir,
// les outils d'ÉCRITURE n'écrivent rien. Ils déposent une proposition dans une
// file, que l'application montre à l'ouverture et qu'on applique d'un geste. Le
// connecteur ne peut donc pas modifier des données, seulement demander qu'on les
// modifie — et une mauvaise interprétation de ma part coûte un refus, pas une
// séance perdue.
//
// Les réponses sont bornées en taille. Un historique complet renvoyé d'un bloc
// remplirait la fenêtre de contexte avec des séries de 2024 pour répondre à une
// question sur cette semaine.

const PROTOCOL_FALLBACK = '2025-06-18'
const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05']
/** Au-delà, on tronque et on le dit : une réponse muette qui déborde est pire
 *  qu'une réponse courte qui annonce ce qu'elle a coupé. */
const MAX_RESULT_BYTES = 40_000

interface Rpc { jsonrpc: string, id?: string | number | null, method?: string, params?: Record<string, unknown> }

export default defineEventHandler(async (event) => {
  // Le corps est lu en premier pour pouvoir COMPTER l'appel avant de le juger : ce
  // qu'on cherche à savoir, c'est si la requête est arrivée jusqu'ici, pas si elle
  // était en droit d'être servie. Un corps illisible compte aussi — il est arrivé.
  const rpc = await readBody<Rpc>(event).catch(() => null)
  noteCall(typeof rpc?.method === 'string' ? rpc.method : '(corps illisible)', new Date())

  const auth = getRequestHeader(event, 'authorization') ?? ''
  const token = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  const claims = verifyToken(token, Date.now())
  if (!claims || claims.scope !== 'suivi') {
    // L'en-tête pointe vers le document de découverte : un client MCP qui reçoit ce
    // 401 sait alors tout seul où aller s'authentifier, sans configuration.
    //
    // L'adresse annoncée est celle de la RFC 9728 — le segment bien-connu s'insère
    // AVANT le chemin de la ressource. Elle pointait vers la racine, qui n'est pas
    // ce que la règle décrit ; les deux répondent aujourd'hui, mais on annonce la
    // bonne, parce que c'est elle qu'un client strict recalculera de son côté.
    const base = getRequestURL(event).origin
    setHeader(event, 'WWW-Authenticate', `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/api/mcp"`)
    throw createError({ statusCode: 401, statusMessage: 'Jeton absent ou invalide' })
  }

  if (!rpc || typeof rpc.method !== 'string') {
    return { jsonrpc: '2.0', id: rpc?.id ?? null, error: { code: -32600, message: 'Requête invalide' } }
  }
  // Une notification (pas d'identifiant) n'attend aucune réponse.
  const isNotification = rpc.id === undefined || rpc.id === null
  const reply = (result: unknown) => (isNotification ? null : { jsonrpc: '2.0', id: rpc.id, result })

  try {
    switch (rpc.method) {
      case 'initialize': {
        const asked = String((rpc.params?.protocolVersion as string) ?? '')
        return reply({
          protocolVersion: SUPPORTED.includes(asked) ? asked : PROTOCOL_FALLBACK,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'damn-claude', version: '1.0.0' },
          instructions: await instructions(),
        })
      }
      case 'notifications/initialized':
        return reply({})
      case 'ping':
        return reply({})
      case 'tools/list':
        return reply({ tools: TOOLS })
      case 'tools/call': {
        const name = String(rpc.params?.name ?? '')
        const args = (rpc.params?.arguments ?? {}) as Record<string, unknown>
        const out = await callTool(name, args)
        // Le nom de l'outil n'est connu qu'ici : `noteCall` s'exécute avant la
        // lecture des paramètres. Sans lui, le relevé dit « tools/call » douze fois
        // de suite et on ne sait pas lequel a lâché.
        noteOutcome(`${name} ok`)
        return reply({ content: [{ type: 'text', text: clamp(out) }] })
      }
      default:
        if (isNotification) return null
        return { jsonrpc: '2.0', id: rpc.id, error: { code: -32601, message: `Méthode inconnue : ${rpc.method}` } }
    }
  }
  catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    const classe = classerErreur(e)
    const outil = rpc?.method === 'tools/call' ? String(rpc.params?.name ?? '?') : String(rpc?.method ?? '?')
    noteOutcome(`${outil} ${classe}`)
    // Journalisé côté serveur EN PLUS d'être rendu au client : quand la passerelle
    // renonce avant notre réponse, le client ne voit qu'un « serveur ne répond
    // pas ». Le journal Netlify, lui, garde la vraie cause.
    console.error(`[mcp] ${outil} — ${classe} — ${message}`)
    if (isNotification) return null
    // Une erreur d'OUTIL se rend dans le résultat, pas en erreur JSON-RPC : le
    // modèle doit pouvoir la lire et corriger son appel plutôt que voir la
    // conversation s'interrompre.
    if (rpc.method === 'tools/call') {
      return { jsonrpc: '2.0', id: rpc.id, result: { isError: true, content: [{ type: 'text', text: `Erreur : ${message}` }] } }
    }
    return { jsonrpc: '2.0', id: rpc.id, error: { code: -32603, message } }
  }
})

/**
 * Ce que le connecteur dit de lui-même à Claude.
 *
 * Le prénom y était en dur : quelqu'un qui héberge ce code voyait son assistant
 * parler des séances de quelqu'un d'autre. Il vient maintenant de la configuration —
 * une seule variable, `NUXT_OWNER_NAME`, et un texte qui reste juste quand elle est
 * absente.
 */
const instructions = async () => `Suivi d'entraînement et de nutrition de ${await ownerName()}.
Les données sont une COPIE envoyée par son appareil : elles peuvent avoir quelques heures de retard, l'outil « etat » en donne la date.
Aucune modification directe n'est possible : « proposer_modification » dépose une proposition à valider dans l'application.
Réponds en français, en t'appuyant sur ses chiffres réels plutôt que sur des généralités.`

const TOOLS = [
  {
    name: 'bilan',
    description: 'LE PREMIER OUTIL À APPELER. Rend d\'un seul coup tout ce par quoi commence une conversation : fraîcheur du miroir, séance et repas prévus aujourd\'hui, dernières séances en résumé, tendance de poids sur 7 et 30 jours, propositions en attente. Évite d\'enchaîner « etat », « seances », « poids » et « nutrition » — n\'appelle les outils détaillés qu\'ensuite, pour ce qui manque.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Jour de référence AAAA-MM-JJ (défaut : aujourd\'hui)' },
        seances: { type: 'integer', description: 'Nombre de séances récentes à résumer (défaut 5, maximum 15)' },
      },
    },
  },
  {
    name: 'etat',
    description: 'Fraîcheur du miroir et volume de données disponibles, sans le reste. Préfère « bilan », qui contient déjà ça.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'profil',
    description: 'Profil (taille, sexe, année de naissance), semaine type d\'entraînement, exceptions de planning par date, jours de salle et de télétravail, et le FOYER : qui mange à la maison et l\'appétit de chacun, exprimé par rapport à celui du propriétaire (1 = autant que lui).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'seances',
    description: 'Séances enregistrées, de la plus récente à la plus ancienne : exercices, séries (charge × reps), ressenti, machine utilisée, notes.',
    inputSchema: {
      type: 'object',
      properties: {
        limite: { type: 'integer', description: 'Nombre de séances (défaut 8, maximum 40)' },
        depuis: { type: 'string', description: 'Date ISO AAAA-MM-JJ : ne renvoyer que les séances à partir de cette date' },
      },
    },
  },
  {
    name: 'exercice',
    description: 'Historique complet d\'UN exercice : toutes ses séances, charges, reps, machine utilisée. Sert à répondre « où j\'en suis au squat ».',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Identifiant, ex. squat, dc-barre, tirage-v' } },
      required: ['id'],
    },
  },
  {
    name: 'poids',
    description: 'Suivi corporel : pesées, et composition (masse grasse, muscle, eau) quand la balance l\'a donnée.',
    inputSchema: {
      type: 'object',
      properties: { limite: { type: 'integer', description: 'Nombre de pesées les plus récentes (défaut 30)' } },
    },
  },
  {
    name: 'nutrition',
    description: 'Données de nutrition. Sans argument, renvoie la liste des rubriques disponibles avec leur taille ; avec « rubrique », renvoie son contenu.',
    inputSchema: {
      type: 'object',
      properties: { rubrique: { type: 'string', description: 'Nom exact de la rubrique à lire' } },
    },
  },
  {
    name: 'journee',
    description: 'CE QUI RESTE À MANGER AUJOURD\'HUI. Cible calorique et protéique du jour, ce qui est déjà avalé, ce que les créneaux non cochés apportent s\'ils sont pris tels quels, et donc l\'écart à combler. À appeler AVANT de composer quoi que ce soit : sans lui on compose à l\'estime, et l\'estime se trompe toujours dans le même sens.',
    inputSchema: {
      type: 'object',
      properties: { date: { type: 'string', description: 'AAAA-MM-JJ — par défaut aujourd\'hui' } },
    },
  },
  {
    name: 'composer',
    description: 'Calcule les macros EXACTES d\'une liste d\'ingrédients et les confronte à ce qui reste sur la journée. Sert à vérifier une composition avant de la déposer, plutôt qu\'à s\'excuser après : les grammages passent par le catalogue, il n\'y a plus de calcul de tête. Un « food » inconnu est signalé nommément.',
    inputSchema: {
      type: 'object',
      properties: {
        items: {
          type: 'array',
          description: '[{ food: "saumon", g: 211 }, …] — identifiants du catalogue (outil « aliments »)',
          items: {
            type: 'object',
            properties: {
              food: { type: 'string', description: 'Identifiant de l\'aliment' },
              g: { type: 'number', description: 'Grammes, CRUS pour viandes, poissons et féculents' },
            },
            required: ['food', 'g'],
          },
        },
        date: { type: 'string', description: 'AAAA-MM-JJ — la journée sur laquelle imputer le repas. Par défaut aujourd\'hui.' },
      },
      required: ['items'],
    },
  },
  {
    name: 'plats',
    description: 'Catalogue des plats : identifiant, nom, type de créneau, conservation. C\'est la liste des identifiants VALIDES pour proposer un menu ou un changement de plat — ne jamais en inventer un.',
    inputSchema: {
      type: 'object',
      properties: { kind: { type: 'string', description: 'Filtrer : pdj, collation, boite, diner, sauce' } },
    },
  },
  {
    name: 'recette',
    description: 'Le contenu RÉEL d\'un plat : ses ingrédients avec leurs grammages (crus), sa préparation, ses macros, sa conservation, sa sauce. Indispensable avant de modifier une recette — « plats » ne donne que les noms. Sans argument, rend la liste des identifiants. Avec { date, slot } au lieu d\'un id, rend la composition du REPAS LIBRE de ce créneau — c\'est ainsi qu\'on relit une variante qu\'on a soi-même déposée, plutôt que de la recalculer de mémoire.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Identifiant du plat, ex. « boite-a »' },
        date: { type: 'string', description: 'AAAA-MM-JJ — avec « slot », lit le repas libre de ce jour au lieu du catalogue' },
        slot: { type: 'string', description: 'Créneau : pdj, creatine, pre, lunch, snack, dinner, night' },
      },
    },
  },
  {
    name: 'aliments',
    description: 'Catalogue des aliments : identifiant, nom, macros pour 100 g, conservation. Ce sont les seuls identifiants valides dans les ingrédients d\'une recette — ne jamais en inventer un.',
    inputSchema: {
      type: 'object',
      properties: { cherche: { type: 'string', description: 'Filtre sur le nom (ex. « saumon »)' } },
    },
  },
  {
    name: 'programme',
    description: 'Le programme d\'entraînement TEL QU\'IL EST aujourd\'hui : séances (identifiant, nom, jour) et, pour chaque exercice, séries, reps, repos en secondes, mesure (reps ou temps), s\'il est actif, s\'il est facultatif, sa position dans la séance, et les machines de remplacement avec leur coefficient. À lire AVANT toute proposition « cible: programme » : les identifiants et les valeurs actuelles viennent d\'ici.',
    inputSchema: {
      type: 'object',
      properties: {
        seance: { type: 'string', description: 'Identifiant d\'une séance (s1…s4) pour n\'avoir qu\'elle' },
        inclure_inactifs: { type: 'boolean', description: 'Montrer aussi les exercices RETIRÉS du programme, à leur place, avec actif: false. À utiliser avant de proposer une réactivation : leur historique est intact.' },
      },
    },
  },
  {
    name: 'menus',
    description: 'Semaines de menus existantes (les siennes et celles livrées) et à quel lundi chacune est appliquée.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'champ',
    description: 'Lit UNE valeur de la sauvegarde par son chemin (pointeur JSON, ex. « /sessions/12/durationMin »). À appeler AVANT toute correction de champ, pour connaître la valeur exacte à mettre dans « de ». Sans argument, renvoie la carte des sections avec leur taille et un exemple de chemin.',
    inputSchema: {
      type: 'object',
      properties: { chemin: { type: 'string', description: 'Pointeur JSON, commençant par / — sans argument, rend la carte de la sauvegarde (les sections, leur taille, un exemple de chemin). C\'est le point d\'entrée de « correction / quoi: champ », qui sait remplacer, créer, ajouter à une liste et supprimer.' } },
    },
  },
  {
    name: 'propositions',
    description: 'Les modifications déjà proposées et leur sort (en attente, appliquée, refusée).',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'proposer_modification',
    description: 'Dépose une proposition de modification. N\'écrit RIEN : elle s\'affiche à l\'ouverture de l\'application, et c\'est lui qui décide. Décris précisément ce qui change.',
    inputSchema: {
      type: 'object',
      properties: {
        resume: { type: 'string', description: 'Une phrase lisible, ex. « Vendredi midi : Boîte B → Saumon patate douce »' },
        cible: {
          type: 'string',
          enum: ['semaine', 'semaine-type', 'plat', 'planning-seance', 'recette', 'aliment', 'repas-libre', 'programme', 'correction', 'autre'],
          description: 'Ce qui est touché',
        },
        detail: {
          type: 'object',
          description: [
            'Le détail exploitable, dont la forme dépend de « cible ». Les deux formes ci-dessous s\'appliquent d\'un tap ; toute autre s\'affiche mais devra être faite à la main.',
            '• plat : { date: "AAAA-MM-JJ", slot: "lunch"|"dinner"|"pdj"|"snack"|"night"|"pre"|"creatine", vers: "<id de plat>" ou null pour revenir au plat prévu }',
            '• planning-seance : { date: "AAAA-MM-JJ", vers: "s1".."s4" ou "repos" }',
            '• repas-libre : { date: "AAAA-MM-JJ", slot: "lunch", vers: { label: "Kebab galette + frites", kcal: 1050, p: 45, g: 95, l: 50 } } — un repas qu\'il n\'a pas cuisiné, qui REMPLACE le plat prévu de ce créneau et porte ses propres macros. « vers: null » le retire et rend le créneau au plat prévu. C\'est la seule forme où tu fournis des chiffres estimés : donne les quatre, les protéines surtout, et dis dans le résumé sur quoi tu t\'es basé. DÈS QUE TU CONNAIS LE CONTENU, ajoute « items: [{ food, g }] » (vérifie-les d\'abord avec « composer ») et, si c\'est la variante d\'un plat du catalogue, « base: "<id du plat>" ». Ce n\'est pas un détail de forme : sans items l\'application ne peut afficher qu\'un nombre et l\'étiquette « du dehors », et il perd les grammages au moment précis où il en a besoin, devant sa balance. Avec eux, elle affiche « modifié », la composition ligne par ligne, et un lien vers la recette d\'origine — sans avoir à te redemander.',
            '  Trois champs FACULTATIFS de « vers » servent quand le repas est une VARIANTE d\'un plat du catalogue — mêmes ingrédients, portions changées, ingrédient remplacé, sauce retirée :',
            '    · base : l\'identifiant du plat dont ça dérive, ex. "din-saumon". Affiche « variante de : … » et donne accès à la recette standard en regard.',
            '    · items : [{ food: "saumon", g: 211 }, …] — la composition RÉELLE de ce repas-là. Appelle « recette » sur le plat d\'origine et repars de ses ingrédients en corrigeant ce qui a changé. Chaque « food » doit exister (outil « aliments ») ou le dépôt est refusé. La liste peut être PARTIELLE : si un ingrédient n\'a pas d\'identifiant — un gigot, un burger — liste les autres, ce sont tes macros qui font foi.',
            '    · steps : la préparation adaptée, seulement si elle diffère de celle du catalogue.',
            '  Ça ne modifie JAMAIS le plat du catalogue : la variante ne vaut que pour ce repas et ce jour. Donne toujours kcal/p/g/l même avec « items » — l\'application calcule les macros des ingrédients listés et te les compare, elle ne les remplace pas. Un écart de plus de 10 % s\'affiche comme un avertissement à la validation, pas comme un refus.',
            '  Pour relire une composition déjà déposée, appelle « recette » avec { date, slot } au lieu d\'un id — plus fiable que de la recalculer de mémoire.',
            '• semaine : { lundi: "AAAA-MM-JJ", nom: "…", jours: [ { lunch: "<id>", dinner: "<id>", off?: true }, … 7 entrées, lundi en premier ] }',
            '• semaine-type : { seances?: ["s1","s2",null,"s3","s4",null,null], salle?: [7 booléens], teletravail?: [7 booléens] } — lundi en premier, les trois axes sont indépendants',
            '• recette : { id?: "<id existant pour modifier>", nom, kind: "pdj"|"boite"|"diner"|"collation"|"sauce", batch?: true, steps?: "…", sauce?: "<id de sauce>", keeps?: 4, items: [ { food: "<id d\'aliment>", g: 120 } ] } — « items » REMPLACE la liste, envoie-la complète. Lis d\'abord la recette avec l\'outil « recette » : sans ça tu effaces des ingrédients sans le savoir. « steps » est la marche à suivre du batch cooking, « keeps » la conservation en jours — c\'est elle qui décide dans quelle session de cuisine le plat tombe.',
            '• aliment : { id?: "<id existant pour corriger>", nom, cat: "viandes"|"poissons"|"oeufs"|"laitiers"|"feculents"|"legumes"|"fruits"|"grasses"|"aromates"|"complements"|"boissons", kcal, p, g, l, cook?: "6 min vapeur", buy?: "1 c. à café = 5 g", keeps?: 5 } — valeurs POUR 100 g, viandes et féculents crus. Les macros doivent expliquer les calories à 25 % près, sinon c\'est refusé : une étiquette mal recopiée ne fait rien planter, elle fausse les calories pour toujours.',
            '• programme : { seance: "<identifiant de séance>", op: "creer-seance"|"ajouter"|"modifier"|"retirer"|"reactiver"|"reordonner", … } — tout ce qu\'un coach fait sur un plan. LIS D\'ABORD l\'outil « programme » : il donne les identifiants de séances existants, les séries, les reps, le repos, la mesure, les positions et les machines de remplacement ACTUELS. Une seule op par proposition — il valide geste par geste, et un refus ne doit pas emporter les autres.',
            '    · creer-seance : { op: "creer-seance", seance: "s5", nom: "Haut du corps", jour?: "Lundi · Push", couleur?: "#8b6f5c", exercices: [ { id?: "developpe-couche", nom: "Développé couché", series: 4, reps: "6-8", repos_s: 150, mesure?: "reps"|"temps", machine?: "Banc + barre", optionnel?: true, muscles?: [...], machines_de_remplacement?: [...] }, … 1 à 30 ] } — crée une séance ENTIÈRE. C\'est le seul geste qui exige un identifiant de séance encore LIBRE : tous les autres exigent l\'inverse. Sur une installation neuve le programme est VIDE — commence par là, il n\'y a aucune séance à laquelle rattacher un exercice tant qu\'aucune n\'est créée.',
            '      Chaque exercice veut nom, series, reps et repos_s, mêmes règles que « ajouter » : sans eux la fiche s\'affiche vide et la séance n\'a rien à saisir. Les identifiants d\'exercices doivent être libres eux aussi, y compris vis-à-vis des mouvements RETIRÉS d\'une autre séance — l\'historique de charges est indexé sur l\'identifiant seul. Une séance vide (zéro exercice) est refusée : elle s\'ouvrirait sur un écran sans rien, et rien n\'indiquerait qu\'il reste à la remplir.',
            '      « jour » est l\'étiquette affichée au-dessus du nom sur la carte de séance — « Lundi · Push », « Mardi · Jambes ». Les muscles ne se déclarent PAS au niveau de la séance : ils sont déduits des exercices, et une liste saisie à la main s\'écarterait du contenu réel au premier mouvement retiré.',
            '    · ajouter : { op: "ajouter", seance: "s2", id: "farmer-walk", nom: "Farmer\'s walk", series: 3, reps: "30-40 s", mesure: "temps", repos_s: 90, muscles: ["avant-bras","abdos"], machine: "Haltères lourds ou trap bar", optionnel?: true, apres?: "curl-marteau", machines_de_remplacement?: [{ id, nom, coefficient }] }',
            '      « repos_s » est OBLIGATOIRE, en secondes (20 à 900) : il n\'y a pas de défaut, le déduire des reps donnerait 40 secondes sur « 30-40 s », c\'est-à-dire un repos calculé sur une durée d\'effort. « id » est déduit du nom si tu ne le donnes pas ; un identifiant DÉJÀ PRIS — même dans une autre séance, même sur un exercice retiré — est REFUSÉ : l\'historique de charges est indexé sur l\'identifiant seul, le réutiliser rangerait de vieux records sous un mouvement jamais fait. « apres » insère juste après cet exercice actif ; absent, l\'exercice va en fin de séance ; invalide, c\'est un refus et non un repli silencieux.',
            '    · modifier : { op: "modifier", seance: "s1", exercice: "squat", series?: 3, de_series: 2, reps?: "6-8", de_reps: "8-10", repos_s?: 150, de_repos_s: 120, nom?, mesure?, machine?, optionnel?, muscles?: [...], machines_de_remplacement?: [...] } — ne change QUE les champs envoyés.',
            '      « series », « reps » et « repos_s » exigent leur « de_… » : la valeur actuellement enregistrée, telle que « programme » la donne. Manquant ou faux = REFUS. C\'est ce qui empêche une proposition bâtie sur un miroir de trois heures d\'écraser un réglage changé depuis sur le téléphone — trois séries au lieu de quatre, ça ne se remarque pas en salle, on les fait, c\'est tout. Les autres champs (nom, machine, muscles, consignes) n\'en demandent pas.',
            '    · retirer : { op: "retirer", seance: "s2", exercice: "sdt-r" } — DÉSACTIVE, ne supprime PAS. Le mouvement sort de la séance du jour, son historique de charges reste intact et reste lisible par l\'outil « exercice ». Repris trois mois plus tard, il retrouve ses courbes au lieu de repartir de zéro. Le retirer deux fois est un refus, pas un geste sans effet.',
            '    · reactiver : { op: "reactiver", seance: "s2", exercice: "sdt-r", apres?: "squat" } — sans « apres », il reprend exactement la place qu\'il occupait. Appelle « programme » avec inclure_inactifs: true pour voir ce qui a été retiré.',
            '    · reordonner : { op: "reordonner", seance: "s3", ordre: ["squat","sdt-r","fentes","leg-curl","mollets","releves"] } — la liste COMPLÈTE des actifs de la séance, dans l\'ordre voulu. Une liste partielle est refusée : les exercices omis garderaient leur place et s\'intercaleraient, donnant un ordre silencieusement différent de celui demandé. L\'ordre a un sens physiologique : un exercice de poigne ou de gainage placé AVANT un soulevé lourd dégrade le soulevé — la poigne lâche avant les ischios, le gainage avant le tronc.',
            '  « muscles » et « machines_de_remplacement » REMPLACENT la liste, ils ne fusionnent pas — même règle que « items » sur une recette. Repars de la liste complète donnée par « programme », sinon tu effaces ce que tu n\'as pas recopié.',
            '  « mesure: "temps" » (défaut : "reps") sort l\'exercice de la progression automatique, de la détection de record et du 1RM estimé. Mets-le sur tout ce qui se compte en secondes — portés, suspensions, gainage : sinon « 30-40 s » se lit 40 répétitions, l\'app croit la cible atteinte et conseille de charger.',
            '  « optionnel: true » : le mouvement s\'affiche grisé en fin de séance et ne compte pas dans le seuil des 80 % qui autorise l\'enregistrement, mais compte normalement dans le volume et les records dès qu\'il est fait.',
            '• correction, série : { quoi: "serie", exercice: "<id>", date: "AAAA-MM-JJ", serie: 0, de: { w, r }, vers: { w, r } }',
            '• correction, pesée : { quoi: "pesee", date: "AAAA-MM-JJ", de: 77.4, vers: 76.9 } — « vers: null » supprime la pesée',
            '• correction, N\'IMPORTE OÙ dans la sauvegarde : { quoi: "champ", op: "remplacer"|"creer"|"ajouter"|"supprimer", chemin: "/sessions/12/durationMin", … }. C\'est le passe-partout : tout ce que l\'application sait écrire est atteignable par là. Lis le chemin d\'abord avec l\'outil « champ » — sans argument il rend la carte de la sauvegarde, avec un chemin il rend la valeur.',
            '    · remplacer (défaut) : { chemin, de: 50, vers: 65 } — une valeur SIMPLE contre une autre. « de » obligatoire.',
            '    · creer : { chemin, vers: … } — une feuille ABSENTE. Le parent doit exister ; on ne fabrique jamais une branche entière. « vers » peut être un objet ou un tableau (400 valeurs, 6 niveaux max), ce qui permet d\'ajouter une clé de jour : /nutrition/extras/2026-08-20.',
            '    · ajouter : { chemin, vers: … } — à la FIN d\'un tableau existant. Le chemin désigne le tableau, pas une position : /bodyWeight pour une pesée oubliée, /nutrition/baskets pour des courses.',
            '    · supprimer : { chemin, de: <la valeur exacte qui est là> } — retire une clé ou un élément de tableau. « de » obligatoire et confronté à l\'identique : effacer une entrée sur une description approximative effacerait la voisine.',
            '  Deux choses seulement restent impossibles, et c\'est délibéré : REMPLACER un objet ou un tableau entier (réécrire d\'un coup une section dont on ne saurait pas dire ce qu\'elle contenait), et créer une branche dont le parent n\'existe pas. Pour changer un objet : descends d\'un cran, ou supprime puis crée.',
            '  Préfère toujours une cible TYPÉE quand elle existe — « plat », « recette », « programme », « correction/serie », « correction/pesee ». Elles valident la forme, produisent une carte de validation lisible, et passent par les mêmes fonctions que l\'écran. Le passe-partout est là pour ce qu\'aucune ne couvre.',
            'Les corrections portent « de » : la valeur actuellement enregistrée. Si elle ne correspond pas, l\'application REFUSE — c\'est ce qui empêche d\'écraser une donnée qu\'on avait mal lue. Lis-la d\'abord avec « exercice » ou « poids ».',
          ].join('\n'),
        },
      },
      required: ['resume', 'cible', 'detail'],
    },
  },
]

/**
 * Pourquoi une proposition a été refusée, en pointant la cause la plus probable.
 *
 * « Proposition invalide » ferait retenter au hasard. Les trois causes qui reviennent
 * — un identifiant d'aliment qui n'existe pas, des macros qui ne collent pas aux
 * calories, une catégorie inventée — se distinguent en quelques lignes, et chacune
 * dit quoi corriger.
 */
interface RefusCtx {
  foodKnown: (id: string) => boolean
  recipeKnown: (id: string) => boolean
  sessionKnown?: (id: string) => boolean
  /** Les séances qui EXISTENT, pour pouvoir les nommer dans un refus plutôt que
   *  d'écrire « s1 à s4 » — ce qui est faux dès qu'une séance a été créée, et
   *  doublement faux sur une installation neuve où il n'y en a aucune. */
  sessionIds?: () => string[]
  exerciseKnown?: (id: string) => boolean
  exercisesOf?: (id: string) => string[]
  exerciseAt?: (id: string) => { seance: string, seanceNom: string, actif: boolean, ex: Exercise } | null
}

function refusMessage(cible: string, d: Record<string, unknown>, ctx: RefusCtx): string {
  if (cible === 'programme') {
    const op = String(d.op ?? d.action ?? d.geste ?? '').replace(/^ordre$/, 'reordonner')
    const seance = String(d.seance ?? d.session ?? '')
    const src = ((d.patch ?? d.nouveau ?? d.vers) && typeof (d.patch ?? d.nouveau ?? d.vers) === 'object'
      ? (d.patch ?? d.nouveau ?? d.vers)
      : d) as Record<string, unknown>
    const lire = (o: Record<string, unknown>, ...k: string[]) => k.map(x => o[x]).find(v => v !== undefined)

    if (!['ajouter', 'modifier', 'retirer', 'reactiver', 'reordonner', 'creer-seance'].includes(op)) {
      return `« op » doit valoir creer-seance, ajouter, modifier, retirer, reactiver ou reordonner — pas ${JSON.stringify(op)}.`
    }
    /**
     * `creer-seance` inverse la condition : c'est le seul geste qui veut un
     * identifiant LIBRE. Réutiliser le message des autres — « la séance n'existe
     * pas » — ferait exactement le contraire de ce qu'il faut faire.
     */
    if (op === 'creer-seance') {
      if (ctx.sessionKnown?.(seance)) {
        return `La séance « ${seance} » existe déjà. « creer-seance » veut un identifiant LIBRE : choisis-en un autre, ou utilise op: "ajouter" pour y mettre un exercice de plus.`
      }
      const neuve = (lire(d, 'nouvelle', 'seance_neuve', 'contenu') ?? d) as Record<string, unknown>
      if (!lire(neuve, 'nom', 'name')) return '« nom » est obligatoire : c\'est le titre affiché de la séance.'
      const ex = asArray(lire(neuve, 'exercices', 'exercises'))
      if (!ex.length) return 'Il faut au moins un exercice : une séance vide s\'ouvre sur un écran sans rien à saisir, elle a l\'air cassée.'
      if (ex.length > 30) return `${ex.length} exercices, c'est au-delà des 30 acceptés — c'est plus vraisemblablement une liste dupliquée qu'une séance.`
      const REQUIS: [string, string][] = [['nom', 'name'], ['series', 'sets'], ['reps', 'reps'], ['repos_s', 'rest']]
      for (const [i, brutEx] of ex.entries()) {
        const e = (brutEx && typeof brutEx === 'object' ? brutEx : {}) as Record<string, unknown>
        const manque = REQUIS.filter(([fr, en]) => lire(e, fr, en) === undefined).map(([fr]) => fr)
        if (manque.length) return `Exercice ${i + 1} : il manque ${manque.join(', ')}. Chacun est obligatoire — sans eux la fiche s'affiche vide. « repos_s » est en secondes (20 à 900), il n'a pas de défaut.`
        const id = lire(e, 'id')
        const place = typeof id === 'string' ? ctx.exerciseAt?.(id) : null
        if (place) return `L'identifiant « ${id} » est déjà pris par « ${place.ex.name} » dans ${place.seanceNom} (${place.seance})${place.actif ? '' : ', retiré du programme mais toujours dans l\'historique'}. L'historique de charges est indexé sur l'identifiant seul : le réutiliser rangerait de vieux records sous un mouvement jamais fait.`
      }
      return 'La séance n\'a pas pu être construite. Vérifie que « seance » est un identifiant simple (lettres, chiffres, tirets) et que chaque exercice a un identifiant unique dans la liste.'
    }
    if (!ctx.sessionKnown?.(seance)) {
      const connues = ctx.sessionIds?.() ?? []
      return `La séance « ${seance} » n'existe pas. ${connues.length ? `Celles qui existent : ${connues.join(', ')}.` : 'Le programme est encore vide.'} Appelle « programme » pour les identifiants exacts, ou crée-la avec op: "creer-seance".`
    }
    const dedans = ctx.exercisesOf?.(seance) ?? []

    if (op === 'reordonner') {
      const ordre = asArray(d.ordre ?? d.order ?? d.exercices).filter((v): v is string => typeof v === 'string')
      const dehors = ordre.filter(id => !dedans.includes(id))
      // Deux causes, deux gestes différents — les confondre ferait chercher au
      // mauvais endroit. Un identifiant inconnu, c'est la proposition qui est
      // fautive ; un actif oublié, c'est presque toujours un miroir périmé.
      if (dehors.length) {
        return `Ces exercices ne sont pas des actifs de « ${seance} » : ${dehors.join(', ')}. Erreur de construction : l'ordre s'applique séance par séance, et un exercice retiré n'a pas de place à occuper. Actifs de cette séance, dans l'ordre : ${dedans.join(', ')}.`
      }
      const manquants = dedans.filter(id => !ordre.includes(id))
      if (manquants.length) {
        return `Il manque ${manquants.join(', ')} dans « ordre ». « reordonner » attend la liste COMPLÈTE des actifs : un exercice omis garderait sa place et l'ordre obtenu ne serait pas celui que tu demandes. Ton miroir est probablement périmé — relis « programme » et redépose. Actifs attendus : ${dedans.join(', ')}.`
      }
      if (new Set(ordre).size !== ordre.length) return 'Un identifiant est cité deux fois dans « ordre ».'
      return 'Ordre refusé : la liste doit contenir entre 1 et 40 identifiants.'
    }

    if (op === 'ajouter') {
      const id = String(lire(src, 'id') ?? '')
      const place = id ? ctx.exerciseAt?.(id) : null
      if (place) {
        return `L'identifiant « ${id} » est déjà pris par « ${place.ex.name} » dans ${place.seanceNom} (${place.seance})${place.actif ? '' : ', retiré du programme mais toujours dans l\'historique'}. L'historique de charges est indexé sur l'identifiant seul : le réutiliser rangerait de vieux records sous un mouvement jamais fait. Choisis-en un autre, ou modifie l'exercice existant avec op: "modifier".`
      }
      if (!lire(src, 'nom', 'name')) return 'Un exercice neuf a besoin d\'un « nom », de « series » (1 à 12) et de « reps ».'
      if (lire(src, 'repos_s', 'rest', 'repos') === undefined) {
        return '« repos_s » est OBLIGATOIRE à l\'ajout, en secondes (20 à 900). Il n\'y a pas de défaut : le déduire des reps donnerait 40 secondes sur « 30-40 s », c\'est-à-dire un repos calculé sur une durée d\'effort.'
      }
      const apres = lire(src, 'apres', 'after') ?? lire(d, 'apres', 'after')
      if (typeof apres === 'string' && apres && !dedans.includes(apres)) {
        return `« apres: ${apres} » ne désigne pas un exercice actif de « ${seance} ». Pas de repli sur « en fin de séance » : l'ordre a un sens physiologique. Positions valides : ${dedans.join(', ')}.`
      }
      return 'Ajout refusé : vérifie « series » (1 à 12), « reps » (texte, ex. "8-10" ou "30-40 s"), « repos_s » (20 à 900), et « machines_de_remplacement » si tu en donnes (coefficient entre 0,2 et 5).'
    }

    const ex = String(lire(d, 'exercice', 'exercise', 'id') ?? '')
    const place = ctx.exerciseAt?.(ex) ?? null
    if (!place) {
      return `L'exercice « ${ex} » n'existe nulle part. Appelle « programme » pour les identifiants exacts — ajoute inclure_inactifs: true s'il s'agit d'un mouvement retiré. Actifs de « ${seance} » : ${dedans.join(', ')}.`
    }
    if (op === 'retirer') {
      if (!place.actif) return `« ${ex} » est déjà retiré du programme. Un geste sans effet ne doit pas s'archiver comme appliqué.`
      return `Retrait refusé : « ${ex} » appartient à ${place.seanceNom} (${place.seance}), pas à « ${seance} ».`
    }
    if (op === 'reactiver') {
      if (place.actif) return `« ${ex} » est déjà actif dans ${place.seanceNom} : il n'y a rien à réactiver.`
      const apres = lire(d, 'apres', 'after')
      if (typeof apres === 'string' && apres && !dedans.includes(apres)) {
        return `« apres: ${apres} » ne désigne pas un exercice actif de « ${seance} ». Positions valides : ${dedans.join(', ')}.`
      }
      return `Réactivation refusée : « ${ex} » appartient à ${place.seanceNom} (${place.seance}).`
    }

    // modifier : le refus le plus fréquent est le « de_… » manquant ou faux.
    const GARDES: [string[], string[], string | number][] = [
      [['series', 'sets'], ['de_series', 'de_sets'], place.ex.sets],
      [['reps', 'repetitions'], ['de_reps'], place.ex.reps],
      [['repos_s', 'rest', 'repos'], ['de_repos_s', 'de_rest', 'de_repos'], restFor(place.ex)],
    ]
    for (const [champs, des, actuel] of GARDES) {
      if (lire(src, ...champs) === undefined) continue
      const annonce = lire(src, ...des) ?? lire(d, ...des)
      if (annonce === undefined) {
        return `Tu changes « ${champs[0]} » sans donner « ${des[0]} ». La valeur enregistrée est ${JSON.stringify(actuel)} : renvoie-la dans « ${des[0]} ». Le miroir peut avoir des heures de retard, et sans cette confrontation une proposition écrite ce matin écraserait un réglage changé depuis sur le téléphone.`
      }
      if (String(annonce) !== String(actuel)) {
        return `« ${des[0]} » ne correspond pas : « ${ex} » est à ${JSON.stringify(actuel)}, pas ${JSON.stringify(annonce)}. Relis « programme », puis repropose.`
      }
    }
    // Une liste de machines mal formée tombait dans le message générique, qui
    // n'aidait pas : il énumérait les champs valides sans dire lequel était fautif.
    const mdr = lire(src, 'machines_de_remplacement', 'variants') ?? lire(d, 'machines_de_remplacement')
    if (mdr !== undefined) {
      const lignes = asArray(mdr) as Record<string, unknown>[]
      const mauvais = lignes.filter(v => !v || typeof v !== 'object'
        || !v.id || !(v.nom ?? v.name)
        || !(Number(v.coefficient ?? v.ratio) >= 0.2 && Number(v.coefficient ?? v.ratio) <= 5))
      if (mauvais.length) {
        return `« machines_de_remplacement » : ${mauvais.length} ligne(s) invalide(s). Chacune veut { id, nom, coefficient }, coefficient entre 0,2 et 5 — au-delà ce n'est plus une conversion de charge, c'est une faute de frappe. Rappel : la liste REMPLACE, relis « programme » et repars de la liste complète.`
      }
    }
    return 'Modification refusée : donne au moins un champ valide — series (1 à 12), reps (texte), repos_s (20 à 900 s), nom, mesure ("reps" ou "temps"), machine, optionnel, muscles ou machines_de_remplacement.'
  }
  if (cible === 'repas-libre') {
    const vers = ((d.vers ?? d.repas) ?? {}) as Record<string, unknown>
    const items = asArray(vers.items ?? vers.ingredients ?? vers.composition)
    const inconnus = items
      .map(it => (it && typeof it === 'object' ? (it as Record<string, unknown>).food ?? (it as Record<string, unknown>).aliment : null))
      .filter((f): f is string => typeof f === 'string' && !ctx.foodKnown(f))
    if (inconnus.length) {
      return `Ces aliments n'existent pas : ${inconnus.join(', ')}. Appelle « aliments » pour les identifiants valides. Tu peux aussi n'en lister qu'une partie : les macros que tu donnes font foi, « items » ne sert qu'à afficher les grammages.`
    }
    const base = vers.base
    if (typeof base === 'string' && base && !ctx.recipeKnown(base)) {
      return `Le plat « ${base} » n'existe pas. « base » doit désigner un plat du catalogue — appelle « plats » — ou être omis.`
    }
    return 'Repas libre refusé : il faut un « label », des « kcal » entre 1 et 5000, et si tu donnes « items », chaque ligne doit avoir un « food » du catalogue et des « g » entre 0 et 2000.'
  }
  if (cible === 'recette') {
    const items = Array.isArray(d.items) ? d.items : (Array.isArray(d.ingredients) ? d.ingredients : [])
    const inconnus = items
      .map(it => (it && typeof it === 'object' ? (it as Record<string, unknown>).food ?? (it as Record<string, unknown>).aliment : null))
      .filter((f): f is string => typeof f === 'string' && !ctx.foodKnown(f))
    if (inconnus.length) {
      return `Ces aliments n'existent pas : ${inconnus.join(', ')}. Appelle « aliments » pour les identifiants valides, ou propose-les d'abord avec « cible: aliment ».`
    }
    if (!items.length) return 'Une recette a besoin d\'au moins un ingrédient, avec son identifiant et ses grammes.'
    if (typeof d.id === 'string' && d.id && !ctx.recipeKnown(d.id)) return `Le plat « ${d.id} » n'existe pas. Sans « id » tu en crées un nouveau ; avec, il doit exister.`
    const sauce = d.sauce ?? d.pot
    if (typeof sauce === 'string' && !ctx.recipeKnown(sauce)) return `La sauce « ${sauce} » n'existe pas. Appelle « plats » avec kind: "sauce".`
    return 'Recette refusée : vérifie le nom, le type (pdj, boite, diner, collation, sauce) et les grammages.'
  }
  const n = (v: unknown) => (typeof v === 'number' ? v : Number(v))
  const kcal = n(d.kcal ?? d.calories)
  const somme = n(d.p ?? d.proteines) * 4 + n(d.g ?? d.glucides) * 4 + n(d.l ?? d.lipides) * 9
  if (Number.isFinite(kcal) && Number.isFinite(somme) && kcal > 0 && Math.abs(somme - kcal) > kcal * 0.25 + 20) {
    return `Les macros donnent ${Math.round(somme)} kcal, pas ${kcal}. Une étiquette mal recopiée ne fait rien planter, elle fausse les calories pour toujours — relis-la.`
  }
  return 'Aliment refusé : il faut un nom, une catégorie valide (viandes — poissons compris —, oeufs, laitiers, complements, feculents, legumes, fruits, grasses, aromates) et les quatre valeurs POUR 100 g, glucides DISPONIBLES hors fibres.'
}

/**
 * Le programme EFFECTIF, celui que l'application affiche.
 *
 * Le programme vivait dans le code, donc se rendait sans rien lire — c'était même
 * une optimisation revendiquée. Il est devenu modifiable : le livré est toujours
 * dans le code, mais les modifications voyagent dans le miroir. Répondre le livré
 * serait désormais répondre à côté, et pire que de répondre lentement : je
 * proposerais des changements sur des séries qui n'existent plus.
 *
 * Sans miroir, on retombe sur le livré : c'est le meilleur défaut possible, et il
 * reste juste tant qu'aucune modification n'a été faite.
 */
const progOf = (d: Record<string, unknown> | null | undefined): Session[] =>
  mergeProgram(PROGRAM, ((d?.programme ?? {}) as ProgramCustom))

async function callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
  if (name === 'proposer_modification') {
    const resume = String(args.resume ?? '').trim()
    if (!resume) throw new Error('« resume » est obligatoire : c\'est la phrase qu\'il lira avant de valider.')
    const detail = (args.detail ?? {}) as Record<string, unknown>
    /**
     * Un aliment ou une recette vérifiés AVANT le dépôt.
     *
     * Même raisonnement que pour les corrections de champ : l'application refusera
     * de toute façon une proposition qu'elle ne sait pas lire, mais elle le fera
     * dans la boîte de réception, et c'est lui qui paiera l'aller-retour. Le
     * serveur a le miroir sous la main, donc la bibliothèque : il peut trancher ici.
     *
     * Le contrôle est le MÊME code que celui de l'application — `foodFor` et
     * `recipeFor` — nourri des mêmes identifiants. Deux validateurs auraient
     * divergé, et c'est toujours celui qui n'est pas testé qui laisse passer.
     */
    const cible = String(args.cible ?? '')
    /**
     * `repas-libre` n'est vérifié ici QUE s'il porte une composition.
     *
     * Sans `items`, c'est une étiquette de restaurant recopiée à la main : il n'y a
     * aucun identifiant à confronter au catalogue, et le faire passer par `planFor`
     * ne changerait rien. Avec `items`, en revanche, chaque aliment doit exister —
     * même exigence que pour une recette, et pour la même raison : une composition
     * qui référence un aliment inventé s'affiche en identifiants bruts dans la fiche.
     */
    const versLibre = ((detail.vers ?? detail.repas) ?? null) as Record<string, unknown> | null
    const libreAvecItems = cible === 'repas-libre'
      && !!versLibre && typeof versLibre === 'object'
      && !!(versLibre.items ?? versLibre.ingredients ?? versLibre.composition ?? versLibre.base)

    if (cible === 'aliment' || cible === 'recette' || cible === 'programme' || libreAvecItems) {
      const m = await readMirror()
      const data = (m?.data ?? {}) as Record<string, unknown>
      const nut = (data.nutrition ?? {}) as Record<string, unknown>
      const recettes = mergeRecipes(
        asArray(nut.userRecipes) as never,
        (nut.recipePatches ?? {}) as never,
        asArray(nut.disabledRecipes) as never,
      )
      const foods = mergeFoods(asArray(nut.userFoods) as never, (nut.foodPatches ?? {}) as never)
      /**
       * Le programme du miroir, retirés compris.
       *
       * `exerciseKnown` doit inclure les mouvements DÉSACTIVÉS, sinon « reactiver »
       * serait refusé pour la seule raison qui le rendait nécessaire. Et
       * `exercisesOf` ne rend que les ACTIFS : c'est cette différence qui permet de
       * distinguer « déjà retiré » de « inconnu ».
       */
      const custom = (data.programme ?? {}) as ProgramCustom
      const sessions = mergeProgram(PROGRAM, custom)
      const toutes = mergeProgram(PROGRAM, custom, true)
      const off = new Set(custom.disabled ?? [])
      const actifsDe = (sid: string) => sessions.find(s => s.id === sid)?.exercises.map(e => e.id) ?? []
      const ctx = {
        foodKnown: (id: string) => !!foods[id],
        recipeKnown: (id: string) => !!recettes[id],
        sessionKnown: (id: string) => sessions.some(s => s.id === id),
        sessionIds: () => sessions.map(s => s.id),
        exerciseKnown: (id: string) => toutes.some(s => s.exercises.some(e => e.id === id)),
        exercisesOf: actifsDe,
        exerciseAt: (id: string) => {
          for (const s of toutes) {
            const ex = s.exercises.find(e => e.id === id)
            if (ex) return { seance: s.id, seanceNom: s.name, actif: !off.has(id), ex }
          }
          return null
        },
      }
      const brut = { id: '', at: '', action: cible, summary: resume, patch: detail, status: 'pending' as const }
      const plan = cible === 'aliment'
        ? foodFor(brut, ctx)
        : (cible === 'recette'
            ? recipeFor(brut, ctx)
            : (cible === 'programme' ? programFor(brut, ctx) : planFor(brut, ctx)))
      if (!plan) throw new Error(refusMessage(cible, detail, ctx))
    }

    // Sur « quoi », pas sur « cible » : l'intention est déjà sans ambiguïté, et une
    // cible mal choisie ne doit pas faire sauter la vérification.
    if (detail.quoi === 'champ') {
      const m = await readMirror()
      if (!m) throw new Error('Aucune donnée personnelle : le téléphone n\'a pas encore poussé son miroir, impossible de vérifier le champ visé.')
      checkFieldFix(detail, m.data as Record<string, unknown>)
    }
    const p = await addProposal({
      action: String(args.cible ?? 'autre'),
      summary: resume,
      patch: (args.detail ?? {}) as Record<string, unknown>,
    }, new Date().toISOString())
    return { depose: true, id: p.id, rappel: 'Rien n\'est écrit : la proposition attend sa validation dans l\'application.' }
  }
  if (name === 'propositions') {
    const all = await readProposals()
    return { total: all.length, propositions: all.slice(-20).reverse() }
  }
  /**
   * Le programme, tel qu'il est AUJOURD'HUI.
   *
   * Il se rendait sans lire le miroir, parce qu'il vivait entièrement dans le code.
   * Il est devenu modifiable, donc il faut le lire : répondre le programme livré
   * quand un exercice en a été retiré, c'est proposer des séries sur un mouvement
   * qu'il ne fait plus.
   *
   * Le repos figure désormais dans la réponse. Sans lui, je ne pouvais pas proposer
   * de l'allonger sans d'abord le deviner — et deviner une valeur qu'on va écrire,
   * c'est exactement ce que ce connecteur refuse de faire ailleurs.
   *
   * Les coefficients sont arrondis à deux décimales. `50/45` donnait
   * « 1.1111111111111112 » : dix-sept chiffres pour une conversion de charge dont le
   * dernier utile est le premier après la virgule.
   */
  if (name === 'programme') {
    const seance = typeof args.seance === 'string' ? args.seance : ''
    const avecInactifs = args.inclure_inactifs === true
    const m = await readMirror()
    const custom = ((m?.data as Record<string, unknown>)?.programme ?? {}) as ProgramCustom
    const off = new Set(custom.disabled ?? [])
    /**
     * La POSITION est celle du programme actif, pas celle du tableau brut.
     *
     * C'est le chiffre affiché à l'écran — « 3. Tractions » — et donc le seul dont on
     * puisse parler avec lui. Un exercice retiré n'en a pas : il n'occupe aucun rang
     * dans une séance dont il est absent, et lui en donner un ferait proposer des
     * réordonnancements sur des places qui n'existent pas.
     */
    const sessions = mergeProgram(PROGRAM, custom, avecInactifs)
    /**
     * L'écart entre la fiche et le carnet, remonté ICI.
     *
     * C'est l'outil qu'on lit avant de proposer un changement de programme : si
     * l'écart n'y figure pas, il faut un audit pour le voir, et on n'en fait pas.
     * Il y figure donc, à côté de la valeur qu'il met en cause.
     */
    const journal = ((m?.data as Record<string, unknown>)?.logs ?? {}) as Record<string, { sets: { r?: number, warm?: boolean }[] }[]>
    const ecartDe = (e: { id: string, reps: string, mesure?: 'reps' | 'temps' }) => {
      // Une série au temps n'a pas de fourchette de reps à confronter.
      if (e.mesure === 'temps') return null
      const g = repsGap(e.reps, journal[e.id] ?? [])
      return g ? { prevu: e.reps, fait_median: g.median, sens: g.sens, seances: g.seances } : null
    }
    return {
      seances: sessions.filter(s => !seance || s.id === seance).map((s) => {
        let rang = 0
        return {
          id: s.id,
          nom: s.name,
          jour: s.tag,
          sprint: !!s.sprint,
          exercices: s.exercises.map((e) => {
            const actif = !off.has(e.id)
            if (actif) rang += 1
            return {
              id: e.id,
              nom: e.name,
              series: e.sets,
              reps: e.reps,
              repos_s: restFor(e),
              mesure: e.mesure ?? 'reps',
              actif,
              optionnel: !!e.optionnel,
              position: actif ? rang : null,
              muscles: e.muscles,
              machine: e.machine,
              ...(e.superset ? { superset: e.superset } : {}),
              ...(e.bodyweight ? { poids_de_corps: true } : {}),
              machines_de_remplacement: (custom.variants?.[e.id] ?? VARIANTS[e.id] ?? []).map(v => ({
                id: v.id,
                nom: (v as { name: string }).name,
                coefficient: Math.round(v.ratio * 100) / 100,
              })),
              ...(ecartDe(e) ? { ecart_reps: ecartDe(e) } : {}),
            }
          }),
        }
      }),
      ...(avecInactifs
        ? {}
        // Les mouvements retirés, que l'historique référence encore. Sans eux, une
        // réponse sur « où j'en suis au curl EZ » afficherait un identifiant brut.
        : { retires: Object.values(retiredExercises(PROGRAM, custom)).map(e => ({ id: e.id, nom: e.name })) }),
      modifie: !!(custom.patches && Object.keys(custom.patches).length)
        || !!(custom.added && Object.keys(custom.added).length)
        || !!custom.disabled?.length
        || !!(custom.order && Object.keys(custom.order).length)
        || !!(custom.variants && Object.keys(custom.variants).length),
      rappel: 'Un exercice « mesure: temps » est hors progression automatique, hors record et hors 1RM. « position » est le rang affiché, les inactifs n\'en ont pas. Un « ecart_reps » signale que la fiche et le carnet ne disent pas la même chose : tant qu\'il dure, l\'auto-régulation raisonne sur une cible qu\'il ne vise pas — elle ne conseille jamais de charger, et elle conseille de décharger à chaque « à l\'échec ». Propose-lui de trancher, ne tranche pas seul.',
    }
  }

  /**
   * Les RÉFÉRENCES n'ont pas besoin du miroir, les données personnelles si.
   *
   * Les trois outils de catalogue — « plats », « aliments », « programme » — savent
   * répondre sans miroir. Ils rendaient alors le contenu livré avec l'application ;
   * celle-ci ne livre plus rien, si bien qu'ils rendent aujourd'hui une liste vide.
   * C'est une réponse JUSTE et utile : « il n'y a encore rien » se distingue de
   * « je ne peux pas répondre », et c'est ce qui permet de proposer de remplir.
   *
   * Les exiger quand même rendait le connecteur inutile pendant la fenêtre exacte où
   * l'on essaie de le mettre en route — juste après l'avoir branché, avant la
   * première ouverture de l'app — et avec un message qui parle d'autre chose.
   */
  const PERSONNELS = ['bilan', 'etat', 'profil', 'seances', 'exercice', 'poids', 'nutrition', 'champ']
  const mirror = await readMirror()
  if (!mirror && PERSONNELS.includes(name)) {
    throw new Error('Aucune donnée personnelle : le téléphone n\'a pas encore poussé son miroir. Demande-lui d\'ouvrir l\'application une fois. Les catalogues (« plats », « aliments », « programme ») restent interrogeables — sur une installation neuve ils sont vides, et c\'est normal : rien n\'est livré, tout est à créer.')
  }
  const d = (mirror?.data ?? {}) as Record<string, unknown>

  if (name === 'bilan') return bilan(d, mirror!.at, args, await readProposals())

  switch (name) {
    case 'plats': {
      // La bibliothèque EFFECTIVE : les plats livrés avec le programme, plus ceux
      // qu'il a créés ou modifiés. Sans elle, un menu proposé porterait des
      // identifiants inventés — et l'application les refuserait, à juste titre.
      const nut = (d.nutrition ?? {}) as Record<string, unknown>
      const recipes = mergeRecipes(
        (nut.userRecipes ?? []) as never,
        (nut.recipePatches ?? {}) as never,
      )
      const off = new Set((nut.disabledRecipes ?? []) as string[])
      const kind = typeof args.kind === 'string' ? args.kind : ''
      const list = Object.values(recipes)
        .filter(r => !kind || r.kind === kind)
        .map(r => ({
          id: r.id,
          nom: r.name,
          type: r.kind,
          type_libelle: KIND_GROUP_LABELS[r.kind] ?? r.kind,
          conservation_jours: r.keep ?? null,
          ...(off.has(r.id) ? { mis_de_cote: true } : {}),
        }))
        .sort((a, b) => a.type.localeCompare(b.type) || a.nom.localeCompare(b.nom))
      return { total: list.length, plats: list }
    }
    case 'aliments': {
      const nut = (d.nutrition ?? {}) as Record<string, unknown>
      const foods = mergeFoods((nut.userFoods ?? []) as never, (nut.foodPatches ?? {}) as never)
      const q = typeof args.cherche === 'string' ? args.cherche.toLowerCase() : ''
      const list = Object.values(foods)
        .filter(f => !q || f.name.toLowerCase().includes(q) || f.id.includes(q))
        .map(f => ({ id: f.id, nom: f.name, cat: f.cat, pour_100g: { kcal: f.kcal, p: f.p, g: f.g, l: f.l } }))
        .sort((a, b) => a.nom.localeCompare(b.nom))
      return { total: list.length, aliments: list }
    }
    case 'recette': {
      const nut = (d.nutrition ?? {}) as Record<string, unknown>
      const recettes = mergeRecipes(
        asArray(nut.userRecipes) as never,
        (nut.recipePatches ?? {}) as never,
        asArray(nut.disabledRecipes) as never,
      )
      const foods = mergeFoods(asArray(nut.userFoods) as never, (nut.foodPatches ?? {}) as never)
      const id = String(args.id ?? '')

      /**
       * Les grammages sont CRUS, et le poids cuit est donné à côté quand il existe.
       *
       * Les tables de composition mesurent le cru : c'est la seule référence qui ne
       * dépende pas de la casserole, et c'est elle qui donne les macros justes. Mais
       * on ne répartit pas du riz cru entre cinq boîtes, d'où la conversion — pour
       * les féculents seulement, les seuls qu'on ne peut pas compter à l'unité.
       */
      const ligne = (it: { food: string, g: number }) => {
        const f = foods[it.food]
        const cuit = cookedWeight(it.food, it.g, { mesures: (nut.cookedRatios ?? {}) as Record<string, number> })
        return {
          aliment: it.food,
          nom: f?.name ?? it.food,
          grammes_crus: it.g,
          ...(cuit ? { grammes_cuits: cuit } : {}),
          ...(f?.cook ? { cuisson: f.cook } : {}),
        }
      }

      /**
       * Un REPAS LIBRE relu par (date, créneau).
       *
       * C'est la contrepartie du dépôt : ce qui a été proposé peut être relu tel
       * qu'il est enregistré, au lieu d'être reconstitué de mémoire d'une
       * conversation à l'autre — ce qui produisait des macros fausses.
       *
       * Rien ici ne vient du catalogue, sauf les noms d'aliments et le rappel du plat
       * d'origine : la composition affichée est celle DE CE REPAS. C'est tout
       * l'intérêt d'une variante, et ce serait un contresens d'aller rechercher les
       * grammages standards.
       */
      const date = String(args.date ?? '')
      const slot = String(args.slot ?? '')
      if (date && slot) {
        const libres = (nut.freeMeals ?? {}) as Record<string, Record<string, Record<string, unknown>>>
        const jour = libres[date] ?? {}
        const repas = jour[slot]
        if (!repas) {
          const dispos = Object.keys(jour)
          throw new Error(dispos.length
            ? `Aucun repas libre sur ${date} au créneau « ${slot} ». Ce jour-là il y en a sur : ${dispos.join(', ')}.`
            : `Aucun repas libre le ${date}. Appelle « journee » pour voir ce qui est prévu ce jour-là.`)
        }
        const items = asArray(repas.items) as { food: string, g: number }[]
        const saisi = {
          kcal: Number(repas.kcal) || 0,
          p: Number(repas.p) || 0,
          g: Number(repas.g) || 0,
          l: Number(repas.l) || 0,
        }
        const baseId = typeof repas.base === 'string' ? repas.base : null
        const base = baseId ? recettes[baseId] : null
        return {
          repas_libre: true,
          date,
          creneau: slot,
          nom: repas.label ?? '',
          saisi_par: repas.from ?? 'saisie',
          derive_de: base ? { id: base.id, nom: base.name } : null,
          preparation: (typeof repas.steps === 'string' && repas.steps) || (base?.steps ?? null),
          preparation_adaptee: typeof repas.steps === 'string' && !!repas.steps,
          ingredients: items.map(ligne),
          // Les DEUX chiffres, jamais un seul. Les macros saisies font foi ; le
          // calcul depuis les ingrédients n'est là que pour se contredire soi-même
          // quand un grammage est faux ou qu'un ingrédient manque à l'appel.
          macros_saisies: saisi,
          macros_des_ingredients: items.length ? roundMacros(macrosOf(items, foods)) : null,
          rappel: items.length
            ? 'Les macros SAISIES font foi. Si le calcul des ingrédients s\'en écarte, c\'est soit un grammage faux, soit un ingrédient hors catalogue non listé — pas une erreur à corriger d\'office.'
            : 'Ce repas n\'a pas de composition : seules les macros ont été saisies.',
        }
      }

      if (!id) {
        return {
          rappel: 'Appelle « recette » avec un id pour voir les ingrédients et les grammages, ou avec { date, slot } pour relire un repas libre.',
          plats: Object.values(recettes).filter(r => !r.disabled).map(r => ({ id: r.id, nom: r.name, type: r.kind })),
        }
      }
      const r = recettes[id]
      if (!r) throw new Error(`Plat inconnu : ${id}. Appelle « recette » sans argument pour la liste.`)

      const sauce = r.sauce ? recettes[r.sauce] : null
      return {
        id: r.id,
        nom: r.name,
        type: r.kind,
        perso: !!r.custom,
        batch_cooking: r.batch,
        // La conservation EFFECTIVE, pas seulement le champ posé sur la recette :
        // faute de valeur explicite, elle est déduite du plus fragile des
        // ingrédients. C'est elle qui décide dans quelle session de cuisine le plat
        // tombe, donc c'est elle qu'il faut lire avant de proposer un changement.
        conservation_jours: keepsOf(r, { foods, recipes: recettes }),
        conservation_posee: typeof r.keeps === 'number' ? r.keeps : null,
        preparation: r.steps || null,
        // `expandItems` ajoute les ingrédients de la sauce : ce sont eux qui comptent
        // dans les macros, donc les cacher rendrait le total incompréhensible.
        ingredients: r.items.map(ligne),
        sauce: sauce ? { id: sauce.id, nom: sauce.name, preparation: sauce.steps || null, ingredients: sauce.items.map(ligne) } : null,
        macros_portion: roundMacros(macrosOf(expandItems(r, { foods, recipes: recettes }), foods)),
        rappel: 'Grammages CRUS — c\'est la référence des macros. Pour modifier, renvoie la liste COMPLÈTE des ingrédients : elle remplace l\'ancienne.',
      }
    }
    case 'menus': {
      const nut = (d.nutrition ?? {}) as Record<string, unknown>
      const mine = (nut.menus ?? []) as { id: string, name: string, days: unknown[] }[]
      return {
        semaines_livrees: builtinWeeks().map(w => ({ id: w.id, nom: w.name, jours: w.days })),
        mes_semaines: mine.map(m => ({ id: m.id, nom: m.name, jours: m.days })),
        semaine_active: nut.activeMenu ?? null,
        appliquees: nut.menuAssign ?? {},
      }
    }
    case 'champ': {
      const chemin = typeof args.chemin === 'string' ? args.chemin : ''
      if (!chemin) {
        // Sans chemin, on donne la CARTE : sections, taille, et un exemple de
        // chemin valide. Deviner « /sessions/12/durationMin » sans savoir que
        // « sessions » existe ni combien il en contient n'aurait pas de sens.
        const sections = Object.entries(d).map(([k, v]) => {
          const n = Array.isArray(v) ? v.length : (v && typeof v === 'object' ? Object.keys(v).length : null)
          return {
            section: k,
            type: Array.isArray(v) ? 'liste' : typeof v,
            elements: n,
            exemple: Array.isArray(v) && v.length ? `/${k}/0` : `/${k}`,
          }
        })
        return { sections, rappel: 'Appelle « champ » avec un chemin pour lire une valeur précise.' }
      }
      const val = getAt(d, chemin)
      if (val === undefined) throw new Error(`Aucune valeur à « ${chemin} ». Vérifie le chemin avec « champ » sans argument.`)
      const simple = val === null || ['string', 'number', 'boolean'].includes(typeof val)
      const double = twinPath(chemin, d)
      return {
        chemin,
        valeur: val,
        modifiable: simple,
        ...(simple ? {} : { note: 'C\'est un objet ou une liste : on ne remplace que des valeurs simples. Descends d\'un cran.' }),
        ...(double ? { affiche: false, note: `Cette copie n'est PAS celle que l'application affiche. La durée montrée est ${double} — corrige plutôt celle-là.` } : {}),
      }
    }
    case 'etat': {
      const sessions = asArray(d.sessions)
      const bw = asArray(d.bodyWeight)
      return {
        miroir_du: mirror.at,
        seances: sessions.length,
        derniere_seance: (sessions.at(-1) as { at?: string } | undefined)?.at ?? null,
        pesees: bw.length,
        derniere_pesee: (bw.at(-1) as { date?: string } | undefined)?.date ?? null,
        exercices_suivis: Object.keys((d.logs ?? {}) as object).length,
      }
    }
    case 'profil': {
      /*
       * Le foyer sort d'ici, avec son facteur déjà calculé.
       *
       * Sans lui, proposer une quantité pour deux revient à multiplier par deux — et
       * deux personnes ne mangent presque jamais pareil. Le facteur est la somme des
       * appétits de ceux qui sont au repas ; les grammages d'une recette, eux, sont
       * TOUJOURS donnés pour UNE part, celle du propriétaire. C'est la même règle que
       * dans l'application : les quantités se multiplient, les macros non.
       */
      const convives = asArray(d.foyer) as Record<string, unknown>[]
      const actifs = convives.filter(c => c.actif !== false)
      const facteur = actifs.reduce((n, c) => n + (Number(c.appetit) || 0), 0)
      return {
        profil: d.profile ?? null,
        semaine_type_seances: d.weekPlan ?? null,
        exceptions_planning: d.planDays ?? {},
        semaine_salle_teletravail: (d.nutrition as Record<string, unknown> | undefined)?.week ?? null,
        foyer: {
          convives,
          au_repas: actifs.map(c => c.nom),
          facteur_quantites: facteur > 0 ? Math.round(facteur * 100) / 100 : 1,
          note: 'Multiplie les grammages d\'une recette par « facteur_quantites » pour cuisiner pour tout le monde. Les macros et les portions restent celles du propriétaire : une portion est son unité de compte. Pour ajouter ou corriger quelqu\'un, propose une écriture sur /foyer avec l\'outil « champ ».',
        },
        /*
         * Qui est à table repas par repas — l'exception, pas la règle.
         *
         * Un facteur unique pour toute la semaine se trompe tous les jours sauf un :
         * on cuisine pour deux le mardi, pour quatre le samedi. Seuls les repas qui
         * SORTENT de l'ordinaire figurent ici ; les autres se lisent avec le foyer.
         */
        convives_par_repas: {
          exceptions: d.repasConvives ?? {},
          note: 'Rangé par date puis par créneau. « membres » liste des identifiants du foyer, « invites » des convives ponctuels ({ nom, appetit }) qui n\'entrent pas dans le foyer. Un repas absent d\'ici se cuisine pour le foyer courant. Pour prévoir un repas à quatre, propose une écriture sur /repasConvives/<date>/<créneau> avec l\'outil « champ ».',
        },
      }
    }
    case 'seances': {
      const limite = clampInt(args.limite, 8, 1, 40)
      const depuis = typeof args.depuis === 'string' ? args.depuis : null
      let sessions = asArray(d.sessions) as Record<string, unknown>[]
      if (depuis) sessions = sessions.filter(s => String(s.at ?? '').slice(0, 10) >= depuis)
      return { total: sessions.length, seances: sessions.slice(-limite).reverse() }
    }
    case 'exercice': {
      const id = String(args.id ?? '')
      const logs = (d.logs ?? {}) as Record<string, unknown>
      if (!(id in logs)) {
        return { inconnu: id, exercices_disponibles: Object.keys(logs) }
      }
      return { exercice: id, seances: logs[id] }
    }
    case 'poids': {
      const limite = clampInt(args.limite, 30, 1, 200)
      return {
        pesees: asArray(d.bodyWeight).slice(-limite),
        composition: asArray(d.withingsBody).slice(-limite),
      }
    }
    /**
     * Le budget du jour, assemblé depuis le miroir.
     *
     * Toute la difficulté est ici, et elle est d'ASSEMBLAGE, pas de calcul : il faut
     * rejouer ce que l'écran fait — le poids le plus récent, la dépense décomposée,
     * la semaine de menus qui s'applique à cette date, le plat réellement choisi
     * plutôt que celui prévu, les repas hors plan qui remplacent un créneau, les
     * cases cochées, les extras notés. Le moindre écart et le conseil contredit
     * l'application, ce qui est pire que pas de conseil du tout.
     *
     * La soustraction, elle, est dans lib/dayBudget.ts, avec ses tests.
     */
    case 'journee':
    case 'composer': {
      const nut = (d.nutrition ?? {}) as Record<string, unknown>
      const jour = typeof args.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.date)
        ? args.date
        : aujourdhuiParis()
      const dow = dowIndex(jour)

      const recettes = mergeRecipes(
        asArray(nut.userRecipes) as never,
        (nut.recipePatches ?? {}) as never,
        asArray(nut.disabledRecipes) as never,
      )
      const foods = mergeFoods(asArray(nut.userFoods) as never, (nut.foodPatches ?? {}) as never)

      // ─── Le poids, l'âge, le métabolisme ──────────────────────────────────
      /**
       * Le poids DE CE JOUR-LÀ, pas le dernier connu.
       *
       * L'application calcule le métabolisme d'un mardi de mars avec la pesée de ce
       * mardi-là. Prendre ici la pesée du matin ferait diverger le connecteur de
       * l'écran dès qu'on interroge une autre date que today — et un conseil qui
       * contredit l'application vaut moins que pas de conseil.
       */
      const kg = weightOn(asArray(d.bodyWeight) as never, jour)?.kg ?? null
      // La composition corporelle PORTÉE : la dernière pesée qui donne un taux de
      // masse grasse exploitable, reconduite quelques jours. C'est la même fonction
      // que l'application, pour que la cible protéique soit la même des deux côtés.
      const comp = carriedComp(asArray(d.withingsBody) as never)
      const profil = (d.profile ?? {}) as { heightCm?: number, sex?: 'h' | 'f', birthYear?: number }
      const bmr = bmrMifflin(kg ?? null, profil.heightCm ?? null, ageOn(jour, profil.birthYear), profil.sex ?? null)

      // ─── Salle ou repos, télétravail, pas ────────────────────────────────
      const semaineType = (nut.week ?? { gym: [], tt: [] }) as never
      const resolu = resolveDay(jour, semaineType, ((nut.overrides ?? {}) as Record<string, never>)[jour])
      const seancesDuJour = (asArray(d.sessions) as { at?: string }[])
        .filter(x => String(x.at ?? '').slice(0, 10) === jour)
      /**
       * EXACTEMENT la règle de l'application — la même fonction, pas une copie.
       *
       * Elle en avait une à elle, qui oubliait le dernier cas : une séance prévue
       * que la journée avait laissée passer se voyait quand même créditer le
       * forfait. Le connecteur annonçait alors une cible plusieurs centaines de
       * calories trop haute sur les jours de salle manqués. Voir lib/energy.ts.
       */
      const brule = sessionBurn({
        records: seancesDuJour as never,
        kg,
        bmr,
        gymPlanned: resolu.gym,
        played: isDayPlayed(jour, aujourdhuiParis(), heureParis()),
      })
      const energie = (bmr !== null && kg)
        ? dayEnergy({ bmr, kg, tt: resolu.tt, steps: resolu.steps, sessionKcal: brule })
        : null

      // ─── Les créneaux du jour ─────────────────────────────────────────────
      const assign = (nut.menuAssign ?? {}) as Record<string, string>
      const mesSemaines = asArray(nut.menus).map(normalizeWeek).filter(Boolean)
      const passees = Object.keys(assign).filter(m => m <= mondayOf(jour)).sort()
      const voulue = passees.length ? assign[passees.at(-1)!] : (nut.activeMenu as string | null)
      const toutes = [...builtinWeeks(), ...mesSemaines] as ReturnType<typeof builtinWeeks>
      const menu = toutes.find(w => w.id === voulue) ?? toutes[0]

      const pris = ((nut.picked ?? {}) as Record<string, Record<string, string>>)[jour] ?? {}
      const libres = ((nut.freeMeals ?? {}) as Record<string, Record<string, Record<string, unknown>>>)[jour] ?? {}
      const coches = new Set(((nut.eaten ?? {}) as Record<string, string[]>)[jour] ?? [])

      const slots: SlotState[] = (resolu.gym ? SLOTS_GYM : SLOTS_REST).map((sl) => {
        const libre = libres[sl.id]
        if (libre) {
          return {
            slot: sl.id, time: sl.time, label: sl.label,
            plat: String(libre.label ?? 'Repas hors plan'),
            macros: {
              kcal: Number(libre.kcal) || 0, p: Number(libre.p) || 0,
              g: Number(libre.g) || 0, l: Number(libre.l) || 0,
            },
            mange: coches.has(sl.id), libre: true,
          }
        }
        const rid = pris[sl.id] ?? recipeForSlot(menu, dow, sl)
        const r = rid ? recettes[rid] : null
        return {
          slot: sl.id, time: sl.time, label: sl.label,
          plat: r?.name ?? null,
          macros: r
            ? roundMacros(macrosOf(expandItems(r, { foods, recipes: recettes }), foods))
            : { kcal: 0, p: 0, g: 0, l: 0 },
          mange: coches.has(sl.id), libre: false,
        }
      })

      const extras = (((nut.extras ?? {}) as Record<string, Record<string, number>[]>)[jour] ?? [])
        .map(e => ({ kcal: Number(e.kcal) || 0, p: Number(e.p) || 0, g: Number(e.g) || 0, l: Number(e.l) || 0 }))

      /**
       * Sans cible, on ne REND PAS zéro.
       *
       * Faute de pesée à cette date ou de profil complet — miroir jamais poussé,
       * taille absente — la cible est inconnue. La rendre à 0 la faisait lire comme
       * « zéro calorie à manger », et le reste devenait négatif : le connecteur
       * annonçait un dépassement à quelqu'un qui venait de petit-déjeuner. Inconnu
       * se dit `null`, et se dit en toutes lettres.
       */
      const sansCible = !energie
      const budget = dayBudget({
        cible: energie?.target ?? 0,
        // Sur la MASSE MAIGRE quand la balance la donne, comme l'écran du jour.
        // Calculée sur le poids total, la cible sortait à 192 g là où l'application
        // en affiche 174 : le connecteur conseillait 18 g de protéines de plus que
        // l'écran, tous les jours. Deux chiffres qui se contredisent valent moins
        // qu'un seul, même approximatif.
        cibleProteines: kg ? proteinPlan(comp?.kg ?? kg, comp).g : null,
        slots,
        extras,
      })

      // ─── « composer » : le même budget, plus une composition confrontée ───
      if (name === 'composer') {
        const items = asArray(args.items) as { food?: unknown, g?: unknown }[]
        if (!items.length) throw new Error('« items » est obligatoire : [{ food: "saumon", g: 211 }, …]. Appelle « aliments » pour les identifiants.')
        const propres: { food: string, g: number }[] = []
        const inconnus: string[] = []
        for (const it of items) {
          const f = typeof it?.food === 'string' ? it.food : ''
          const gr = Number(it?.g)
          if (!f || !Number.isFinite(gr) || gr <= 0) throw new Error('Chaque ligne veut un « food » (identifiant du catalogue) et des « g » strictement positifs.')
          if (!foods[f]) { inconnus.push(f); continue }
          propres.push({ food: f, g: Math.round(gr * 10) / 10 })
        }
        if (inconnus.length) {
          throw new Error(`Ces aliments n'existent pas : ${inconnus.join(', ')}. Appelle « aliments » pour les identifiants valides, ou propose-les avec « cible: aliment ».`)
        }
        const apporte = roundMacros(macrosOf(propres, foods))
        return {
          date: jour,
          detail: propres.map((it) => {
            const f = foods[it.food]
            const k = it.g / 100
            const cuit = cookedWeight(it.food, it.g, { mesures: (nut.cookedRatios ?? {}) as Record<string, number> })
            return {
              aliment: it.food,
              nom: f.name,
              grammes_crus: it.g,
              ...(cuit ? { grammes_cuits: cuit } : {}),
              kcal: Math.round(f.kcal * k),
              p: Math.round(f.p * k * 10) / 10,
              g: Math.round(f.g * k * 10) / 10,
              l: Math.round(f.l * k * 10) / 10,
            }
          }),
          total: apporte,
          // La confrontation, c'est tout l'intérêt : savoir que le plat fait 640 kcal
          // ne sert à rien si on ignore qu'il en restait 500.
          dans_la_journee: sansCible ? null : fitInto(apporte, budget),
          reste_avant_ce_repas: sansCible ? null : budget.reste,
          rappel: sansCible
            ? 'Macros exactes, mais AUCUNE cible disponible pour les situer dans la journée : ne dis pas si le repas « rentre » ou non.'
            : 'Ces chiffres sont calculés depuis le catalogue : reprends-les tels quels dans « proposer_modification », ne les recalcule pas.',
        }
      }

      return {
        date: jour,
        jour: DAY_NAMES[dow],
        jour_de_salle: resolu.gym,
        teletravail: resolu.tt,
        depense: energie
          ? {
              metabolisme: energie.bmr,
              base_kcal: energie.baseKcal,
              pas_kcal: energie.stepsKcal,
              seance_kcal: energie.sessionKcal,
              seance_estimee: !seancesDuJour.length && resolu.gym,
            }
          : null,
        cible_kcal: sansCible ? null : budget.cible,
        cible_proteines_g: budget.cibleProteines,
        deja_mange: budget.mange,
        prevu_sur_la_journee: budget.prevu,
        reste_a_manger: sansCible ? null : budget.reste,
        // La différence entre `reste_a_manger` et `apport_des_creneaux_restants` dit
        // s'il faut alléger ou ajouter, et de combien. C'est LE chiffre à lire.
        apport_des_creneaux_restants: budget.restePrevu,
        creneaux: slots.map(sl => ({
          creneau: sl.slot, heure: sl.time, intitule: sl.label,
          plat: sl.plat, hors_plan: sl.libre, mange: sl.mange, macros: sl.macros,
        })),
        extras_notes: extras.length,
        rappel: energie
          ? 'Pour composer un repas qui tombe juste : « composer » avec la liste d\'ingrédients, il calcule et confronte à ce reste. Ne calcule pas de tête.'
          : 'CIBLE INDISPONIBLE — ne conclus rien sur les calories. Il manque une pesée à cette date, la taille ou l\'année de naissance dans le profil. Les macros des repas ci-dessous restent exactes : c\'est la cible qui manque, pas le contenu des assiettes.',
      }
    }
    case 'nutrition': {
      const nut = (d.nutrition ?? {}) as Record<string, unknown>
      const rubrique = typeof args.rubrique === 'string' ? args.rubrique : ''
      if (!rubrique) {
        return {
          rubriques: Object.entries(nut).map(([k, v]) => ({
            nom: k,
            taille_octets: Buffer.byteLength(JSON.stringify(v ?? null)),
          })).sort((a, b) => b.taille_octets - a.taille_octets),
        }
      }
      if (!(rubrique in nut)) throw new Error(`Rubrique inconnue : ${rubrique}. Appelle « nutrition » sans argument pour la liste.`)
      return { [rubrique]: nut[rubrique] }
    }
    default:
      throw new Error(`Outil inconnu : ${name}`)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Le bilan : une seule traversée au lieu de quatre.
// ─────────────────────────────────────────────────────────────────────────────
//
// Presque toutes les conversations commencent pareil — de quand datent les données,
// qu'est-ce qui est prévu aujourd'hui, comment se sont passées les dernières
// séances, où en est le poids. Répondre demandait quatre appels : `etat`, `seances`,
// `poids`, `nutrition`. Quatre allers-retours pour une seule question.
//
// Ça coûtait déjà du contexte — quatre réponses qui se recoupent — mais c'est la
// passerelle qui a tranché : elle échoue une fois sur deux, et chaque traversée
// évitée est une chance de moins de tomber dessus. Un bilan en un appel, c'est
// statistiquement quatre fois moins d'échecs pour ouvrir une conversation.
//
// Le contenu est un RÉSUMÉ, délibérément : les séries détaillées restent dans
// `seances`, l'historique d'un mouvement dans `exercice`. Tout regrouper aurait juste
// déplacé le problème dans la fenêtre de contexte.

function bilan(
  d: Record<string, unknown>,
  pousseLe: string,
  args: Record<string, unknown>,
  props: { status: string }[],
): unknown {
  // À l'heure de PARIS. Le serveur tourne en UTC : entre minuit et deux heures du
  // matin en France, il est encore la veille pour lui. Le premier outil de toute
  // conversation annonçait alors la séance et les repas de la veille comme étant
  // ceux d'aujourd'hui — et rien dans la réponse ne permettait de s'en apercevoir.
  const jour = typeof args.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.date)
    ? args.date
    : aujourdhuiParis()
  const combien = clampInt(args.seances, 5, 1, 15)
  const nut = (d.nutrition ?? {}) as Record<string, unknown>

  // ─── Ce qui est prévu aujourd'hui ────────────────────────────────────────
  // Même règle que l'application : une exception de planning l'emporte sur la
  // semaine type. Les redéfinir autrement ferait diverger ce que je dis de ce que
  // l'écran montre, et c'est exactement le genre d'écart qu'on ne voit jamais venir.
  const dow = dowIndex(jour)
  const exceptions = (d.planDays ?? {}) as Record<string, string | null>
  const semaine = asArray(d.weekPlan) as (string | null)[]
  const seanceId = Object.hasOwn(exceptions, jour) ? exceptions[jour] : (semaine[dow] ?? null)
  const seanceDuJour = progOf(d).find(p => p.id === seanceId) ?? null
  const salle = !!seanceDuJour

  // La semaine de menus appliquée à cette date : la dernière assignée avant elle.
  const assign = (nut.menuAssign ?? {}) as Record<string, string>
  const mesSemaines = asArray(nut.menus).map(normalizeWeek).filter(Boolean)
  const passees = Object.keys(assign).filter(m => m <= mondayOf(jour)).sort()
  const voulue = passees.length ? assign[passees.at(-1)!] : (nut.activeMenu as string | null)
  const toutes = [...builtinWeeks(), ...mesSemaines] as ReturnType<typeof builtinWeeks>
  const menu = toutes.find(w => w.id === voulue) ?? toutes[0]

  const recettes = mergeRecipes(
    asArray(nut.userRecipes) as never,
    (nut.recipePatches ?? {}) as never,
    asArray(nut.disabledRecipes) as never,
  )
  const nomDe = (id: string | undefined) => (id ? recettes[id]?.name ?? id : null)
  // Le plat RÉELLEMENT pris l'emporte sur celui du plan : c'est ce qu'il a mangé.
  const pris = ((nut.picked ?? {}) as Record<string, Record<string, string>>)[jour] ?? {}
  const repas = (salle ? SLOTS_GYM : SLOTS_REST)
    .filter(sl => sl.id === 'lunch' || sl.id === 'dinner')
    .map(sl => ({
      creneau: sl.id,
      heure: sl.time,
      plat: nomDe(pris[sl.id] ?? recipeForSlot(menu, dow, sl)),
      remplace: Object.hasOwn(pris, sl.id),
    }))

  // ─── Les dernières séances, en une ligne chacune ─────────────────────────
  const sessions = asArray(d.sessions) as Record<string, unknown>[]
  const recentes = sessions.slice(-combien).reverse().map((s) => {
    const entries = asArray(s.entries) as { sets?: unknown[], effort?: string }[]
    const durs = entries.map(e => e.effort).filter(Boolean)
    return {
      date: String(s.at ?? '').slice(0, 10),
      nom: s.name ?? null,
      duree_min: s.durationMin ?? null,
      exercices: entries.length,
      series: entries.reduce((n, e) => n + asArray(e.sets).length, 0),
      a_l_echec: durs.filter(e => e === 'fail').length,
      note: s.note ?? null,
    }
  })

  // ─── Le poids : la tendance, pas la liste ────────────────────────────────
  // Le calcul est dans lib/bilan.ts, avec ses tests : c'est la seule partie du bilan
  // qui puisse être fausse sans que ça se voie.
  const poids = weightTrend(asArray(d.bodyWeight) as { date?: string, kg?: number }[], jour)
  // La fraîcheur du miroir se mesure à MAINTENANT, pas au jour demandé : c'est une
  // propriété du serveur, pas de la question posée.
  const heures = Math.round((Date.now() - Date.parse(pousseLe)) / 3600000)

  return {
    miroir: {
      pousse_le: pousseLe,
      // Le retard est LE chiffre à lire avant de conclure quoi que ce soit.
      retard_h: heures > 0 ? heures : 0,
      a_jour: heures < 24,
    },
    aujourdhui: {
      date: jour,
      jour: DAY_NAMES[dow],
      seance_prevue: seanceDuJour ? { id: seanceDuJour.id, nom: seanceDuJour.name } : null,
      jour_de_salle: salle,
      semaine_de_menus: menu?.name ?? null,
      repas,
    },
    seances_recentes: recentes,
    // Le rythme, pas un verdict : la cible dépend de sa composition corporelle, et ce
    // sont `poids` et `profil` qui portent ces chiffres-là.
    poids,
    propositions_en_attente: props.filter(p => p.status === 'pending').length,
    pour_aller_plus_loin: 'Séries détaillées : « seances ». Historique d\'un mouvement : « exercice ». Un champ précis : « champ ».',
  }
}

/**
 * L'heure et la date DE GRÉGOIRE, pas celles du serveur.
 *
 * Netlify tourne en UTC ; lui vit à Paris. Une journée « déjà jouée » se décide à
 * 15 h locales — à 15 h 30 Paris en été, le serveur croit qu'il est 13 h 30 et
 * conclut que la séance de midi est encore à venir. Deux heures pendant lesquelles
 * le connecteur crédite un forfait de séance que l'écran, lui, a déjà retiré.
 */
const PARIS = 'Europe/Paris'
const aujourdhuiParis = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: PARIS, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const heureParis = (): number =>
  Number(new Intl.DateTimeFormat('en-GB', { timeZone: PARIS, hour: '2-digit', hour12: false }).format(new Date()))

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

function clampInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10)
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback
}

/** Tronque en le DISANT : une réponse coupée en silence se lit comme une réponse
 *  complète, et le modèle conclut sur des données qu'il n'a pas vues. */
function clamp(value: unknown): string {
  const text = JSON.stringify(value, null, 1) ?? 'null'
  if (Buffer.byteLength(text) <= MAX_RESULT_BYTES) return text
  return `${text.slice(0, MAX_RESULT_BYTES)}\n… RÉPONSE TRONQUÉE à ${MAX_RESULT_BYTES} octets. Relance avec un filtre plus étroit (limite, depuis, rubrique).`
}
