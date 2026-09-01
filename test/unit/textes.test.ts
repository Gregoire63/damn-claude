import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// ─────────────────────────────────────────────────────────────────────────────
// Ce que l'application DIT, et ce qu'elle ne doit plus dire.
// ─────────────────────────────────────────────────────────────────────────────
//
// Les textes d'écran ont longtemps été écrits pour un seul utilisateur : ils
// racontaient le pourquoi du code, mentionnaient un prénom, une balance précise, des
// choix de conception. Sur une application que quelqu'un d'autre installe, chacune de
// ces phrases est du bruit — au mieux, une curiosité ; au pire, une consigne qui ne
// s'applique pas à lui.
//
// Ce test ne juge pas le style : il attrape les formes qui ne peuvent pas être
// correctes. Un nom propre dans un gabarit, une référence au dépôt, une explication
// de décision technique. La règle générale reste une affaire de relecture ; ce qui
// est ici est mécanique, et se serait reglissé sans lui.
//
// Les COMMENTAIRES ne sont pas concernés, et c'est délibéré : ils expliquent le
// pourquoi à qui lit le code, ce qui est exactement leur rôle. La frontière est
// l'écran.

function gabarits(dir: string, out: string[] = []): string[] {
  for (const nom of readdirSync(dir)) {
    const p = join(dir, nom)
    if (statSync(p).isDirectory()) gabarits(p, out)
    else if (nom.endsWith('.vue')) out.push(p)
  }
  return out
}

/** Le contenu de <template>, sans les commentaires ni les attributs techniques. */
function texteVisible(fichier: string): string {
  const src = readFileSync(fichier, 'utf8')
  const i = src.indexOf('<template>')
  const j = src.lastIndexOf('</template>')
  if (i < 0 || j < 0) return ''
  return src.slice(i, j)
      .replace(/<!--[\s\S]*?-->/g, '')
      // Les interpolations sont du CODE : `{{ v.state.value.passkeys }}` n'est pas un
      // texte affiché, et le compter ferait échouer le test sur un nom de variable.
      .replace(/\{\{[\s\S]*?\}\}/g, '·')
      .replace(/<[^>]*>/g, ' ')
}

const FICHIERS = [...gabarits('components'), ...gabarits('pages'), ...gabarits('layouts')]

/**
 * Ce qu'aucun écran ne doit contenir, et pourquoi.
 *
 * Chaque ligne vient d'une phrase réellement affichée à un moment : le nom du
 * propriétaire, « l'appli te dit », une justification de choix technique.
 */
const INTERDITS: { motif: RegExp, raison: string }[] = [
  { motif: /Grégoire|Gregoire/i, raison: 'un prénom en dur : l\'application est utilisée par d\'autres' },
  { motif: /\bquelqu'un d'autre\b/i, raison: 'les données d\'un tiers ne concernent pas l\'utilisateur' },
  { motif: /\bNetlify\b/, raison: 'le nom de l\'hébergeur : chacun déploie où il veut' },
  { motif: /\bnpm run\b|localhost:\d/, raison: 'une commande de développement n\'a rien à faire à l\'écran' },
  { motif: /\bc'est délibéré\b|\bc'est voulu\b|\bexprès\b/i, raison: 'une justification de conception, pas une consigne' },
  { motif: /\bl'appli\b/i, raison: 'familier : « l\'application », ou rien' },
  { motif: /\bton téléphone\b/i, raison: 'l\'appareil n\'est pas forcément un téléphone' },
  { motif: /\bpasskey/i, raison: 'jargon : « clé d\'accès »' },
  { motif: /\bmiroir\b/i, raison: 'jargon interne : « copie » ou « sauvegarde »' },
]

describe('les textes de l’application', () => {
  it('ne parlent de personne en particulier, ni du dépôt', () => {
    const fautes: string[] = []
    for (const f of FICHIERS) {
      const t = texteVisible(f)
      for (const { motif, raison } of INTERDITS) {
        const m = motif.exec(t)
        if (m) fautes.push(`${f} — « ${m[0]} » : ${raison}`)
      }
    }
    expect(fautes, `\n${fautes.join('\n')}\n`).toEqual([])
  })

  /**
   * Le tutoiement, tenu partout. Un écran qui vouvoie au milieu de dix qui tutoient
   * se remarque immédiatement, et donne l'impression d'une application recousue.
   */
  it('tutoient, sans jamais vouvoyer', () => {
    const fautes: string[] = []
    for (const f of FICHIERS) {
      const t = texteVisible(f)
      const m = /\b(vous (pouvez|devez|avez|êtes|pourrez)|votre (poids|profil|séance|compte|appareil))\b/i.exec(t)
      if (m) fautes.push(`${f} — « ${m[0]} »`)
    }
    expect(fautes, `\n${fautes.join('\n')}\n`).toEqual([])
  })

  /**
   * Un paragraphe d'écran ne dépasse pas trois phrases. Au-delà, ce n'est plus une
   * consigne, c'est un article — et il ne se lit pas : on referme.
   */
  it('ne posent pas de pavé à lire au milieu d’un écran', () => {
      const longs: string[] = []
      for (const f of FICHIERS) {
        const src = readFileSync(f, 'utf8').replace(/<!--[\s\S]*?-->/g, '')
        for (const m of src.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)) {
          const t = m[1]!.replace(/\{\{[\s\S]*?\}\}/g, '·').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
          if (t.length < 200) continue
          const phrases = t.split(/[.!?](?:\s|$)/).filter(x => x.trim().length > 12)
          if (phrases.length > 3) longs.push(`${f} — ${phrases.length} phrases : « ${t.slice(0, 70)}… »`)
        }
      }
      expect(longs, `\n${longs.join('\n')}\n`).toEqual([])
    })
})
