---
title: 'Tendances des mots-clés'
description: 'Explorez la direction, l’élan et la saisonnalité de l’intérêt de recherche avec des estimations clairement signalées.'
locale: fr
slug: keyword-trends
section: research
order: 9
---

# Tendances des mots-clés

Tendances des mots-clés montre l’évolution de l’intérêt de recherche. Une exploration présente un indice relatif, la direction annuelle, l’élan récent et les mois saisonniers pour cinq mots-clés au maximum.

<!-- docs-truth: metric=trend_explorations; unit=one-exploration-up-to-five-keywords; cache-hits=count; refund=provider-failure-zero-retained-series; cadence=on-demand; estimates=required -->

## Ce que couvre une unité

Une exploration confirmée utilise une unité `trend_explorations`, que vous saisissiez un ou cinq mots-clés. L’aperçu, son annulation, la réouverture d’un résultat stocké ou la sélection d’une requête associée avant confirmation ne consomment rien. Une suite confirmée est une nouvelle exploration.

Consultez les [Tarifs](./pricing.fr.md) pour les quotas et prix actuels.

## L’indice est une estimation

Chaque série et chaque indication porte la mention **Estimation**. L’indice d’intérêt de 0 à 100 est relatif au marché et à la période choisis. Ce n’est ni un volume mensuel absolu, ni du trafic, ni une prévision.

- La comparaison annuelle exige au moins 56 observations valides.
- L’élan exige 12 observations et peut monter, baisser ou rester stable.
- La saisonnalité exige 24 mois distincts. Si l’historique manque, RankMeFast le dit au lieu d’inventer une tendance.

Une réponse réussie mais plate, clairsemée ou vide est un vrai résultat, pas une erreur.

## Cache et remboursements

Un résultat provenant du cache utilise quand même une unité. Une exploration réussie sans série compte aussi.

Si la source échoue avant qu’une série soit conservée, l’unité réservée est rendue une seule fois et l’exécution est marquée comme remboursée. Dès qu’une série utile est conservée, l’unité reste consommée, même si une autre indication est indisponible.

## Quand explorer

La fonction travaille **à la demande**, sans surveillance continue. Relancez-la pour une vue plus récente. Si les nouvelles explorations sont suspendues, les résultats stockés restent lisibles.

Ouvrez **Tendances en direct** dans Recherche de mots-clés, saisissez jusqu’à cinq expressions, choisissez le marché et la langue, vérifiez l’aperçu, puis confirmez. Voir [Plans, limites & crédits](./plans-limits-credits.fr.md).

[Retour à l’index de la documentation](./index.fr.md)
