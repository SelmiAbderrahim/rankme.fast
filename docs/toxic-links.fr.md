---
title: 'Liens toxiques et désaveu'
description: 'Comment RankMeFast classe les backlinks avec une grille déterministe, quand l''IA peut annoter une ligne, et pourquoi le fichier de désaveu n''est jamais soumis à votre place.'
locale: fr
slug: toxic-links
section: product
order: 5
---

# Liens toxiques et désaveu

Une revue de toxicité évalue, selon une grille fixe, les lignes de backlinks que vous avez déjà récupérées. Vous pouvez ensuite construire un fichier de désaveu au format Google. RankMeFast ne le soumet jamais à votre place.

<!-- docs-truth: metric=toxicity_reviews; unit=one-review-up-to-1000-stored-rows; cache-hits=count; refund=provider-failure-zero-retained; cadence=on-demand; estimates=rubric-observation -->

## Comment les lignes sont classées

La grille `toxicity-rubric-v1` lit le score de spam du fournisseur sur chaque ligne de backlink stockée et la place dans une bande propre, à surveiller ou toxique. Les signaux de lien brisé et de nofollow peuvent faire changer la bande.

Les mêmes lignes avec les mêmes scores de spam tombent toujours dans les mêmes bandes, et chaque bande est affichée à côté des éléments qui la justifient.

## Ce que coûte une revue

Une revue capture jusqu'à 1 000 lignes déjà récupérées et paie au plus 100 nouveaux scores de spam de domaine. Si le site n'a encore aucune ligne de backlink stockée, chargez d'abord sa liste de backlinks.

Vous pouvez demander une justification IA sur une ligne signalée. Elle cite cette ligne stockée ou s'abstient. Si l'étape fournisseur échoue, rien n'est conservé et l'unité est rendue.

## Construire le fichier de désaveu

1. Incluez ou excluez chaque ligne.
2. Choisissez la portée domaine ou URL.
3. Exportez un fichier `.txt` simple au format Google. Les lignes exclues n'y figurent pas.

RankMeFast exporte le fichier pour votre propre relecture et votre soumission à Google. Il n'est pas relié à l'outil de désaveu de la Search Console et ne peut rien téléverser en votre nom.

## Ce que signifie une bande

Une bande est l'avis de la grille sur un lien. Elle ne prédit ni pénalité Google, ni action manuelle, ni changement de position.

L'IA peut commenter une ligne que la grille a déjà signalée, mais elle ne peut pas ajouter un domaine que la grille n'a pas signalé. Chaque domaine de l'export remonte à une ligne stockée.

Pour les unités et les limites de forfait, voir [Tarifs](./pricing.fr.md).

[Retour à l'index de la documentation](./index.fr.md)
