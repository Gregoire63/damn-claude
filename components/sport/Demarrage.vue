<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useDemarrage } from '~/composables/useDemarrage'
import type { EtapeId } from '~/composables/useDemarrage'
import { useProfile } from '~/composables/useProfile'
import { useRestauration, phraseBilan } from '~/composables/useRestauration'
import { useVault } from '~/composables/useVault'
import { useWorkout } from '~/composables/useWorkout'
import { useWithings } from '~/composables/useWithings'
import { useFitbit } from '~/composables/useFitbit'

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

onMounted(() => { d.hydrate(); void chargerSante(); void chargerSources() })

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
  if (!kg || kg < 25 || kg > 350) { emit('flash', 'Un poids entre 25 et 350 kg', 'echec'); return }
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
    emit('flash', 'Passkey posé ✓ — le code de démarrage est consommé')
    void chargerSante()
  }
  else {
    echecPasskey.value = v.error.value ?? 'Enregistrement refusé, sans plus de détail.'
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
  catch { emit('flash', 'Copie impossible — sélectionne l’adresse à la main', 'echec') }
}

// ─── 3. Connecteurs ──────────────────────────────────────────────────────────
/**
 * Ce qu'on peut brancher, et rien d'autre.
 *
 * L'étape s'appelait « Balance et pas » et proposait de saisir son poids : il est
 * déjà demandé à l'étape 1, et les pas ne décident presque rien. Elle répond
 * maintenant à la seule question qui se pose ici — qu'est-ce que je peux brancher,
 * et est-ce que c'est déjà branché.
 *
 * Les marques non configurées restent VISIBLES, en grisé, avec la raison. Ne rien
 * montrer ferait croire que l'application ne les connaît pas, et on chercherait
 * ailleurs une intégration qui n'attend qu'une variable d'environnement.
 */
interface Dispo { id: string, label: string, icone: string, capabilities: string[], note: string }
interface Indispo { id: string, label: string, icone: string, raison: string }
const dispo = ref<Dispo[]>([])
const indispo = ref<Indispo[]>([])
async function chargerSources() {
  try {
    const r = await $fetch<{ disponibles: Dispo[], indisponibles: Indispo[] }>('/api/sources')
    dispo.value = r.disponibles
    indispo.value = r.indisponibles
  }
  catch { dispo.value = []; indispo.value = [] }
}

const withings = useWithings()
const fitbit = useFitbit()
const branche = (id: string) =>
  (id === 'withings' ? withings.connected.value : id === 'fitbit' ? fitbit.connected.value : false)
