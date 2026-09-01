import { useFoyer } from '~/composables/useFoyer'
import { useNutrition } from '~/composables/useNutrition'
import { useProfile } from '~/composables/useProfile'
import { useProgram } from '~/composables/useProgram'
import { useRestTimer } from '~/composables/useRestTimer'
import { useMesures } from '~/composables/useMesures'
import { useWorkout } from '~/composables/useWorkout'
import type { Session } from '~/data/sportProgram'
import type { Food, Recipe } from '~/data/nutritionProgram'

/**
 * Restaurer une sauvegarde : UN seul endroit.
 *
 * Une sauvegarde touche six modules — journaux et pesées, profil et semaine type,
 * nutrition, programme, minuteur, Withings — et chacun a sa propre fonction
 * `restore`. Tant que la liste vivait dans le gestionnaire d'import de l'écran
 * Profil, elle était recopiée à chaque nouveau point d'entrée, et deux d'entre elles
 * y ont déjà manqué à un moment : les réglages du minuteur partaient dans l'export
 * sans jamais en revenir, et le programme modifié était écrasé par le programme
 * livré — des mois de réglages de séances effacés par un import.
 *
 * Le pack d'exemple emprunte exactement le même chemin, et c'est ce qui garantit
 * qu'il est RÉVERSIBLE : il arrive comme du contenu personnel, modifiable et
 * supprimable, pas comme une donnée livrée qu'on ne peut plus retirer.
 */

/** Ce qu'une restauration a réellement produit, pour pouvoir le DIRE. */
export interface BilanRestauration {
  ok: boolean
  /** Renseignée seulement en cas d'échec. */
  erreur?: string
  seances: number
  aliments: number
  recettes: number
  menus: number
  /** Séances enregistrées dans le journal. */
  journal: number
  pesees: number
  /** Le pack d'exemple a servi de socle à une sauvegarde d'avant le vidage. */
  rebase: boolean
}

interface Pack {
  programme?: { sessions?: Session[] }
  nutrition?: { userFoods?: Food[], userRecipes?: Recipe[], menus?: unknown[] }
}

