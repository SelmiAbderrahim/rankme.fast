---
title: 'Regroupement de mots-clés'
description: 'Comment RankMeFast regroupe les mots-clés suivis selon les URL de résultats partagées, et pourquoi c''est de l''arithmétique et non un score de similarité.'
locale: fr
slug: keyword-clustering
section: product
order: 2
---

# Regroupement de mots-clés

Le regroupement rassemble vos mots-clés suivis selon le nombre d'URL de résultats qu'ils ont en commun. Il s'appuie uniquement sur les observations SERP déjà stockées par RankMeFast et ne lance jamais de vérification de position pour combler un manque.

<!-- docs-truth: metric=keyword_cluster_runs; unit=one-run-up-to-200-keywords; cache-hits=count; refund=none-blocked-keywords-are-reported; cadence=on-demand; estimates=shared-url-arithmetic -->

## Comment un groupe se forme

1. Pour chaque mot-clé, RankMeFast prend les 10 premières URL de résultats de sa dernière observation stockée.
2. Deux mots-clés sont reliés lorsqu'ils partagent au moins 3 de ces URL.
3. Les liens s'enchaînent : si A est relié à B et B à C, les trois se retrouvent dans le même groupe.

Une exécution couvre jusqu'à 200 mots-clés. L'appartenance est un simple calcul sur les URL partagées, donc les mêmes observations stockées donnent toujours les mêmes groupes.

## Quels mots-clés peuvent participer

Seuls les mots-clés Google observés au cours des 7 derniers jours participent. Avant le lancement, un contrôle préalable vous montre lesquels sont éligibles.

Les mots-clés exclus sont listés avec leur motif (manquant, périmé ou vide) au lieu de disparaître en silence. L'exécution consomme son unité dès qu'elle démarre, et les mots-clés bloqués ne sont pas remboursés.

## Libellés

Le moteur d'IA peut proposer un nom pour chaque groupe, affiché avec un marqueur IA. Si cette étape échoue, vos groupes restent sans nom. Le regroupement, lui, ne change pas, car il ne dépend jamais du modèle.

Trois URL partagées, c'est un seuil et non un score de similarité, et un groupe ne dit rien de l'intention de recherche. RankMeFast n'invente jamais de mot-clé, d'URL ou d'observation pour compléter un groupe.

## Forfaits et disponibilité

Quotas mensuels par forfait :

- Starter : 0
- Pro : 4
- Agency : 20

Un opérateur peut désactiver le regroupement avec le drapeau `KEYWORD_CLUSTERING_ENABLED`. Les nouvelles exécutions sont alors refusées avec un message localisé, et les groupes existants restent lisibles. La page [Tarifs](./pricing.fr.md) explique le fonctionnement des unités.

[Retour à l'index de la documentation](./index.fr.md)
