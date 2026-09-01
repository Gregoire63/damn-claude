import { requireSession } from '../auth/_auth'
import { readMirror, writeMirror } from '../../utils/vault'

/** Taille de garde : l'export tient largement dessous, et au-delà c'est une erreur
 *  ou un abus, pas une sauvegarde. */
const MAX_BYTES = 4 * 1024 * 1024

/**
 * Le téléphone pousse son instantané. Le serveur l'accepte tel quel.
 *
 * Aucune fusion, et c'est délibéré : le téléphone est la source, le serveur n'en
 * est que le reflet. Fusionner supposerait d'arbitrer entre deux versions d'une
 * même séance, donc de pouvoir se tromper sur des données qu'on ne peut pas
 * reconstituer. Les modifications venues de Claude passent par la file de
 * propositions, jamais par ici.
 */
export default defineEventHandler(async (event) => {
  requireSession(event)
  const body = await readBody<{ version?: number, data?: Record<string, unknown> }>(event)
  if (!body?.data || typeof body.data !== 'object') {
    throw createError({ statusCode: 400, statusMessage: 'Données absentes' })
  }
  const size = Buffer.byteLength(JSON.stringify(body.data))
  if (size > MAX_BYTES) throw createError({ statusCode: 413, statusMessage: 'Données trop volumineuses' })

  const at = new Date().toISOString()
  await writeMirror({ at, version: body.version ?? 0, data: body.data })
  return { ok: true, at, bytes: size }
})

export const _readMirror = readMirror // conservé pour les tests d'intégration
