import { describe, expect, it } from 'vitest'
import { MIN_AFFICHAGE_MS, attenteRestante } from '../../composables/useEcranChargement'

// ─────────────────────────────────────────────────────────────────────────────
// Combien de temps tenir l'écran de chargement.
// ─────────────────────────────────────────────────────────────────────────────
//
// Le défaut réparé : Nuxt rend le gabarit DANS la racine de l'application, que le
// montage de Vue remplace. Sur un rechargement à chaud, l'écran vivait quelques
// dizaines de millisecondes — un flash, pas un écran.
//
// Ce qui se teste ici est la seule chose qui puisse être fausse, et elle peut l'être
// dans les deux sens : ne pas attendre du tout (le flash qu'on répare), ou ajouter
// une attente par-dessus un chargement déjà long — c'est-à-dire ralentir exactement
// les appareils qui rament déjà.

describe('l’attente restante', () => {
  it('complète ce qui manque quand l’app est prête trop vite', () => {
    // Prête en 80 ms : il reste presque tout le minimum à tenir.
    expect(attenteRestante(1000, 1080)).toBe(MIN_AFFICHAGE_MS - 80)
  })

  /** Le point qui empêche la correction de devenir une lenteur. */
  it('n’ajoute rien quand le chargement a déjà dépassé le minimum', () => {
    expect(attenteRestante(1000, 1000 + MIN_AFFICHAGE_MS)).toBe(0)
    expect(attenteRestante(1000, 9000)).toBe(0)
  })

  /**
   * Sans horodatage, on ne fabrique pas d'attente.
   *
   * Le script du gabarit n'a pas tourné : page servie côté serveur, gabarit absent,
   * navigateur qui a coupé les scripts en ligne. Attendre « au cas où » ferait
   * patienter deux secondes devant une page déjà affichée.
   */
  it('ne tient rien quand le gabarit n’a pas posé son heure', () => {
    expect(attenteRestante(null, 5000)).toBe(0)
    expect(attenteRestante(undefined, 5000)).toBe(0)
    expect(attenteRestante(0, 5000)).toBe(0)
  })

  /** Une horloge qui recule (changement d'heure système) ne doit pas figer l'écran. */
  it('encaisse une horloge qui part à l’envers', () => {
    expect(attenteRestante(9000, 1000)).toBe(MIN_AFFICHAGE_MS)
  })

  it('accepte un minimum choisi', () => {
    expect(attenteRestante(1000, 1200, 500)).toBe(300)
  })
})
