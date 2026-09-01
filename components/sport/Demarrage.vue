<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useDemarrage } from '~/composables/useDemarrage'
import type { EtapeId } from '~/composables/useDemarrage'
import { useProfile } from '~/composables/useProfile'
import { useRestauration, phraseBilan } from '~/composables/useRestauration'
import { useVault } from '~/composables/useVault'
import { useWorkout } from '~/composables/useWorkout'

/**
 * Le premier écran : ce qu'il faut avoir posé pour que l'application dise vrai.
 *
 * Il proposait deux boutons — faire remplir par Claude, ou charger l'exemple. Ils
 * règlent le CONTENU et laissent de côté tout ce dont les calculs dépendent. Sans
 * taille, sexe et année de naissance, il n'y a pas de métabolisme de base, donc pas
 * de cible calorique : l'application en affichait une quand même, fausse, sans le
 * dire. Une cible trop haute ne se remarque pas — elle se mange.
 *
 * D'où un parcours, et une seule étape qui barre la route. Les trois autres sont des
 * invitations : brancher Claude, brancher une balance, remplir le programme. On peut
 * s'en passer et se servir de l'application, ce qui n'est pas vrai du profil.
 */
const emit = defineEmits<{ flash: [msg: string, ton?: 'ok' | 'echec'] }>()
/** Les messages des composants enfants passent par le même bandeau, ton compris. */
function relayer(msg: string, ton?: 'ok' | 'echec') { emit('flash', msg, ton) }

const d = useDemarrage()
const { profile, setPrenom, setHeight, setSex, setBirthYear } = useProfile()
const { addBodyWeight } = useWorkout()
const v = useVault()

/**
 * L'étape ouverte : posée UNE FOIS, puis pilotée par l'utilisateur.
 *
 * Elle se calculait en continu — « la première non réglée ». Résultat : en tapant le
 * dernier chiffre de son poids, l'étape se refermait sous les doigts et la suivante
 * s'ouvrait à sa place. L'écran bougeait pendant la frappe, sans que rien ne l'ait
 * demandé, et le bouton « Continuer » disparaissait avant d'avoir servi.
 *
 * Elle se pose donc dès que l'état est connu — l'hydratation du profil se fait dans
 * la coque, donc pas forcément avant ce composant — et ne bouge plus ensuite que sur
 * un geste : un en-tête, ou « Continuer ».
 */
const ouverte = ref<EtapeId | null>(null)
let posee = false
watch(() => d.restantes.value[0]?.id ?? null, (premiere) => {
  if (posee || !premiere) return
  ouverte.value = premiere
  posee = true
}, { immediate: true })
/**
 * On ne passe pas devant une étape bloquante inachevée.
 *
 * Revenir en arrière reste libre — corriger sa taille après coup est normal. C'est
 * l'inverse qui ne l'est pas : ouvrir « Remplir » avec un profil vide donne un
 * programme dont les calories seront fausses, et rien à l'écran ne relierait la
 * cause à l'effet.
 */
function accessible(id: EtapeId): boolean {
  const liste = d.etapes.value
  const i = liste.findIndex(e => e.id === id)
  return !liste.some((e, j) => j < i && e.bloquante && !e.faite)
}
function basculer(id: EtapeId) {
  if (!accessible(id)) return
  ouverte.value = ouverte.value === id ? null : id
}
/** Ouvre la suivante — le geste normal quand une étape vient d'être remplie. */
function suivante(id: EtapeId) {
  const liste = d.etapes.value
  ouverte.value = liste[liste.findIndex(e => e.id === id) + 1]?.id ?? null
}

onMounted(() => { d.hydrate(); void chargerSante() })

// ─── 1. Toi ──────────────────────────────────────────────────────────────────
/**
 * Chaque champ s'enregistre en le QUITTANT, sans bouton.
 *
 * Le poids en avait un — « Enregistrer ce poids » — et les trois autres n'en avaient
 * pas. Un formulaire où trois valeurs sur quatre se rangent toutes seules et la
 * quatrième attend un bouton est un formulaire qu'on quitte en croyant l'avoir
 * rempli. Ce bouton ne confirmait rien et ne validait rien : il rattrapait une
 * incohérence qu'il valait mieux supprimer.
 */
const { currentWeight } = useWorkout()

function poserPoids(v: string) {
  if (!String(v).trim()) return
  // `String(...)` d'abord : Vue convertit tout seul la valeur d'un `<input
  // type="number">`, et `.replace` sur un nombre casse la fonction entière.
  const kg = parseFloat(String(v).replace(',', '.'))
  if (!kg || kg < 25 || kg > 350) { emit('flash', 'Poids invalide : entre 25 et 350 kg', 'echec'); return }
  addBodyWeight(kg)
}

