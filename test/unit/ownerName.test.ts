import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// À qui appartient cette instance.
// ─────────────────────────────────────────────────────────────────────────────
//
// La question a l'air cosmétique. Elle ne l'est pas : ce nom s'affiche dans la
// fenêtre de passkey du système — celle où l'on approche son doigt — et dans ce que
// le connecteur raconte à Claude. Écrit en dur, il faisait s'authentifier sous mon
// nom quiconque hébergeait ce code, et lui donnait un assistant qui parlait de mes
// séances.
//
// On ne peut PAS le tirer de Claude : le message `initialize` du protocole porte un
// `clientInfo` — le nom du LOGICIEL client — et le flux OAuth ne transporte aucune
// identité d'utilisateur. C'est donc l'application qui doit le demander, et le bon
// moment est celui où l'on pose le passkey.
//
// Ces tests lisent les sources : ils protègent la CASCADE, qui est la seule chose
// qu'un futur remaniement peut casser sans que rien ne le signale.

const AUTH = readFileSync('server/api/auth/_auth.ts', 'utf8')
const CHALLENGE = readFileSync('server/api/auth/challenge.post.ts', 'utf8')
const REGISTER = readFileSync('server/api/auth/register.post.ts', 'utf8')
const VAULT = readFileSync('server/utils/vault.ts', 'utf8')
const MCP = readFileSync('server/api/mcp.post.ts', 'utf8')

describe('le nom du propriétaire', () => {
  it('se cherche dans le coffre, puis la configuration, puis « Moi »', () => {
    const corps = AUTH.slice(AUTH.indexOf('export async function ownerName'), AUTH.indexOf('export const ownerNameSync'))
    // L'ordre compte : le nom tapé par la personne l'emporte sur celui du déploiement.
    expect(corps.indexOf('cred?.ownerName')).toBeGreaterThan(-1)
    expect(corps.indexOf('cred?.ownerName')).toBeLessThan(corps.indexOf('useRuntimeConfig'))
    expect(corps).toContain("'Moi'")
  })

  it('se range à côté du passkey, et reste facultatif', () => {
    // Facultatif : une instance posée avant ce champ doit continuer de fonctionner.
    expect(VAULT).toMatch(/ownerName\?: string/)
    expect(REGISTER).toContain('...(qui ? { ownerName: qui } : {})')
  })

  it('voyage avec la demande de défi, pour la fenêtre du système', () => {
    // Au moment de poser le passkey, le nom n'existe encore nulle part : s'il ne
    // partait qu'à l'enregistrement, la fenêtre afficherait « Moi » juste avant.
    expect(CHALLENGE).toContain('nom?: string')
    expect(CHALLENGE).toContain('rpName: `Damn Claude — ${qui}`')
  })

  it('est borné, et nettoyé de ses espaces', () => {
    // Un nom de deux mille caractères dans une fenêtre système est un problème
    // d'affichage qu'on ne voit qu'une fois en production.
    expect(AUTH).toContain('.trim().slice(0, 40)')
    for (const f of [CHALLENGE, REGISTER]) expect(f).toContain('.trim().slice(0, 40)')
  })

  it('n’est plus écrit en dur nulle part côté serveur', () => {
    for (const [nom, src] of Object.entries({ AUTH, CHALLENGE, REGISTER, MCP })) {
      const lignes = src.split('\n').filter(l => /gr[ée]goire/i.test(l) && !l.trim().startsWith('*') && !l.trim().startsWith('//'))
      expect(lignes, `${nom} : ${lignes.join(' | ')}`).toEqual([])
    }
  })

  it('le connecteur lit le nom au moment de répondre, pas au chargement du module', () => {
    // Écrit comme une constante de module, il serait figé au démarrage à froid de la
    // fonction — et un renommage ne se verrait qu'au prochain déploiement.
    expect(MCP).toContain('const instructions = async () =>')
    expect(MCP).toContain('await instructions()')
  })
})
