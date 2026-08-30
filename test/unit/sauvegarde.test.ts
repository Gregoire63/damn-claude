import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Rien de ce qui est écrit ne doit se perdre en chemin.
// ─────────────────────────────────────────────────────────────────────────────
//
// Une clé de stockage qui n'entre pas dans l'instantané ne part ni dans l'export
// manuel ni dans le miroir. On restaure sur un téléphone neuf, tout a l'air là — et
// ce qui manquait ne se remarque que des semaines plus tard, quand on cherche
// pourquoi le minuteur ne vibre plus au poignet. C'est arrivé, précisément avec les
// réglages du minuteur.
//
// Ce test lit les SOURCES plutôt que d'exécuter l'application : il n'a pas besoin
// d'un navigateur pour répondre à « quelqu'un a-t-il ajouté une clé sans la brancher
// à la sauvegarde ». La liste des exclusions est explicite, et c'est le point : y
// ajouter une ligne est un geste délibéré, qu'on relit en revue.

const lire = (f: string) => readFileSync(join('composables', f), 'utf8')

/** Toutes les clés localStorage déclarées dans les composables. */
function clesDeclarees(): { constante: string, cle: string, fichier: string }[] {
  const out: { constante: string, cle: string, fichier: string }[] = []
  for (const f of readdirSync('composables').filter(x => x.endsWith('.ts'))) {
    for (const m of lire(f).matchAll(/const ([A-Z_]+_KEY) = '([^']+)'/g)) {
      out.push({ constante: m[1], cle: m[2], fichier: f })
    }
  }
  return out
}

/**
 * Ce qui n'a RIEN à faire dans une sauvegarde, et pourquoi.
 *
 * Chaque ligne est une décision, pas un oubli toléré.
 */
const HORS_SAUVEGARDE: Record<string, string> = {
  BACKUP_KEY: 'l\'instantané de secours lui-même — le sauvegarder serait circulaire',
  EXPORT_KEY: 'date du dernier export : une propriété de CET appareil',
  SCHEMA_KEY: 'version de schéma, réécrite à l\'hydratation',
  LAST_PUSH_KEY: 'horodatage du dernier envoi au coffre, propre à l\'appareil',
  MIGRATED_KEY: 'drapeau de migration Withings',
  TOK_KEY: 'JETONS Withings — ne doivent JAMAIS sortir de l\'appareil',
  NONCE_KEY: 'nonce OAuth à usage unique, périmé en dix minutes',
  SYNC_KEY: 'date de dernière synchro, propre à l\'appareil',
  LEGACY_BW_KEY: 'ancienne clé, lue une fois pour migrer',
  LEGACY_SEL_KEY: 'ancienne clé, lue une fois pour migrer',
  LEGACY_START_KEY: 'ancienne clé, lue une fois pour migrer',
  // Ce test n'a commencé à la voir que le jour où la séance est sortie de la page
  // pour devenir un composable. La décision, elle, n'a pas changé : le brouillon est
  // une séance À MOITIÉ FAITE, pas une donnée. Il existe pour survivre à un
  // rechargement accidentel sur CET appareil ; le restaurer sur un téléphone neuf
  // rouvrirait une séance commencée ailleurs, un autre jour, avec un chrono parti
  // d'une heure qui n'a plus de sens.
  DRAFT_KEY: 'brouillon de la séance en cours — transitoire, et propre à l\'appareil',
}

