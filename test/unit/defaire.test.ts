import { describe, expect, it } from 'vitest'
import type { RawProposal } from '../../lib/proposals'
import { defaireProposition } from '../../lib/proposals'

/*
 * Une proposition acceptée d'un tap est une écriture. Sans retour arrière, la seule
 * façon d'y revenir était de redemander à Claude de proposer l'inverse — dépendre du
 * connecteur pour réparer ce que le connecteur a fait, et attendre une conversation
 * pour corriger un geste d'une seconde.
 */
const base = { id: 'p1', at: '2026-09-01T10:00:00.000Z', summary: 'Truc', action: 'correction', status: 'applied' as const }
const prop = (patch: Record<string, unknown>): RawProposal => ({ ...base, patch })
const inv = (r: ReturnType<typeof defaireProposition>) => ('inverse' in r ? r.inverse.patch : null)
const pourquoi = (r: ReturnType<typeof defaireProposition>) => ('raison' in r ? r.raison : '')

describe('ce qui se défait', () => {
  it('remplacer se défait dans l’autre sens', () => {
    const r = defaireProposition(prop({ quoi: 'champ', op: 'remplacer', chemin: '/profile/heightCm', de: 180, vers: 182 }))
    expect(inv(r)).toEqual({ quoi: 'champ', op: 'remplacer', chemin: '/profile/heightCm', de: 182, vers: 180 })
  })

  it('ce qui a été créé se supprime', () => {
    const r = defaireProposition(prop({ quoi: 'champ', op: 'creer', chemin: '/notes/x', vers: 'salut' }))
    expect(inv(r)).toEqual({ quoi: 'champ', op: 'supprimer', chemin: '/notes/x', de: 'salut' })
  })

  it('ce qui a été supprimé se recrée', () => {
    const r = defaireProposition(prop({ quoi: 'champ', op: 'supprimer', chemin: '/notes/x', de: 'salut' }))
    expect(inv(r)).toEqual({ quoi: 'champ', op: 'creer', chemin: '/notes/x', vers: 'salut' })
  })

  it('une pesée corrigée se remet à sa valeur d’avant', () => {
    const r = defaireProposition(prop({ quoi: 'pesee', date: '2026-08-19', de: 91.5, vers: 91.2 }))
    expect(inv(r)).toEqual({ quoi: 'pesee', date: '2026-08-19', de: 91.2, vers: 91.5 })
  })

  /*
   * LE contrôle qui rend tout ça sûr : après l'échange, « de » vaut ce que la
   * proposition d'origine a écrit. `applicable()` refusera donc de défaire une
   * donnée modifiée depuis — plutôt que d'écraser un travail plus récent avec une
   * valeur d'il y a trois jours.
   */
  it('l’inverse est une proposition en attente, avec un identifiant à lui', () => {
    const r = defaireProposition(prop({ quoi: 'champ', op: 'remplacer', chemin: '/a', de: 1, vers: 2 }))
    expect('inverse' in r && r.inverse.status).toBe('pending')
    expect('inverse' in r && r.inverse.id).toBe('p1~defaire')
    expect('inverse' in r && r.inverse.summary).toBe('Annuler : Truc')
  })
})

describe('ce qui ne se défait pas, et qui le dit', () => {
  it('un ajout à une liste : on ne saurait pas lequel retirer', () => {
    const r = defaireProposition(prop({ quoi: 'champ', op: 'ajouter', chemin: '/bodyWeight', vers: { date: '2026-09-01', kg: 90 } }))
    expect(inv(r)).toBe(null)
    expect(pourquoi(r)).toContain('ajout')
  })

  it('une valeur d’avant absente : on refuse plutôt que de deviner', () => {
    expect(pourquoi(defaireProposition(prop({ quoi: 'champ', op: 'remplacer', chemin: '/a', vers: 2 })))).toContain('avant')
    expect(pourquoi(defaireProposition(prop({ quoi: 'champ', op: 'supprimer', chemin: '/a' })))).toContain('supprimée')
  })

  it('une pesée effacée se ressaisit ailleurs', () => {
    expect(pourquoi(defaireProposition(prop({ quoi: 'pesee', date: '2026-08-19', de: 91.5, vers: null })))).toContain('journal')
  })

  it('un geste de programme renvoie vers « Programme modifié »', () => {
    const r = defaireProposition(prop({ op: 'modifier', seance: 's1', exercice: 'e1', patch: { series: 5 } }))
    expect(inv(r)).toBe(null)
    expect(pourquoi(r)).toContain('Programme modifié')
  })
})
