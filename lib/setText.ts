// Import relatif : testé dans le projet « unit », qui tourne en Node pur sans la
// résolution de chemins de Nuxt.
import { isTimed } from './program'

// ─────────────────────────────────────────────────────────────────────────────
// Écrire une série comme elle se lit.
// ─────────────────────────────────────────────────────────────────────────────
//
// Le journal écrivait « 91.5×40 » pour une suspension à la barre de quarante
// secondes. Les deux nombres sont justes et la phrase est fausse : on lit « quarante
// répétitions à 91,5 kg », c'est-à-dire un exercice qu'on n'a pas fait.
//
// Le format vit ici, en un seul endroit, parce que trois écrans l'affichent — la
// journée du calendrier, la carte de séance, les records — et que trois formats
// auraient fini par diverger. C'est la même raison qui a sorti `mesure` du décor :
// une série au temps n'est pas une série au poids, et l'écrire pareil ne les rend
// pas comparables, ça rend la lecture fausse.

export interface SetLike { w?: number, r?: number, w2?: number, r2?: number }
export interface ExLike { mesure?: 'reps' | 'temps', bodyweight?: boolean, superset?: [string, string] }

const nb = (n: number) => String(Math.round(n * 10) / 10)

/**
 * Une secondes en « 40 s » ou « 1:15 ».
 *
 * Le seuil à la minute : en dessous, « 45 s » se lit d'un coup ; au-delà, « 90 s »
 * demande une conversion mentale que « 1:30 » évite. C'est le même choix que le
 * minuteur de repos, et volontairement le même rendu.
 */
export function secText(s: number): string {
  const n = Math.round(s)
  return n < 60 ? `${n} s` : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`
}

/**
 * Une série, écrite pour être lue.
 *
 * `bw` est le poids de corps du jour de la séance. Quand on l'a, une série au poids
 * de corps s'écrit par son LEST — « +10 kg » — parce que c'est la seule part qui ait
 * bougé : répéter 91,5 kg sur chaque ligne d'un mois de dips ne dit rien, et masque
 * le fait qu'on a ajouté dix kilos.
 */
export function setText(s: SetLike, e: ExLike = {}, bw?: number | null): string {
  const r = s.r ?? 0
  const w = s.w ?? 0

  if (e.superset && s.r2 !== undefined) {
    return `${nb(w)}×${r} + ${nb(s.w2 ?? 0)}×${s.r2}`
  }

  if (isTimed(e)) {
    const t = secText(r)
    if (!e.bodyweight) return w > 0 ? `${t} à ${nb(w)} kg` : t
    const lest = bw != null ? Math.round((w - bw) * 10) / 10 : null
    if (lest === null) return w > 0 ? `${t} à ${nb(w)} kg` : t
    return lest > 0 ? `${t} +${nb(lest)} kg` : t
  }

  if (e.bodyweight && bw != null) {
    const lest = Math.round((w - bw) * 10) / 10
    return lest > 0 ? `+${nb(lest)}×${r}` : `PDC×${r}`
  }
  return `${nb(w)}×${r}`
}

/** Le mot de l'unité, pour les libellés — « reps » ou « s ». */
export const unitText = (e: ExLike = {}): string => (isTimed(e) ? 's' : 'reps')
