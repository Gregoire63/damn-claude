import { computed, ref } from 'vue'
import { PROGRAM } from '~/data/sportProgram'
import type { Exercise, Session } from '~/data/sportProgram'
import { LEGACY_NAMES, allExercises, mergeProgram, retiredExercises } from '~/lib/program'
import { EXERCISE_GEAR, VARIANTS } from '~/data/exerciseVariants'
import type { Variant } from '~/data/exerciseVariants'
import type { ExercisePatch, ProgramCustom, VariantSpec } from '~/lib/program'

// ─────────────────────────────────────────────────────────────────────────────
// Le programme d'entraînement, désormais modifiable.
// ─────────────────────────────────────────────────────────────────────────────
//
// Même architecture que la bibliothèque de plats : le livré ne bouge pas, les
// modifications vivent à côté, et la fusion se fait à la lecture. C'est ce qui permet
// de revenir en arrière — retirer un patch rend la fiche d'origine — et ce qui rend
// une mise à jour du programme livré compatible avec des modifications déjà faites.
//
// Un exercice RETIRÉ n'est pas supprimé, il est désactivé. Les séances enregistrées
// sont indexées par identifiant d'exercice : le supprimer effacerait des records
// réellement soulevés et rendrait illisibles des mois de journal.

const PATCH_KEY = 'gr-prog-patch-v1' // exercices livrés, modifiés
const ADDED_KEY = 'gr-prog-added-v1' // exercices ajoutés, par séance
const OFF_KEY = 'gr-prog-off-v1' // exercices retirés du programme
const ORDER_KEY = 'gr-prog-order-v1' // ordre voulu, par séance
const VAR_KEY = 'gr-prog-var-v1' // machines de remplacement redéfinies
const SEANCES_KEY = 'gr-prog-seances-v1' // séances créées de toutes pièces

const patches = ref<Record<string, ExercisePatch>>({})
const added = ref<Record<string, Exercise[]>>({})
const disabled = ref<string[]>([])
const order = ref<Record<string, string[]>>({})
const variants = ref<Record<string, VariantSpec[]>>({})
const seances = ref<Session[]>([])

let hydrated = false

function safeParse<T>(raw: string | null, fb: T): T {
  if (!raw) return fb
  try { return JSON.parse(raw) as T }
  catch { return fb }
}
function write(key: string, value: unknown) {
  if (!import.meta.client) return
  try { localStorage.setItem(key, JSON.stringify(value)) }
  catch { /* stockage plein ou indisponible */ }
}

