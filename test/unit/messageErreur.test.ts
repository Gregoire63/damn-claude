import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { messageErreur } from '../../lib/erreurs'

/*
 * Deux fautes qui n'en font qu'une : on ne voyait ni ce qu'on tapait, ni pourquoi
 * c'était refusé.
 *
 * Le code de démarrage se saisissait dans un champ masqué — donc à l'aveugle, sur un
 * clavier de téléphone — et le refus s'affichait « 403 ». Entre les deux, il n'y avait
 * aucun moyen de savoir si le code était mal tapé, périmé, ou déjà consommé.
 */

const lire = (f: string) => readFileSync(new URL(`../../${f}`, import.meta.url), 'utf8')

describe('le code de démarrage se lit pendant qu\'on le tape', () => {
  it.each([
    ['components/sport/Demarrage.vue', 'codeDemarrage'],
    ['components/sport/Vault.vue', 'bootstrap'],
  ])('%s ne masque pas le champ', (fichier, modele) => {
    const src = lire(fichier)
    const champs = [...src.matchAll(new RegExp(`<input[^>]*v-model="${modele}"[^>]*>`, 'g'))].map(m => m[0])
    expect(champs.length).toBeGreaterThan(0)
    for (const champ of champs) {
      expect(champ).not.toContain('type="password"')
      // Le clavier d'un téléphone met une majuscule en début de champ et corrige
      // ce qu'il prend pour un mot : un code de seize caractères aléatoires ne
      // survit ni à l'un ni à l'autre.
      expect(champ).toContain('autocapitalize="none"')
      expect(champ).toContain('autocorrect="off"')
    }
  })
})

describe('le serveur accepte un code entouré d\'espaces', () => {
  it.each(['server/api/auth/register.post.ts', 'server/api/auth/reset.post.ts'])('%s', (f) => {
    expect(lire(f)).toMatch(/verifierBootstrap\(String\([^)]*\)\.trim\(\)\)/)
  })
})

describe('le refus dit ce qu\'il faut faire, pas « 403 »', () => {
  it('montre ce que le serveur a répondu', () => {
    const e = Object.assign(new Error('[POST] "/api/auth/register": 403 '), {
      data: { statusCode: 403, statusMessage: 'Ce code de démarrage a déjà servi.' },
    })
    expect(messageErreur(e)).toBe('Ce code de démarrage a déjà servi.')
  })

  it('accepte aussi un corps qui n\'a que `message`', () => {
    expect(messageErreur({ data: { message: 'Trop de tentatives.' } })).toBe('Trop de tentatives.')
  })

  /* Capteur refusé, fenêtre fermée : pas de corps, et le message du navigateur est
     déjà le bon. */
  it('garde le message du navigateur quand il n\'y a pas de corps', () => {
    expect(messageErreur(new Error('The operation either timed out or was not allowed.')))
      .toBe('The operation either timed out or was not allowed.')
  })

  it('retire le « Error: » que personne n\'a besoin de lire', () => {
    expect(messageErreur({ data: { statusMessage: 'Error: Code de démarrage invalide' } }))
      .toBe('Code de démarrage invalide')
  })
})
