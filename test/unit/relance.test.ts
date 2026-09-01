import { describe, expect, it, vi } from 'vitest'
import { avecRelances } from '../../lib/relance'

/*
 * Revenir dans l'application juste après avoir tapé « Autoriser » est le cas NORMAL,
 * pas un cas limite : c'est le premier réflexe. L'autre navigateur n'a alors pas fini
 * de ranger les jetons, la réclamation échoue, et sans relance il ne se passe plus
 * rien — il faut recharger la page à la main pour voir sa balance apparaître.
 */
const sansAttendre = () => Promise.resolve()

describe('relances', () => {
  it('s\'arrête au premier essai réussi', async () => {
    const essai = vi.fn().mockResolvedValue('withings')
    expect(await avecRelances([0, 10, 20], essai, sansAttendre)).toBe('withings')
    expect(essai).toHaveBeenCalledTimes(1)
  })

  it('réessaie tant que ce n\'est pas encore prêt', async () => {
    const essai = vi.fn()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce('fitbit')
    expect(await avecRelances([0, 10, 20], essai, sansAttendre)).toBe('fitbit')
    expect(essai).toHaveBeenCalledTimes(3)
  })

  it('n\'insiste pas indéfiniment', async () => {
    const essai = vi.fn().mockResolvedValue(null)
    expect(await avecRelances([0, 10, 20], essai, sansAttendre)).toBe(null)
    expect(essai).toHaveBeenCalledTimes(3)
  })

  it('attend entre deux essais, jamais avant le premier', async () => {
    const dormi: number[] = []
    const essai = vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('oura')
    await avecRelances([0, 1500, 4000], essai, async (ms) => { dormi.push(ms) })
    expect(dormi).toEqual([1500])
  })
})
