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
