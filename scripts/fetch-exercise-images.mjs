#!/usr/bin/env node
/*
 * Télécharge, pour chaque exercice du programme, la position de DÉPART et de FIN
 * dans public/exercises/<idExercice>-1.jpg et <idExercice>-2.jpg.
 *
 *   node scripts/fetch-exercise-images.mjs
 *
 * ── Source & licence — À LIRE AVANT DE LANCER ───────────────────────────────
 *
 * ⚠️  CE QUE CE SCRIPT TÉLÉCHARGE N'EST PAS LIBRE DE DROITS.
 *
 * Source par défaut : free-exercise-db (https://github.com/yuhonas/free-exercise-db).
 * Ce dépôt est sous Unlicense, mais l'Unlicense y couvre le JEU DE DONNÉES JSON ;
 * son README ne dit rien des images. Trois issues posent exactement la question —
 * #2 (« I'm not sure if the images are royalty free »), #12 et #13 — et AUCUNE n'a
 * de réponse du mainteneur. Le statut n'est donc pas « libre », il est « jamais
 * établi », ce qui n'est pas la même chose.
 *
 * Les fichiers eux-mêmes le disent assez : 850×567, JPEG progressif, éclairage
 * studio, modèles identifiables dans une salle commerciale, EXIF entièrement
 * retiré. C'est de la photo de commande, très probablement bodybuilding.com.
 *
 * D'où la règle du dépôt : ces images sont IGNORÉES PAR GIT (.gitignore) et ne
 * sont jamais commitées. Les garder sur son disque pour son instance perso est une
 * chose ; les redistribuer depuis un dépôt public sous AGPL en est une autre. Elles
 * ont d'ailleurs été purgées de l'historique une fois, ce qui a coûté un
 * force-push : la ligne de .gitignore est ce qui évite de recommencer.
 *
 * ── Sans images, rien ne casse ──────────────────────────────────────────────
 * `components/sport/ExerciseMove.vue` retombe sur le schéma des muscles travaillés
 * (`SportMuscleMap`), qui dit d'ailleurs quelque chose qu'une photo ne dit pas.
 * C'est l'affichage par défaut d'un clone frais, et il est très bien.
 *
 * ── Si tu veux de vraies images, avec de vrais droits ───────────────────────
 *   • Everkinetic — https://github.com/everkinetic/data, CC BY-SA 4.0. Vraiment
 *     libres, mais attribution ET partage à l'identique obligatoires : la mention
 *     doit apparaître quelque part dans l'application, pas seulement dans un README.
 *   • Gym Visual — https://gymvisual.com, payant, le style « 3D + muscles ».
 *   • Les tiennes, prises à la salle. C'est le seul cas sans aucune contrainte.
 * Dépose <idExercice>-1.jpg et <idExercice>-2.jpg dans public/exercises/ ;
 * l'application les affiche automatiquement, sans rien changer au code.
 * ────────────────────────────────────────────────────────────────────────────
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const outDir = join(root, 'public', 'exercises')
mkdirSync(outDir, { recursive: true })

// Lit la correspondance depuis data/exerciseImages.ts (sans dépendre de TS)
const mapSrc = readFileSync(join(root, 'data', 'exerciseImages.ts'), 'utf8')
const SLUGS = {}
for (const m of mapSrc.matchAll(/'([^']+)':\s*'([^']+)'/g)) SLUGS[m[1]] = m[2]

const BASE = 'https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises'

async function grab(slug, n) {
  const res = await fetch(`${BASE}/${slug}/${n}.jpg`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

let ok = 0, fail = 0
// Exos simples : 2 frames (départ/fin) du même mouvement
for (const [exId, slug] of Object.entries(SLUGS)) {
  try {
    const [a, b] = await Promise.all([grab(slug, 0), grab(slug, 1)])
    writeFileSync(join(outDir, `${exId}-1.jpg`), a)
    writeFileSync(join(outDir, `${exId}-2.jpg`), b)
    console.log(`✓ ${exId}  (${slug})`)
    ok++
  } catch (e) {
    console.warn(`✗ ${exId}  (${slug}) — ${e.message}`)
    fail++
  }
}
// Supersets : 1 image de travail par mouvement
const pairRe = /'([\w-]+)':\s*\[\s*\{\s*slug:\s*'([^']+)'[^}]*\},\s*\{\s*slug:\s*'([^']+)'/g
for (const m of mapSrc.matchAll(pairRe)) {
  const [, exId, slugA, slugB] = m
  try {
    const [a, b] = await Promise.all([grab(slugA, 0), grab(slugB, 0)])
    writeFileSync(join(outDir, `${exId}-1.jpg`), a)
    writeFileSync(join(outDir, `${exId}-2.jpg`), b)
    console.log(`✓ ${exId}  (superset : ${slugA} + ${slugB})`)
    ok++
  } catch (e) {
    console.warn(`✗ ${exId}  — ${e.message}`)
    fail++
  }
}
console.log(`\nTerminé : ${ok} exercices, ${fail} échecs. Images dans public/exercises/`)
