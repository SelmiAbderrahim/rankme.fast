---
title: 'Suivi des fonctionnalités SERP'
description: 'Ce que RankMeFast enregistre sur les fonctionnalités de résultats à chaque vérification de position, et ce qu''il n''affirme jamais.'
locale: fr
slug: serp-features
section: product
order: 1
---

# Suivi des fonctionnalités SERP

Chaque vérification de position lancée par RankMeFast note aussi les fonctionnalités de résultats apparues pour ce mot-clé. Vous ne payez rien de plus, et la vérification ne demande pas plus de résultats que d'habitude au fournisseur.

<!-- docs-truth: metric=none; unit=byproduct-of-serp_checks; cache-hits=count; refund=not-applicable; cadence=follows-rank-check; estimates=provider-observation -->

## Ce qui est enregistré

À chaque vérification, RankMeFast note si l'un de ces éléments figurait sur la page de résultats :

- un extrait optimisé
- un bloc « Autres questions posées »
- un pack local
- des résultats vidéo, image ou shopping
- un panneau knowledge graph

Il conserve aussi les résultats organiques, jusqu'à 100 lignes.

Une fonctionnalité est considérée comme la vôtre quand son hôte correspond exactement à celui de votre site, une fois les deux normalisés. Sinon, elle est enregistrée comme présente, mais pas à vous.

## Historique

Chaque mot-clé suivi a un historique vérification par vérification. Vous pouvez le lire sous forme de matrice de points ou de tableau : mêmes données, plus pratique pour les lecteurs d'écran et les exports.

Les observations sont conservées 90 jours, avec les 30 vérifications les plus récentes par mot-clé. Les lignes plus anciennes disparaissent et ne peuvent pas être reconstruites.

## Limites

Comme la vérification de position ne demande pas de profondeur supplémentaire, une vérification en direct peut renvoyer moins de 100 lignes organiques.

RankMeFast peut seulement dire qu'une fonctionnalité a été **observée** ou **non observée** lors d'une vérification stockée. Cela ne prouve pas que Google ne l'affiche jamais, et un manque reste un manque : rien n'est estimé pour le combler.

## Disponibilité

Il n'y a pas de quota séparé : la capture accompagne les vérifications de position déjà incluses dans votre forfait. Un opérateur peut la désactiver avec le drapeau `SERP_FEATURE_TRACKING_ENABLED` ; les nouvelles exécutions sont alors refusées avec un message dans votre langue, et les résultats stockés restent lisibles. Les unités et limites de forfait sont détaillées dans [Tarifs](./pricing.fr.md).

[Retour à l'index de la documentation](./index.fr.md)
