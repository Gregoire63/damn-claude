<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useVault } from '~/composables/useVault'
import { defaireProposition, detailLines, planFor, weekFor } from '~/lib/proposals'
import { getAt } from '~/lib/pointer'
import { checkFreeMeal } from '~/lib/freeMeal'
import type { RawProposal } from '~/lib/proposals'
import { useNutrition } from '~/composables/useNutrition'
import { useProgram } from '~/composables/useProgram'
import { useSnapshot } from '~/composables/useSnapshot'
import { fmtRest, restFor } from '~/lib/rest'

// ─────────────────────────────────────────────────────────────────────────────
// Ce que Claude propose, et ce qu'on en a fait.
// ─────────────────────────────────────────────────────────────────────────────
//
// Cette feuille vivait DANS les réglages, derrière un bouton, lui-même dans la carte
// du coffre, elle-même en bas d'un écran long. Or c'est la seule chose de
// l'application qui ATTEND quelque chose de toi : tant qu'une proposition n'est ni
// appliquée ni refusée, rien n'est écrit et Claude ne le sait pas. Une file d'attente
// qu'il faut penser à aller consulter n'est pas une file d'attente, c'est un oubli
// programmé — elle s'ouvre maintenant depuis l'en-tête, avec le nombre en attente
// écrit dessus.
//
// Le retour arrière du programme l'a suivie, et c'est le même sujet vu de l'autre
// bout : ce qui est proposé ici s'y applique, ce qui a été appliqué s'y défait.
// Réparer une modification acceptée trop vite en fouillant les réglages, pendant que
// l'écran qui l'a acceptée est deux taps plus loin, n'avait pas de sens.

const emit = defineEmits<{ close: [], flash: [msg: string] }>()

const v = useVault()
const { buildSnapshot } = useSnapshot()
onMounted(() => { void v.hydrate() })

const showDetail = ref<string | null>(null)
const applicable = (p: RawProposal) => v.applicable(p)

async function doApply(p: RawProposal) {
  if (await v.apply(p)) { emit('flash', 'Appliqué ✓'); await v.push(buildSnapshot, true) }
  else emit('flash', v.error.value ?? 'Échec')
}
async function doRefuse(p: RawProposal) {
  if (await v.resolve(p, 'refused')) emit('flash', 'Refusé')
}

/**
 * Trois onglets, et pourquoi les refusées n'en ont pas un.
 *
 * « En attente » est ce qui te demande quelque chose ; « Validées » est ce que tu as
 * accepté, et donc ce qui a ÉCRIT quelque part ; « Programme » est l'ÉTAT qui en
 * résulte, et qu'on vient corriger sans forcément savoir laquelle des propositions
 * l'a mis là. Il était affiché sous les deux autres : deux listes empilées dans une
 * fenêtre qui défile déjà, et on tombait dessus en cherchant autre chose.
 *
 * Une proposition refusée n'a rien écrit : il n'y a rien à relire et rien à défaire,
 * un quatrième onglet ne porterait qu'un historique.
 */
const onglet = ref<'attente' | 'validees' | 'programme'>('attente')
const validees = computed(() => v.recent.value.filter(r => r.status === 'applied'))

/**
 * Défaire, c'est appliquer l'inverse — pas effacer une ligne.
 *
 * L'inverse d'une proposition est une autre proposition (voir lib/proposals.ts) :
 * on échange « avant » et « après » et on repasse par le chemin d'application
 * habituel. Ce qui compte est ce que ça CONSERVE : `applicable()` garde la porte, et
 * comme « de » vaut maintenant ce que la proposition d'origine a écrit, le contrôle
 * devient « la donnée est-elle encore telle que je l'ai laissée ? ». Modifiée depuis,
 * on refuse de défaire plutôt que d'écraser un travail plus récent.
 */
