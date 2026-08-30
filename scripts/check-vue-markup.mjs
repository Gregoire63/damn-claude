// Garde-fou : le compilateur Vue signale le HTML invalide — un <tr> sans <tbody>,
// un <button> dans un <button> — mais seulement quand il compile le fichier, donc
// seulement si l'on ouvre l'écran concerné en développement. Un composant rarement
// visité peut porter la faute pendant des mois sans que personne ne voie l'alerte.
//
// Ce n'est pas de la pédanterie de spécification. L'analyseur HTML du navigateur
// RÉPARE ces structures à sa façon : il insère un <tbody> qu'on n'a pas écrit, il
// SORT le bouton intérieur de son parent. La page rendue n'est alors plus celle du
// gabarit, et le bogue qui en découle ne ressemble jamais à sa cause.
//
// On compile donc tout, à froid, sans navigateur et sans visiter un seul écran.
//
// On appelle `compile` de @vue/compiler-dom et non `compileTemplate` de
// @vue/compiler-sfc : ce dernier installe son propre `onWarn`, range les messages
// dans `result.tips` sous forme de texte déjà mis en page, et la position devient
// une chaîne à ré-analyser. Ici on reçoit l'objet `loc`, donc une vraie ligne.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from '@vue/compiler-sfc'
import { compile } from '@vue/compiler-dom'

function composants(dir, out = []) {
  for (const nom of readdirSync(dir)) {
    const p = join(dir, nom)
    if (statSync(p).isDirectory()) composants(p, out)
    else if (nom.endsWith('.vue')) out.push(p)
  }
  return out
}

const fichiers = [
  ...['components', 'pages', 'layouts'].flatMap(d => composants(d)),
  // Les deux gabarits racine. error.vue est le seul rendu côté serveur : c'est le
  // seul endroit où un balisage invalide produirait une vraie erreur d'hydratation.
  'app.vue',
  'error.vue',
].filter(f => existsSync(f)).sort()
let bad = 0

for (const f of fichiers) {
  const { descriptor } = parse(readFileSync(f, 'utf8'), { filename: f })
  const tpl = descriptor.template
  if (!tpl) continue
  // `compile` ne voit que le contenu du <template> : ses lignes repartent de 1.
  const decalage = tpl.loc.start.line - 1
  try {
    compile(tpl.content, {
      onWarn: (w) => {
        bad++
        console.error(`${f}:${(w.loc?.start?.line ?? 0) + decalage} — ${w.message}`)
      },
    })
  }
  catch (e) {
    bad++
    console.error(`${f} — ${e.message}`)
  }
}

if (bad) {
  console.error(`\n${bad} problème(s) de balisage. Le navigateur les « réparerait » à sa façon.`)
  process.exit(1)
}
console.log(`Balisage valide (${fichiers.length} composants).`)