/**
 * Ce qui manque, nommé.
 *
 * « Continuer » grisé sans un mot est une porte fermée sans écriteau : on remonte
 * l'écran à la recherche du champ oublié. La liste coûte quatre comparaisons qu'on
 * faisait déjà pour savoir si l'étape est finie.
 */
const manqueProfil = computed(() => [
  profile.value.sex ? null : 'le sexe',
  profile.value.heightCm ? null : 'la taille',
  profile.value.birthYear ? null : 'l’année de naissance',
  currentWeight.value ? null : 'le poids',
].filter(Boolean) as string[])

// ─── 2. Claude ───────────────────────────────────────────────────────────────
/**
 * L'état du serveur, dit ICI plutôt que laissé à deviner.
 *
 * Une variable oubliée se manifestait par « Aucun passkey » — c'est-à-dire par ce
 * qu'affiche une installation parfaitement saine où l'on n'a rien fait. On cherchait
 * donc côté navigateur un problème qui était côté serveur.
 */
interface Sante {
  pret: boolean
  env: Record<string, boolean>
  store: string
  driver: string
}
const sante = ref<Sante | null>(null)
async function chargerSante() {
  try { sante.value = await $fetch<Sante>('/api/vault/health') }
  catch { sante.value = null }
}
const manquantes = computed(() => Object.entries(sante.value?.env ?? {}).filter(([, ok]) => !ok).map(([k]) => k))

const codeDemarrage = ref('')
/**
 * Le résultat s'affiche DANS l'étape, pas seulement en haut de page.
 *
 * Le bandeau de message vit dans la coque, tout en haut. Quand on pose son passkey,
 * on est en bas d'un formulaire déroulé : il apparaît hors de l'écran, disparaît au
 * bout de six secondes, et le bouton reste là, identique. On ne sait ni si ça a
 * marché, ni pourquoi non — ce qui est exactement ce qu'on vient de me décrire.
 */
const echecPasskey = ref('')
async function poserPasskey() {
  echecPasskey.value = ''
  if (await v.register(codeDemarrage.value.trim(), profile.value.prenom || '')) {
    codeDemarrage.value = ''
    emit('flash', 'Clé d’accès créée ✓')
    void chargerSante()
  }
  else {
    echecPasskey.value = v.error.value ?? 'Enregistrement refusé.'
    emit('flash', echecPasskey.value, 'echec')
  }
}

/**
 * En local, TOUT est différent, et rien ne le dit.
 *
 * Un passkey est lié au DOMAINE : celui posé sur le site en ligne ne vaut rien sur
 * `localhost`, et le coffre local est un dossier vide. Il faut donc en poser un
 * second, avec le code imprimé par `npm run dev` — pas celui de Netlify. Sans cette
 * phrase, on essaie son passkey, le navigateur n'en propose aucun, et on conclut
 * que l'application est cassée.
 */
const enLocal = computed(() => import.meta.client && /^(localhost|127\.|\[::1\])/.test(location.hostname))

const hote = computed(() => (import.meta.client ? location.host : ''))
const urlConnecteur = computed(() => (import.meta.client ? `${location.origin}/api/mcp` : '/api/mcp'))
const copie = ref(false)
async function copierUrl() {
  try {
    await navigator.clipboard.writeText(urlConnecteur.value)
    copie.value = true
    setTimeout(() => { copie.value = false }, 2500)
  }
  catch { emit('flash', 'Copie impossible. Sélectionne l’adresse manuellement.', 'echec') }
}

// ─── 3. Connecteurs ──────────────────────────────────────────────────────────
// La liste est celle des réglages, en version compacte : voir SportSources. Deux
// listes de marques auraient divergé au premier ajout, et c'est celle du parcours —
// vue une fois, à l'installation — qui serait restée en arrière.

// ─── 4. Remplir ──────────────────────────────────────────────────────────────
const PROMPT = `Tu as accès à mon application de suivi sportif et nutritionnel par le connecteur « Damn Claude ». Elle est VIDE : aucune séance, aucun aliment, aucune recette, aucun menu.

Aide-moi à la remplir, dans cet ordre — chaque étape a besoin de la précédente.

1. Le programme. Demande-moi combien de séances par semaine, le matériel dont je dispose, mon niveau et mon objectif. Puis crée les séances UNE PAR UNE : cible « programme », op « creer-seance ». Chaque exercice veut un nom, des séries, une fourchette de reps et un repos en secondes.

2. La semaine type. Une fois les séances créées, place-les avec la cible « semaine-type » ({ seances: [...7 entrées, lundi en premier] }), et demande-moi mes jours de télétravail.

3. Les aliments. Demande-moi ce que je mange vraiment. Dépose-les un par un avec la cible « aliment » : valeurs pour 100 g, viandes et féculents crus.

4. Les recettes. Compose mes plats à partir de ces aliments — cible « recette » : petit-déjeuner, boîtes du midi, dîners, collations.

5. Les menus. Range les plats dans une semaine avec la cible « semaine », puis cale les créneaux fixes (petit-déjeuner, collations, avant de dormir) avec « semaine-type » et son champ « slots ».

Deux règles : n'invente aucune valeur que je n'aie confirmée, et attends que j'aie validé une étape avant de passer à la suivante. Chaque proposition arrive dans ma boîte de réception — rien n'est écrit tant que je n'ai pas appuyé sur « Appliquer ».`

