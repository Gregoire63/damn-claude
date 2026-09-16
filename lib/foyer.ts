/**
 * Le FOYER : qui mange à la maison, et combien chacun mange.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Tout le module nutrition compte en PORTIONS, et une portion c'est la sienne :
 * les cibles caloriques, les macros, ce qui reste au frigo. Cuisiner à deux se
 * réglait donc en multipliant par deux — sauf que deux personnes ne mangent
 * presque jamais pareil, et qu'un ×2 fait trop pour l'un, ou pas assez pour
 * l'autre. On finit par corriger de tête, ingrédient par ingrédient, à chaque
 * plat.
 *
 * Un convive porte donc un APPÉTIT, exprimé par rapport au sien : 1 = « comme moi »,
 * 0,6 = « les deux tiers ». Les grammages se multiplient par la somme des appétits
 * de ceux qui mangent.
 *
 * ── Deux règles qui découlent de là, et qu'il ne faut pas perdre de vue ──
 *
 * « Moi » ne se supprime pas et son appétit vaut toujours 1. Ce n'est pas une
 * politesse : c'est l'UNITÉ. Tous les autres chiffres de l'application — la cible du
 * jour, le métabolisme de base, les macros d'un plat — sont exprimés dans cette
 * unité-là. La rendre réglable ferait dériver tout le reste sans que rien ne le dise.
 *
 * Et le facteur ne touche QUE les quantités à peser et à acheter, jamais les macros
 * affichées : ce qu'on mange reste une portion, la sienne. Multiplier les macros par
 * le nombre de convives ferait compter dans son suivi ce que quelqu'un d'autre a
 * mangé — c'est-à-dire fausser la seule chose que cette application sert à mesurer.
 */

export interface Convive {
  id: string
  nom: string
  /** Par rapport à soi : 1 = autant que moi, 0,6 = 60 %. */
  appetit: number
  /** Mange en ce moment. Ce qu'on coche avant de cuisiner. */
  actif: boolean
}

/** L'unité de compte. Toujours là, toujours à 1, toujours au repas. */
export const MOI: Convive = { id: 'moi', nom: 'Moi', appetit: 1, actif: true }

/** Bornes de l'appétit : un dixième de part, trois parts. Au-delà, c'est un convive de plus. */
export const APPETIT_MIN = 0.1
export const APPETIT_MAX = 3

export const borner = (n: number): number =>
  Math.min(APPETIT_MAX, Math.max(APPETIT_MIN, Math.round(n * 100) / 100))

/**
 * Ce par quoi multiplier les quantités.
 *
 * La somme des appétits de ceux qui mangent. Seul : 1, et rien ne change nulle part
 * — c'est ce qui permet d'ajouter cette notion sans rien déranger pour qui cuisine
 * pour lui.
 */
export function facteurConvives(convives: Convive[]): number {
  const somme = convives.filter(c => c.actif).reduce((n, c) => n + borner(c.appetit), 0)
  // Zéro convive actif n'a pas de sens — on cuisine au moins pour soi. Le cas ne
  // devrait pas arriver (« Moi » est verrouillé), mais un stockage bricolé à la main
  // ne doit pas rendre une liste de courses vide.
  return somme > 0 ? Math.round(somme * 100) / 100 : 1
}

/** Applique le facteur à un grammage. Arrondi au gramme : on ne pèse pas plus fin. */
export const pourConvives = (grammes: number, facteur: number): number =>
  Math.round(grammes * facteur)

/**
 * Relit ce qui a été stocké, en se méfiant de tout.
 *
 * `MOI` est réinjecté quoi qu'il arrive, en tête, avec son appétit à 1 et sa présence
 * au repas : un stockage vidé, tronqué ou modifié à la main ne doit jamais aboutir à
 * une application qui cuisine pour personne.
 */
export function normaliserConvives(brut: unknown): Convive[] {
  const liste = Array.isArray(brut) ? brut : []
  const autres: Convive[] = []
  const vus = new Set([MOI.id])
  for (const c of liste) {
    if (!c || typeof c !== 'object') continue
    const o = c as Record<string, unknown>
    const id = String(o.id ?? '').trim()
    if (!id || vus.has(id)) continue
    const nom = String(o.nom ?? '').trim().slice(0, 24)
    if (!nom) continue
    vus.add(id)
    autres.push({ id, nom, appetit: borner(Number(o.appetit) || 1), actif: o.actif !== false })
  }
  return [{ ...MOI }, ...autres.slice(0, 8)]
}

/** Un identifiant stable pour un convive ajouté. */
export const idConvive = (nom: string, existants: Convive[]): string => {
  const base = nom.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'convive'
  let id = base
  let n = 2
  while (existants.some(c => c.id === id)) id = `${base}-${n++}`
  return id
}

