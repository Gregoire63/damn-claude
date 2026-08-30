import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { SESSION_FORFAIT, ageOn, sessionBurn } from '../../lib/energy'
import { latestWeight, weightOn } from '../../lib/weight'
import { bmrMifflin, dayEnergy, isDayPlayed, proteinPlan } from '../../lib/nutritionStats'

// ─────────────────────────────────────────────────────────────────────────────
// Le connecteur ne doit jamais contredire l'écran.
// ─────────────────────────────────────────────────────────────────────────────
//
// C'est arrivé trois fois, et à chaque fois de la même façon : le serveur avait sa
// propre copie d'une règle que l'application avait, elle, corrigée depuis.
//
//   · la cible protéique, calculée sur le poids total au lieu de la masse maigre —
//     dix-huit grammes d'écart, tous les jours ;
//   · la dépense de séance, sans la clause « journée passée » — plusieurs centaines
//     de calories sur un jour de salle manqué ;
//   · le poids, pris à la dernière pesée au lieu de celle du jour interrogé.
//
// Un conseil qui contredit l'application vaut moins que pas de conseil : on ne sait
// plus lequel croire, donc on ne croit plus aucun des deux.
//
// Ces tests vérifient DEUX choses. D'abord que le serveur importe bien les fonctions
// partagées plutôt que d'en réécrire. Ensuite, sur ses vrais chiffres, que la chaîne
// complète donne le résultat attendu.

const MCP = readFileSync('server/api/mcp.post.ts', 'utf8')
const PROPOSALS = readFileSync('lib/proposals.ts', 'utf8')

