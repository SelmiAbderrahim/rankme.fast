---
title: 'Radar de marque'
description: 'Analysez une requête de marque à la demande, examinez les mentions conservées et comprenez l’option et le remboursement.'
locale: fr
slug: brand-radar
section: research
order: 11
---

# Brand Radar

Brand Radar recherche les mentions publiques d’une requête de marque, enregistre les mentions retenues et calcule le volume, la répartition des sentiments, les principaux domaines et l’écart avec l’analyse terminée précédente de la même requête sur le même site. Il peut aussi produire un court résumé avec sources.

Ouvrez un site puis choisissez l’onglet **Brand Radar**. Chaque analyse appartient à ce site : deux sites suivant la même marque gardent des listes et des références de tendance distinctes.

Le champ facultatif **Pays du site éditeur** permet une recherche. Il filtre selon le pays d’enregistrement du site qui publie la mention, et non selon l’emplacement du lecteur. Choisissez **Tous les pays** pour une analyse mondiale. Les anciennes analyses qui conservaient seulement un numéro de lieu inutilisé sont affichées comme mondiales, car ce numéro n’influençait pas leurs résultats.

<!-- docs-truth: metric=brand_mention_scans; unit=one-scan-one-brand-query; cache-hits=not-applicable-fresh-required; refund=search-provider-failure-zero-retained; cadence=on-demand; estimates=ai-digest-labeled -->

## Sachez ce que couvre une unité

Une analyse confirmée d’une requête de marque utilise une unité `brand_mention_scans`. Les filtres facultatifs de langue et de pays du site éditeur ainsi que le résumé cité sont inclus. Les requêtes de concurrents ne peuvent pas être regroupées dans cette unité.

L’aperçu et son annulation ne consomment rien. L’aperçu prévoit toujours une nouvelle collecte, car les mentions appartiennent à votre compte et ne sont jamais mises en cache pour d’autres comptes. Les quotas, l’option Brand Radar et les packs actuels sont dans les [Tarifs](./pricing.fr.md).

## Comprenez remboursements et résultats partiels

L’unité vous est rendue, une seule fois, uniquement si la première recherche échoue côté source et que RankMeFast ne garde aucune mention.

Ces cas consomment quand même l’unité :

- la recherche réussit sans trouver de mention ;
- des mentions sont conservées avant un arrêt ultérieur de source ou de budget ;
- le résumé ou le texte généré échoue ;
- toutes les phrases générées sont rejetées faute de citation vérifiable.

RankMeFast ne supprime pas des mentions trouvées simplement pour vous rembourser.

## Séparez les faits du texte généré

Volumes, sentiments, domaines et variation depuis la précédente analyse de la même requête viennent des lignes stockées. Sans analyse antérieure, vous verrez « aucune comparaison pour l’instant » plutôt qu’un zéro.

Les phrases du résumé sont rédigées par l’IA et ne s’affichent que si elles citent des mentions enregistrées. Si aucune phrase fiable ne subsiste, l’interface l’indique. Les mentions peuvent être consultées et exportées en CSV.

## Choisissez quand analyser

Brand Radar fonctionne **à la demande**, sans surveillance continue. Relancez-le pour une nouvelle observation. Weekly Pulse peut résumer les écarts déjà stockés pour ce même site, mais ne lance ni ne facture une analyse. Une pause des nouveaux scans laisse les données existantes lisibles.

Voir [Plans, limites & crédits](./plans-limits-credits.fr.md) pour l’éligibilité et les remboursements.

[Retour à l’index de la documentation](./index.fr.md)
