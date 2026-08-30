import { ref } from 'vue'
import { CARD_EDGE, CARD_QUALITY, MAX_EDGE, QUALITY, THUMB_EDGE, THUMB_QUALITY, fitWithin, rejectReason } from '../lib/photoSize'

// Photos des plats, une par plat, stockées SUR LE TÉLÉPHONE.
//
// IndexedDB et pas localStorage, pour trois raisons :
//  1. localStorage plafonne autour de 5 Mo. Une seule photo d'iPhone en fait 4.
//  2. localStorage ne stocke que du texte : il faudrait passer en base64, soit
//     +33 % de volume pour rien.
//  3. Une QuotaExceededError sur localStorage fait échouer les écritures des AUTRES
//     clés — le planning, les repas cochés, les courses. Une photo trop lourde ne
//     doit pas pouvoir emporter le suivi avec elle.
//
// IndexedDB stocke des Blob nativement, avec un quota qui se compte en centaines de Mo.

const DB_NAME = 'gr-photos'
const DB_VERSION = 1
const STORE = 'dishes'

export interface DishPhoto {
  id: string // identifiant du plat
  full: Blob
  /**
   * Taille intermédiaire pour les couvertures de cartes.
   *
   * Il n'y en avait que deux, et les cartes affichaient la vignette de liste :
   * 192 px étirés sur 340 px de large, d'où le flou. Servir le plein format à leur
   * place aurait réglé le flou en faisant décoder seize images de 1440 px pour une
   * grille. Une taille de plus coûte 15 Ko par photo et règle les deux.
   */
  card?: Blob
  thumb: Blob
  w: number
  h: number
  bytes: number
  at: string // ISO, pour afficher « cuisiné le … »
}

/** Métadonnées seules : ce qu'on garde en mémoire pour toute la bibliothèque. */
export interface PhotoMeta { id: string, w: number, h: number, bytes: number, at: string }

const metas = ref<Record<string, PhotoMeta>>({})
const busy = ref<string | null>(null) // id en cours de traitement
const error = ref<string | null>(null)
let hydrated = false
let dbPromise: Promise<IDBDatabase | null> | null = null

// URL d'objet par plat. Sans ce cache, chaque rendu recrée une URL et l'ancienne
// n'est jamais révoquée : le blob reste en mémoire jusqu'au rechargement de la page.
const urls = new Map<string, string>()
/** Les trois tailles stockées pour chaque photo. */
export type PhotoKind = 'thumb' | 'card' | 'full'
export const PHOTO_KINDS = ['thumb', 'card', 'full'] as const
/** Le navigateur s'est-il engagé à ne pas évincer le stockage ? */
const persisted = ref<boolean | null>(null)

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve) => {
    if (!import.meta.client || !('indexedDB' in window)) return resolve(null)
    let req: IDBOpenDBRequest
    // Navigation privée sur certains navigateurs : indexedDB existe mais lève à l'ouverture.
    try { req = indexedDB.open(DB_NAME, DB_VERSION) }
    catch { return resolve(null) }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { keyPath: 'id' })
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => resolve(null)
  })
  return dbPromise
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then(db => new Promise<T | null>((resolve) => {
    if (!db) return resolve(null)
    try {
      const req = run(db.transaction(STORE, mode).objectStore(STORE))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    }
    catch { resolve(null) }
  }))
}

/**
 * Décode le fichier en respectant l'orientation EXIF. Sans `imageOrientation`,
 * une photo prise en portrait sur iPhone ressort couchée : le capteur enregistre
 * toujours en paysage et note la rotation en métadonnée, que canvas ignore.
 */
async function decode(file: Blob): Promise<ImageBitmap | HTMLImageElement> {
  if ('createImageBitmap' in window) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }) }
    catch { /* vieux Safari : on retombe sur <img>, qui applique l'EXIF depuis iOS 13 */ }
  }
  const url = URL.createObjectURL(file)
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('Image illisible'))
      img.src = url
    })
  }
  finally { URL.revokeObjectURL(url) }
}

