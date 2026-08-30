// ─────────────────────────────────────────────────────────────────────────────
// Désigner un endroit précis dans la sauvegarde, et n'y toucher que là.
// ─────────────────────────────────────────────────────────────────────────────
//
// Rendre « tout le fichier de sauvegarde modifiable » pose une question qu'il vaut
// mieux résoudre avant d'écrire la première ligne : COMMENT désigne-t-on l'endroit
// à modifier, et qu'est-ce qu'on s'interdit d'y faire ?
//
// Le format retenu est le JSON Pointer (RFC 6901) : `/sessions/3/durationMin`. Il a
// deux qualités qui comptent ici — il est sans ambiguïté (pas d'analyse d'expression,
// pas de quotes à interpréter) et il ne peut désigner qu'UN emplacement, jamais une
// sélection. On ne peut pas écrire « toutes les séances de août » par accident.
//
// Ce module savait UNE chose : remplacer une valeur simple déjà présente. Trois
// interdits l'encadraient — ne rien créer, n'écrire que des scalaires, vérifier la
// valeur en place avant de l'écraser.
//
// Les deux premiers sont tombés, et il faut dire pourquoi, parce qu'ils étaient
// écrits comme des principes. Ils protégeaient contre le mauvais risque. Le vrai
// coût de ces interdits, mesuré : une cinquantaine de gestes que l'application sait
// faire et qu'aucune conversation ne pouvait déclencher — ajouter une pesée oubliée,
// retirer un extra saisi deux fois, effacer une exception de planning, rendre sa
// fiche d'origine à un exercice. Chacun renvoyait « fais-le à la main », c'est-à-dire
// renvoyait le travail à quelqu'un pendant qu'une machine regardait.
//
// Ce qui reste, et qui suffit :
//
//   • on ne crée jamais un CHEMIN, seulement une feuille. Le parent doit exister de
//     bout en bout — une faute de frappe dans un nom de section ne fabrique donc
//     toujours pas de branche fantôme que rien ne lit ;
//   • on vérifie la valeur en place avant de la remplacer ou de la supprimer (cf.
//     `de` dans les propositions). Ce module ne fait que la LIRE ; c'est l'appelant
//     qui compare. C'est ce garde-fou-là qui portait réellement la sécurité, et il
//     ne bouge pas ;
//   • une valeur composée est bornée en taille et en profondeur : on peut ajouter un
//     repas ou une pesée, pas réinjecter un fichier entier par un pointeur.
//
// Et un interdit qui s'ajoute, plus utile que ceux qui partent : on ne remplace
// JAMAIS un objet ou un tableau existant. Créer une feuille absente, ajouter à une
// liste, supprimer une entrée précise — oui. Écraser d'un coup une section entière
// dont on ne saurait pas dire ce qu'elle contenait — non. C'est la différence entre
// modifier des données et les réécrire.

export type Scalar = string | number | boolean | null

/** Les segments d'un pointeur, échappements RFC 6901 résolus. */
export function parsePointer(pointer: string): string[] | null {
  if (typeof pointer !== 'string' || pointer === '') return null
  if (!pointer.startsWith('/')) return null
  if (pointer.length > 200) return null
  return pointer
    .slice(1)
    .split('/')
    // ~1 → « / » et ~0 → « ~ ». L'ordre est imposé par la RFC : l'inverse
    // transformerait « ~01 » en « / » au lieu de « ~1 ».
    .map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'))
}

const isIndex = (s: string) => /^(0|[1-9]\d*)$/.test(s)

/**
 * La valeur à cet emplacement, ou `undefined` si le chemin ne mène nulle part.
 *
 * `undefined` ne se distingue pas d'une valeur absente, et c'est voulu : dans les
 * deux cas il n'y a rien à remplacer.
 */
export function getAt(root: unknown, pointer: string): unknown {
  const parts = parsePointer(pointer)
  if (!parts) return undefined
  let cur: unknown = root
  for (const p of parts) {
    if (Array.isArray(cur)) {
      if (!isIndex(p)) return undefined
      cur = cur[Number(p)]
    }
    else if (cur && typeof cur === 'object') {
      // `Object.hasOwn` et non `in` : sinon `/constructor` ou `/__proto__`
      // désigneraient des membres hérités, qui n'appartiennent pas aux données.
      if (!Object.hasOwn(cur as object, p)) return undefined
      cur = (cur as Record<string, unknown>)[p]
    }
    else return undefined
    if (cur === undefined) return undefined
  }
  return cur
}

export const isScalar = (v: unknown): v is Scalar =>
  v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'

/**
 * Écrit une valeur simple à cet emplacement. Rend `false` sans rien toucher si le
 * chemin n'existe pas, ou si l'on essaie d'écraser un objet ou un tableau.
 *
 * La mutation se fait sur l'objet passé — l'appelant travaille sur un instantané
 * qu'il vient de construire, pas sur l'état vivant de l'application.
 */
