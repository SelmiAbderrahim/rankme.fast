---
title: 'Backlinks et veille concurrentielle'
description: 'Comparez les backlinks, les paysages de mots-clés, les pages classées et les rapports concurrents enregistrés.'
locale: fr
slug: backlinks-competitors
section: audits
order: 6
---

# Backlinks et veille concurrentielle

Les backlinks et la veille concurrentielle répondent à deux questions différentes. Les backlinks indiquent quels sites renvoient vers un domaine. La veille concurrentielle compare les requêtes et les pages classées des concurrents que vous avez confirmés pour l'un de vos sites.

<!-- generated: finite-backlink-limits:start -->
Les lignes de backlinks sont mesurées chaque mois. Pro inclut jusqu’à 10 000 lignes par mois et Agency jusqu’à 100 000. Les rapports enregistrés restent consultables une fois le plafond mensuel atteint.
<!-- generated: finite-backlink-limits:end -->

## L'espace de travail du site

Ouvrez un site puis choisissez **Concurrents**. Le portefeuille, les paysages de mots-clés, les comparaisons de contenu, le suivi, les estimations de trafic et les rapports enregistrés se trouvent au même endroit. Pro permet de sélectionner jusqu'à trois concurrents confirmés par rapport. Agency en permet dix. Un site peut conserver jusqu'à dix concurrents actifs.

Les comptes Starter voient l'explication de la mise à niveau. Si un opérateur suspend les nouveaux traitements, les rapports enregistrés restent lisibles. Après un changement de formule, certaines données peuvent aussi rester accessibles en lecture seule.

## Unités et confirmation

Un rapport de paysage utilise une unité `keyword_lookups` par concurrent sélectionné. Trois concurrents consomment donc trois unités. Avant confirmation, RankMeFast indique combien d'unités et de lignes le rapport utilisera. Les résultats en cache comptent aussi. L'actualisation de la découverte est facultative. Elle utilise une unité `keyword_lookups` de plus, et seulement après sa propre prévisualisation et confirmation.

Pour chaque concurrent, la comparaison effectue trois contrôles de mots-clés: mots-clés partagés, mots-clés classés uniquement par votre site et mots-clés classés uniquement par le concurrent. Chaque contrôle garde au plus 100 lignes, donc un rapport Agency sur dix concurrents contient au maximum 3 000 lignes.

## Lire un paysage

Le rapport distingue cinq classes:

- `missing`: le concurrent est classé, mais votre site n'a pas été observé.
- `owned_only`: votre site est classé, mais le concurrent n'a pas été observé.
- `shared_behind`: les deux sont classés et votre position est moins bonne.
- `shared_ahead`: les deux sont classés et votre position est meilleure.
- `shared_even`: les deux ont la même position observée.

Les positions, les URL classées et les dates d'observation viennent directement de la source. Le volume de recherche et la difficulté sont des estimations du fournisseur. Les classes, la confiance et les recommandations sont calculées à partir des lignes gardées dans le rapport. Une valeur absente reste absente, sans estimation de remplacement. Un rapport partiel précise combien de concurrents et d'étapes ont fourni des données exploitables.

## Pages classées et contenu

Les rapports Agency peuvent proposer des paires de pages classées. Vérifiez les deux URL avant de lancer une comparaison de contenu. Vous pouvez remplacer l'URL concurrente proposée par une autre URL publique du même domaine confirmé. Une suggestion ne lance jamais de collecte à elle seule, et RankMeFast ne remplace pas discrètement la page par l'accueil.

La comparaison de contenu confirmée utilise une unité `competitor_content_runs` distincte. La vérification d'une paire de pages ne consomme pas cette unité. Le suivi demande lui aussi une action et une confirmation séparées.

Une recommandation reste dans le rapport jusqu'à ce que vous l'acceptiez. L'accepter ajoute un seul élément à Prochaines actions. Cela ne publie aucun contenu et ne lance aucun autre traitement payant.

## Rapports enregistrés et exports

Rouvrir un paysage ou une ancienne analyse de contenu ne déclenche aucun appel fournisseur et ne consomme aucune unité. Les exports PDF, CSV et JSON utilisent l'instantané enregistré. Le PDF refuse une sélection de plus de 1 000 lignes et propose CSV ou JSON. Ces deux formats conservent toute la sélection dans la limite de 3 000 lignes et de la taille globale de téléchargement.

Les anciens favoris Concurrents ouvrent l'onglet Concurrents. L'ancien lien concurrent de Content Intelligence ouvre la vue Contenu. L'outil Keyword Gap autonome conserve son historique et sa facturation d'une unité `keyword_lookups` par concurrent.

Les scores de backlinks et les chiffres de trafic sont des estimations liées à la couverture du fournisseur. Comparez des observations de même source et de même date sans les confondre avec vos propres données analytiques.

Consultez [Plans, limites et crédits](./plans-limits-credits.fr.md) pour les quotas actuels et [Content Intelligence](./content-intelligence.fr.md) pour le traitement de contenu séparé.

[Retour à l'index de la documentation](./index.fr.md)