const CLE_DEFAITES = 'gr-defaites-v1'
const defaites = ref<string[]>([])
onMounted(() => {
  try { defaites.value = JSON.parse(localStorage.getItem(CLE_DEFAITES) || '[]') }
  catch { defaites.value = [] }
})
const estDefaite = (p: RawProposal) => defaites.value.includes(p.id)

/** Ce que le bouton peut faire, et sinon pourquoi il ne peut pas. */
function retourPossible(p: RawProposal): { ok: true } | { ok: false, raison: string } {
  if (estDefaite(p)) return { ok: false, raison: 'Déjà défaite.' }
  const r = defaireProposition(p)
  if ('raison' in r) return { ok: false, raison: r.raison }
  return v.applicable(r.inverse)
    ? { ok: true }
    : { ok: false, raison: 'La donnée a changé depuis : la défaire écraserait quelque chose de plus récent.' }
}

/** Une confirmation, parce qu'un tap de trop réécrit une donnée. */
const aDefaire = ref<RawProposal | null>(null)

async function confirmerDefaire() {
  const p = aDefaire.value
  aDefaire.value = null
  if (!p) return
  const r = defaireProposition(p)
  if ('raison' in r) { emit('flash', r.raison); return }
  if (await v.apply(r.inverse, { archiver: false })) {
    defaites.value = [...defaites.value, p.id]
    try { localStorage.setItem(CLE_DEFAITES, JSON.stringify(defaites.value.slice(-200))) }
    catch { /* stockage refusé : la donnée est défaite, seule la marque manque */ }
    // Le miroir suit, mais son échec ne doit pas masquer la confirmation : la donnée
    // EST défaite, et « Session requise » à cet instant-là ferait croire le contraire.
    void v.push(buildSnapshot, true)
    emit('flash', 'Défait ✓')
  }
  else emit('flash', v.error.value ?? 'Impossible de défaire')
}

/**
 * Une semaine se relit en TABLEAU, pas en liste de clés.
 *
 * Quatorze repas affichés en « jours[3].slots.dinner = din-poulet » ne se valident
 * pas : on ne peut pas voir d'un coup d'œil qu'un plat revient trois fois ou qu'un
 * jeudi soir est vide. Le nom du plat plutôt que son identifiant, pour la même
 * raison — c'est ce qu'il mangera, pas ce que la base stocke.
 */
const { library } = useNutrition()
const DOW = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim']
const nomPlat = (id: string) => library.value.recipes[id]?.name ?? id
function semaine(p: RawProposal) {
  const w = weekFor(p, id => !!library.value.recipes[id])
  if (!w) return null
  return {
    lundi: w.lundi,
    nom: w.nom,
    lignes: w.jours.map((j, i) => ({
      jour: DOW[i],
      off: j.off,
      midi: j.slots.lunch ? nomPlat(j.slots.lunch) : '—',
      soir: j.slots.dinner ? nomPlat(j.slots.dinner) : '—',
    })),
  }
}

/**
 * La composition d'un repas hors plan, confrontée aux macros annoncées.
 *
 * C'est le seul endroit de l'application où l'on peut encore refuser sans rien
 * perdre — après validation, le repas est écrit et compte dans la journée. Alors on
 * montre l'écart ICI, avant, plutôt qu'après.
 *
 * On MONTRE, on ne bloque pas. Un écart a deux causes également plausibles : un
 * grammage estimé de travers, ou un ingrédient qui n'a pas d'identifiant dans le
 * catalogue — un gigot, un burger — et que Claude n'a donc pas pu lister. Refuser la
 * seconde au nom de la première reviendrait à interdire de décrire ce qu'on a mangé
 * dès qu'un seul ingrédient sort du plan. Le bouton « Appliquer » reste donc actif :
 * c'est une phrase de plus à lire, pas une porte fermée.
 */
