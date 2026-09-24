---
title: 'Suivi local par grille'
description: 'Comment les grilles de pack local par coordonnée sont collectées, ce que signifie une cellule en échec, et pourquoi les coordonnées se saisissent au lieu de se cliquer sur une carte.'
locale: fr
slug: geogrid
section: product
order: 9
---

# Suivi local par grille

Un balayage de grille vérifie le pack local depuis de nombreux points autour d'un lieu, en une seule fois. Vous voyez comment la visibilité varie dans un quartier, et pas seulement depuis un point.

<!-- docs-truth: metric=geogrid_scans; unit=one-grid-scan-up-to-49-cells; cache-hits=count; refund=all-cell-failure-only; cadence=on-demand; estimates=provider-observation -->

## Lancer un balayage

Choisissez une taille de grille (3×3, 5×5 ou 7×7), un espacement et un niveau de zoom. RankMeFast lance une vérification Maps par cellule, et toute la grille compte comme un seul balayage décompté.

Pour chaque cellule, il stocke la position observée, la taille du pack local et l'heure de la vérification. Les résultats s'affichent en grille thermique, toujours accompagnée d'un tableau accessible.

## Lire une cellule

Chaque cellule indique l'une de ces trois choses :

- une position observée
- « absent du pack local »
- une vérification en échec, qui ne stocke aucune position et n'est jamais affichée comme un rang

Chaque cellule a sa propre heure de capture. Une grille est donc un ensemble de vérifications rapprochées, pas un instantané de toute la zone au même moment.

## Unités et remboursements

Un balayage avec au moins une cellule exploitable consomme son unité. Vous n'êtes remboursé que si toutes les cellules échouent, car une grille partielle contient encore des observations utiles.

Le forfait Agency inclut 6 balayages par mois. Pro accède aux grilles via le pack de crédits `geogrid-scans-10`, et Starter n'a aucun quota de grille.

Pour les unités et les limites de forfait, voir [Tarifs](./pricing.fr.md).

## Limites

Vous saisissez les coordonnées à la main. RankMeFast n'utilise aucun fournisseur de tuiles cartographiques, il n'y a donc pas de carte interactive sur laquelle cliquer.

Une grille montre ce que le fournisseur a vu depuis ces coordonnées à ce moment-là. Ce n'est pas une prévision, et cela ne dit pas ce que verra une personne en particulier.

[Retour à l'index de la documentation](./index.fr.md)
