---
title: 'Cannibalisation de mots-clés'
description: 'Comment RankMeFast repère les requêtes où plusieurs de vos pages se concurrencent, à partir des seules lignes Search Console déjà stockées.'
locale: fr
slug: cannibalization
section: product
order: 4
---

# Cannibalisation de mots-clés

Un rapport de cannibalisation lit les lignes `query,page` de Google Search Console que RankMeFast synchronise déjà pour votre site. Il ne coûte rien en frais fournisseur et fonctionne même quand Google est déconnecté.

<!-- docs-truth: metric=cannibalization_reports; unit=one-report-one-window; cache-hits=count; refund=no-stored-rows-no-unit-consumed; cadence=on-demand; estimates=first-party-gsc-rows -->

## Ce que montre un rapport

Pour chaque requête où au moins deux de vos pages apparaissent, vous voyez les pages concurrentes avec leurs clics, impressions, position moyenne et part du total de la requête.

RankMeFast suggère aussi quelle page devrait être la page principale. Il choisit toujours dans le même ordre, donc les mêmes lignes donnent la même réponse :

1. Le plus de clics.
2. La meilleure position moyenne, en cas d'égalité sur les clics.
3. Un ordre de départage fixe, si les deux sont à égalité.

## Fenêtres et confiance

Vous pouvez lancer un rapport sur 7, 28 ou 90 jours de lignes stockées. Une fenêtre plus longue utilise simplement davantage de ce qui est déjà stocké ; elle ne récupère rien de nouveau.

Chaque constat reçoit une confiance élevée, moyenne ou faible. Elle reflète la solidité des données stockées (nombre de lignes, netteté de l'écart entre les pages), pas ce qui se passera si vous agissez.

## Avant d'en lancer un

Si votre site n'a encore aucune ligne `query,page` stockée, il n'y a rien à analyser. RankMeFast vous demande de synchroniser Search Console d'abord et ne consomme aucune unité de forfait.

## Ce qui vous revient

Le rapport ne prédit aucun changement de position et ne touche pas à votre site. Consolider une page, la rediriger ou la laisser telle quelle, c'est à vous de décider.

## Forfaits et disponibilité

Les quotas mensuels sont Starter 4, Pro 20 et Agency 100. Pour le fonctionnement des unités, voir [Tarifs](./pricing.fr.md).

Si un opérateur désactive `CANNIBALIZATION_ENABLED`, les nouveaux rapports sont refusés avec un message localisé. Les rapports existants restent lisibles.

[Retour à l'index de la documentation](./index.fr.md)
