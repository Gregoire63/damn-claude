/**
 * Le programme d'exemple : quatre séances, un cycle push / jambes / pull / haut.
 *
 * Il vivait dans `data/sportProgram.ts` et se chargeait avec l'application. C'était
 * le programme d'une seule personne servi à tout le monde : sur une installation
 * neuve, on héritait de ses séances, de ses machines et de ses identifiants
 * d'exercices, qu'il fallait ensuite effacer un par un.
 *
 * Il est devenu ce qu'il aurait toujours dû être : un exemple, qu'on importe si on
 * le veut. Rien ici n'est chargé par l'application — `scripts/exporter-exemple.mjs`
 * en fait `public/exemple.json`, et c'est ce fichier que le bouton « Charger
 * l'exemple » restaure, exactement comme une sauvegarde.
 */
import type { Session, SprintPlan } from '../sportProgram'

// Séance de sprint partagée par les jours « + Sprint » (mardi & vendredi)
export const SPRINT_EXEMPLE: SprintPlan = {
  title: 'Sprints — fin de séance',
  goal: 'Développer puissance et explosivité sans casser la récup des jambes. On reste à ~90 %, jamais à fond : la qualité prime sur la quantité.',
  warmup: [
    '5 min footing léger pour monter la température',
    'Mobilité : montées de genoux, talons-fesses, pas chassés (2 × 20 m)',
    '3 accélérations progressives sur 60 m : 60 %, puis 70 %, puis 80 %',
  ],
  protocol: [
    { label: 'Séries', value: '5 à 6' },
    { label: 'Effort', value: '60–80 m · 10–15 s' },
    { label: 'Intensité', value: '85–90 %' },
    { label: 'Récup', value: '2 min marche' },
  ],
  exterieur: [
    'Surface souple de préférence : piste synthétique, herbe sèche. Évite le bitume dur.',
    'Départ debout, accélération progressive sur les 20 premiers mètres.',
    'Tiens la vitesse max sur 30–40 m, sans crisper.',
    'Décélère en douceur sur 15–20 m — ne t\'arrête jamais net.',
  ],
  tapis: [
    'Règle la vitesse AVANT de lancer l\'effort : sur tapis on sprinte à vitesse fixe.',
    'Vitesse cible ≈ 15–18 km/h (commence plus bas et monte semaine après semaine).',
    'Inclinaison 1–2 % pour se rapprocher des conditions extérieures.',
    'Attache la pince d\'arrêt d\'urgence à toi — obligatoire.',
    'Pieds sur les rails latéraux, lance le tapis, attends la vitesse, puis pose-toi sur la bande (mains aux barres au départ si besoin).',
    'Sprinte 10–15 s, puis repose les pieds sur les rails (laisse le tapis tourner) pour la récup.',
  ],
  tapisNote: 'Sur tapis, raisonne en TEMPS (10–15 s) plutôt qu\'en distance, et ne descends jamais du tapis à pleine vitesse.',
  cues: [
    'Grandis-toi, buste très légèrement en avant.',
    'Bras actifs qui rythment la foulée, mains et épaules relâchées.',
    'Appuis sur l\'avant du pied, fréquence élevée plutôt que grandes enjambées.',
  ],
  cooldown: '5 min de marche + étirements légers ischios/mollets. Idéalement un week-end de récup derrière.',
}