export function useRestauration() {
  const workout = useWorkout()
  const foyer = useFoyer()
  const profile = useProfile()
  const nutrition = useNutrition()
  const program = useProgram()
  const mesures = useMesures()
  const timer = useRestTimer()

  /**
   * Une sauvegarde d'AVANT le vidage de `data/`.
   *
   * Elle se reconnaît sans deviner : le champ `programme.sessions` n'existait pas,
   * puisque les séances vivaient dans le code. Toute sauvegarde faite depuis en
   * porte un — vide pour une installation neuve, mais présent.
   *
   * La distinction n'est pas cosmétique. Une telle sauvegarde ne contient que les
   * ÉCARTS au programme livré : des patches et des ajouts indexés par « s1 », un
   * planning qui nomme « s3 », un journal de charges indexé par « squat ». Restaurée
   * telle quelle dans une application qui ne livre plus rien, elle rend une
   * application vide — les données sont là, mais plus rien ne les rattache à
   * quoi que ce soit d'affichable.
   *
   * Le socle qui leur manque est exactement le pack d'exemple : c'est le contenu que
   * l'application livrait à l'époque où cette sauvegarde a été faite.
   */
  const estAvantVidage = (data: Record<string, unknown>): boolean => {
    const p = data.programme as Record<string, unknown> | undefined
    return !!p && typeof p === 'object' && !Array.isArray(p.sessions)
  }

  /** Le pack d'exemple, servi en statique. `null` si on ne peut pas le lire. */
  async function lireExemple(): Promise<Pack | null> {
    try {
      const r = await fetch('/exemple.json', { cache: 'no-store' })
      return r.ok ? await r.json() as Pack : null
    } catch { return null }
  }

  /**
   * Remet sous la sauvegarde le socle qu'elle suppose.
   *
   * Règle unique, et c'est ce qui la rend sûre : on AJOUTE, on n'écrase jamais. Un
   * identifiant déjà pris par le contenu restauré gagne — `addSession` refuse un
   * doublon, et l'union d'aliments donne la priorité aux siens. Relancé deux fois,
   * le rattrapage ne produit rien de plus.
   */
  async function rebaser(): Promise<boolean> {
    const pack = await lireExemple()
    if (!pack) return false

    for (const s of pack.programme?.sessions ?? []) program.addSession(s)

    const union = <T extends { id: string }>(base: T[], siens: T[]): T[] => {
      const pris = new Set(siens.map(x => x.id))
      return [...base.filter(x => !pris.has(x.id)), ...siens]
    }
    const n = pack.nutrition ?? {}
    nutrition.restore({
      nutrition: {
        userFoods: union(n.userFoods ?? [], nutrition.userFoods.value),
        userRecipes: union(n.userRecipes ?? [], nutrition.userRecipes.value),
        // Les menus ne se fusionnent pas : une semaine est un tout, et deux semaines
        // « A » ne diraient rien. On ne comble que le vide.
        ...(nutrition.menus.value.length ? {} : { menus: n.menus ?? [] }),
      },
    } as Parameters<typeof nutrition.restore>[0])

    // Sans semaine ACTIVE, l'écran nutrition n'a ni déjeuner ni dîner à afficher.
    // La sauvegarde en désignait une qui n'existe plus — celles qui étaient livrées
    // ne partaient pas à l'export. On en active une plutôt que de rendre un écran
    // vide qui ressemble à une panne.
    if (!nutrition.activeMenu.value && nutrition.menus.value.length) {
      nutrition.setActiveMenu(nutrition.menus.value[0]!.id)
    }
    return true
  }

  /** Ce que l'application contient MAINTENANT — lu, pas déduit de ce qu'on a écrit. */
  const bilan = (rebase: boolean): BilanRestauration => ({
    ok: true,
    rebase,
    seances: program.program.value.length,
    aliments: Object.keys(nutrition.library.value.foods).length,
    recettes: Object.keys(nutrition.library.value.recipes).length,
    menus: nutrition.menus.value.length,
    journal: workout.sessionLog().length,
    pesees: workout.bodyWeight.value.length,
  })

  /** La part qui vient APRÈS `restoreData` — utile quand celui-ci a déjà été appelé
   *  par `importJSON`, qui lit le fichier et le passe ensuite en rappel. */
  function restaurerLeReste(data: Record<string, unknown>): void {
    profile.restore(data as Parameters<typeof profile.restore>[0])
    nutrition.restore(data as Parameters<typeof nutrition.restore>[0])
    mesures.restore(data)
    timer.restore(data)
    program.restore(data)
    // `normaliserConvives` réinjecte « Moi » quoi qu'il arrive : une sauvegarde
    // d'avant le foyer, ou trafiquée, ne doit pas aboutir à une application qui
    // cuisine pour personne.
    foyer.restore(data.foyer)
  }

  /** Tout ce qu'une sauvegarde peut contenir, remis en place. */
  async function restaurerTout(data: Record<string, unknown>): Promise<BilanRestauration> {
    workout.restoreData(data)
    restaurerLeReste(data)
    const rebase = estAvantVidage(data) ? await rebaser() : false
    return bilan(rebase)
  }

  /** Un fichier choisi par l'utilisateur. */
  async function restaurerFichier(file: File): Promise<BilanRestauration> {
    let brut: Record<string, unknown>
    try {
      brut = JSON.parse(await file.text()) as Record<string, unknown>
    } catch {
      return { ok: false, erreur: 'Fichier illisible : ce n\'est pas du JSON.', rebase: false, seances: 0, aliments: 0, recettes: 0, menus: 0, journal: 0, pesees: 0 }
    }
    if (!brut || typeof brut !== 'object' || Array.isArray(brut)) {
      return { ok: false, erreur: 'Ce fichier n\'est pas une sauvegarde.', rebase: false, seances: 0, aliments: 0, recettes: 0, menus: 0, journal: 0, pesees: 0 }
    }
    return restaurerTout(brut)
  }

  /**
   * Le pack d'exemple, servi en statique depuis `public/exemple.json`.
   *
   * Il n'est PAS embarqué dans le bundle : cent dix kilo-octets qu'aucun utilisateur
   * ne charge deux fois n'ont rien à faire dans le chemin critique d'une application
   * qui s'ouvre en salle, sur un réseau de sous-sol.
   */
  async function chargerExemple(): Promise<BilanRestauration> {
    const pack = await lireExemple()
    if (!pack) {
      return { ok: false, erreur: 'Exemple indisponible — réessaie en ligne.', rebase: false, seances: 0, aliments: 0, recettes: 0, menus: 0, journal: 0, pesees: 0 }
    }
    return restaurerTout(pack as Record<string, unknown>)
  }

  return { restaurerTout, restaurerLeReste, restaurerFichier, chargerExemple }
}

/**
 * Le bilan, en une phrase qu'on peut vérifier d'un coup d'œil.
 *
 * « Données importées ✓ » ne dit rien : c'est exactement ce qu'affichait l'écran le
 * jour où un import a rendu une application vide sans que personne s'en aperçoive
 * avant d'aller chercher ses séances. Des CHIFFRES se confrontent à ce qu'on
 * attendait ; une coche ne se confronte à rien.
 */
export function phraseBilan(b: BilanRestauration): string {
  if (!b.ok) return b.erreur ?? 'Import impossible.'
  const bouts = [
    b.seances ? `${b.seances} séance${b.seances > 1 ? 's' : ''}` : null,
    b.recettes ? `${b.recettes} plat${b.recettes > 1 ? 's' : ''}` : null,
    b.journal ? `${b.journal} séance${b.journal > 1 ? 's' : ''} au journal` : null,
    b.pesees ? `${b.pesees} pesée${b.pesees > 1 ? 's' : ''}` : null,
  ].filter(Boolean)
  if (!bouts.length) return 'Import terminé : aucune donnée exploitable dans le fichier.'
  const rebase = b.rebase ? ' Programme et catalogue rétablis depuis l\'exemple.' : ''
    return `Import réussi ✓ — ${bouts.join(', ')}.${rebase}`
}