function compositionLibre(p: RawProposal) {
  const plan = planFor(p, v.ctx)
  if (plan?.kind !== 'repas-libre' || !plan.repas) return null
  const ctrl = checkFreeMeal(plan.repas, library.value.foods)
  if (!ctrl) return null
  return {
    repas: plan.repas,
    lignes: (plan.repas.items ?? []).map(it => ({
      nom: library.value.foods[it.food]?.name ?? it.food,
      g: it.g,
    })),
    base: plan.repas.base ? library.value.recipes[plan.repas.base]?.name ?? plan.repas.base : null,
    ctrl,
  }
}

/**
 * Une modification de programme se relit AVANT → APRÈS, pas en JSON.
 *
 * « patch: {"sets":5,"rest":180} » ne se valide pas : pour savoir si c'est une bonne
 * idée il faut se rappeler ce qu'il y avait avant, et personne ne se rappelle qu'un
 * développé haltères était à 4 séries et 120 secondes. On affiche donc les deux
 * colonnes, et le geste en toutes lettres.
 *
 * Le cas « retirer » porte sa propre phrase, parce que c'est le seul dont l'effet
 * pourrait inquiéter : rien n'est supprimé, l'historique garde le mouvement et ses
 * records. Le dire ici évite d'hésiter au moment de valider.
 */
const prog = useProgram()
const GESTES: Record<string, string> = {
  modifier: 'Modifier', ajouter: 'Ajouter', retirer: 'Retirer', reactiver: 'Remettre', reordonner: 'Réordonner',
  'creer-seance': 'Créer la séance',
}
const MESURES: Record<string, string> = { reps: 'répétitions', temps: 'temps' }
function programme(p: RawProposal) {
  const plan = planFor(p, v.ctx)
  if (plan?.kind !== 'programme') return null
  const seance = prog.sessionById(plan.seance)
  const actuel = plan.exercice ? prog.exerciseById(plan.exercice) : null
  const lignes: { champ: string, avant: string, apres: string }[] = []
  const ligne = (champ: string, avant: string | number | undefined, apres: string | number | undefined) => {
    if (apres === undefined) return
    lignes.push({ champ, avant: avant === undefined ? '—' : String(avant), apres: String(apres) })
  }

  if (plan.op === 'modifier' && plan.patch) {
    const q = plan.patch
    ligne('Nom', actuel?.name, q.name)
    ligne('Séries', actuel?.sets, q.sets)
    ligne('Reps', actuel?.reps, q.reps)
    if (q.rest !== undefined) ligne('Repos', actuel ? fmtRest(restFor(actuel)) : undefined, fmtRest(q.rest))
    ligne('Mesure', MESURES[actuel?.mesure ?? 'reps'], q.mesure ? MESURES[q.mesure] : undefined)
    ligne('Machine', actuel?.machine || '—', q.machine === '' ? '—' : q.machine)
    ligne('Facultatif', actuel?.optionnel ? 'oui' : 'non', q.optionnel === undefined ? undefined : (q.optionnel ? 'oui' : 'non'))
    ligne('Muscles', actuel?.muscles.join(', '), q.muscles?.join(', '))
    ligne('Consignes', actuel?.cues.length ? `${actuel.cues.length} ligne(s)` : '—', q.cues ? `${q.cues.length} ligne(s)` : undefined)
  }
  if (plan.op === 'ajouter' && plan.nouveau) {
    const n = plan.nouveau
    ligne('Nom', undefined, n.name)
    ligne('Séries', undefined, n.sets)
    ligne('Reps', undefined, n.reps)
    ligne('Repos', undefined, fmtRest(restFor(n)))
    if (n.mesure) ligne('Mesure', undefined, MESURES[n.mesure])
    if (n.optionnel) ligne('Facultatif', undefined, 'oui')
    if (n.machine) ligne('Machine', undefined, n.machine)
    if (n.muscles.length) ligne('Muscles', undefined, n.muscles.join(', '))
    if (plan.apres) ligne('Placé après', undefined, prog.exerciseName(plan.apres))
  }
  /**
   * Une séance neuve se relit EN ENTIER, exercice par exercice.
   *
   * C'est le seul geste qui écrit plusieurs mouvements d'un coup : réduit à
   * « Créer · Haut du corps », il faudrait valider une liste qu'on n'a pas vue.
   * Les séries, les reps et le repos y sont pour la même raison qu'ailleurs — ce
   * sont les trois valeurs qu'on corrigerait après coup si elles étaient fausses.
   */
  const neuve = plan.op === 'creer-seance' ? plan.seanceNeuve ?? null : null
  if (neuve) {
    ligne('Identifiant', undefined, neuve.id)
    if (neuve.tag) ligne('Jour', undefined, neuve.tag)
    ligne('Exercices', undefined, String(neuve.exercises.length))
  }
  if (plan.op === 'reactiver' && plan.apres) ligne('Placé après', undefined, prog.exerciseName(plan.apres))
  /**
   * Les machines de remplacement se relisent EN ENTIER.
   *
   * La liste remplace, elle ne fusionne pas : afficher seulement ce qui change
   * cacherait justement ce qui disparaît, et c'est le seul risque du geste.
   */
  if (plan.variants) {
    const av = prog.variantsFor(plan.exercice ?? '')
    ligne('Machines', av.length ? av.map(v => `${v.name} ×${v.ratio}`).join(' · ') : '—',
      plan.variants.length ? plan.variants.map(v => `${v.name} ×${v.ratio}`).join(' · ') : '—')
  }

  return {
    geste: GESTES[plan.op] ?? plan.op,
    seance: seance?.name ?? plan.seanceNeuve?.name ?? plan.seance,
    exercice: actuel?.name ?? plan.nouveau?.name ?? plan.exercice ?? '',
    lignes,
    ordre: plan.op === 'reordonner' ? (plan.ordre ?? []).map(id => prog.exerciseName(id)) : null,
    exercices: neuve
      ? neuve.exercises.map(e => ({
          nom: e.name,
          detail: [
            e.mesure === 'temps' ? `${e.sets} × ${e.reps}` : `${e.sets} × ${e.reps} reps`,
            `repos ${fmtRest(restFor(e))}`,
            ...(e.machine ? [e.machine] : []),
            ...(e.optionnel ? ['facultatif'] : []),
          ].join(' · '),
        }))
      : null,
    note: plan.op === 'retirer'
      ? 'Sort du programme. Les séances déjà enregistrées gardent ce mouvement et ses records — rien n\'est supprimé, et on peut le remettre à sa place.'
      : (plan.op === 'reactiver' && !plan.apres
          ? 'Revient dans la séance, à sa place d\'origine.'
          : (neuve ? 'S\'ajoute au programme, après les séances existantes. Elle devient planifiable dans la semaine type, et ses exercices partent sans historique.' : '')),
  }
}

