# Contribuer

Projet personnel, ouvert sous AGPL. Les contributions sont bienvenues, avec une
réserve honnête : **c'est l'application d'une personne**, et une proposition qui la
transforme en produit multi-utilisateur sera refusée — pas par principe, parce que
c'est un autre projet.

## Avant d'ouvrir une pull request

```bash
npm ci
npm run check      # sélecteurs CSS en double, clés de données en double, balisage Vue
npm test           # les deux projets Vitest
npm run build      # jamais `nuxt generate`
```

La CI lance exactement ces trois-là. Une PR rouge n'est pas relue.

Lisez **[CLAUDE.md](CLAUDE.md)** d'abord : il liste les règles qui mordent, celles
qu'on n'enfreint pas par ignorance mais par bon sens apparent — remettre trois
aliments dans `data/`, mémoïser le client Blobs, ajouter un import dans
`lib/onglets.ts`. Chacune vient d'un bug réel et aucune ne casse tout de suite.

## Ce qui est attendu d'un changement

**Un test qui prouve le changement.** Pas un test qui répète le code : un test qui
échouait avant et qui passe après. S'il ne peut pas échouer, il ne sert à rien.

**Un commentaire qui dit pourquoi.** Le code dit déjà quoi. La convention du projet
est d'écrire ce que le commentaire empêche de réintroduire — les 40 000 lignes
existantes sont dans ce ton, en français.

**Aucune dépendance ajoutée sans raison écrite.** Le projet tient sur Nuxt, Vue et
deux bibliothèques de passkey, délibérément.

**Aucun secret, nulle part.** Voir [SECURITY.md](SECURITY.md).

## Messages de commit

[Conventional Commits](https://www.conventionalcommits.org/fr/), en français, sujet à
l'impératif, 72 caractères maximum :

```
feat(programme): créer une séance entière depuis le connecteur
fix(import): rattraper les sauvegardes d'avant le vidage de data/
refactor(nutrition): sortir la restauration dans un composable
test(vault): couvrir le refus d'un identifiant déjà pris
docs(heberger): expliquer le changement de domaine
chore(ci): épingler Node sur .nvmrc
```

Portées usuelles : `programme`, `nutrition`, `seance`, `vault`, `mcp`, `pwa`,
`import`, `ci`, `docs`.

Le corps explique le POURQUOI quand le sujet ne suffit pas, et cite le symptôme
observé plutôt que la ligne modifiée — c'est ce qu'on relira dans six mois.

## Branches

`develop` est la branche de travail. Une PR par sujet ; les changements sans rapport
dans un même commit sont ce qui rend un `git bisect` inutile.
