import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import ExerciseOptions from '../../components/sport/ExerciseOptions.vue'
import type { Exercise } from '../../data/sportProgram'

// ─────────────────────────────────────────────────────────────────────────────
// Le menu ⚙ : tout ce qu'on peut faire d'un mouvement, derrière un bouton.
// ─────────────────────────────────────────────────────────────────────────────
//
// L'en-tête de chaque carte portait trois pastilles — la fiche, le commentaire, les
// gestes du jour. Dix-huit boutons de 26 pixels sur une séance de six mouvements,
// dans la colonne où l'on vient taper des kilos.
//
// Elles ont fusionné en un menu, puis le menu a cessé d'être un menu : chacune de ses
// lignes ouvrait ENCORE quelque chose — une fenêtre pour les machines, une carte de
// confirmation pour « repris en main », une quatrième pour la fiche. Tout est
// maintenant DANS la fenêtre, et ces tests tiennent les trois choses qui se
// perdraient sans bruit en la remplissant :
//
//  · le commentaire s'enregistre À LA FRAPPE. Il passait par une fenêtre avec un
//    bouton « Terminé » qui ne terminait rien — le brouillon de séance est sauvegardé
//    en continu de toute façon. Sans la sauvegarde à la frappe, refermer le menu d'un
//    tap à côté perdrait ce qu'on vient d'écrire, et rien ne le dirait ;
//  · il n'y a plus qu'UN endroit où l'écrire. Deux champs sur le même commentaire
//    seraient deux endroits à vérifier le jour où l'un des deux cesse d'enregistrer ;
//  · rien n'OUVRE plus rien : la liste des machines se déplie sur place, « repris en
//    main » bascule sans confirmation, et la fiche est dépliée en bas. C'est ce qui se
//    défait le plus facilement — remettre un calque est toujours la solution la plus
//    courte quand un écran devient long.

const MONTAGE = { attachTo: document.body, global: { stubs: { transition: false } } }
afterEach(() => { document.body.querySelectorAll('.sport-portal').forEach(n => n.remove()) })

const ex = (over: Partial<Exercise> = {}): Exercise => ({
  id: 'squat', name: 'Squat', sets: 4, reps: '6-8',
  muscles: ['quadris'], cues: [], machine: 'Barre', ...over,
})

const ouvrir = async (props: Partial<InstanceType<typeof ExerciseOptions>['$props']> = {}) => {
  const w = mount(ExerciseOptions, {
    ...MONTAGE,
    props: { ex: ex(), repos: 90, note: '', notePrecedente: null, variant: null, swap: false, alternatives: [], ...props },
  })
  await nextTick()
  return w
}

const champ = () => document.body.querySelector('#exopt-note') as HTMLTextAreaElement | null

describe('le commentaire, dans le menu', () => {
  it('s’enregistre à la frappe, sans bouton pour valider', async () => {
    const w = await ouvrir()
    const t = champ()!
    expect(t).toBeTruthy()

    t.value = 'Épaule raide'
    t.dispatchEvent(new Event('input'))
    await nextTick()

    expect(w.emitted('update:note')?.at(-1)).toEqual(['Épaule raide'])
    // Et rien ne demande de confirmer : le seul bouton du bloc serait un piège à
    // texte perdu pour qui referme sans le toucher.
    expect(document.body.textContent).not.toContain('Terminé')
  })

  it('remet sous les yeux ce qui avait été noté la dernière fois', async () => {
    await ouvrir({ notePrecedente: 'épaule raide' })
    expect(document.body.textContent).toContain('La dernière fois : épaule raide')
  })

  it('part du commentaire déjà écrit plutôt que d’un champ vide', async () => {
    await ouvrir({ note: 'déjà écrit' })
    expect(champ()!.value).toBe('déjà écrit')
  })
})

describe('l’ordre des blocs', () => {
  /**
   * Le commentaire EN PREMIER, et ce n'est pas un détail de goût.
   *
   * C'est le seul de ces gestes qui revienne PENDANT la séance : « épaule qui tire »
   * s'écrit entre deux séries, là où la machine et la reprise en main se décident une
   * fois, en arrivant. Sous les boutons, il demandait de faire défiler pour trois mots
   * — et la fenêtre s'est allongée depuis qu'elle porte aussi la fiche.
   */
  it('ouvre sur le commentaire, finit par la fiche', async () => {
    await ouvrir()
    const blocs = [...document.body.querySelectorAll('.exopt-list > *')].map(e => e.className.split(' ')[0])
    expect(blocs[0]).toBe('exopt-note')
    expect(blocs.at(-1)).toBe('exopt-fiche')
    expect(blocs).toContain('exopt-duo')
  })
})