/**
 * Une écriture générique, rendue lisible.
 *
 * Valider « /nutrition/extras/2026-08-19/0 » revient à signer un pointeur JSON. La
 * phrase de résumé dit l'intention, mais c'est la carte qui doit dire le FAIT — et
 * pour une suppression, ce qui disparaît, puisque c'est le seul geste qu'on ne
 * pourra pas défaire d'un tap.
 *
 * Le chemin est traduit en mots à partir de la carte de la sauvegarde : « séance
 * n° 12 · durée » se relit, « /sessions/12/durationMin » se déchiffre.
 */
const SECTIONS: Record<string, string> = {
  logs: 'Historique de charges', bodyWeight: 'Pesées', sessions: 'Séances enregistrées',
  profile: 'Profil', weekPlan: 'Semaine type', planDays: 'Exceptions de planning',
  nutrition: 'Nutrition', withingsBody: 'Pesées Withings', restTimer: 'Minuteur de repos',
  programme: 'Programme', foyer: 'Foyer',
}
const GESTES_CHAMP: Record<string, string> = {
  remplacer: 'Remplacer', creer: 'Ajouter', ajouter: 'Ajouter à la liste', supprimer: 'Supprimer',
}
const enClair = (v: unknown): string => {
  if (v === undefined) return '—'
  if (v === null) return 'vide'
  if (typeof v === 'object') return JSON.stringify(v, null, 1).replace(/\n\s*/g, ' ').slice(0, 240)
  return String(v)
}
function champ(p: RawProposal) {
  const plan = planFor(p, v.ctx)
  if (plan?.kind !== 'correction-champ') return null
  const parts = plan.chemin.split('/').filter(Boolean)
  const snap = v.ctx.snapshot()
  return {
    geste: GESTES_CHAMP[plan.op] ?? plan.op,
    section: SECTIONS[parts[0]] ?? parts[0],
    chemin: plan.chemin,
    reste: parts.slice(1).join(' · '),
    // Sur un ajout, l'« avant » est la liste entière : la dumper noierait ce qui
    // change. On dit sa taille, ce qui suffit à situer où l'entrée atterrit.
    avant: plan.op === 'creer'
      ? '—'
      : plan.op === 'ajouter'
        ? `${(getAt(snap, plan.chemin) as unknown[] | undefined)?.length ?? 0} entrées`
        : enClair(getAt(snap, plan.chemin)),
    apres: plan.op === 'supprimer'
      ? 'supprimé'
      : plan.op === 'ajouter' ? `+ ${enClair(plan.vers)}` : enClair(plan.vers),
    danger: plan.op === 'supprimer',
  }
}