export function setAt(root: unknown, pointer: string, value: Scalar): boolean {
  const parts = parsePointer(pointer)
  if (!parts || !parts.length || !isScalar(value)) return false
  const last = parts[parts.length - 1]
  const parent = parts.length === 1 ? root : getAt(root, `/${parts.slice(0, -1).map(escape1).join('/')}`)
  if (!parent || typeof parent !== 'object') return false

  if (Array.isArray(parent)) {
    if (!isIndex(last)) return false
    const i = Number(last)
    if (i >= parent.length) return false // on ne rallonge pas un tableau
    if (parent[i] !== null && typeof parent[i] === 'object') return false
    parent[i] = value
    return true
  }
  const obj = parent as Record<string, unknown>
  if (!Object.hasOwn(obj, last)) return false // on ne crée pas de champ
  const before = obj[last]
  if (before !== null && typeof before === 'object') return false // ni objet, ni tableau
  obj[last] = value
  return true
}

const escape1 = (s: string) => s.replace(/~/g, '~0').replace(/\//g, '~1')

/**
 * Le parent d'un emplacement, et le dernier segment du chemin.
 *
 * Rendus ensemble parce que les quatre opérations en ont besoin toutes les quatre,
 * et qu'un recalcul séparé finirait par diverger d'une opération à l'autre.
 */
function parentOf(root: unknown, pointer: string): { parent: unknown, last: string } | null {
  const parts = parsePointer(pointer)
  if (!parts || !parts.length) return null
  const last = parts[parts.length - 1]
  const parent = parts.length === 1 ? root : getAt(root, `/${parts.slice(0, -1).map(escape1).join('/')}`)
  if (!parent || typeof parent !== 'object') return null
  return { parent, last }
}

/**
 * Bornes d'une valeur composée. Elles ne sont pas là pour la performance.
 *
 * Une proposition qui écrit un objet écrit quelque chose que personne ne relit champ
 * par champ avant de valider : on lit le résumé, on regarde la carte, on tape. La
 * borne dit donc jusqu'où une valeur reste RELISIBLE.
 *
 * Les deux chiffres sont calés sur le plus gros objet légitime — une séance oubliée
 * qu'on veut enregistrer après coup : `{ at, sessionId, entries: [ { exId, sets: [
 * { w, r } ] } ] }`. Six exercices de quatre séries, c'est une centaine de nœuds et
 * cinq niveaux d'imbrication. On prend six niveaux et quatre cents nœuds, ce qui
 * laisse de la marge pour une grosse séance sans jamais laisser passer une section
 * entière de la sauvegarde : `nutrition` seule en compte plusieurs milliers.
 *
 * Le budget est TOTAL et non par niveau. Un plafond par niveau se contourne sans le
 * vouloir — cent entrées à chaque étage font un million de nœuds sur six niveaux —
 * et c'est le genre de borne qui rassure sans rien borner.
 */
export const VALUE_MAX_DEPTH = 6
export const VALUE_MAX_NODES = 400

export function boundedValue(v: unknown): boolean {
  let budget = VALUE_MAX_NODES
  const marche = (x: unknown, depth: number): boolean => {
    if (--budget < 0 || depth > VALUE_MAX_DEPTH) return false
    if (isScalar(x)) return true
    const entries = Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.values(x) : null)
    if (!entries) return false // fonction, undefined, symbole : rien à faire ici
    return entries.every(e => marche(e, depth + 1))
  }
  return marche(v, 0)
}

/**
 * Crée une feuille ABSENTE. Rend `false` si elle existe déjà — c'est `setAt` qu'on
 * veut alors, et confondre les deux ferait écraser en croyant ajouter.
 */
export function createAt(root: unknown, pointer: string, value: unknown): boolean {
  const p = parentOf(root, pointer)
  if (!p || !boundedValue(value)) return false
  if (Array.isArray(p.parent)) return false // dans un tableau, on ajoute, on ne crée pas
  const obj = p.parent as Record<string, unknown>
  if (Object.hasOwn(obj, p.last)) return false
  obj[p.last] = value
  return true
}

/**
 * Ajoute à la FIN d'un tableau. Le pointeur désigne le tableau, pas une position.
 *
 * Insérer au milieu n'est volontairement pas offert : les tableaux de la sauvegarde
 * sont soit triés à l'écriture — les pesées, les séances —, soit sans ordre
 * signifiant. Une insertion positionnelle ne servirait qu'à se tromper de place.
 */
export function pushAt(root: unknown, pointer: string, value: unknown): boolean {
  const arr = getAt(root, pointer)
  if (!Array.isArray(arr) || !boundedValue(value)) return false
  if (arr.length >= 5000) return false
  arr.push(value)
  return true
}

/**
 * Supprime une clé d'objet ou un élément de tableau.
 *
 * C'est la seule opération irréversible du module, et la seule dont l'appelant DOIT
 * avoir confronté la valeur avant d'appeler (cf. `de`). Ici on ne fait qu'exécuter :
 * la garde est chez celui qui sait ce qu'il efface.
 */
export function removeAt(root: unknown, pointer: string): boolean {
  const p = parentOf(root, pointer)
  if (!p) return false
  if (Array.isArray(p.parent)) {
    if (!isIndex(p.last)) return false
    const i = Number(p.last)
    if (i >= p.parent.length) return false
    p.parent.splice(i, 1)
    return true
  }
  const obj = p.parent as Record<string, unknown>
  if (!Object.hasOwn(obj, p.last)) return false
  delete obj[p.last]
  return true
}
