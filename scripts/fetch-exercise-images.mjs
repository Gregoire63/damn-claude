#!/usr/bin/env node
/*
 * Télécharge, pour chaque exercice du programme, la position de DÉPART et de FIN
 * dans public/exercises/<idExercice>-1.jpg et <idExercice>-2.jpg.
 *
 *   node scripts/fetch-exercise-images.mjs
 *
 * ── Source & licence ────────────────────────────────────────────────────────
 * Par défaut : free-exercise-db (https://github.com/yuhonas/free-exercise-db).
 * ⚠️  Ces images ressemblent fortement à des photos de bodybuilding.com et leur
 *     statut de droits est ambigu (le dépôt n'a mis en licence libre que le JSON).
 *     Convient pour un usage personnel ; pour un site public 100% clean, remplace
 *     par des images dont tu détiens les droits :
 *       • Gym Visual (https://gymvisual.com) — le style exact "3D + muscles" de la réf (payant)
 *       • Everkinetic (CC BY-SA, https://commons.wikimedia.org/wiki/Category:Exercise_diagrams)
 *     Il suffit de déposer <idExercice>-1.jpg et <idExercice>-2.jpg dans
 *     public/exercises/ ; l'app les affiche automatiquement.
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
