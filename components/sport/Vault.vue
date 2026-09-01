<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useVault } from '~/composables/useVault'
import { detailLines, planFor, weekFor } from '~/lib/proposals'
import { getAt } from '~/lib/pointer'
import { checkFreeMeal } from '~/lib/freeMeal'
import type { RawProposal } from '~/lib/proposals'
import { useNutrition } from '~/composables/useNutrition'
import { useProgram } from '~/composables/useProgram'
import { fmtRest, restFor } from '~/lib/rest'

/**
 * Le connecteur, vu du téléphone.
 *
 * Trois états, dans cet ordre : pas de passkey → en poser un ; passkey mais pas de
 * session → se déverrouiller ; session → l'état du miroir et la boîte de réception
 * des propositions.
 *
 * Le point délicat est la validation. Une proposition n'est PAS un message : c'est
 * une écriture en attente sur des données qui pilotent des calories et une
 * progression. On montre donc la phrase, le détail brut, et on dit clairement
 * quand l'application ne sait pas l'appliquer toute seule — auquel cas le bouton
 * ne prétend rien faire, il note simplement que c'est réglé.
 */
const props = defineProps<{ snapshot: () => Record<string, unknown> }>()
const emit = defineEmits<{ flash: [msg: string] }>()

const v = useVault()
const bootstrap = ref('')
const labelSecours = ref('')

/**
 * La liste des appareils, jamais indéfinie.
 *
 * `/api/auth/me` peut répondre une forme ANTÉRIEURE — pendant un déploiement, le
 * temps que les fonctions basculent, ou depuis une page restée ouverte. Un
 * `undefined.length` dans un gabarit ne se rattrape pas : tout l'écran disparaît,
 * y compris le bouton qui aurait permis de recharger.
 */
const appareils = computed(() => v.state.value.appareils ?? [])

/** Un passkey de plus, depuis l'appareil qu'on veut autoriser. */
async function doSecours() {
  if (await v.ajouterSecours(labelSecours.value.trim())) {
    labelSecours.value = ''
    emit('flash', 'Clé d’accès ajoutée ✓')
  }
}
const showDetail = ref<string | null>(null)
const showReset = ref(false)
/** La boîte de réception s'ouvre en carte : voir le commentaire du bouton. */
const inbox = ref(false)

/**
 * Le diagnostic du serveur, affiché tant que tout n'est pas en place.
 *
 * Une variable d'environnement oubliée se manifestait par « Aucun passkey » —
 * c'est-à-dire exactement ce qu'affiche une installation saine où l'on n'a encore
 * rien fait. On cherchait donc côté navigateur un problème qui était côté serveur.
 */
interface Health {
  pret: boolean
  env: Record<string, boolean>
  bootstrap?: { longueur: number, espaces_parasites: boolean }
  store: string
  driver: string
  miroir?: { pousse_le: string, seances: number, pesees: number } | null
  propositions_en_attente?: number
}
const health = ref<Health | null>(null)

onMounted(async () => {
  await v.hydrate()
  try { health.value = await $fetch<Health>('/api/vault/health') }
  catch { health.value = null }
})

const manquantes = computed(() =>
  Object.entries(health.value?.env ?? {}).filter(([, ok]) => !ok).map(([k]) => k))

async function doReset() {
  try {
    await $fetch('/api/auth/reset', { method: 'POST', body: { bootstrap: bootstrap.value.trim() } })
    bootstrap.value = ''
    showReset.value = false
    await v.refresh()
    emit('flash', 'Clés d’accès effacées')
  }
  catch { emit('flash', 'Code de démarrage invalide') }
}

const statut = computed(() => {
  if (!v.state.value.registered) return 'a-poser'
  return v.state.value.connected ? 'ouvert' : 'verrouille'
})

