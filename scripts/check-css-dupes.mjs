// Garde-fou : deux règles de premier niveau portant le MÊME sélecteur se marchent
// dessus en silence — la seconde hérite des propriétés de la première sans qu'aucun
// outil ne le signale. Trois collisions sont passées par là (.nu-ing, .nu-slot,
// .nu-chip), chacune visible seulement à l'écran, longtemps après coup.
import { readFileSync } from 'node:fs'

// Doublons volontaires : un même élément décrit en deux endroits (placement dans une
// grille d'un côté, style propre de l'autre).
const ALLOWED = new Set(['.nu-stats', '.nu-hero-actions', '.nu-photo-thumb', '.nu-photo-thumb img', '.nu-photo.cover .nu-photo-add'])

let bad = 0
for (const file of ['assets/css/nutrition.css', 'assets/css/sport.css']) {
  const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  const counts = new Map()
  for (const m of src.matchAll(/^([.#][^{@\n]+)\{/gm)) {
    for (const sel of m[1].split(',')) {
      const s = sel.trim()
      if (s) counts.set(s, (counts.get(s) ?? 0) + 1)
    }
  }
  for (const [sel, n] of counts) {
    if (n > 1 && !ALLOWED.has(sel)) {
      console.error(`${file} — « ${sel} » défini ${n} fois`)
      bad++
    }
  }
}
console.log(bad ? `\n${bad} sélecteur(s) en double.` : 'Aucune collision de sélecteur.')
process.exit(bad ? 1 : 0)
