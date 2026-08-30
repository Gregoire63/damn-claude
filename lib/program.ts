// Import relatif : testé dans le projet « unit », qui tourne en Node pur sans la
// résolution de chemins de Nuxt.
import type { Exercise, Session } from '../data/sportProgram'

// ─────────────────────────────────────────────────────────────────────────────
// Le programme livré, plus ce qu'un coach en a fait.
// ─────────────────────────────────────────────────────────────────────────────
//
// `PROGRAM` était figé dans le code. Changer 4×6-8 en 5×5 sur le développé couché,
// allonger un repos, retirer un mouvement qui fait mal à l'épaule, en ajouter un —
// tout cela demandait de rouvrir l'éditeur. C'est le seul pan de l'application qui
// n'avait aucune prise depuis une conversation, alors que c'est précisément le pan
// sur lequel un coach intervient.
//
// Le mécanisme est celui de la bibliothèque de plats, et pour les mêmes raisons :
//
//   · on PATCHE le livré, on ne le réécrit pas. La fiche d'origine reste là, donc on
//     peut revenir en arrière si la modification se révèle mauvaise ;
//   · on RETIRE en désactivant, jamais en supprimant. Les séances enregistrées sont
//     indexées par identifiant d'exercice : effacer l'exercice rendrait illisibles
//     des mois d'historique, et ferait disparaître des records qu'on a vraiment
//     soulevés. Un mouvement retiré sort du programme et reste dans le passé.
//
// Cette deuxième règle est la plus importante, et c'est celle qu'on aurait le plus
// facilement enfreinte : « retirer un exercice » se code en une ligne avec un filter,
// et cette ligne coûte l'historique.

/** Ce qu'on peut changer sur un exercice livré. Tout est facultatif : un patch ne
 *  touche QUE ce qu'il mentionne. */
export interface ExercisePatch {
  name?: string
  sets?: number
  reps?: string
  /** Repos entre séries, en secondes. */
  rest?: number
  cues?: string[]
  machine?: string
  muscles?: string[]
  bodyweight?: boolean
  /** Les deux mouvements enchaînés, par leur LIBELLÉ — pas par identifiant : la
   *  saisie affiche une colonne de charge par mouvement, elle n'ouvre pas de fiche. */
  superset?: [string, string]
  mesure?: 'reps' | 'temps'
  optionnel?: boolean
}

/** Une machine de remplacement, telle qu'une proposition a le droit de la décrire. */
export interface VariantSpec { id: string, name: string, ratio: number }

export interface ProgramCustom {
  /**
   * Séances créées de toutes pièces.
   *
   * Les cinq autres champs ne savent que MODIFIER le livré — `added` lui-même est
   * indexé par identifiant de séance existante. Tant qu'il n'y avait que ce
   * mécanisme, une installation neuve au programme vide restait vide pour toujours :
   * il n'y avait aucune séance à laquelle rattacher un exercice, et donc rien que
   * Claude puisse proposer.
   *
   * Ce champ-ci porte des séances COMPLÈTES, au même format que le livré. C'est ce
   * qui permet à l'application de partir de zéro — et c'est la seule façon d'être
   * partageable sans imposer le programme de quelqu'un d'autre.
   */
  sessions?: Session[]
  /** Modifications d'exercices livrés, par identifiant. */
  patches?: Record<string, ExercisePatch>
  /** Exercices ajoutés, par identifiant de séance. */
  added?: Record<string, Exercise[]>
  /** Exercices retirés du programme — mais PAS de l'historique. */
  disabled?: string[]
  /** Ordre voulu des exercices d'une séance, par identifiant de séance. */
  order?: Record<string, string[]>
  /**
   * Machines de remplacement redéfinies, par identifiant d'exercice.
   *
   * Elles vivent dans `data/exerciseVariants.ts`, avec quatre champs de plus que ce
   * qu'une proposition sait décrire — `gear` pilote l'icône de matériel, `hint` et
   * `why` la phrase d'explication. La liste stockée ici ne porte donc QUE l'essentiel,
   * et la fusion rend le reste au catalogue quand l'identifiant s'y trouve encore.
   */
  variants?: Record<string, VariantSpec[]>
}

const patchOf = (e: Exercise, p?: ExercisePatch): Exercise => {
  if (!p) return e
  // Aucune clé absente ne doit écraser l'existant : c'est tout l'intérêt d'un patch.
  const out: Exercise = { ...e }
  if (typeof p.name === 'string' && p.name.trim()) out.name = p.name.trim()
  if (typeof p.sets === 'number' && p.sets > 0) out.sets = Math.round(p.sets)
  if (typeof p.reps === 'string' && p.reps.trim()) out.reps = p.reps.trim()
  if (typeof p.rest === 'number' && p.rest > 0) out.rest = Math.round(p.rest)
  if (Array.isArray(p.cues)) out.cues = p.cues.filter(c => typeof c === 'string' && c.trim())
  if (typeof p.machine === 'string') out.machine = p.machine
  if (Array.isArray(p.muscles) && p.muscles.length) out.muscles = p.muscles.filter(m => typeof m === 'string')
  if (typeof p.bodyweight === 'boolean') out.bodyweight = p.bodyweight
  if (Array.isArray(p.superset) && p.superset.length === 2) out.superset = [String(p.superset[0]), String(p.superset[1])]
  if (p.mesure === 'reps' || p.mesure === 'temps') out.mesure = p.mesure
  if (typeof p.optionnel === 'boolean') out.optionnel = p.optionnel
  return out
}

/**
 * Le programme EFFECTIF : livré + modifications + ajouts − retraits, dans l'ordre voulu.
 *
 * Les identifiants absents de `order` gardent leur place relative après ceux qui y
 * figurent : réordonner les trois premiers exercices ne doit pas obliger à énumérer
 * les six.
 */
