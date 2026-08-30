import { clearSession } from './_auth'

export default defineEventHandler((event) => {
  clearSession(event)
  return { ok: true }
})