/**
 * Le programme modifié, et le chemin du retour.
 *
 * Il vivait dans les réglages, en carte séparée — c'est-à-dire à l'autre bout de
 * l'application par rapport à l'écran où l'on ACCEPTE ces modifications. Or c'est
 * le même sujet vu des deux bouts : une mauvaise idée validée d'un tap se défait
 * ici, pas dans un écran de configuration qu'on ouvre une fois par mois.
 *
 * Sans ce retour, la seule façon d'annuler était de redemander à Claude de proposer
 * l'inverse — donc de dépendre du connecteur pour réparer ce que le connecteur a
 * fait. Un geste qu'on ne peut pas défaire seul n'est pas une proposition, c'est un
 * engagement.
 *
 * Rien ne s'affiche quand rien n'a bougé : le programme livré n'a pas besoin d'être
 * annoncé, il est déjà en haut de l'accueil.
 */
const {
  custom: progCustom, exerciseName: progName,
  resetExercise, enableExercise, disableExercise, sessionById: progSession, setOrder,
} = prog

const progChanges = computed(() => {
  const c = progCustom.value
  const out: { cle: string, texte: string, defaire: () => void }[] = []
  for (const id of Object.keys(c.patches ?? {})) {
    const q = c.patches![id]
    const quoi = [
      q.sets !== undefined ? `${q.sets} séries` : '',
      q.reps !== undefined ? `${q.reps} reps` : '',
      q.rest !== undefined ? `repos ${fmtRest(q.rest)}` : '',
      q.name !== undefined ? 'nom' : '',
      q.machine !== undefined ? 'machine' : '',
      q.cues !== undefined ? 'consignes' : '',
      q.muscles !== undefined ? 'muscles' : '',
    ].filter(Boolean).join(', ')
    out.push({ cle: `p:${id}`, texte: `${progName(id)} — ${quoi}`, defaire: () => resetExercise(id) })
  }
  for (const id of c.disabled ?? []) {
    out.push({ cle: `d:${id}`, texte: `${progName(id)} — retiré du programme`, defaire: () => enableExercise(id) })
  }
  for (const [sid, ids] of Object.entries(c.order ?? {})) {
    if (!ids.length) continue
    out.push({
      cle: `o:${sid}`,
      texte: `${progSession(sid)?.name ?? sid} — ordre changé`,
      defaire: () => setOrder(sid, []),
    })
  }
  // Défaire un AJOUT, c'est le retirer — pas l'effacer. Si on a déjà chargé dessus,
  // l'effacer emporterait les séries enregistrées ; le retirer les laisse lisibles.
  for (const [sid, list] of Object.entries(c.added ?? {})) {
    for (const e of list) {
      if ((c.disabled ?? []).includes(e.id)) continue
      out.push({
        cle: `a:${e.id}`,
        texte: `${e.name} — ajouté à ${progSession(sid)?.name ?? sid}`,
        defaire: () => disableExercise(e.id),
      })
    }
  }
  return out
})
</script>