export function mergeProgram(builtin: Session[], custom: ProgramCustom = {}, avecInactifs = false): Session[] {
  const off = new Set(custom.disabled ?? [])
  /**
   * Les séances créées passent par le MÊME traitement que les livrées.
   *
   * On les concatène ici plutôt que de les rendre à part : patches, retraits, ordre
   * et machines de remplacement s'appliquent alors à elles sans une ligne de plus.
   * Une séance créée puis modifiée se comporte exactement comme une séance livrée
   * modifiée — il n'y a pas deux régimes à connaître.
   *
   * Un identifiant déjà pris par le livré est IGNORÉ. Le laisser passer afficherait
   * la séance deux fois, et l'historique — indexé par exercice — ne saurait plus à
   * laquelle des deux rattacher une performance.
   */
  const connus = new Set(builtin.map(s => s.id))
  const toutes = [...builtin, ...(custom.sessions ?? []).filter(s => s?.id && !connus.has(s.id))]
  return toutes.map((s) => {
    const ajoutes = (custom.added?.[s.id] ?? []).filter(e => e && typeof e.id === 'string')
    const tous = [...s.exercises, ...ajoutes]
      .filter(e => avecInactifs || !off.has(e.id))
      .map(e => patchOf(e, custom.patches?.[e.id]))

    /**
     * L'ordre voulu déplace les ACTIFS entre eux ; les inactifs gardent leur place.
     *
     * C'est ce qui fait qu'une réactivation sans position demandée retrouve l'endroit
     * d'origine — l'exercice n'a jamais bougé du tableau, il en était seulement filtré.
     * Trier tout le monde ensemble aurait ramené les inactifs en fin de liste, et un
     * mouvement repris trois mois plus tard serait revenu à un autre endroit de la
     * séance que celui d'où il était parti.
     */
    const voulu = custom.order?.[s.id]
    if (!voulu?.length) return { ...s, exercises: finDeBloc(tous) }
    const rang = new Map(voulu.map((id, i) => [id, i]))
    const places = tous.map((e, i) => i).filter(i => rang.has(tous[i].id))
    const deplaces = places
      .map(i => tous[i])
      .sort((a, b) => (rang.get(a.id) ?? 0) - (rang.get(b.id) ?? 0))
    const sortie = [...tous]
    places.forEach((pos, k) => { sortie[pos] = deplaces[k] })
    return { ...s, exercises: finDeBloc(sortie) }
  })
}

/**
 * Les mouvements facultatifs, toujours en fin de séance.
 *
 * C'est fait ICI, dans la fusion, et pas à l'affichage — sinon l'écran montrerait un
 * ordre et l'outil `programme` en annoncerait un autre, ce qui ferait proposer des
 * réordonnancements par rapport à une liste que personne ne voit. Un seul ordre,
 * pour tout le monde.
 *
 * Conséquence assumée : un `reordonner` qui place un facultatif au milieu est
 * accepté — les identifiants sont bons — mais le facultatif redescend en fin de bloc.
 */
const finDeBloc = (list: Exercise[]): Exercise[] =>
  [...list.filter(e => !e.optionnel), ...list.filter(e => e.optionnel)]

/** Un exercice mesuré en TEMPS, et non en répétitions. Le point d'entrée unique des
 *  trois court-circuits — progression, record, 1RM. */
export const isTimed = (e: { mesure?: 'reps' | 'temps' } | null | undefined): boolean =>
  e?.mesure === 'temps'

/** Actif = présent dans le programme. Un exercice retiré reste dans les données. */
export const isActive = (custom: ProgramCustom, exId: string): boolean =>
  !(custom.disabled ?? []).includes(exId)

/** Tous les exercices du programme effectif, à plat. */
export const allExercises = (sessions: Session[]): Exercise[] => sessions.flatMap(s => s.exercises)

/**
 * Les exercices RETIRÉS, avec leur fiche d'origine.
 *
 * L'historique les référence encore. Sans cette liste, une séance de mars afficherait
 * « dc-barre » en identifiant brut là où elle affichait « Développé couché barre ».
 */
export function retiredExercises(builtin: Session[], custom: ProgramCustom = {}): Record<string, Exercise> {
  const off = new Set(custom.disabled ?? [])
  const out: Record<string, Exercise> = {}
  // Les séances créées comptent autant que les livrées : un mouvement retiré d'une
  // séance qu'on a écrite soi-même est référencé par l'historique exactement pareil,
  // et sans son nom ce sont des mois de journal qui deviennent illisibles.
  for (const s of [...builtin, ...(custom.sessions ?? [])]) {
    if (!s?.exercises) continue
    for (const e of s.exercises) if (off.has(e.id)) out[e.id] = e
    for (const e of custom.added?.[s.id] ?? []) if (off.has(e.id)) out[e.id] = e
  }
  return out
}

/**
 * Les mouvements retirés AVANT que le programme ne devienne modifiable.
 *
 * Ils ne sont plus nulle part dans `PROGRAM`, mais des séances de l'historique les
 * référencent encore. Cette table vivait recopiée à l'identique dans deux composants —
 * `DaySheet` et `Report` — et un troisième écran l'aurait oubliée. Elle est ici, une
 * fois, avec la fonction qui la consulte.
 */
export const LEGACY_NAMES: Record<string, string> = {
  'ext-corde': 'Extension triceps corde',
  'curl-incline': 'Curl incliné haltères',
  'curl-ez': 'Curl barre EZ',
}

/** La séance qui contient cet exercice dans le programme livré ou personnalisé. */
export function sessionOf(sessions: Session[], exId: string): Session | null {
  return sessions.find(s => s.exercises.some(e => e.id === exId)) ?? null
}