describe('les gestes du jour', () => {
  /** Les deux se choisissent l'un CONTRE l'autre : ils doivent être côte à côte. */
  it('pose « autre machine » et « repris en main » sur la même ligne', async () => {
    await ouvrir()
    const duo = document.body.querySelector('.exopt-duo')!
    expect(duo.querySelectorAll('button')).toHaveLength(2)
    expect(duo.textContent).toContain('Autre machine')
    expect(duo.textContent).toContain('Repris en main')
  })

  /**
   * La phrase d'aide ne doit parler que des boutons PRÉSENTS. Un mouvement sans
   * machine de remplacement n'affiche pas 🔁 ; lire « 🔁 si la tienne est prise » sous
   * un bouton qui n'existe pas envoie le chercher.
   */
  it('ne promet pas un bouton absent', async () => {
    await ouvrir({ ex: ex({ id: 'mouvement-invente' }) })
    expect(document.body.querySelector('.exopt-duo')!.querySelectorAll('button')).toHaveLength(1)
    expect(document.body.textContent).not.toContain('si la tienne est prise')
    expect(document.body.textContent).toContain('changé pour de bon')
  })

  it('n’offre l’alternance que là où elle existe', async () => {
    await ouvrir()
    expect(document.body.textContent).not.toContain('à la place')

    document.body.querySelectorAll('.sport-portal').forEach(n => n.remove())
    await ouvrir({ alternatives: [ex({ id: 'abducteur', name: 'Abducteurs' })] })
    expect(document.body.textContent).toContain('Faire Abducteurs à la place')
  })

  /** « Repris en main » bascule SUR PLACE : réversible d'un second tap, donc une
   *  confirmation modale ne protégeait de rien et coûtait un calque. */
  it('bascule « repris en main » sans rien demander', async () => {
    const w = await ouvrir()
    const btn = [...document.body.querySelectorAll('.exopt-btn')].find(b => b.textContent?.includes('Repris en main')) as HTMLButtonElement
    btn.click()
    await nextTick()
    expect(w.emitted('swap')?.at(-1)).toEqual(['squat'])
    // Aucune carte de confirmation ne s'est posée par-dessus.
    expect(document.body.querySelector('.confirm-overlay')).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Rien n'ouvre rien : la fenêtre porte tout.
// ─────────────────────────────────────────────────────────────────────────────

describe('la fenêtre se suffit', () => {
  /** La fiche du mouvement est DÉPLIÉE, pas derrière un bouton : c'est la moitié du
   *  « sans redirection » — l'autre étant la liste des machines. */
  it('déplie la fiche du mouvement, sans bouton pour l’ouvrir', async () => {
    await ouvrir({ ex: ex({ cues: ['Dos droit'] }) })
    expect(document.body.querySelector('.exfiche')).toBeTruthy()
    expect(document.body.textContent).toContain('Dos droit')
    // Le repos de la fiche vient de l'appelant, pas d'un second calcul.
    expect(document.body.textContent).toContain('1:30')
    // Et rien ne propose d'aller la chercher ailleurs.
    const boutons = [...document.body.querySelectorAll('button')].map(b => b.textContent ?? '')
    expect(boutons.some(t => t.includes("Comment l'exécuter"))).toBe(false)
  })

  /** La liste des machines se déplie DANS la fenêtre. Repliée par défaut : on ne
   *  change pas de machine à chaque série, et dépliée elle pousse le reste dehors. */
  it('déplie la liste des machines sur place', async () => {
    const w = await ouvrir()
    expect(document.body.querySelector('.vr-bloc')).toBeNull()

    const btn = [...document.body.querySelectorAll('.exopt-btn')].find(b => b.textContent?.includes('Autre machine')) as HTMLButtonElement
    btn.click()
    await nextTick()

    expect(document.body.querySelector('.vr-bloc')).toBeTruthy()
    // Une seule fenêtre à l'écran, toujours.
    expect(document.body.querySelectorAll('.popup')).toHaveLength(1)

    const choix = document.body.querySelectorAll('.vr-pick')
    expect(choix.length).toBeGreaterThan(1) // la référence + au moins une machine
    ;(choix[1] as HTMLButtonElement).click()
    await nextTick()
    expect(w.emitted('pick-variant')).toBeTruthy()
    // Choisie, la liste se replie et la fenêtre reste ouverte.
    expect(document.body.querySelector('.vr-bloc')).toBeNull()
    expect(document.body.querySelector('.popup')).toBeTruthy()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Le garde-fou de source : un seul chemin d'écriture.
// ─────────────────────────────────────────────────────────────────────────────

const coque = readFileSync('layouts/default.vue', 'utf8')

describe('la coque', () => {
  it('n’a plus de fenêtre de commentaire à côté du menu', () => {
    expect(coque).not.toContain('note-popup')
    expect(coque).not.toContain('noting')
    // La carte le RELIT — ça, c'est gratuit et ça doit rester.
    expect(coque).toContain('ex-note-said')
  })
})