describe('l’aller-retour de sauvegarde', () => {
  const cles = clesDeclarees()

  it('déclare bien des clés à surveiller', () => {
    expect(cles.length).toBeGreaterThan(30)
  })

  /**
   * Le cœur du test. Une clé absente des deux listes est une donnée qui disparaît
   * silencieusement à la restauration.
   */
  it('branche CHAQUE clé persistée à la sauvegarde, ou l’exclut explicitement', () => {
    const snapshot = readFileSync('composables/useSnapshot.ts', 'utf8')
    const nutrition = lire('useNutrition.ts')
    const workout = lire('useWorkout.ts')
    const profil = lire('useProfile.ts')
    const withings = lire('useWithings.ts')
    const timer = lire('useRestTimer.ts')
    const programme = lire('useProgram.ts')

    /**
     * L'assemblage de ce composable est-il appelé dans `buildSnapshot` ?
     *
     * On remonte la destructuration — `const { snapshot: timerData } =
     * useRestTimer()` — jusqu'à l'alias, puis on cherche son appel dans le corps de
     * la fonction. Vérifier l'import ne suffirait pas : un import inutilisé est
     * exactement la forme que prend un débranchement.
     */
    const appeleParInstantane = (fichier: string) => {
      const composable = fichier.replace('.ts', '')
      const destructure = new RegExp(`const \\{([^}]*)\\} = ${composable}\\(`).exec(snapshot)
      if (!destructure) return false
      const alias = destructure[1].split(',')
        .map(x => (x.includes(':') ? x.split(':')[1] : x).trim())
        .filter(Boolean)
      const debutFn = snapshot.indexOf('function buildSnapshot')
      const corpsFn = snapshot.slice(debutFn)
      return alias.some(a => new RegExp(`\\b${a}\\(`).test(corpsFn))
    }

    const SOURCES: Record<string, string> = {
      'useNutrition.ts': nutrition, 'useWorkout.ts': workout, 'useProfile.ts': profil,
      'useWithings.ts': withings, 'useRestTimer.ts': timer, 'useProgram.ts': programme,
    }

    /**
     * Une clé est branchée si LA VALEUR QU'ELLE PERSISTE atteint l'instantané.
     *
     * On remonte du `setItem(CLÉ, JSON.stringify(x))` jusqu'à `x`, puis on vérifie
     * que ce `x` apparaît soit directement dans useSnapshot.ts — c'est le cas des
     * `logs`, `profile`, `weekPlan` — soit dans la fonction d'assemblage du
     * composable, elle-même appelée par l'instantané. Vérifier la présence de la
     * FONCTION ne suffisait pas : `useProfile` et `useWorkout` n'en ont pas, leurs
     * refs sont lues directement.
     */
    const branchee = (c: { constante: string, fichier: string }) => {
      const src = SOURCES[c.fichier]
      if (!src) return false
      const ecriture = new RegExp(`setItem\\(${c.constante},\\s*JSON\\.stringify\\(([\\w.]+)`).exec(src)
      // Écriture d'un objet LITTÉRAL (les réglages du minuteur) : il n'y a pas de ref
      // à suivre. On exige alors que la fonction d'assemblage du composable soit
      // réellement APPELÉE depuis l'instantané — pas seulement qu'elle existe.
      // C'est exactement ce qui manquait : la fonction était là, personne ne
      // l'appelait, et la règle générale laissait passer.
      if (!ecriture) return appeleParInstantane(c.fichier)
      const ref = ecriture[1].split('.')[0]
      if (new RegExp(`\\b${ref}\\b`).test(snapshot)) return true
      // Sinon : la ref doit figurer dans exportData()/snapshot() du composable.
      const debut = Math.max(src.indexOf('function exportData('), src.indexOf('function snapshot('))
      if (debut < 0) return false
      const corps = src.slice(debut, src.indexOf('\n  }', debut))
      return new RegExp(`\\b${ref}\\b`).test(corps)
    }

    const orphelines = cles
      .filter(c => !(c.constante in HORS_SAUVEGARDE))
      .filter(c => !branchee(c))
      .map(c => `${c.constante} (${c.fichier})`)

    expect(orphelines, `clés non sauvegardées : ${orphelines.join(', ')}`).toEqual([])
  })

  it('n’exclut jamais une clé sans en donner la raison', () => {
    for (const [k, raison] of Object.entries(HORS_SAUVEGARDE)) {
      expect(raison.length, k).toBeGreaterThan(15)
    }
  })

  /** Les jetons Withings ne doivent pas figurer dans l'instantané. Jamais. */
  it('garde les jetons Withings hors de toute sauvegarde', () => {
    const snapshot = readFileSync('composables/useSnapshot.ts', 'utf8')
    expect(snapshot).not.toMatch(/TOK_KEY|access_token|refresh_token/)
    const withings = lire('useWithings.ts')
    const snapFn = withings.slice(withings.indexOf('function snapshot()'))
    const corps = snapFn.slice(0, snapFn.indexOf('\n  }'))
    expect(corps).not.toMatch(/tok|token/i)
  })

  /**
   * Les réglages du minuteur : la clé qui manquait. Le test nomme le cas plutôt que
   * de se contenter de la règle générale — c'est celui qu'on veut voir échouer en
   * rouge si quelqu'un débranche à nouveau.
   */
  it('emporte les réglages du minuteur, son et relais montre compris', () => {
    const timer = lire('useRestTimer.ts')
    expect(timer).toMatch(/function snapshot\(\)/)
    expect(timer).toMatch(/restTimer:/)
    expect(timer).toMatch(/function restore\(/)
    expect(readFileSync('composables/useSnapshot.ts', 'utf8')).toMatch(/timerData\(\)/)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// L'aller-retour se joue DEUX FOIS, et il manquait une moitié.
// ─────────────────────────────────────────────────────────────────────────────
//
// Les tests ci-dessus vérifient qu'une clé entre bien dans l'instantané. Ils ne
// disaient rien du chemin inverse : une correction de champ reconstruit l'instantané,
// y change une valeur, puis le réinjecte dans les composables — et si l'un d'eux n'est
// pas réinjecté, la valeur écrite est perdue au `buildSnapshot()` suivant, qui relit
// un composable resté sur son ancienne donnée.
//
// C'est arrivé sur `useRestTimer`, et de la pire façon possible : la proposition
// s'archivait « appliquée ». Accepté, enregistré, disparu. Le même composable avait
// déjà eu ce défaut à l'export, ce qui dit assez que la liste écrite à la main n'est
// pas un mécanisme fiable.

describe('le chemin du RETOUR restaure toutes les sections', () => {
  const vault = readFileSync('composables/useVault.ts', 'utf8')
  const snapshot = readFileSync('composables/useSnapshot.ts', 'utf8')

  /** Les composables qui ALIMENTENT l'instantané, lus dans useSnapshot. */
  const alimentent = [...snapshot.matchAll(/= (use[A-Z]\w+)\(/g)].map(m => m[1])

  it('la fonction de restauration existe, et n’est pas une liste dispersée', () => {
    expect(vault).toContain('function restoreAll(')
  })

  it('réinjecte CHAQUE composable qui a alimenté l’instantané', () => {
    const debut = vault.indexOf('function restoreAll(')
    const corps = vault.slice(debut, vault.indexOf('\n  }', debut))
    // Le nom de la variable locale dérive du composable : useRestTimer → restTimer.
    const manquants = alimentent.filter((c) => {
      const local = c.replace(/^use/, '')
      const attendu = local.charAt(0).toLowerCase() + local.slice(1)
      return !new RegExp(`\\b(${attendu}|${local})\\w*\\.restore`, 'i').test(corps)
    })
    expect(manquants, `sections écrites mais jamais relues : ${manquants.join(', ')}`).toEqual([])
  })
})