export function useProgram() {
  function hydrate() {
    if (hydrated || !import.meta.client) return
    hydrated = true
    patches.value = safeParse(localStorage.getItem(PATCH_KEY), {})
    added.value = safeParse(localStorage.getItem(ADDED_KEY), {})
    disabled.value = safeParse(localStorage.getItem(OFF_KEY), [])
    order.value = safeParse(localStorage.getItem(ORDER_KEY), {})
    variants.value = safeParse(localStorage.getItem(VAR_KEY), {})
    seances.value = safeParse(localStorage.getItem(SEANCES_KEY), [])
  }
  hydrate()

  const custom = computed<ProgramCustom>(() => ({
    sessions: seances.value,
    patches: patches.value,
    added: added.value,
    disabled: disabled.value,
    order: order.value,
    variants: variants.value,
  }))

  /** LE programme, celui que tous les écrans doivent lire. */
  const program = computed<Session[]>(() => mergeProgram(PROGRAM, custom.value))
  const exercises = computed<Exercise[]>(() => allExercises(program.value))
  /** Le programme AVEC les mouvements retirés, à leur place. Ce que lit l'écran de
   *  réactivation et l'outil « programme » quand on lui demande les inactifs. */
  const programAll = computed<Session[]>(() => mergeProgram(PROGRAM, custom.value, true))
  /** Les mouvements retirés, pour que l'historique garde leurs noms. */
  const retired = computed<Record<string, Exercise>>(() => retiredExercises(PROGRAM, custom.value))
  const isOff = (id: string) => disabled.value.includes(id)

  /**
   * Crée une séance entière.
   *
   * Refuse un identifiant déjà pris — par le livré comme par une séance déjà créée.
   * C'est la seule garde qui compte : l'historique est indexé par exercice, et deux
   * séances de même identifiant rendraient impossible de savoir à laquelle rattacher
   * une performance. Rendre `false` plutôt que lever : l'appelant est soit une
   * proposition à valider, soit un écran, et aucun des deux n'a de quoi traiter une
   * exception.
   */
  function addSession(s: Session): boolean {
    if (!s?.id || program.value.some(x => x.id === s.id)) return false
    seances.value = [...seances.value, s]
    write(SEANCES_KEY, seances.value)
    return true
  }

  /**
   * Retire une séance CRÉÉE. Définitif, contrairement au retrait d'un exercice.
   *
   * Un exercice retiré reste dans `disabled` parce que l'historique le référence et
   * doit pouvoir afficher son nom. Une séance créée puis supprimée n'a, elle, pas
   * d'équivalent livré à retrouver : si des performances y sont attachées, ce sont
   * les exercices qui les portent, et `retiredExercises` continue de les nommer.
   * Une séance LIVRÉE n'est pas supprimable ici — il n'y a rien à supprimer.
   */
  function removeSession(id: string): boolean {
    if (!seances.value.some(s => s.id === id)) return false
    seances.value = seances.value.filter(s => s.id !== id)
    write(SEANCES_KEY, seances.value)
    return true
  }

  /**
   * Les machines de remplacement EFFECTIVES.
   *
   * Une liste proposée ne porte que trois champs. Le catalogue en a six : `gear`
   * pilote l'icône de matériel, `hint` et `why` la phrase d'explication. On rend donc
   * les trois manquants dès que l'identifiant existe encore au catalogue — remplacer
   * la liste ne doit pas coûter l'icône d'une machine qu'on garde.
   */
  const variantsFor = (exId: string): Variant[] => {
    const voulu = variants.value[exId]
    if (!voulu) return VARIANTS[exId] ?? []
    const cat = new Map((VARIANTS[exId] ?? []).map(v => [v.id, v]))
    return voulu.map((v) => {
      const d = cat.get(v.id)
      return {
        id: v.id,
        name: v.name,
        ratio: v.ratio,
        hint: d?.hint ?? '',
        why: d?.why ?? '',
        gear: d?.gear ?? EXERCISE_GEAR[exId] ?? 'barre',
      }
    })
  }

  /** Où se trouve cet exercice, et dans quel état. Le refus « déjà pris dans s2 »
   *  en dépend, et la garde des « de_… » aussi. */
  const exerciseAt = (id: string): { seance: string, seanceNom: string, actif: boolean, ex: Exercise } | null => {
    for (const s of programAll.value) {
      const ex = s.exercises.find(e => e.id === id)
      if (ex) return { seance: s.id, seanceNom: s.name, actif: !isOff(id), ex }
    }
    return null
  }

  const sessionById = (id: string | null): Session | null =>
    (id ? program.value.find(s => s.id === id) ?? null : null)
  const exerciseById = (id: string): Exercise | null =>
    exercises.value.find(e => e.id === id) ?? retired.value[id] ?? null
  /**
   * Le nom d'un exercice, RETIRÉS COMPRIS.
   *
   * L'historique est indexé par identifiant : sans repli, une séance de mars
   * afficherait « ext-corde » là où elle affichait « Extension triceps corde ».
   * Tout écran qui montre du passé doit passer par ici.
   */
  const exerciseName = (id: string): string => exerciseById(id)?.name ?? LEGACY_NAMES[id] ?? id

  /** Modifie un exercice existant. Les clés absentes du patch ne sont pas touchées. */
  function patchExercise(exId: string, patch: ExercisePatch) {
    patches.value = { ...patches.value, [exId]: { ...patches.value[exId], ...patch } }
    write(PATCH_KEY, patches.value)
  }
  /** Rend sa fiche d'origine à un exercice livré. */
  function resetExercise(exId: string) {
    const next = { ...patches.value }
    delete next[exId]
    patches.value = next
    write(PATCH_KEY, patches.value)
  }
  /**
   * Ajoute un exercice, éventuellement juste APRÈS un autre.
   *
   * Les ajouts sont stockés à part et se retrouvent naturellement en fin de séance.
   * Pour les placer ailleurs, on ne touche pas au stockage : on écrit l'ordre voulu,
   * qui est déjà le mécanisme prévu pour ça. Deux façons de positionner un exercice
   * auraient fini par se contredire.
   */
  function addExercise(sessionId: string, ex: Exercise, apres?: string) {
    added.value = { ...added.value, [sessionId]: [...(added.value[sessionId] ?? []), ex] }
    write(ADDED_KEY, added.value)
    // Un exercice ajouté puis retiré puis réajouté doit réapparaître.
    if (disabled.value.includes(ex.id)) enableExercise(ex.id)
    if (apres) placeAfter(sessionId, ex.id, apres)
  }

  /** Place `exId` juste après `apres` dans l'ordre effectif de la séance. */
  function placeAfter(sessionId: string, exId: string, apres: string) {
    const s = program.value.find(x => x.id === sessionId)
    if (!s) return
    const ids = s.exercises.map(e => e.id).filter(id => id !== exId)
    const i = ids.indexOf(apres)
    if (i < 0) return
    ids.splice(i + 1, 0, exId)
    setOrder(sessionId, ids)
  }
  /** Retire du PROGRAMME, jamais de l'historique. */
  function disableExercise(exId: string) {
    if (disabled.value.includes(exId)) return
    disabled.value = [...disabled.value, exId]
    write(OFF_KEY, disabled.value)
  }
  /**
   * Remet un exercice dans le programme.
   *
   * Sans `apres`, il retrouve sa place d'origine — il ne l'a jamais quittée, il en
   * était seulement filtré. C'est toute la raison pour laquelle « retirer »
   * désactive au lieu de supprimer.
   */
  function enableExercise(exId: string, apres?: string) {
    disabled.value = disabled.value.filter(id => id !== exId)
    write(OFF_KEY, disabled.value)
    if (!apres) return
    const s = programAll.value.find(x => x.exercises.some(e => e.id === exId))
    if (s) placeAfter(s.id, exId, apres)
  }

  /** Redéfinit les machines de remplacement d'un exercice. La liste REMPLACE. */
  function setVariants(exId: string, list: VariantSpec[]) {
    variants.value = { ...variants.value, [exId]: list }
    write(VAR_KEY, variants.value)
  }
  function resetVariants(exId: string) {
    const next = { ...variants.value }
    delete next[exId]
    variants.value = next
    write(VAR_KEY, variants.value)
  }
  function setOrder(sessionId: string, ids: string[]) {
    order.value = { ...order.value, [sessionId]: ids }
    write(ORDER_KEY, order.value)
  }

  function snapshot() {
    return { programme: { sessions: seances.value, patches: patches.value, added: added.value, disabled: disabled.value, order: order.value, variants: variants.value } }
  }
  /** Restauration TOLÉRANTE : une sauvegarde d'avant cette fonctionnalité passe sans erreur. */
  function restore(data: Record<string, unknown>) {
    const p = data?.programme as ProgramCustom | undefined
    if (!p || typeof p !== 'object') return
    if (p.patches && typeof p.patches === 'object') { patches.value = p.patches; write(PATCH_KEY, patches.value) }
    if (p.added && typeof p.added === 'object') { added.value = p.added; write(ADDED_KEY, added.value) }
    if (Array.isArray(p.disabled)) { disabled.value = p.disabled; write(OFF_KEY, disabled.value) }
    if (p.order && typeof p.order === 'object') { order.value = p.order; write(ORDER_KEY, order.value) }
    if (p.variants && typeof p.variants === 'object') { variants.value = p.variants; write(VAR_KEY, variants.value) }
    if (Array.isArray(p.sessions)) { seances.value = p.sessions; write(SEANCES_KEY, seances.value) }
  }

  return {
    hydrate, program, programAll, exercises, retired, custom,
    sessionById, exerciseById, exerciseName, exerciseAt, variantsFor,
    patchExercise, resetExercise, addExercise, disableExercise, enableExercise, setOrder,
    setVariants, resetVariants, placeAfter,
    addSession, removeSession,
    snapshot, restore,
  }
}
