// ─────────────────────────────────────────────────────────────────────────────
// Partager le son avec le reste du téléphone.
// ─────────────────────────────────────────────────────────────────────────────
//
// Une page web qui joue du son PREND le focus audio du système. Sur Android comme
// sur iOS, le lecteur qui l'avait — Spotify, un podcast — se fait interrompre : il
// continue d'afficher qu'il joue, et plus rien ne sort. Le seul moyen de récupérer
// le son est d'aller mettre en pause puis relancer, c'est-à-dire de comprendre
// d'abord que c'est l'application de sport qui a volé le son.
//
// C'est exactement ce que faisait la piste inaudible de veille : validée une série,
// le repos démarre, la piste part, la musique meurt.
//
// ── Ce qu'on veut, précisément ──────────────────────────────────────────────
//
// Deux comportements différents, et les confondre est toute l'erreur :
//
//  · la veille est un effet de bord technique. Elle doit se MÉLANGER : personne ne
//    doit l'entendre ni la subir ;
//  · le bip de fin de repos, lui, doit s'entendre PAR-DESSUS la musique. Le système
//    sait faire ça tout seul — c'est ce qu'il fait pour un GPS ou une notification :
//    il baisse la musique le temps du son, puis la remonte.
//
// L'API Audio Session (`navigator.audioSession`) permet de le déclarer :
// « ambient » se mélange, « transient » se pose par-dessus en baissant le reste.
// Elle est encore d'implémentation limitée — d'où le test d'existence et l'absence
// totale de dépendance à elle : là où elle manque, c'est la règle de visibilité de
// `useRestTimer` qui fait le gros du travail, sur tous les navigateurs.

type TypeSession = 'auto' | 'playback' | 'transient' | 'transient-solo' | 'ambient' | 'play-and-record'

interface AvecSession { audioSession?: { type: TypeSession } }

function session(): { type: TypeSession } | null {
  if (!import.meta.client) return null
  const n = navigator as Navigator & AvecSession
  return n.audioSession ?? null
}

/** L'API existe-t-elle sur ce navigateur ? Exporté pour que l'écran puisse le dire. */
export const partageAudioDisponible = (): boolean => !!session()

function poser(type: TypeSession) {
  const s = session()
  if (!s) return
  // Un type refusé lève : on n'insiste pas, le repli est de ne rien déclarer du tout,
  // ce qui nous ramène au comportement d'avant — pas à quelque chose de pire.
  try { s.type = type } catch { /* type non supporté */ }
}

/**
 * « Je me mélange, je ne prends rien. »
 *
 * À poser une fois, avant de jouer quoi que ce soit. C'est ce qui évite que la piste
 * de veille interrompe la musique de quelqu'un qui s'entraîne en écoutant autre
 * chose — c'est-à-dire de tout le monde.
 */
export function partagerLeSon() { poser('ambient') }

let retour: ReturnType<typeof setTimeout> | null = null

/**
 * « Baisse la musique, j'ai quelque chose à dire. »
 *
 * Le temps du bip et pas davantage : `transient` laisse le système baisser le reste
 * puis le remonter, comme pour une indication GPS. On revient explicitement à
 * `ambient` derrière, parce qu'un état transitoire qu'on oublie de rendre devient un
 * état permanent — et c'est le vol de focus, repris par la porte de service.
 */
export function baisserLeSonUnInstant(dureeMs: number) {
  if (!session()) return
  poser('transient')
  if (retour) clearTimeout(retour)
  retour = setTimeout(() => { poser('ambient'); retour = null }, Math.max(200, dureeMs))
}
