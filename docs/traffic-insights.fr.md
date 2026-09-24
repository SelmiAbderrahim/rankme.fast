---
title: 'Analyse du trafic'
description: 'Comparez le trafic modélisé des concurrents avec des estimations, unités et remboursements explicites.'
locale: fr
slug: traffic-insights
section: research
order: 8
---

# Traffic Insights

Traffic Insights crée un instantané stocké d’un domaine concurrent : visites organiques mensuelles modélisées, rang du domaine, nombre de mots-clés, principaux pays et historique. Servez-vous-en pour comparer des tendances, pas pour remplacer les données Analytics du concurrent.

<!-- docs-truth: metric=traffic_snapshots; unit=one-target-domain-snapshot; cache-hits=count; refund=all-provider-parts-fail-zero-retained; cadence=on-demand; estimates=required -->

## Ce que couvre une unité

Chaque instantané confirmé d’un domaine utilise une unité `traffic_snapshots`. Un aperçu de plusieurs domaines affiche une unité par domaine, mais chaque confirmation produit un instantané distinct. L’aperçu et son annulation ne consomment rien.

Les quotas et prix actuels sont indiqués dans les [Tarifs](./pricing.fr.md). Ouvrir, filtrer ou comparer des instantanés déjà créés ne consomme aucune unité supplémentaire.

## Chaque nombre est une estimation

Chaque valeur numérique porte la mention **Estimation**. Elle est modélisée à partir d’un index de recherche ; il ne s’agit ni de visites réelles, ni de conversions, ni de données Analytics réelles. Les valeurs manquantes restent indisponibles. Un instantané partiel peut rester utile, et l’interface indique qu’il est partiel.

La comparaison aligne jusqu’à cinq instantanés stockés, sans combler ni déduire les données de pays ou d’historique absentes.

## Cache et remboursements

Un instantané servi depuis le cache compte comme une unité, tout comme un résultat vide mais réussi.

L’instantané rassemble plusieurs observations. Si elles échouent toutes et que RankMeFast ne conserve aucun résultat, l’unité est rendue une seule fois. Dès qu’une observation utile est conservée, l’instantané partiel ou complet reste facturé. Une nouvelle tentative ne peut pas rembourser deux fois la même unité.

## Quand actualiser

Traffic Insights fonctionne **à la demande** et ne surveille pas les concurrents en continu. Lancez un nouvel instantané pour obtenir une estimation plus récente. Si les créations sont suspendues, vos listes, détails et comparaisons stockés restent lisibles.

Ouvrez l’onglet **Trafic** d’un site, saisissez un domaine public, vérifiez l’aperçu, puis confirmez. Pour les plafonds, packs et remboursements, consultez [Plans, limites & crédits](./plans-limits-credits.fr.md).

[Retour à l’index de la documentation](./index.fr.md)