/** « Moi + Camille » ou « Moi seul ». Ce qu'on écrit sur la fiche de recette. */
export function libelleConvives(convives: Convive[]): string {
  const actifs = convives.filter(c => c.actif)
  if (actifs.length <= 1) return 'Moi seul'
  return actifs.map(c => c.nom).join(' + ')
}

// ─────────────────────────────────────────────────────────────────────────────
// Qui mange CE repas-là.
// ─────────────────────────────────────────────────────────────────────────────
//
// Le foyer dit qui vit là et combien chacun mange. Il ne dit pas qui est à table ce
// soir : on cuisine pour deux le mardi, pour quatre le samedi, et un dimanche midi
// on est seul. Un facteur unique pour toute la semaine se trompe donc tous les jours
// sauf un.
//
// Chaque repas porte ses convives : des MEMBRES du foyer (dont on connaît déjà
// l'appétit) et des INVITÉS ponctuels, qui n'ont pas à entrer dans le foyer pour un
// dîner. Ajouter sa belle-sœur à la liste des habitants pour un samedi soir, puis
// penser à l'en retirer, c'est le genre de ménage que personne ne fait.

/** Quelqu'un qui mange une fois. Pas de nom obligatoire : « invité » suffit. */
export interface Invite { nom: string, appetit: number }

export interface ConvivesRepas {
  /** Identifiants des membres du foyer à table. */
  membres: string[]
  /** Ceux qui ne sont là que ce soir. */
  invites: Invite[]
  /**
   * Combien de fois chacun mange CE plat. Absent, ou 1 : une fois, ce soir.
   *
   * ── Pourquoi ce n'est pas un appétit ────────────────────────────────────
   *
   * Cuisiner pour le lendemain, c'est doubler la casserole sans changer l'assiette.
   * Monter l'appétit à 200 % dirait autre chose : que la personne mange deux fois
   * plus CE SOIR — et `partDeMoi` suivrait, donc la fiche annoncerait une assiette
   * deux fois plus grosse et le suivi compterait un dîner double. Les grammages
   * seraient bons et tout le reste faux.
   *
   * Le nombre de repas multiplie donc ce qu'on PÈSE, et rien d'autre. La part qui
   * revient à chacun ce soir reste une portion, la sienne.
   *
   * Par personne et non global, parce que c'est comme ça que ça tombe : on prévoit
   * deux jours pour soi et un seul pour l'autre, qui déjeune dehors le lendemain.
   * Un multiplicateur unique obligerait à cuisiner un repas de trop.
   *
   * Rangé à part des `membres` et non fondu dedans : ce qui vaut 1 n'est pas écrit,
   * donc une sauvegarde d'avant ce réglage se relit sans migration, et un repas
   * ordinaire ne coûte toujours rien à stocker.
   */
  repas?: Record<string, number>
}

/** Bornes du nombre de repas. Au-delà de neuf, ce n'est plus un plat, c'est un stock. */
export const REPAS_MIN = 1
export const REPAS_MAX = 9

export const bornerRepas = (n: unknown): number => {
  const v = Math.round(Number(n))
  return Number.isFinite(v) ? Math.min(REPAS_MAX, Math.max(REPAS_MIN, v)) : REPAS_MIN
}

/** Combien de fois ce membre mange ce plat. L'absence vaut une fois. */
export const repasDe = (repas: ConvivesRepas | null, id: string): number =>
  bornerRepas(repas?.repas?.[id] ?? 1)

/** Quelqu'un cuisine-t-il pour plus d'un repas ? Décide de ce que l'écran annonce. */
export const aDesRepasEnPlus = (repas: ConvivesRepas | null): boolean =>
  !!repas && repas.membres.some(id => repasDe(repas, id) > 1)

/**
 * Repose le nombre de repas d'un membre. Un retour à 1 EFFACE l'entrée plutôt que
 * de l'écrire : c'est ce qui garde « ordinaire » indiscernable de « jamais touché »,
 * et donc le stockage lisible.
 */
export function avecRepas(c: ConvivesRepas, id: string, n: number): ConvivesRepas {
  const suivant = { ...(c.repas ?? {}) }
  const v = bornerRepas(n)
  if (v <= 1) delete suivant[id]
  else suivant[id] = v
  const out: ConvivesRepas = { ...c, repas: suivant }
  if (!Object.keys(suivant).length) delete out.repas
  return out
}

/** Le même nombre pour tout le monde — le geste courant : « je cuisine pour demain ». */
export function repasPourTous(c: ConvivesRepas, n: number): ConvivesRepas {
  return c.membres.reduce((acc, id) => avecRepas(acc, id, n), c)
}