export const PROGRAM_EXEMPLE: Session[] = [
  {
    id: 's1',
    name: 'Pecs, Épaules & Triceps',
    tag: 'Lundi · Push',
    color: '#8b6f5c',
    sprint: null,
    exercises: [
      { id: 'dc-barre', name: 'Développé couché barre', sets: 4, reps: '6-8', rest: 180, muscles: ['pecs', 'epaules-av', 'triceps'], cues: ['Omoplates serrées, pieds ancrés au sol', 'Barre au niveau des mamelons, coudes ~45°', 'Pousse en explosif, descends en 2 sec'], machine: 'Alternative On Air : machine convergente si les barres sont prises' },
      { id: 'di-halteres', name: 'Développé incliné haltères', sets: 3, reps: '8-10', rest: 120, muscles: ['pecs', 'epaules-av'], cues: ['Banc à 30° max, pas plus', "Descends jusqu'à l'étirement du pec", 'Ne claque pas les haltères en haut'], machine: '' },
      { id: 'dev-mil', name: 'Développé militaire haltères', sets: 2, reps: '8-10', rest: 120, muscles: ['epaules-av', 'epaules-lat', 'triceps'], cues: ['Assis dossier à 85°', 'Descends les haltères au niveau des oreilles', "Gainage serré, pas d'arche lombaire"], machine: 'Alternative : machine développé épaules' },
      { id: 'elev-lat', name: 'Élévations latérales', sets: 3, reps: '15', rest: 75, muscles: ['epaules-lat'], cues: ["Monte jusqu'à l'horizontale, pas plus", 'Petit doigt légèrement vers le haut', 'Léger et strict > lourd et moche'], machine: 'Ou poulie basse unilatéral' },
      { id: 'dips', name: 'Dips lestés', sets: 3, reps: '8-12', rest: 150, muscles: ['pecs', 'triceps'], cues: ['Buste penché en avant = pec, droit = triceps', "Descends jusqu'à 90° aux coudes", 'Charge préremplie avec ton poids de corps — ajoute ton lest par-dessus dès que tu passes 12 reps'], machine: 'Alternative : machine à dips assis', bodyweight: true },
      { id: 'crunch-cable', name: 'Crunch à la poulie', sets: 3, reps: '12-15', rest: 60, muscles: ['abdos'], cues: ['À genoux face à la poulie haute', 'Enroule la colonne, ne tire pas avec les bras', 'Charge progressive'], machine: '' },
    ],
  },
  {
    id: 's2',
    name: 'Dos & Biceps',
    tag: 'Mardi + Sprint',
    color: '#5f7a6b',
    sprint: SPRINT_EXEMPLE,
    exercises: [
      { id: 'tirage-v', name: 'Tirage vertical', sets: 3, reps: '8-10', rest: 120, muscles: ['dos', 'biceps'], cues: ['Prise légèrement plus large que les épaules', 'Tire vers le haut des pecs, coudes vers le bas', 'Ne te balance pas en arrière'], machine: 'Ou tractions lestées si maîtrisées' },
      { id: 'rowing-m', name: 'Rowing machine', sets: 4, reps: '8-10', rest: 120, muscles: ['dos', 'biceps'], cues: ['Poitrine collée au support', 'Tire les coudes en arrière, serre les omoplates', 'Pause 1 sec en contraction'], machine: 'Machine rowing assis prise neutre' },
      { id: 'lombaires', name: 'Extensions lombaires (banc)', sets: 3, reps: '12-15', rest: 75, muscles: ['lombaires', 'fessiers'], cues: ['Buste qui descend lentement, dos neutre', "Remonte jusqu'à l'alignement, sans cambrer à l'excès", 'Serre les fessiers en haut', '1-2 tenues de 5 s en haut sur la dernière série', 'Disque contre la poitrine quand 15 reps deviennent faciles (note le lest, 0 = poids de corps)'], machine: 'Banc à lombaires 45° ou banc romain' },
      { id: 'face-pull', name: 'Face pull', sets: 3, reps: '15', rest: 75, muscles: ['epaules-ar', 'dos'], cues: ['Poulie à hauteur du visage, corde', 'Tire vers le front en écartant', 'Rotation externe en fin de mouvement'], machine: '' },
      { id: 'oiseau', name: 'Oiseau (reverse fly)', sets: 3, reps: '15', rest: 75, muscles: ['epaules-ar'], cues: ['Buste penché à ~90°, dos plat', 'Écarte les bras en serrant les omoplates', "Léger et strict, aucun élan — monte jusqu'à l'horizontale"], machine: 'Haltères, poulies croisées ou pec deck inversé' },
      { id: 'curl-marteau', name: 'Curl marteau (hammer)', sets: 3, reps: '10-12', rest: 90, muscles: ['biceps', 'avant-bras'], cues: ['Prise NEUTRE (paumes qui se font face), poignets verrouillés', "Travaille le brachial (sous le biceps) + le long chef → l'épaisseur du bras", 'Contrôle la descente 2-3 s, aucun élan'], machine: 'Haltères, ou corde à la poulie basse' },
      // La poigne lâche avant les ischios au soulevé de terre roumain : elle devient
      // le facteur limitant d'un mouvement qui ne travaille pas la poigne. On la
      // travaille donc à part, et EN FIN de séance — une poigne fatiguée avant un
      // tirage lourd dégraderait le tirage, ce qui reviendrait à déplacer le problème.
      { id: 'suspension', name: 'Suspension à la barre', sets: 3, reps: '30-45 s', rest: 90, mesure: 'temps', bodyweight: true, muscles: ['avant-bras', 'abdos'], cues: ['Suspension passive : épaules relâchées, bras tendus', 'Serre la barre, respire, tiens', 'Compte les secondes — la progression se joue sur la durée, puis sur le lest'], machine: 'Barre de traction — sangles INTERDITES, c\'est la poigne qu\'on travaille' },
    ],
  },
  {
    id: 's3',
    name: 'Jambes',
    tag: 'Jeudi · maintien',
    color: '#b07d2e',
    sprint: null,
    exercises: [
      { id: 'squat', name: 'Squat', sets: 3, reps: '6-8', rest: 180, muscles: ['quadris', 'fessiers'], cues: ['Descends sous la parallèle si mobilité OK', "Genoux dans l'axe des pieds", 'Gainage avant de descendre'], machine: '' },
      { id: 'sdt-r', name: 'Soulevé de terre roumain', sets: 3, reps: '8-10', rest: 180, muscles: ['ischios', 'fessiers', 'dos'], cues: ['Hanches en arrière, genoux quasi fixes', 'Barre collée aux jambes', 'Étirement ischio puis remonte avec les hanches'], machine: '' },
      { id: 'fentes', name: 'Fentes marchées', sets: 2, reps: '10/j', rest: 150, muscles: ['quadris', 'fessiers'], cues: ['Grand pas, genou arrière frôle le sol', 'Buste droit', 'Haltères le long du corps'], machine: 'Ou presse unilatérale' },
      { id: 'leg-curl', name: 'Leg curl (ischios)', sets: 3, reps: '10-12', rest: 90, muscles: ['ischios'], cues: ['Contrôle la descente (2-3 s)', 'Amplitude complète, sans à-coup', 'Bassin plaqué au banc, pas de coup de rein'], machine: 'Machine leg curl allongé ou assis' },
      { id: 'mollets', name: 'Mollets debout', sets: 3, reps: '12-15', rest: 75, muscles: ['mollets'], cues: ['Amplitude complète, pause en bas', 'Monte sur la pointe max', 'Pas de rebond'], machine: 'Machine debout ou à la presse' },
      // Suspendu à une barre : c'est un mouvement au poids de corps, et la fiche ne le
      // disait pas. Les séries s'enregistraient donc à 0 kg — volume nul, record nul,
      // depuis le début. Les séries DÉJÀ enregistrées gardent leur 0 : les réécrire
      // serait inventer un poids qu'on n'a pas mesuré ce jour-là.
      { id: 'releves', name: 'Relevés de jambes suspendu', sets: 3, reps: '12', rest: 60, muscles: ['abdos'], cues: ['Enroule le bassin, pas juste les jambes', 'Contrôle la descente', 'Tape seulement le LEST : rien si tu es à vide, le poids des lests de chevilles sinon'], machine: 'Barre de traction ou chaise romaine', bodyweight: true },
    ],
  },
  {
    id: 's4',
    name: 'Pecs & Bras',
    tag: 'Vendredi + Sprint',
    color: '#9a6a4f',
    sprint: SPRINT_EXEMPLE,
    exercises: [
      { id: 'dev-halteres', name: 'Développé couché haltères', sets: 4, reps: '8-10', rest: 120, muscles: ['pecs', 'epaules-av', 'triceps'], cues: ["Amplitude plus grande qu'à la barre", "Descends jusqu'à l'étirement", 'Trajectoire en léger arc de cercle'], machine: '' },
      { id: 'ecartes', name: 'Écartés à la poulie', sets: 3, reps: '12-15', rest: 75, muscles: ['pecs'], cues: ['Léger arrondi des coudes, fixe', 'Croise légèrement les mains devant', 'Tension continue, pas de repos en haut'], machine: 'Ou au pec deck' },
      // Les tenues étaient une consigne au milieu des tractions : un travail qui se
      // compte en secondes, noté nulle part, donc invisible dans les courbes. Elles
      // deviennent une ligne à elles, en secondes — c'est le même mouvement, ce n'est
      // pas la même unité, et on ne peut pas enregistrer les deux sur une seule fiche.
      { id: 'tractions', name: 'Tractions', sets: 4, reps: 'max', rest: 150, muscles: ['dos', 'biceps'], cues: ['Note le nombre de reps à chaque série — objectif : battre ton total', 'Tape seulement le LEST : ton poids du jour est ajouté tout seul', 'Ajoute du lest dès que tu passes 10-12 reps propres', 'Descente lente et contrôlée (2-3 s) — le négatif fait grossir le dos'], machine: 'Barre de traction — assistance élastique/machine si besoin', bodyweight: true },
      { id: 'ss-bras', name: 'Superset triceps : pushdown + extension', sets: 3, reps: '12+12', rest: 120, muscles: ['triceps'], cues: ['12 pushdowns à la corde (poulie haute)', 'Puis SANS repos, 12 extensions au-dessus de la tête (corde, poulie basse)', 'Repos seulement après les deux exos, puis on recommence', 'Deux angles : chef latéral (pushdown) + longue portion (overhead) = triceps complet'], machine: "Poulie corde — haute pour le pushdown, basse pour l'overhead", superset: ['Pushdown', 'Overhead'] },
      { id: 'curl-21', name: 'Curl 21 (méthode 7-7-7)', sets: 3, reps: '7+7+7 (21)', rest: 90, muscles: ['biceps'], cues: ['7 reps sur la moitié basse (bas → milieu)', '7 reps sur la moitié haute (milieu → haut)', '7 reps en amplitude complète', "Charge légère, aucun élan — c'est la brûlure qui fait le boulot"], machine: 'Barre EZ, haltères ou poulie basse' },
      { id: 'tractions-tenue', name: 'Tenue menton au-dessus de la barre', sets: 2, reps: '10-20 s', rest: 90, mesure: 'temps', bodyweight: true, optionnel: true, muscles: ['dos', 'biceps'], cues: ['Menton franchement au-dessus de la barre, épaules basses', 'Tiens jusqu\'à ne plus pouvoir tenir la position — pas jusqu\'à ce que ce soit dur', 'Compte les secondes, pas les répétitions'], machine: 'Barre de traction' },
    ],
  },
]

