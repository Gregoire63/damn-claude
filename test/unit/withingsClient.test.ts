import { describe, expect, it } from 'vitest'
import { AUTH_STATUSES, WithingsError } from '../../server/api/withings/_client'

describe('erreurs Withings', () => {
  it('reconnaît un problème de jeton, pas une panne', () => {
    // 503 est ici un statut WITHINGS, pas un code HTTP : c'est celui que renvoie
    // l'endpoint de jetons pour « invalid params: refresh_token ». Le confondre
    // avec un HTTP 503 envoie chercher une panne de serveur qui n'existe pas.
    expect(new WithingsError(503, 'invalid params: refresh_token').isAuth).toBe(true)
    expect(new WithingsError(401, 'unauthorized').isAuth).toBe(true)
    expect(new WithingsError(601, 'too many requests').isAuth).toBe(false)
    expect(new WithingsError(2554, 'server error').isAuth).toBe(false)
    expect(AUTH_STATUSES).toContain(503)
  })

  it('garde le statut lisible dans le message', () => {
    expect(new WithingsError(503, 'invalid params: refresh_token').message)
      .toBe('Withings status 503: invalid params: refresh_token')
  })
})
