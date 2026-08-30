import type { FreeMeal } from '~/lib/freeMeal'

// ─────────────────────────────────────────────────────────────────────────────
// Les repas du dehors, pré-remplis.
// ─────────────────────────────────────────────────────────────────────────────
//
// Ce catalogue existe pour une raison de terrain : on saisit son kebab debout, avant
// de manger ou juste après, et personne ne connaît les macros d'un kebab de tête.
// Sans repère, la saisie finit en « 800 » au jugé — ou, plus souvent, ne se fait pas.
//
// Ce sont des ORDRES DE GRANDEUR pour une portion française courante, pas des valeurs
// d'étiquette. Un kebab varie du simple au double selon la sauce et la taille ; deux
// pizzerias ne servent pas la même pizza. Ils sont là pour amorcer la saisie, et
// chaque champ reste modifiable — c'est le point : partir de 1000 et corriger à 1200
// vaut infiniment mieux que partir de rien.
//
// Les protéines sont le chiffre le plus soigné des quatre. C'est celui qui pilote la
// conservation du muscle en déficit, donc celui dont une erreur coûte quelque chose ;
// se tromper de 10 g de glucides sur un déjeuner ne change aucune décision.
//
// `from: 'catalogue'` marque la provenance : à la relecture, on distingue un chiffre
// approximatif d'un chiffre lu sur un emballage.

export interface EatingOut extends FreeMeal { id: string, groupe: string }

const m = (id: string, groupe: string, label: string, kcal: number, p: number, g: number, l: number): EatingOut =>
  ({ id, groupe, label, kcal, p, g, l, from: 'catalogue' })

export const EATING_OUT: EatingOut[] = [
  // ─── Sur le pouce ────────────────────────────────────────────────────────
  m('kebab-galette-frites', 'Sur le pouce', 'Kebab galette + frites', 1050, 45, 95, 50),
  m('kebab-assiette', 'Sur le pouce', 'Kebab assiette (sans pain)', 750, 50, 55, 38),
  m('tacos-french', 'Sur le pouce', 'Tacos français (viande, sauce fromagère)', 1200, 45, 110, 60),
  m('burger-frites', 'Sur le pouce', 'Burger + frites (fast-food)', 950, 40, 95, 45),
  m('burger-seul', 'Sur le pouce', 'Burger seul', 550, 30, 45, 27),
  m('sandwich-jb', 'Sur le pouce', 'Sandwich jambon-beurre', 500, 22, 55, 20),
  m('sandwich-poulet', 'Sur le pouce', 'Sandwich poulet crudités', 450, 28, 50, 14),
  m('panini', 'Sur le pouce', 'Panini', 550, 22, 55, 26),
  m('wrap-poulet', 'Sur le pouce', 'Wrap ou burrito poulet', 700, 35, 75, 26),
  m('bagel-saumon', 'Sur le pouce', 'Bagel saumon', 550, 28, 55, 24),
  m('croque', 'Sur le pouce', 'Croque-monsieur + salade', 600, 28, 45, 32),
  m('frites', 'Sur le pouce', 'Frites (portion moyenne)', 400, 5, 50, 20),

  // ─── Au restaurant ───────────────────────────────────────────────────────
  m('steak-frites', 'Au restaurant', 'Steak frites', 850, 45, 70, 42),
  m('poulet-frites', 'Au restaurant', 'Poulet rôti + frites', 800, 50, 65, 38),
  m('pates-bolo', 'Au restaurant', 'Pâtes bolognaise', 750, 35, 90, 25),
  m('lasagnes', 'Au restaurant', 'Lasagnes (part)', 700, 35, 60, 35),
  m('pizza-entiere', 'Au restaurant', 'Pizza entière (~300 g)', 800, 32, 95, 30),
  m('pizza-parts', 'Au restaurant', 'Pizza, 2 parts', 500, 20, 60, 19),
  m('saumon-riz', 'Au restaurant', 'Saumon, riz, légumes', 650, 40, 55, 28),
  m('salade-cesar', 'Au restaurant', 'Salade César', 550, 30, 25, 35),
  m('salade-composee', 'Au restaurant', 'Salade composée légère', 400, 25, 25, 20),
  m('quiche', 'Au restaurant', 'Quiche + salade', 550, 20, 40, 33),
  m('raclette', 'Au restaurant', 'Raclette (repas complet)', 1100, 55, 45, 75),
  m('couscous', 'Au restaurant', 'Couscous royal', 900, 50, 90, 35),

  // ─── Cuisines du monde ───────────────────────────────────────────────────
  m('sushi-12', 'Cuisines du monde', 'Sushi, 12 pièces', 500, 25, 75, 10),
  m('poke-saumon', 'Cuisines du monde', 'Poke bowl saumon', 650, 35, 70, 22),
  m('riz-cantonais', 'Cuisines du monde', 'Riz cantonais + poulet', 800, 35, 95, 28),
  m('bo-bun', 'Cuisines du monde', 'Bo bun', 600, 30, 75, 18),
  m('pad-thai', 'Cuisines du monde', 'Pad thaï', 700, 28, 85, 26),
  m('curry-riz', 'Cuisines du monde', 'Curry de poulet + riz', 750, 38, 85, 26),

  // ─── Cantine et à côté ───────────────────────────────────────────────────
  m('cantine', 'Cantine et à côté', 'Plat de cantine (viande, féculent, légumes)', 650, 35, 65, 25),
  m('cantine-leger', 'Cantine et à côté', 'Cantine, plat léger', 450, 30, 40, 16),
  m('patisserie', 'Cantine et à côté', 'Pâtisserie ou dessert', 400, 5, 50, 20),
  m('biere', 'Cantine et à côté', 'Bière, 50 cl', 200, 2, 16, 0),
  m('vin', 'Cantine et à côté', 'Verre de vin', 120, 0, 4, 0),
]

/** Les groupes dans l'ordre d'affichage, sans les recalculer à chaque rendu. */
export const EATING_OUT_GROUPS: { nom: string, plats: EatingOut[] }[] =
  EATING_OUT.reduce<{ nom: string, plats: EatingOut[] }[]>((acc, plat) => {
    const g = acc.find(x => x.nom === plat.groupe)
    if (g) g.plats.push(plat)
    else acc.push({ nom: plat.groupe, plats: [plat] })
    return acc
  }, [])