<template>
  <!-- La boîte de réception, en fenêtre posée par-dessus. On y entre quand on décide
       de s'en occuper, et on en ressort sans avoir perdu sa place dans le coffre.
       Popup porte sa propre transition : pas de `<transition>` à l'appel. -->
  <Popup
    popup-class="vt-inbox-popup"
    title="Propositions de Claude"
    :subtitle="v.pendingCount.value ? `${v.pendingCount.value} en attente · rien n'est écrit avant ta validation` : 'Rien en attente'"
    @close="emit('close')"
  >
    <template #default>
      <!-- Le même contrôle segmenté que partout ailleurs dans l'application : le
           même geste doit avoir la même forme, sinon chaque écran se réapprend. -->
      <!-- `onglets-nu` : le même contrôle segmenté que partout, sans sa piste grise.
           Posée sur le fond clair d'une fenêtre, elle dessinait un bloc de couleur en
           travers de l'en-tête — la piste sert à détacher le contrôle d'un fond
           chargé, et il n'y en a pas ici. -->
      <nav class="onglets-int onglets-nu">
        <div class="segmente" role="tablist">
          <button role="tab" :aria-selected="onglet === 'attente'" :class="{ sel: onglet === 'attente' }" @click="onglet = 'attente'">
            En attente<span v-if="v.pendingCount.value" class="mono"> · {{ v.pendingCount.value }}</span>
          </button>
          <button role="tab" :aria-selected="onglet === 'validees'" :class="{ sel: onglet === 'validees' }" @click="onglet = 'validees'">
            Validées<span v-if="validees.length" class="mono"> · {{ validees.length }}</span>
          </button>
          <button role="tab" :aria-selected="onglet === 'programme'" :class="{ sel: onglet === 'programme' }" @click="onglet = 'programme'">
            Programme<span v-if="progChanges.length" class="mono"> · {{ progChanges.length }}</span>
          </button>
        </div>
      </nav>

      <template v-if="onglet === 'programme'">
        <p v-if="!progChanges.length" class="muted vt-txt">
          Le programme est celui d'origine. Ce que tu acceptes ici et qui le modifie
          apparaîtra dans cette liste, avec de quoi le rétablir.
        </p>
        <div v-for="c in progChanges" :key="c.cle" class="row-between pg-line">
          <span>{{ c.texte }}</span>
          <button class="btn" :aria-label="`Défaire : ${c.texte}`" @click="c.defaire()">↺</button>
        </div>
        <p v-if="progChanges.length" class="muted mt-6">
          ↺ rétablit la version d'origine. Un exercice retiré reste dans les séances déjà
          enregistrées, avec ses records.
        </p>
      </template>

      <template v-else-if="onglet === 'validees'">
        <p v-if="!validees.length" class="muted vt-txt">
          Rien de validé pour l'instant. Ce que tu acceptes atterrit ici, et peut se
          défaire tant que la donnée n'a pas rebougé depuis.
        </p>
        <div v-for="p in validees" :key="p.id" class="vt-prop" :class="{ faite: estDefaite(p) }">
          <div class="vt-p-sum">{{ p.summary }}</div>
          <div class="vt-p-meta mono muted">
            {{ p.action }} · {{ new Date(p.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) }}
          </div>
          <div class="nav-row">
            <button
              class="btn flex-1" :disabled="!retourPossible(p).ok"
              @click="aDefaire = p"
            >↺ Défaire</button>
          </div>
          <p v-if="!retourPossible(p).ok" class="muted vt-p-manual">
            {{ (retourPossible(p) as { raison: string }).raison }}
          </p>
        </div>
      </template>

      <template v-else>
      <p v-if="!v.pending.value.length" class="muted vt-txt">
        Rien en attente. Ce que Claude propose depuis une conversation atterrit ici, et
        <b>rien n’est écrit</b> avant que tu valides.
      </p>
      <div v-for="p in v.pending.value" :key="p.id" class="vt-prop">
        <div class="vt-p-sum">{{ p.summary }}</div>
        <div class="vt-p-meta mono muted">
          {{ p.action }} · {{ new Date(p.at).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }) }}
        </div>
        <!-- Une composition s'affiche d'office, comme une semaine : c'est ce qu'on
             valide. La lire en JSON dans « voir le détail » ne permet pas de repérer
             qu'un grammage a un zéro de trop. -->
        <div v-if="compositionLibre(p)" class="vt-libre">
          <div v-if="compositionLibre(p)!.base" class="vt-libre-base">
            variante de <b>{{ compositionLibre(p)!.base }}</b> · le plat du catalogue ne bouge pas
          </div>
          <table class="vt-libre-t">
            <tbody>
              <tr v-for="(l, i) in compositionLibre(p)!.lignes" :key="i">
                <th>{{ l.nom }}</th><td class="mono">{{ l.g }} g</td>
              </tr>
            </tbody>
          </table>
          <p v-if="compositionLibre(p)!.ctrl.notable" class="vt-libre-ecart">
            ⚠️ Ces ingrédients donnent <b>{{ Math.round(compositionLibre(p)!.ctrl.calcule.kcal) }} kcal</b>,
            la proposition en annonce <b>{{ Math.round(compositionLibre(p)!.ctrl.saisi.kcal) }}</b>
            ({{ compositionLibre(p)!.ctrl.ecartPct > 0 ? '+' : '' }}{{ compositionLibre(p)!.ctrl.ecartPct }} %).
            Normal si un ingrédient n'est pas dans le catalogue ; à vérifier sinon.
            Ce sont les chiffres annoncés qui seront enregistrés.
          </p>
        </div>
        <!-- Une semaine s'affiche d'office : c'est le contenu qu'on valide, pas un détail. -->
        <table v-if="semaine(p)" class="vt-week">
          <caption class="mono">{{ semaine(p)!.nom }} · à partir du {{ semaine(p)!.lundi }}</caption>
          <tbody>
            <tr v-for="l in semaine(p)!.lignes" :key="l.jour" :class="{ off: l.off }">
              <th class="mono">{{ l.jour }}</th>
              <td v-if="l.off" colspan="2" class="vt-w-off">absent</td>
              <template v-else><td>{{ l.midi }}</td><td>{{ l.soir }}</td></template>
            </tr>
          </tbody>
        </table>
        <!-- Une modification de programme aussi : c'est le contenu qu'on valide. -->
        <div v-if="programme(p)" class="vt-prog">
          <div class="vt-prog-h mono">
            {{ programme(p)!.geste }} · {{ programme(p)!.seance }}
            <b v-if="programme(p)!.exercice"> · {{ programme(p)!.exercice }}</b>
          </div>
          <table v-if="programme(p)!.lignes.length" class="vt-prog-t">
            <thead><tr><th /><th class="vt-prog-av">avant</th><th>après</th></tr></thead>
            <tbody>
              <tr v-for="l in programme(p)!.lignes" :key="l.champ">
                <th>{{ l.champ }}</th>
                <td class="vt-prog-av">{{ l.avant }}</td>
                <td><b>{{ l.apres }}</b></td>
              </tr>
            </tbody>
          </table>
          <ol v-if="programme(p)!.ordre" class="vt-prog-o">
            <li v-for="(n, i) in programme(p)!.ordre" :key="i">{{ n }}</li>
          </ol>
          <ol v-if="programme(p)!.exercices" class="vt-prog-o">
            <li v-for="(e, i) in programme(p)!.exercices" :key="i">
              {{ e.nom }}<span class="vt-prog-d">{{ e.detail }}</span>
            </li>
          </ol>
          <p v-if="programme(p)!.note" class="vt-prog-n">{{ programme(p)!.note }}</p>
        </div>
        <!-- Une écriture générique : le chemin en mots, et ce qui change. -->
        <div v-if="champ(p)" class="vt-prog" :class="{ danger: champ(p)!.danger }">
          <div class="vt-prog-h mono">
            {{ champ(p)!.geste }} · {{ champ(p)!.section }}
            <b v-if="champ(p)!.reste"> · {{ champ(p)!.reste }}</b>
          </div>
          <table class="vt-prog-t">
            <thead><tr><th /><th class="vt-prog-av">avant</th><th>après</th></tr></thead>
            <tbody>
              <tr>
                <th>Valeur</th>
                <td class="vt-prog-av">{{ champ(p)!.avant }}</td>
                <td><b>{{ champ(p)!.apres }}</b></td>
              </tr>
            </tbody>
          </table>
          <p v-if="champ(p)!.danger" class="vt-prog-n">
            ⚠️ Suppression définitive. La valeur de gauche est ce qui disparaît.
          </p>
        </div>
        <button class="vt-p-toggle" @click="showDetail = showDetail === p.id ? null : p.id">
          {{ showDetail === p.id ? '▲ Masquer le détail' : '▼ Voir le détail' }}
        </button>
        <dl v-if="showDetail === p.id" class="vt-p-detail mono">
          <template v-for="l in detailLines(p)" :key="l.label">
            <dt>{{ l.label }}</dt><dd>{{ l.value }}</dd>
          </template>
        </dl>
        <!--
          Ce message était le symptôme d'un manque : une cinquantaine de gestes que
          l'app savait faire et qu'aucune proposition ne pouvait déclencher. Il ne
          reste plus qu'une raison de le voir — une proposition dont la valeur de
          départ ne correspond plus, parce qu'on a changé la donnée entre-temps sur le
          téléphone. Ce n'est pas « à faire à la main », c'est « à reproposer », et le
          message doit le dire, sinon on refait le travail soi-même pour rien.
        -->
        <p v-if="!applicable(p)" class="vt-p-manual">
          ⏳ Cette proposition n'est plus applicable : la valeur qu'elle remplace a changé
                    depuis. Redemande-la à Claude, il repartira de la valeur à jour.
        </p>
        <div class="nav-row">
          <button v-if="applicable(p)" class="btn-primary flex-1" @click="doApply(p)">Appliquer</button>
          <button class="btn flex-1" @click="doRefuse(p)">{{ applicable(p) ? 'Refuser' : 'Écarter' }}</button>
        </div>
      </div>

      </template>


    </template>
  </Popup>

  <!--
    La confirmation, contre le tap de trop.

    Défaire réécrit une donnée : c'est aussi engageant qu'appliquer, et le bouton est
    à quelques pixels de « Voir le détail ». Le confirme natif du navigateur aurait
    fait l'affaire, mais il bloque tout le fil d'exécution et sort du dessin de
    l'application — la même boîte que « annuler la séance en cours », donc.
  -->
  <transition name="pop">
    <div v-if="aDefaire" class="confirm-overlay au-dessus" @click.self="aDefaire = null">
      <div class="confirm-box">
        <div class="confirm-emoji" aria-hidden="true">↺</div>
        <div class="confirm-title">Défaire cette validation ?</div>
        <div class="confirm-text">
          « {{ aDefaire.summary }} » — la donnée revient à ce qu'elle était avant.
        </div>
        <div class="confirm-actions">
          <button class="btn confirm-keep" @click="aDefaire = null">Garder</button>
          <button class="confirm-yes" @click="confirmerDefaire">Défaire</button>
        </div>
      </div>
    </div>
  </transition>
</template>
