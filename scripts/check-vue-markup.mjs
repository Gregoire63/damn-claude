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

/**
 * Une page = un seul nœud à la racine, et ce nœud doit être un ÉLÉMENT.
 *
 * Deux garde-fous en un, parce que les deux se réparent au même endroit.
 *
 * 1. `<NuxtPage>` enveloppe la page dans une `<Transition>` (le glissement d'onglet),
 *    et une transition anime UN nœud du DOM. `<Suspense>`, `<ClientOnly>` ou un
 *    `<template>` à la racine n'existent pas dans le DOM : Vue prévient une fois en
 *    console (« renders non-element root node that cannot be animated »), puis rend
 *    l'écran SANS animation. Rien ne casse, rien n'échoue — le glissement ne joue
 *    simplement pas sur cet onglet-là.
 *
 * 2. Un COMMENTAIRE posé à la racine, à côté de l'élément, compte comme un second
 *    nœud : en développement le compilateur les conserve, la page rend un fragment, et
 *    Nuxt le signale lui-même (NUXT_E4004, « does not have a single root node and will
 *    cause errors when navigating between routes »). Le commentaire va donc DANS
 *    l'élément racine, jamais au-dessus.
 *
 * Les deux ne se voient qu'en ouvrant la console du bon écran, en développement, après
 * avoir navigué. C'est exactement le genre de faute qu'une vérification à froid attrape
 * mieux qu'un humain.
 */
function racineUnique(f, ast) {
  // On garde les commentaires : c'est le point 2. Seuls les blancs de mise en page
  // disparaissent — eux ne produisent aucun nœud.
  const noeuds = ast.children.filter(c => !(c.type === 2 && !c.content.trim()))
  if (noeuds.length !== 1) {
    const quoi = noeuds.map(c => (c.type === 3 ? 'un commentaire' : c.type === 2 ? 'du texte' : `<${c.tag}>`)).join(' + ')
    console.error(`${f} — ${noeuds.length} nœuds à la racine (${quoi}) ; une page en veut UN. Rentre les commentaires dans l'élément racine.`)
    return false
  }
  const [r] = noeuds
  // tagType 0 = balise HTML. 1 = composant, 3 = <template> : ni l'un ni l'autre
  // n'existe dans le DOM, donc rien à animer.
  if (r.type !== 1 || r.tagType !== 0) {
    const quoi = r.type === 1 ? `<${r.tag}>` : r.type === 3 ? 'un commentaire' : 'du texte'
    console.error(`${f} — racine ${quoi} : enveloppe-la dans un élément HTML, sinon la transition d'onglet ne joue pas.`)
    return false
  }
  return true
}

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
  if (f.startsWith('pages') && tpl.ast && !racineUnique(f, tpl.ast)) bad++
}

if (bad) {
  console.error(`\n${bad} problème(s) de balisage. Le navigateur les « réparerait » à sa façon.`)
  process.exit(1)
}
console.log(`Balisage valide (${fichiers.length} composants), pages à racine unique.`)