describe('le serveur emprunte les règles, il ne les réécrit pas', () => {
  it('importe le socle énergie et le socle poids', () => {
    expect(MCP).toMatch(/from '~\/lib\/energy'/)
    expect(MCP).toMatch(/from '~\/lib\/weight'/)
    expect(MCP).toMatch(/sessionBurn\(/)
  })

  it('ne redéclare NI le forfait de séance NI sa propre règle de dépense', () => {
    // Il en avait une à lui, sans la clause « journée passée ».
    expect(MCP).not.toMatch(/DEFAULT_BURN/)
    expect(MCP).not.toMatch(/=\s*440/)
    expect(MCP).not.toMatch(/\bdayBurn\(/)
  })

  it('lit le poids À LA DATE demandée, pas la dernière pesée', () => {
    expect(MCP).toMatch(/weightOn\(/)
    // `latestWeight` conviendrait pour « aujourd'hui » et mentirait pour toute autre date.
    expect(MCP).not.toMatch(/latestWeight\(/)
  })

  it('calcule la cible protéique sur la composition corporelle', () => {
    expect(MCP).toMatch(/carriedComp\(/)
    expect(MCP).toMatch(/proteinPlan\(comp\?\.kg \?\? kg, comp\)/)
  })

  /**
   * Une cible inconnue n'est PAS zéro.
   *
   * Miroir jamais poussé, pesée manquante à la date demandée, profil incomplet : la
   * cible est indisponible. Rendue à 0, elle se lisait « zéro calorie à manger », et
   * le reste devenait négatif — le connecteur annonçait un dépassement à quelqu'un
   * qui venait de petit-déjeuner.
   */
  it('rend « null » plutôt que zéro quand la cible est inconnue', () => {
    expect(MCP).toMatch(/const sansCible = !energie/)
    expect(MCP).toMatch(/cible_kcal: sansCible \? null : /)
    expect(MCP).toMatch(/reste_a_manger: sansCible \? null : /)
    expect(MCP).toMatch(/dans_la_journee: sansCible \? null : /)
    expect(MCP).toMatch(/CIBLE INDISPONIBLE/)
  })

  /**
   * Le serveur tourne en UTC, lui vit à Paris. Une journée « déjà jouée » se décide à
   * 15 h locales : sans conversion, deux heures par jour où le connecteur crédite un
   * forfait de séance que l'écran a déjà retiré.
   */
  it('raisonne à l’heure de Paris, pas à celle du serveur', () => {
    expect(MCP).toMatch(/Europe\/Paris/)
    expect(MCP).toMatch(/aujourdhuiParis\(\)/)
    expect(MCP).toMatch(/heureParis\(\)/)
    // Et la date par défaut aussi : à minuit passé en France, le serveur est encore la veille.
    expect(MCP).not.toMatch(/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/)
  })
})

describe('le programme annoncé est celui de l’application', () => {
  /**
   * Le programme vivait dans le code : le serveur le rendait tel quel, et c'était
   * juste. Il est devenu modifiable, et la même ligne est devenue fausse — répondre
   * les séries livrées quand un exercice en a été retiré, c'est proposer du travail
   * sur un mouvement qu'il ne fait plus.
   *
   * Ce test lit la source parce que c'est la régression la plus silencieuse qui soit :
   * la réponse reste plausible, elle est simplement périmée.
   */
  it('fusionne le livré avec les modifications, plutôt que de le rendre brut', () => {
    expect(MCP).toContain('mergeProgram(PROGRAM')
    // Aucun `PROGRAM.find` / `PROGRAM.filter` résiduel : ce sont exactement les deux
    // formes qui rendraient le programme d'origine sans s'en apercevoir.
    expect(MCP).not.toMatch(/\bPROGRAM\.(find|filter|flatMap|map|some)\b/)
  })

  it('expose la cible « programme » à l’écriture', () => {
    // Une cible absente de l'énumération n'est jamais proposée ; une cible présente
    // mais non validée au dépôt s'accumule en propositions inapplicables.
    expect(MCP).toMatch(/enum: \[[^\]]*'programme'/)
    expect(MCP).toContain('programFor(brut, ctx)')
  })

  /**
   * Un geste que le code accepte mais que la description ne mentionne pas est INVISIBLE.
   *
   * C'est le seul endroit où Claude lit ce que le connecteur accepte. Un handler qui
   * marche sans être déclaré ne sera jamais appelé — et l'inverse est pire : une op
   * annoncée que le code refuse produit des dépôts rejetés sans qu'on comprenne, parce
   * que la documentation dit qu'ils devraient passer.
   *
   * Le test lit les deux côtés et les confronte, plutôt que de faire confiance à
   * l'habitude de mettre à jour les deux.
   */
  it('déclare EXACTEMENT les gestes que le code sait appliquer', () => {
    const OPS = ['ajouter', 'modifier', 'retirer', 'reactiver', 'reordonner', 'creer-seance']
    const codees = /const PROGRAM_OPS = \[([^\]]+)\]/.exec(PROPOSALS)?.[1] ?? ''
    for (const op of OPS) {
      expect(codees, `${op} doit être acceptée par le code`).toContain(`'${op}'`)
      expect(MCP, `${op} doit être documentée dans la description de l'outil`).toContain(`· ${op} :`)
    }
    // Et rien de plus : une septième op codée sans être annoncée serait morte.
    expect(codees.split(',').length).toBe(OPS.length)
  })

  it('documente les pièges que la description doit porter', () => {
    // Chacun a coûté quelque chose ailleurs dans ce projet : une liste partielle qui
    // efface, une valeur écrasée sur un miroir périmé, un défaut inventé.
    const ATTENDUS = [
      'REMPLACENT la liste', // muscles et machines de remplacement
      'liste COMPLÈTE des actifs', // reordonner
      'repos_s » est OBLIGATOIRE', // pas de défaut inventé
      'exigent leur « de_… »', // les gardes contre un miroir périmé
      'sens physiologique', // l'ordre des exercices
      'DÉSACTIVE, ne supprime PAS', // retirer
      'hors progression automatique', // mesure: temps, dans l'outil de lecture
    ]
    for (const a of ATTENDUS) expect(MCP, a).toContain(a)
  })

  /**
   * Le programme n'est plus « s1 à s4 ».
   *
   * Cette phrase était vraie tant que les quatre séances vivaient dans le code. Elle
   * est devenue un mensonge le jour où on a pu en créer une — et sur une installation
   * neuve, dont le programme est VIDE, elle envoie chercher des séances qui n'ont
   * jamais existé. Un message de refus qui ment coûte plus cher qu'un refus sec :
   * il fait retenter la même chose.
   */
  it('ne promet plus quatre séances codées en dur dans ses refus', () => {
    expect(MCP).not.toContain('elles s\'appellent s1 à s4')
    expect(MCP).not.toContain('On n\'ajoute pas de séance')
    // Et le refus doit dire ce qu'on peut faire à la place.
    expect(MCP).toContain('crée-la avec op: "creer-seance"')
  })

  it('rend le repos, sans quoi on ne peut pas proposer de l’allonger', () => {
    // Deviner une valeur qu'on va écrire est précisément ce que ce connecteur
    // refuse de faire partout ailleurs.
    expect(MCP).toContain('repos_s: restFor(e)')
  })
})

describe('la chaîne complète, sur ses chiffres réels', () => {
  // Profil réel : 179 cm, né en 1997, pesées de la semaine du 19 août 2026.
  const PESEES = [
    { date: '2026-08-17', kg: 91.91 },
    { date: '2026-08-18', kg: 91.84 },
    { date: '2026-08-19', kg: 91.58 },
  ]
  const chaine = (iso: string, opts: { gym: boolean, tt: boolean, records?: unknown[], played: boolean }) => {
    const kg = weightOn(PESEES, iso)!.kg
    const bmr = bmrMifflin(kg, 179, ageOn(iso, 1997), 'h')!
    const burn = sessionBurn({ records: (opts.records ?? []) as never, kg, bmr, gymPlanned: opts.gym, played: opts.played })
    return { kg, bmr, ...dayEnergy({ bmr, kg, tt: opts.tt, sessionKcal: burn }) }
  }

  it('un jour sans salle donne la cible que l’application affiche', () => {
    const r = chaine('2026-08-19', { gym: false, tt: false, played: false })
    expect(r.kg).toBe(91.58)
    expect(r.bmr).toBe(1895)
    expect(r.need).toBe(2446)
    expect(r.target).toBe(1960)
  })

  it('un jour de salle à venir crédite le forfait, et lui seul', () => {
    const r = chaine('2026-08-19', { gym: true, tt: false, played: false })
    expect(r.sessionKcal).toBe(SESSION_FORFAIT)
    expect(r.need).toBe(2886)
  })

  /** LA correction : la séance prévue que la journée a laissée passer. */
  it('un jour de salle MANQUÉ ne crédite rien', () => {
    const r = chaine('2026-08-19', { gym: true, tt: false, played: true })
    expect(r.sessionKcal).toBe(0)
    expect(r.need).toBe(2446)
    // 350 kcal de cible en moins : c'est l'écart que le connecteur annonçait en trop.
    expect(chaine('2026-08-19', { gym: true, tt: false, played: false }).target - r.target).toBe(350)
  })

  it('relire une date passée emploie la pesée de CE jour-là', () => {
    expect(chaine('2026-08-17', { gym: false, tt: false, played: true }).kg).toBe(91.91)
    expect(chaine('2026-08-19', { gym: false, tt: false, played: true }).kg).toBe(91.58)
    // La dernière pesée connue donnerait 91,58 partout — soit un métabolisme faux de 3 kcal
    // le 17, et bien davantage sur une date plus ancienne.
    expect(latestWeight(PESEES)).toBe(91.58)
  })

  it('la cible protéique suit la masse maigre, comme à l’écran', () => {
    const comp = { kg: 91.58, fatRatio: 26.4, leanMass: 67.39 }
    expect(proteinPlan(comp.kg, comp as never).g).toBe(174)
    // Sur le poids total, on obtiendrait 192 : c'est ce que le connecteur disait.
    expect(proteinPlan(91.58).g).toBe(192)
  })

  it('la journée bascule en « jouée » à 15 h, pas à l’heure du serveur', () => {
    expect(isDayPlayed('2026-08-19', '2026-08-19', 14)).toBe(false)
    expect(isDayPlayed('2026-08-19', '2026-08-19', 15)).toBe(true)
    expect(isDayPlayed('2026-08-18', '2026-08-19', 9)).toBe(true)
  })
})