async function encode(src: ImageBitmap | HTMLImageElement, max: number, quality: number): Promise<Blob> {
  const sw = 'width' in src ? src.width : 0
  const sh = 'height' in src ? src.height : 0
  const { w, h } = fitWithin(sw, sh, max)
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas indisponible')
  // Rééchantillonnage de qualité : sans ça, une division par 4 crénelle le riz et le texte.
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(src as CanvasImageSource, 0, 0, w, h)

  const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/webp', quality))
  // WebP fait ~30 % de moins que JPEG à qualité perçue égale. Si le navigateur ne
  // sait pas l'encoder, toBlob renvoie du PNG (énorme) ou null : on force le JPEG.
  if (blob && blob.type === 'image/webp') return blob
  const jpeg = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', quality))
  if (!jpeg) throw new Error('Encodage impossible')
  return jpeg
}

/**
 * Espace de noms des photos de matériel : `ex:<exercice>` pour le mouvement du
 * programme, `ex:<variante>` pour une machine de remplacement. Elles vivent dans le
 * même stockage que les photos de plats — un seul mécanisme de redimensionnement,
 * de persistance et de vignettes — mais elles n'obéissent pas au même nettoyage.
 */
export const GEAR_PHOTO_PREFIX = 'ex:'
export const gearPhotoId = (id: string) => `${GEAR_PHOTO_PREFIX}${id}`
export const isGearPhoto = (id: string) => id.startsWith(GEAR_PHOTO_PREFIX)

/**
 * Les photos à supprimer : celles dont le plat n'existe plus.
 *
 * Fonction pure et exportée parce que c'est la seule partie DESTRUCTRICE du
 * stockage, et la seule qu'on puisse tester sans IndexedDB. Les photos de matériel
 * en sont exclues : la bibliothèque de plats est le seul écran qui sache ce qui
 * existe encore, mais elle ne sait rien des machines — sans ce filtre, ouvrir
 * l'onglet « Plats » effacerait en silence toutes les photos prises à la salle.
 */
export function orphanPhotoIds(all: string[], knownDishIds: string[]): string[] {
  const known = new Set(knownDishIds)
  return all.filter(id => !isGearPhoto(id) && !known.has(id))
}

