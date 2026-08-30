// Garde-fou : une clé écrite deux fois dans un même objet littéral.
//
// JavaScript ne proteste pas — la seconde écrase la première en silence, et le
// fichier reste parfaitement valide. Ça s'est produit sur `keeps`, `cook` et
// `noFreeze` en éditant la table des aliments par script : les valeurs étaient
// identiques, donc rien ne cassait, mais la ligne suivante aurait pu être différente
// et le plan entier aurait alors reposé sur une donnée fantôme.
//
// Vite le signale en développement, noyé dans le reste. Ici, ça échoue.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const DIRS = ['data', 'lib', 'composables']
let bad = 0

/** Les objets littéraux d'un fichier, sans imbrication : suffisant pour des tables de données. */
function* flatObjects(src) {
  const re = /\{[^{}]*\}/gs
  let m
  while ((m = re.exec(src)) !== null) yield { text: m[0], at: src.slice(0, m.index).split('\n').length }
}

for (const dir of DIRS) {
  for (const file of readdirSync(dir).filter(f => f.endsWith('.ts'))) {
    const path = join(dir, file)
    const src = readFileSync(path, 'utf8')
    for (const obj of flatObjects(src)) {
      const seen = new Map()
      for (const k of obj.text.matchAll(/(?:^|\n)\s*([a-zA-Z_]\w*)\s*:/g)) {
        const key = k[1]
        seen.set(key, (seen.get(key) ?? 0) + 1)
      }
      for (const [key, n] of seen) {
        if (n > 1) {
          const id = obj.text.match(/id: '([^']+)'/)?.[1] ?? `ligne ${obj.at}`
          console.error(`${path} — « ${key} » écrit ${n} fois dans ${id}`)
          bad++
        }
      }
    }
  }
}
console.log(bad ? `\n${bad} clé(s) en double.` : 'Aucune clé en double.')
process.exit(bad ? 1 : 0)