/** « À la main » n'est pas un fournisseur qu'on branche : c'est le cas par défaut. */
const aBrancher = (id: string) => id === 'withings' || id === 'fitbit'
function connecter(id: string) {
  if (id === 'withings') withings.connect()
  else if (id === 'fitbit') fitbit.connect()
}
const CE_QUE_CA_DONNE: Record<string, string> = {
  poids: 'poids', composition: 'masse grasse', pas: 'pas',
}
const apporte = (caps: string[]) => caps.map(c => CE_QUE_CA_DONNE[c] ?? c).join(' · ')

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
  catch { emit('flash', 'Copie impossible — sélectionne le texte à la main', 'echec') }
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
      <h2 class="dem-t">{{ d.bloque.value ? 'Bienvenue' : 'Il reste deux ou trois choses' }}</h2>
      <p class="dem-p">
        <template v-if="d.bloque.value">
          Damn Claude ne livre aucune donnée : ni séances, ni aliments, ni menus. Tu ne
          commences pas par effacer celles de quelqu'un d'autre.
        </template>
        <template v-else>
          Encore {{ d.restantes.value.length }} étape<template v-if="d.restantes.value.length > 1">s</template>.
          Chacune peut être passée — mais autant les regarder une fois, elles ne
          reviendront pas te chercher.
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
              Ces quatre valeurs décident du métabolisme de base, donc de toute la cible
              calorique. Sans elles l'application affiche des tirets — c'est préférable à
              un chiffre inventé.
            </p>
            <label class="field"><span>Prénom</span>
              <input :value="profile.prenom ?? ''" type="text" maxlength="40" placeholder="ex. Grégoire" autocomplete="given-name" @change="setPrenom(($event.target as HTMLInputElement).value)"></label>
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
              Il manque encore <b>{{ manqueProfil.join(', ') }}</b>.
            </p>
            <button class="btn-primary dem-btn" :disabled="manqueProfil.length > 0" @click="suivante('toi')">
              Continuer →
            </button>
          </template>

          <!-- 2. Claude -->
          <template v-else-if="e.id === 'claude'">
            <div v-if="sante && manquantes.length" class="vt-warn">
              <b>Le serveur n'est pas prêt.</b> Variables absentes chez ton hébergeur :
              <b>{{ manquantes.join(', ') }}</b>.
            </div>
            <div v-else-if="sante && sante.store !== 'ok'" class="vt-warn">
              <b>Stockage injoignable</b> ({{ sante.driver }}) : {{ sante.store }}.
            </div>

            <template v-if="!v.state.value.registered">
              <p class="dem-p">
                Pose ton passkey : c'est lui qui ouvre le coffre que Claude lit. Le code de
                démarrage est <b>fabriqué à chaque démarrage</b> et ne sert qu'une fois.
                <template v-if="enLocal">
                  En local, il est imprimé dans le terminal où tourne
                  <b>npm run dev</b> — pas celui de Netlify.
                </template>
                <template v-else>
                  Il est imprimé dans le journal du build : Netlify → Deploys → le dernier.
                </template>
              </p>
              <div v-if="enLocal" class="vt-warn">
                <b>Tu es en local.</b> Un passkey est lié au domaine : celui de ton site en
                ligne ne fonctionne pas ici, et le coffre local est vide. Il faut en poser
                un <b>second</b>, propre à <b>{{ hote }}</b>.
              </div>
              <label class="field"><span>Code de démarrage</span>
                <input v-model="codeDemarrage" type="password" autocomplete="off" placeholder="ex. 4f2a9c1e8b7d0356"></label>
              <!-- Bouton mort si le serveur ne peut pas répondre : sans NUXT_VAULT_SECRET,
                   la demande de défi rend un 500, et « 500 Server Error » n'apprend rien à
                   celui qui vient de taper son code. Mieux vaut ne pas proposer le geste. -->
              <button
                class="btn-primary dem-btn"
                :disabled="v.busy.value || !codeDemarrage.trim() || manquantes.length > 0"
                @click="poserPasskey"
              >🔐 Poser mon passkey</button>
              <p v-if="manquantes.length" class="dem-p dem-manque">
                Impossible tant que <b>{{ manquantes.join(', ') }}</b> {{ manquantes.length > 1 ? 'manquent' : 'manque' }} :
                le serveur ne sait pas signer la demande.
              </p>
              <p v-if="echecPasskey" class="vt-warn">
                <b>Ça n'a pas marché.</b> {{ echecPasskey }}
              </p>
              <p class="dem-p">
                Ton appareil va te demander ton visage, ton empreinte ou ton code de
                déverrouillage. Le champ ci-dessus n'est pas ça — c'est le code du journal.
              </p>
            </template>
            <template v-else>
              <div class="vt-ok"><b>Passkey posé ✓</b> — le code de démarrage est consommé.</div>
              <p class="dem-p">
                Ajoute maintenant le connecteur dans Claude avec cette
                adresse, puis l'identifiant et le secret MCP de tes variables d'hébergement.
              </p>
              <pre class="dem-prompt mono">{{ urlConnecteur }}</pre>
              <button class="btn dem-btn" @click="copierUrl">{{ copie ? 'Copié ✓' : '⧉ Copier l’adresse' }}</button>
              <p class="dem-p">
                Pense au <b>passkey de secours</b> depuis ton ordinateur, dans Profil →
                Connecteur : sans lui, perdre ce téléphone impose de redéployer pour rentrer.
              </p>
            </template>
            <button class="btn dem-btn" @click="d.passer('claude'); suivante('claude')">
              {{ v.state.value.registered ? 'Continuer →' : 'Plus tard, continuer' }}
            </button>
          </template>

          <!-- 3. Connecteurs -->
          <template v-else-if="e.id === 'capteurs'">
            <p class="dem-p">
              Une balance connectée remplit le poids et la composition toute seule, tous les
              matins, sans y penser. Rien n'est obligatoire : à la main, tout fonctionne
              pareil.
            </p>
            <ul class="dem-conn">
              <li v-for="c in dispo" :key="c.id" :class="{ on: branche(c.id) }">
                <span class="dem-conn-i" aria-hidden="true">{{ c.icone }}</span>
                <span class="dem-conn-t">
                  <b>{{ c.label }}</b>
                  <small>{{ apporte(c.capabilities) }}</small>
                </span>
                <span v-if="branche(c.id)" class="dem-conn-ok mono">connecté ✓</span>
                <button v-else-if="aBrancher(c.id)" class="btn dem-conn-b" @click="connecter(c.id)">Connecter</button>
                <span v-else class="dem-conn-ok mono">par défaut</span>
              </li>
              <li v-for="c in indispo" :key="c.id" class="off">
                <span class="dem-conn-i" aria-hidden="true">{{ c.icone }}</span>
                <span class="dem-conn-t">
                  <b>{{ c.label }}</b>
                  <small>{{ c.raison }}</small>
                </span>
              </li>
            </ul>
            <button class="btn dem-btn" @click="d.passer('capteurs'); suivante('capteurs')">
              Continuer →
            </button>
          </template>

          <!-- 4. Remplir -->
          <template v-else>
            <p class="dem-p">
              Colle ce message à ton Claude : il te posera les questions et déposera ses
              propositions ici. Rien ne s'écrit sans ta validation.
            </p>
            <pre class="dem-prompt">{{ PROMPT }}</pre>
            <button class="btn dem-btn" @click="copierPrompt">{{ copiePrompt ? 'Copié ✓' : '⧉ Copier le message' }}</button>
            <p class="dem-p mt-6">
              Ou pars de l'exemple : quatre séances, cent cinquante-deux aliments,
              trente-quatre recettes. Il arrive comme du contenu <b>personnel</b> — tu le
              modifies, tu en retires ce que tu veux.
            </p>
            <button class="btn dem-btn" :disabled="enCours" @click="charger">
              {{ enCours ? 'Chargement…' : '↓ Charger l’exemple' }}
            </button>
            <button class="btn dem-btn" @click="d.passer('remplir')">
              Je remplirai plus tard — entrer dans l’application
            </button>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
