---
title: 'Liens toxiques et désaveu'
description: 'Comment RankMeFast classe les backlinks par niveau de risque avec des règles fixes, quand l''IA peut annoter une ligne, et pourquoi le fichier de désaveu n''est jamais soumis à votre place.'
locale: fr
slug: toxic-links
section: product
order: 5
---

# Liens toxiques et désaveu

Une revue de toxicité note les lignes de backlinks déjà récupérées selon des règles fixes, puis vous permet de créer un fichier de désaveu au format Google. RankMeFast ne soumet jamais ce fichier.

<!-- docs-truth: metric=toxicity_reviews; unit=one-review-up-to-1000-stored-rows; cache-hits=count; refund=provider-failure-zero-retained; cadence=on-demand; estimates=rubric-observation -->

## Comment chaque ligne reçoit un niveau de risque

Les règles (version `toxicity-rubric-v1`) lisent le score de spam de chaque ligne de backlink enregistrée et la placent au niveau sain, à surveiller ou toxique. Les signaux de lien cassé et de nofollow ajustent ce niveau.

Les règles donnent toujours le même résultat : les mêmes lignes enregistrées et les mêmes scores de spam produisent toujours les mêmes niveaux de risque, et chaque niveau est affiché avec les éléments qui l'expliquent.

## Ce que coûte une revue

Une revue capture jusqu'à 1 000 lignes déjà récupérées et paie au plus 100 nouveaux scores de spam de domaine. Si le site n'a encore aucune ligne de backlink stockée, chargez d'abord sa liste de backlinks.

Vous pouvez demander une justification IA sur une ligne signalée. Elle cite cette ligne stockée ou s'abstient. Si l'étape fournisseur échoue, rien n'est conservé et l'unité est rendue.

## Construire le fichier de désaveu

1. Incluez ou excluez chaque ligne.
2. Choisissez la portée domaine ou URL.
3. Exportez un fichier `.txt` simple au format Google. Les lignes exclues n'y figurent pas.

RankMeFast exporte le fichier pour votre propre relecture et votre soumission à Google. Il n'est pas relié à l'outil de désaveu de la Search Console et ne peut rien téléverser en votre nom.

## Limites honnêtes

Un niveau de risque décrit ce que les règles ont trouvé dans un lien. Ce n'est jamais une prédiction de pénalité Google, d'action manuelle ou de changement de classement.

L'IA peut annoter une ligne déjà signalée par les règles, mais elle ne peut jamais ajouter un domaine que les règles n'ont pas signalé. Chaque domaine de l'export renvoie à une ligne enregistrée.

Avant d'agir, comparez ce guide aux preuves stockées et à l'état affiché dans RankMeFast.

Pour les unités et les limites de forfait, voir [Tarifs](./pricing.fr.md).

[Retour à l'index de la documentation](./index.fr.md)