export function usePhotos() {
  /** Charge les métadonnées (pas les blobs : on ne veut pas 20 Mo en RAM au démarrage). */
  async function hydrate() {
    if (hydrated || !import.meta.client) return
    hydrated = true
    // « Stockage persistant » : sans ça, un navigateur à court d'espace peut vider
    // IndexedDB sans prévenir — c'est ce qui fait dire que les photos sont « dans le
    // cache ». Avec, elles ne partent que si l'utilisateur les supprime lui-même.
    try {
      if (navigator.storage?.persist) persisted.value = await navigator.storage.persist()
    }
    catch { persisted.value = null }
    const all = await tx<DishPhoto[]>('readonly', s => s.getAll() as IDBRequest<DishPhoto[]>)
    const next: Record<string, PhotoMeta> = {}
    for (const p of all ?? []) next[p.id] = { id: p.id, w: p.w, h: p.h, bytes: p.bytes, at: p.at }
    metas.value = next
  }

  const has = (id: string) => !!metas.value[id]
  const metaOf = (id: string) => metas.value[id] ?? null

  /**
   * Enregistre une photo pour un plat. Une seule par plat : la nouvelle remplace
   * l'ancienne, et l'ancienne URL est révoquée pour que le blob soit libéré.
   */
  async function put(id: string, file: File): Promise<boolean> {
    error.value = null
    const reason = rejectReason(file)
    if (reason) { error.value = reason; return false }
    busy.value = id
    try {
      const src = await decode(file)
      const [full, card, thumb] = await Promise.all([
        encode(src, MAX_EDGE, QUALITY),
        encode(src, CARD_EDGE, CARD_QUALITY),
        encode(src, THUMB_EDGE, THUMB_QUALITY),
      ])
      // Lire les dimensions AVANT de fermer le bitmap : après close(), width vaut 0.
      const size = fitWithin(src.width, src.height, MAX_EDGE)
      if ('close' in src) src.close() // libère le bitmap sans attendre le ramasse-miettes
      const rec: DishPhoto = {
        id, full, card, thumb, w: size.w, h: size.h,
        bytes: full.size + card.size + thumb.size,
        at: new Date().toISOString().slice(0, 16),
      }
      const ok = await tx('readwrite', s => s.put(rec))
      if (ok === null && !(await has0(id))) { error.value = 'Écriture impossible : stockage plein ou navigation privée.'; return false }
      revoke(id)
      metas.value = { ...metas.value, [id]: { id, w: rec.w, h: rec.h, bytes: rec.bytes, at: rec.at } }
      return true
    }
    catch (e) {
      error.value = (e as Error).message || 'Photo illisible.'
      return false
    }
    finally { busy.value = null }
  }

  // Vérifie en base qu'un enregistrement existe (le put a pu réussir malgré un null).
  async function has0(id: string) {
    return !!(await tx<DishPhoto>('readonly', s => s.get(id) as IDBRequest<DishPhoto>))
  }

  async function remove(id: string) {
    await tx('readwrite', s => s.delete(id))
    revoke(id)
    const next = { ...metas.value }
    delete next[id]
    metas.value = next
  }

  /**
   * Supprime les photos dont le plat n'existe plus — sinon elles occupent l'espace à vie.
   *
   * Le nettoyage ne vaut QUE pour les plats. La bibliothèque de plats est le seul
   * écran qui sache ce qui existe encore, mais elle ne sait rien des photos de
   * machines : sans ce garde-fou, ouvrir l'onglet « Plats » effacerait en silence
   * toutes les photos de matériel prises à la salle.
   */
  async function prune(knownIds: string[]) {
    const orphans = orphanPhotoIds(Object.keys(metas.value), knownIds)
    for (const id of orphans) await remove(id)
    return orphans.length
  }

  // Les deux tailles sont indexées séparément (`id:thumb`, `id:full`) : les révoquer
  // toutes les deux, sinon la vignette de l'ancienne photo survit au remplacement.
  function revoke(id: string) {
    for (const kind of PHOTO_KINDS) {
      const key = `${id}:${kind}`
      const u = urls.get(key)
      if (u) { URL.revokeObjectURL(u); urls.delete(key) }
    }
  }
  function revokeAll() {
    for (const u of urls.values()) URL.revokeObjectURL(u)
    urls.clear()
  }

  /**
   * URL affichable, à la taille demandée : `thumb` pour les listes, `card` pour les
   * couvertures de cartes, `full` pour l'aperçu plein écran. Servir la mauvaise
   * taille se voit tout de suite — soit c'est flou, soit ça rame.
   */
  async function urlOf(id: string, kind: PhotoKind = 'thumb'): Promise<string | null> {
    const key = `${id}:${kind}`
    const cached = urls.get(key)
    if (cached) return cached
    const rec = await tx<DishPhoto>('readonly', s => s.get(id) as IDBRequest<DishPhoto>)
    if (!rec) return null
    // Les photos prises avant l'ajout de la taille intermédiaire n'ont pas de `card` :
    // on retombe sur le plein format, net, plutôt que sur la vignette, floue.
    const blob = kind === 'thumb' ? rec.thumb : kind === 'card' ? rec.card ?? rec.full : rec.full
    const url = URL.createObjectURL(blob)
    urls.set(key, url)
    return url
  }

  /**
   * Télécharge la photo pleine taille, pour la ranger dans la galerie du téléphone.
   *
   * IndexedDB n'est pas un cache — c'est du stockage persistant, et `persist()`
   * ci-dessus demande au navigateur de ne jamais l'évincer. Mais une PWA ne peut pas
   * écrire dans la pellicule : sur iPhone comme sur Android, la seule voie est un
   * téléchargement que l'utilisateur range où il veut.
   */
  async function download(id: string, label = 'plat'): Promise<boolean> {
    const url = await urlOf(id, 'full')
    if (!url) return false
    const a = document.createElement('a')
    a.href = url
    a.download = `${label.replace(/[^\w\-]+/g, '-').toLowerCase()}.webp`
    document.body.appendChild(a)
    a.click()
    a.remove()
    return true
  }

  return { hydrate, has, metaOf, metas, put, remove, prune, urlOf, download, revoke, revokeAll, persisted, busy, error }
}