/** Par défaut, ceux du foyer qui sont au repas : le réglage courant, sans surprise. */
export const convivesParDefaut = (foyer: Convive[]): ConvivesRepas => ({
  membres: foyer.filter(c => c.actif).map(c => c.id),
  invites: [],
})

export function normaliserRepas(brut: unknown): ConvivesRepas | null {
  if (!brut || typeof brut !== 'object') return null
  const o = brut as Record<string, unknown>
  const membres = Array.isArray(o.membres) ? o.membres.map(String).slice(0, 12) : []
  const invites = Array.isArray(o.invites)
    ? o.invites.slice(0, 12).map((i) => {
        const x = (i && typeof i === 'object' ? i : {}) as Record<string, unknown>
        return { nom: String(x.nom ?? '').trim().slice(0, 24) || 'Invité', appetit: borner(Number(x.appetit) || 1) }
      })
    : []
  if (!membres.length && !invites.length) return null
  // `MOI` est toujours à table : tout le reste de l'application compte dans SA part,
  // et un repas dont il serait absent n'aurait ni cible, ni macros, ni sens ici.
  const tous = membres.includes(MOI.id) ? membres : [MOI.id, ...membres]
  // Les repas en plus : seulement pour des gens réellement à table, et seulement
  // au-dessus de 1. Une entrée orpheline — le membre a été décoché depuis — ferait
  // réapparaître un ×2 le jour où on le recoche, sans que rien ne l'ait demandé.
  const repas: Record<string, number> = {}
  const brutRepas = (o.repas && typeof o.repas === 'object' ? o.repas : {}) as Record<string, unknown>
  for (const id of tous) {
    const n = bornerRepas(brutRepas[id] ?? 1)
    if (n > 1) repas[id] = n
  }
  const propre: ConvivesRepas = { membres: tous, invites }
  if (Object.keys(repas).length) propre.repas = repas
  return propre
}

/**
 * Ce par quoi multiplier les quantités pour CE repas.
 *
 * Somme des appétits de ceux qui mangent, chacun compté autant de fois qu'il
 * emporte de repas. Un invité compte une fois : il est à table ce soir, c'est tout
 * ce que ça veut dire. Quelqu'un qui repart avec une boîte est un convive de plus.
 */
export function facteurRepas(repas: ConvivesRepas | null, foyer: Convive[]): number {
  if (!repas) return facteurConvives(foyer)
  const parId = new Map(foyer.map(c => [c.id, c]))
  const membres = repas.membres.reduce((n, id) => n + borner(parId.get(id)?.appetit ?? 1) * repasDe(repas, id), 0)
  const invites = repas.invites.reduce((n, i) => n + borner(i.appetit), 0)
  const somme = membres + invites
  return somme > 0 ? Math.round(somme * 100) / 100 : 1
}

/**
 * La part qui revient à MOI, entre 0 et 1 — ce qu'on met dans son assiette.
 *
 * C'est la question que la fiche ne répondait pas. Elle affichait les quantités à
 * peser pour tout le monde et annonçait des macros « pour ta part », sans jamais
 * dire quelle fraction de la casserole c'était. On cuisine 1,6 portion et on sert à
 * vue — c'est-à-dire qu'on mange autre chose que ce que l'application compte.
 */
export function partDeMoi(repas: ConvivesRepas | null, foyer: Convive[]): number {
  const facteur = facteurRepas(repas, foyer)
  const moi = foyer.find(c => c.id === MOI.id)?.appetit ?? 1
  // UNE portion, même quand on en cuisine trois : le numérateur ne porte pas le
  // nombre de repas. C'est toute la différence entre « je cuisine pour demain » et
  // « je mange le double ce soir » — et la confondre ferait compter deux dîners.
  return facteur > 0 ? Math.min(1, borner(moi) / facteur) : 1
}

/**
 * « Moi ×2 + Camille + 2 invités ». Ce qu'on écrit en tête de la fiche.
 *
 * Le ×2 est NOMMÉ et pas seulement compté dans le facteur : c'est le seul endroit
 * où l'on relit sa propre décision de la veille, la casserole déjà sur le feu.
 */
export function libelleRepas(repas: ConvivesRepas | null, foyer: Convive[]): string {
  if (!repas) return libelleConvives(foyer)
  const noms = repas.membres
    .map((id) => {
      const nom = foyer.find(c => c.id === id)?.nom
      if (!nom) return null
      const n = repasDe(repas, id)
      return n > 1 ? `${nom} ×${n}` : nom
    })
    .filter((n): n is string => !!n)
  const n = repas.invites.length
  const bouts = [...noms, ...(n ? [`${n} invité${n > 1 ? 's' : ''}`] : [])]
  if (!bouts.length) return 'Moi seul'
  if (bouts.length === 1) return bouts[0]!.includes('×') ? bouts[0]! : 'Moi seul'
  return bouts.join(' + ')
}
