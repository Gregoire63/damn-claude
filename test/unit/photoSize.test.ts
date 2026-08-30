import { describe, expect, it } from 'vitest'
import {
  BUDGET_WARN_BYTES, CARD_EDGE, MAX_EDGE, MAX_INPUT_BYTES, THUMB_EDGE,
  expectedBytes, fitWithin, humanBytes, rejectReason, storageVerdict,
} from '../../lib/photoSize'

describe('les trois tailles servies', () => {
  it('vont de la vignette de liste au plein écran', () => {
    // Servir la vignette en couverture de carte était toute l'explication du flou :
    // 192 px étirés sur une carte de 340 px. Trois tailles, trois usages.
    expect(THUMB_EDGE).toBeLessThan(CARD_EDGE)
    expect(CARD_EDGE).toBeLessThan(MAX_EDGE)
  })

  it('le plein format couvre un téléphone à 3× sans mollesse', () => {
    // 400 px CSS de large sur un écran à 3× réclament 1200 px réels.
    expect(MAX_EDGE).toBeGreaterThanOrEqual(1200)
  })
})

describe('fitWithin', () => {
  it('réduit une photo d\'iPhone au côté long demandé', () => {
    // 12 Mpx en portrait : 3024 × 4032.
    expect(fitWithin(3024, 4032, MAX_EDGE)).toEqual({ w: 1080, h: MAX_EDGE })
  })

  it('garde les proportions en paysage', () => {
    expect(fitWithin(4032, 3024, MAX_EDGE)).toEqual({ w: MAX_EDGE, h: 1080 })
  })

  it('n\'agrandit jamais — inventer des pixels ne fait que gonfler le fichier', () => {
    expect(fitWithin(320, 240, MAX_EDGE)).toEqual({ w: 320, h: 240 })
    expect(fitWithin(MAX_EDGE, 300, MAX_EDGE)).toEqual({ w: MAX_EDGE, h: 300 })
  })

  it('ne renvoie jamais une dimension nulle sur une image très panoramique', () => {
    const s = fitWithin(8000, 20, THUMB_EDGE)
    expect(s.w).toBe(THUMB_EDGE)
    expect(s.h).toBeGreaterThanOrEqual(1)
  })

  it('encaisse des dimensions absurdes sans planter', () => {
    expect(fitWithin(0, 0, MAX_EDGE)).toEqual({ w: 0, h: 0 })
    expect(fitWithin(-10, 100, MAX_EDGE)).toEqual({ w: 0, h: 0 })
    expect(fitWithin(Number.NaN, 100, MAX_EDGE)).toEqual({ w: 0, h: 0 })
  })

  it('un carré reste un carré', () => {
    expect(fitWithin(2000, 2000, MAX_EDGE)).toEqual({ w: MAX_EDGE, h: MAX_EDGE })
  })
})

describe('expectedBytes', () => {
  it('annonce un ordre de grandeur de l\'ordre de la centaine de kilo-octets', () => {
    const n = expectedBytes(3024, 4032)
    expect(n).toBeGreaterThan(50 * 1024)
    expect(n).toBeLessThan(200 * 1024)
  })

  it('une photo déjà petite pèse moins', () => {
    expect(expectedBytes(600, 800)).toBeLessThan(expectedBytes(3024, 4032))
  })

  it('trente plats photographiés restent très en dessous du seuil d\'alerte', () => {
    expect(expectedBytes(3024, 4032) * 30).toBeLessThan(BUDGET_WARN_BYTES)
  })
})

describe('rejectReason', () => {
  it('accepte les formats courants', () => {
    expect(rejectReason({ type: 'image/jpeg', size: 3_000_000 })).toBeNull()
    expect(rejectReason({ type: 'image/png', size: 500_000 })).toBeNull()
    expect(rejectReason({ type: 'image/webp', size: 90_000 })).toBeNull()
  })

  it('explique quoi faire pour le HEIC plutôt que d\'échouer au décodage', () => {
    const r = rejectReason({ type: 'image/heic', size: 2_000_000 })!
    expect(r).toContain('HEIC')
    expect(r).toContain('compatible') // le réglage iPhone à changer
  })

  it('refuse ce qui n\'est pas une image', () => {
    expect(rejectReason({ type: 'application/pdf', size: 1000 })).toContain('pas une image')
  })

  it('refuse au-delà de la limite d\'entrée', () => {
    expect(rejectReason({ type: 'image/jpeg', size: MAX_INPUT_BYTES + 1 })).toContain('trop lourde')
  })
})

describe('humanBytes', () => {
  it('choisit l\'unité lisible', () => {
    expect(humanBytes(512)).toBe('512 o')
    expect(humanBytes(90_000)).toBe('88 Ko')
    expect(humanBytes(3_500_000)).toBe('3.3 Mo')
  })
})

describe('storageVerdict', () => {
  it('ne dit rien d\'alarmant quand il n\'y a rien', () => {
    const v = storageVerdict(0, 0)
    expect(v.warn).toBe(false)
    expect(v.note).toContain('Aucune photo')
  })

  it('donne le total et la moyenne en usage normal', () => {
    const v = storageVerdict(20 * 90_000, 20)
    expect(v.warn).toBe(false)
    expect(v.note).toContain('20 photo')
    expect(v.note).toContain('moyenne')
  })

  it('alerte au-delà du budget et dit quoi faire', () => {
    const v = storageVerdict(BUDGET_WARN_BYTES + 1, 40)
    expect(v.warn).toBe(true)
    expect(v.note).toContain('Supprime')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
import { gearPhotoId, isGearPhoto, orphanPhotoIds } from '../../composables/usePhotos'

// Le nettoyage des photos est la seule opération DESTRUCTRICE du stockage : c'est
// celle qu'il faut border. Les photos de plats et les photos de machines partagent
// la même base — même redimensionnement, même persistance — mais pas le même cycle
// de vie, et un seul écran connaît la liste des plats encore valides.
describe('nettoyage des photos', () => {
  it('supprime les photos de plats disparus', () => {
    const all = ['boite-a', 'din-saumon', 'plat-supprime']
    expect(orphanPhotoIds(all, ['boite-a', 'din-saumon'])).toEqual(['plat-supprime'])
  })

  it('ne touche jamais aux photos de matériel', () => {
    // Sans ce garde-fou, ouvrir l'onglet « Plats » effacerait en silence toutes les
    // photos de machines prises à la salle : la bibliothèque ne passe que des
    // identifiants de plats, tout le reste lui paraît orphelin.
    const all = ['boite-a', gearPhotoId('squat-vsquat'), gearPhotoId('squat')]
    expect(orphanPhotoIds(all, ['boite-a'])).toEqual([])
    expect(orphanPhotoIds(all, [])).toEqual(['boite-a'])
  })

  it('reconnaît une photo de matériel à son espace de noms', () => {
    expect(isGearPhoto(gearPhotoId('squat-presse'))).toBe(true)
    expect(isGearPhoto('boite-a')).toBe(false)
  })
})