const copiePrompt = ref(false)
async function copierPrompt() {
  try {
    await navigator.clipboard.writeText(PROMPT)
    copiePrompt.value = true
    setTimeout(() => { copiePrompt.value = false }, 2500)
  }
  catch { emit('flash', 'Copie impossible. Sélectionne le texte manuellement.', 'echec') }
}

const { chargerExemple } = useRestauration()
const enCours = ref(false)
async function charger() {
  if (enCours.value) return
  enCours.value = true
  const b = await chargerExemple()
  enCours.value = false
  emit('flash', phraseBilan(b), b.ok ? 'ok' : 'echec')
}
</script>

<template>
  <div class="stack">
    <div class="card dem-hero">
      <h2 class="dem-t">{{ d.bloque.value ? 'Configuration' : 'Presque prêt' }}</h2>
      <p class="dem-p">
        <template v-if="d.bloque.value">
          Quelques réglages avant de commencer. Seul le profil est obligatoire.
        </template>
        <template v-else>
          Encore {{ d.restantes.value.length }} étape<template v-if="d.restantes.value.length > 1">s</template>,
          toutes facultatives.
        </template>
      </p>
      <div class="dem-bar" :aria-label="`${d.progression.value} sur 4`">
        <span v-for="e in d.etapes.value" :key="e.id" :class="{ ok: e.reglee }"></span>
      </div>
    </div>

    <div class="card dem-steps">
      <div v-for="(e, i) in d.etapes.value" :key="e.id" class="dem-step" :class="{ open: ouverte === e.id, done: e.reglee }">
        <button class="dem-head" :disabled="!accessible(e.id)" @click="basculer(e.id)">
          <span class="dem-n" :class="{ ok: e.faite, skip: !e.faite && e.passee }">{{ e.faite ? '✓' : (e.passee ? '–' : i + 1) }}</span>
          <span class="dem-txt">
            <b>{{ e.titre }}</b>
            <small>{{ e.sous }}</small>
          </span>
          <span class="dem-chev" aria-hidden="true">{{ ouverte === e.id ? '▴' : '▾' }}</span>
        </button>

        <div v-if="ouverte === e.id" class="dem-body">
          <!-- 1. Toi -->
          <template v-if="e.id === 'toi'">
            <p class="dem-p">
              Ces valeurs servent à calculer ta dépense énergétique et tes objectifs.
            </p>
            <label class="field"><span>Prénom</span>
              <input :value="profile.prenom ?? ''" type="text" maxlength="40" placeholder="Prénom" autocomplete="given-name" @change="setPrenom(($event.target as HTMLInputElement).value)"></label>
            <div class="field">
              <span>Sexe</span>
              <div class="segmente" role="group">
                <button :class="{ sel: profile.sex === 'h' }" @click="setSex('h')">Homme</button>
                <button :class="{ sel: profile.sex === 'f' }" @click="setSex('f')">Femme</button>
              </div>
            </div>
            <label class="field"><span>Taille (cm)</span>
              <input :value="profile.heightCm ?? ''" type="number" inputmode="numeric" placeholder="ex. 180" @change="setHeight(parseFloat(($event.target as HTMLInputElement).value) || null)"></label>
            <label class="field"><span>Année de naissance</span>
              <input :value="profile.birthYear ?? ''" type="number" inputmode="numeric" placeholder="ex. 1998" @change="setBirthYear(parseInt(($event.target as HTMLInputElement).value, 10) || null)"></label>
            <label class="field"><span>Poids du jour (kg)</span>
              <input :value="currentWeight ?? ''" type="number" inputmode="decimal" step="0.1" placeholder="ex. 78,4" @change="poserPoids(($event.target as HTMLInputElement).value)"></label>

            <p v-if="manqueProfil.length" class="dem-p dem-manque">
              Il manque <b>{{ manqueProfil.join(', ') }}</b>.
            </p>
            <button class="btn-primary btn-bloc" :disabled="manqueProfil.length > 0" @click="suivante('toi')">
              Continuer →
            </button>
          </template>

          <!-- 2. Claude -->
          <template v-else-if="e.id === 'claude'">
            <div v-if="sante && manquantes.length" class="vt-warn">
              <b>Serveur incomplet.</b> Variables manquantes chez l'hébergeur :
              <b>{{ manquantes.join(', ') }}</b>.
            </div>
            <div v-else-if="sante && sante.store !== 'ok'" class="vt-warn">
              <b>Stockage injoignable</b> ({{ sante.driver }}) : {{ sante.store }}.
            </div>

            <template v-if="!v.state.value.registered">
              <p class="dem-p">
                Ta clé d'accès protège les données que Claude peut lire. Pour la créer, saisis
                le code de démarrage à usage unique
                <template v-if="enLocal">affiché dans le terminal du serveur de développement.</template>
                <template v-else>affiché dans le journal du dernier déploiement.</template>
              </p>
              <div v-if="enLocal" class="vt-warn">
                Une clé d'accès est liée à un domaine : celle du site en ligne ne fonctionne
                pas sur <b>{{ hote }}</b>. Il en faut une seconde, propre à cette adresse.
              </div>
              <label class="field"><span>Code de démarrage</span>
                <input v-model="codeDemarrage" type="password" autocomplete="off" placeholder="16 caractères"></label>
              <!-- Bouton mort si le serveur ne peut pas répondre : sans NUXT_VAULT_SECRET,
                   la demande de défi rend un 500, et « 500 Server Error » n'apprend rien à
                   celui qui vient de taper son code. Mieux vaut ne pas proposer le geste. -->
              <button
                class="btn-primary btn-bloc"
                :disabled="v.busy.value || !codeDemarrage.trim() || manquantes.length > 0"
                @click="poserPasskey"
              >🔐 Créer une clé d'accès</button>
              <p v-if="manquantes.length" class="dem-p dem-manque">
                Indisponible tant que <b>{{ manquantes.join(', ') }}</b>
                {{ manquantes.length > 1 ? 'manquent' : 'manque' }}.
              </p>
              <p v-if="echecPasskey" class="vt-warn">
                <b>Échec.</b> {{ echecPasskey }}
              </p>
              <p class="dem-p">
                Ton appareil demandera ensuite ton empreinte, ton visage ou ton code de
                déverrouillage.
              </p>
            </template>
            <template v-else>
              <div class="vt-ok"><b>Clé d'accès créée ✓</b></div>
              <p class="dem-p">
                Ajoute le connecteur dans Claude avec cette adresse, puis l'identifiant et le
                secret MCP.
              </p>
              <pre class="dem-prompt mono">{{ urlConnecteur }}</pre>
              <button class="btn btn-bloc" @click="copierUrl">{{ copie ? 'Copié ✓' : '⧉ Copier l’adresse' }}</button>
              <p class="dem-p">
                Ajoute une <b>seconde clé d'accès</b> depuis un autre appareil, dans Profil →
                Connecteur Claude. Sans elle, perdre celui-ci fait perdre l'accès.
              </p>
            </template>
            <button class="btn btn-bloc" @click="d.passer('claude'); suivante('claude')">
              {{ v.state.value.registered ? 'Continuer →' : 'Passer cette étape' }}
            </button>
          </template>

          <!-- 3. Connecteurs -->
          <template v-else-if="e.id === 'capteurs'">
            <p class="dem-p">
              Une balance ou une montre connectée remplit le poids et les pas
              automatiquement. La saisie manuelle reste disponible.
            </p>
            <SportSources compact @flash="relayer" />
            <button class="btn btn-bloc" @click="d.passer('capteurs'); suivante('capteurs')">
              Continuer →
            </button>
          </template>

          <!-- 4. Remplir -->
          <template v-else>
            <p class="dem-p">
              Colle ce message dans Claude. Il te posera les questions et déposera ses
              propositions ici, à valider une par une.
            </p>
            <pre class="dem-prompt">{{ PROMPT }}</pre>
            <button class="btn btn-bloc" @click="copierPrompt">{{ copiePrompt ? 'Copié ✓' : '⧉ Copier le message' }}</button>
            <p class="dem-p mt-6">
              Ou charge l'exemple : 4 séances, 152 aliments et 34 recettes, modifiables et
              supprimables.
            </p>
            <button class="btn btn-bloc" :disabled="enCours" @click="charger">
              {{ enCours ? 'Chargement…' : '↓ Charger l’exemple' }}
            </button>
            <button class="btn btn-bloc" @click="d.passer('remplir')">
              Passer cette étape
            </button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