const miroirLabel = computed(() => {
  if (!v.mirrorAt.value) return 'jamais envoyé'
  const d = new Date(v.mirrorAt.value)
  const min = Math.round((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'à l’instant'
  if (min < 60) return `il y a ${min} min`
  const h = Math.round(min / 60)
  return h < 36 ? `il y a ${h} h` : `le ${d.toLocaleDateString('fr-FR')}`
})

const applicable = (p: RawProposal) => v.applicable(p)

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
  programme: 'Programme',
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
 * Un code refusé ne dit rien tout seul.
 *
 * « 403 » laisse chercher entre une faute de frappe, un remplissage automatique du
 * navigateur et un retour à la ligne collé dans la variable Netlify. Comparer les
 * deux LONGUEURS tranche en une seconde, et ne révèle rien du code.
 */
const indice = computed(() => {
  const b = health.value?.bootstrap
  if (!b || !b.longueur) return ''
  const tape = bootstrap.value.trim().length
  if (b.espaces_parasites) return `⚠️ La variable Netlify contient un espace ou un retour à la ligne parasite — retire-le.`
  if (!tape) return `Le serveur attend un code de ${b.longueur} caractères.`
  if (tape !== b.longueur) return `Tu tapes ${tape} caractères, le serveur en attend ${b.longueur}.`
  return `${tape} caractères des deux côtés : la longueur correspond.`
})

const nom = ref('')
async function doRegister() {
  if (await v.register(bootstrap.value.trim(), nom.value.trim())) {
    bootstrap.value = ''
    emit('flash', 'Clé d’accès créée ✓')
    await v.push(props.snapshot, true)
  }
}
/** Renommer après coup : le nom se corrige sans redéployer ni retoucher au passkey. */
const renommage = ref(false)
const nouveauNom = ref('')
async function doRename() {
  if (await v.rename(nouveauNom.value.trim())) {
    renommage.value = false
    emit('flash', 'Nom mis à jour ✓')
  }
  else emit('flash', v.error.value ?? 'Échec')
}
async function doLogin() {
  if (await v.login()) emit('flash', 'Déverrouillé ✓')
}
async function doPush() {
  emit('flash', (await v.push(props.snapshot, true)) ? 'Données envoyées ✓' : (v.error.value ?? 'Envoi impossible'))
}
async function doApply(p: RawProposal) {
  if (await v.apply(p)) { emit('flash', 'Appliqué ✓'); await v.push(props.snapshot, true) }
  else emit('flash', v.error.value ?? 'Échec')
}
async function doRefuse(p: RawProposal) {
  if (await v.resolve(p, 'refused')) emit('flash', 'Refusé')
}
</script>

<template>
  <div class="card">
    <div class="row-between mb-8">
      <div class="section-label">Connecteur Claude</div>
      <span class="muted" :class="{ 'export-warn': statut !== 'ouvert' }">
        {{ statut === 'ouvert' ? 'Déverrouillé' : statut === 'verrouille' ? 'Verrouillé' : 'À configurer' }}
      </span>
    </div>

    <!-- À qui appartient cette instance. Visible une fois déverrouillé seulement :
         sur une page publique, ce serait donner un nom à un inconnu. -->
    <div v-if="statut === 'ouvert'" class="vt-owner">
      <template v-if="!renommage">
        <span class="muted">Compte de <b>{{ v.state.value.ownerName || 'sans nom' }}</b></span>
        <button class="vt-p-toggle" @click="nouveauNom = v.state.value.ownerName || ''; renommage = true">renommer</button>
      </template>
      <template v-else>
        <input v-model="nouveauNom" class="note-input" type="text" placeholder="Ton prénom" maxlength="40">
        <div class="nav-row mt-6">
          <button class="btn-primary flex-1" :disabled="v.busy.value" @click="doRename">Enregistrer</button>
          <button class="btn flex-1" @click="renommage = false">Annuler</button>
        </div>
        <p class="muted vt-txt">
          Ce nom apparaît à la demande de clé d'accès et dans les réponses de Claude.
        </p>
      </template>
    </div>

    <!-- Ce qui manque côté serveur, dit avant qu'on cherche ailleurs -->
    <div v-if="health && !health.pret" class="vt-warn">
      <b>Serveur incomplet.</b>
                <template v-if="manquantes.length">
                  Variables manquantes chez l'hébergeur : <b>{{ manquantes.join(', ') }}</b>.
                </template>
      <template v-if="health.store !== 'ok'">
        Stockage ({{ health.driver }}) : {{ health.store }}.
      </template>
    </div>

    <!-- Le serveur va bien mais n'a rien à lire.
         C'est le manque qui se diagnostique le plus mal : côté conversation, Claude
         dit « je n'ai pas accès à tes données », ce qui se lit comme une panne du
         connecteur. Vu d'ici, c'est un bouton à presser une fois. -->
    <div v-else-if="health && health.pret && health.miroir === null" class="vt-warn">
      <b>Aucune donnée envoyée.</b> Claude ne pourra rien lire tant que la copie n'a pas été
              transmise : déverrouille, puis touche <b>⬆ Envoyer maintenant</b>.
    </div>

    <!-- 1. Poser le premier passkey -->
    <template v-if="statut === 'a-poser'">
      <p class="muted vt-txt">
        Crée une clé d'accès pour autoriser Claude à lire tes données. Le code de démarrage
                ne sert qu'une fois ; les clés suivantes s'ajoutent depuis cet écran, sans code.
      </p>
      <p v-if="v.state.value.bootstrapSource !== 'env'" class="muted vt-txt">
        <b>Où le trouver :</b> dans le journal du dernier déploiement, à la ligne
                « Code de démarrage de ce déploiement ». Il est renouvelé à chaque déploiement.
      </p>
      <p v-else class="muted vt-txt">
        <b>Où le trouver :</b> c'est la valeur de <b>NUXT_VAULT_BOOTSTRAP</b>, dans les
                variables de ton hébergeur.
      </p>
      <div v-if="!v.state.value.bootstrapReady" class="vt-warn">
        ⚠️ Le code de démarrage a déjà servi. Relance un déploiement pour en obtenir un
                  nouveau.
      </div>
      <template v-else>
        <!-- Le prénom est demandé ICI, et pas dans une variable d'hébergement : c'est
             le moment où l'on déclare que cette instance est la sienne, et la fenêtre
             du système va l'afficher dans la seconde qui suit. -->
        <input v-model="nom" class="note-input mt-6" type="text" placeholder="Prénom (facultatif)" autocomplete="given-name" maxlength="40">
        <input v-model="bootstrap" class="note-input mono mt-6" type="text" inputmode="text" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Code de démarrage">
        <p v-if="indice" class="muted vt-hint mono">{{ indice }}</p>
        <button class="btn-primary vt-go mt-6" :disabled="v.busy.value || !bootstrap.trim()" @click="doRegister">
          🔐 Créer une clé d'accès
        </button>
        <p class="muted vt-txt">
          Ton appareil demandera ensuite ton empreinte, ton visage ou ton code de
                    déverrouillage.
        </p>
      </template>
    </template>

    <!-- 2. Se déverrouiller -->
    <template v-else-if="statut === 'verrouille'">
      <p class="muted vt-txt">
        Déverrouille pour envoyer tes données et relever les propositions de Claude.
      </p>
      <button class="btn-primary vt-go mt-6" :disabled="v.busy.value" @click="doLogin">
        🔓 Déverrouiller
      </button>
    </template>

    <!-- 3. Ouvert -->
    <template v-else>
      <div class="row-between vt-row">
        <span class="muted">Copie des données</span>
        <span class="mono">{{ miroirLabel }}</span>
      </div>
      <p class="muted vt-txt">
        Copie de tes données que Claude peut lire. Elle sert aussi de sauvegarde.
      </p>
      <div class="nav-row mt-6">
        <button class="btn flex-1" :disabled="v.busy.value" @click="doPush">⬆ Envoyer maintenant</button>
        <button class="btn flex-1" @click="v.loadPending()">↻ Relever</button>
        <button class="btn flex-1" @click="v.logout()">Verrouiller</button>
      </div>
      <!-- Le double des clés, et c'est un PASSKEY, plus un mot de passe.
           Tant qu'il n'y en avait qu'un, perdre son téléphone imposait de garder
           valide pour toujours un code capable de tout rouvrir. Le second passkey
           supprime ce besoin : le code de démarrage redevient un code d'installation. -->
      <div class="vt-keys mt-6">
        <div class="row-between">
          <span class="muted">Appareils autorisés</span>
          <span class="mono">{{ appareils.length || v.state.value.passkeys || 1 }}</span>
        </div>
        <ul v-if="appareils.length" class="vt-keys-l">
          <li v-for="a in appareils" :key="a.id">
            <span>{{ a.label || 'Appareil' }} <small class="muted mono">· {{ a.at.slice(0, 10) }}</small></span>
            <button
              v-if="appareils.length > 1"
              class="vt-p-toggle"
              :disabled="v.busy.value"
              @click="v.revoquer(a.id)"
            >retirer</button>
          </li>
        </ul>
        <div v-if="appareils.length < 2" class="vt-warn mt-6">
          <b>Un seul appareil autorisé.</b> Le perdre coûterait un passage par l'hébergeur pour
                    revenir. Ajoute une clé d'accès depuis un autre appareil.
        </div>
        <input v-model="labelSecours" class="note-input mt-6" type="text" placeholder="Nom de l'appareil" maxlength="30">
        <button class="btn vt-go mt-6" :disabled="v.busy.value" @click="doSecours">
          ➕ Ajouter une clé d'accès
        </button>
        <p class="muted vt-txt">
          À faire depuis l'appareil à autoriser. Aucun code n'est demandé.
        </p>
      </div>

      <!-- Le dernier recours, quand TOUS les passkeys sont perdus. -->
      <button class="vt-p-toggle mt-6" @click="showReset = !showReset">
        {{ showReset ? '▲ Annuler' : 'Tout perdu ? Repartir de zéro' }}
      </button>
      <template v-if="showReset">
        <p class="muted vt-txt">
          Efface toutes les clés d'accès pour pouvoir en recréer une. Il faut le code du
                    dernier déploiement, lisible dans son journal.
        </p>
        <input v-model="bootstrap" class="note-input mono mt-6" type="text" inputmode="text" autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false" placeholder="Code du dernier déploiement">
        <button class="btn mt-6 vt-go" :disabled="!bootstrap.trim()" @click="doReset">🗝 Effacer les clés d'accès</button>
      </template>

      <!-- Boîte de réception : un BOUTON, pas une liste dépliée.
           Ce qu'on veut savoir en passant sur cet écran, c'est « y a-t-il quelque
           chose à valider ». La liste elle-même se lit à un moment choisi : elle
           tient plusieurs écrans dès qu'une semaine de menus s'y trouve, et elle
           poussait tout le reste du coffre — dont le bouton d'envoi du miroir —
           hors de vue. -->
      <button class="vt-inbox" :class="{ some: v.pendingCount.value }" @click="inbox = true">
        <span class="vt-inbox-txt">
          <b>Propositions de Claude</b>
          <small>{{ v.pendingCount.value
            ? `${v.pendingCount.value} en attente de ta validation`
            : (v.recent.value.length ? 'Rien en attente · voir les dernières décisions' : 'Rien en attente') }}</small>
        </span>
        <span v-if="v.pendingCount.value" class="mono vt-inbox-n">{{ v.pendingCount.value }}</span>
        <span class="vt-inbox-go" aria-hidden="true">→</span>
      </button>
    </template>

    <p v-if="v.error.value" class="vt-warn mt-6">{{ v.error.value }}</p>
  </div>

  <!-- La boîte de réception, en fenêtre posée par-dessus. On y entre quand on décide
       de s'en occuper, et on en ressort sans avoir perdu sa place dans le coffre.
       Popup porte sa propre transition : pas de `<transition>` à l'appel. -->
  <Popup
    v-if="inbox"
    popup-class="vt-inbox-popup"
    title="Propositions de Claude"
    :subtitle="v.pendingCount.value ? `${v.pendingCount.value} en attente · rien n'est écrit avant ta validation` : 'Rien en attente'"
    @close="inbox = false"
  >
    <template #default>
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

      <div v-if="v.recent.value.length" class="vt-recent muted">
        Dernières décisions :
        <span v-for="r in v.recent.value" :key="r.id" class="vt-r">
          {{ r.status === 'applied' ? '✓' : '✕' }} {{ r.summary }}
        </span>
      </div>
    </template>
  </Popup>
</template>
