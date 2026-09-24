---
title: 'Intelligence des avis'
description: 'Synchronisez les avis publics à la demande, consultez tendances et thèmes cités, et sachez quand une unité est rendue.'
locale: fr
slug: review-intelligence
section: research
order: 10
---

# Intelligence des avis

Intelligence des avis récupère les avis publics des fiches Google, Trustpilot et Tripadvisor que vous configurez et les garde au même endroit. Elle calcule les statistiques de note et peut regrouper les éloges et critiques récurrents en thèmes, chacun citant les avis enregistrés sur lesquels il s’appuie.

<!-- docs-truth: metric=review_syncs; unit=one-sync-one-to-three-sources; cache-hits=count; refund=all-sources-provider-fail-zero-new-rows; cadence=on-demand; estimates=stored-observations -->

## Sachez ce que couvre une unité

Une synchronisation confirmée utilise une unité `review_syncs` pour l’ensemble du travail. Vous pouvez choisir une, deux ou trois sources configurées et une profondeur allant jusqu’à 100 avis par source ; le coût n’augmente pas avec le nombre de sources. L’analyse des thèmes est incluse.

L’aperçu et son annulation ne consomment rien. Consultez les [Tarifs](./pricing.fr.md) pour les quotas et packs actuels.

## Comprenez le cache, les doublons et les remboursements

Les avis publics provenant du cache comptent. RankMeFast déduplique par source et identifiant d’avis ; une synchronisation réussie sans nouvelle ligne compte donc aussi, car la source a bien été vérifiée.

Vous récupérez l’unité, une seule fois, seulement si **toutes les sources choisies** échouent et qu’aucun nouvel avis n’est enregistré. Une synchronisation partielle, une synchronisation réussie sans rien de nouveau ou un échec de l’analyse des thèmes utilise quand même l’unité, car le travail sur les avis a eu lieu ou des avis ont été gardés. Relancer ne peut pas rembourser la même unité deux fois.

## Lisez thèmes et statistiques

Notes, volumes, répartition par source et tendances mensuelles viennent des avis stockés. Les thèmes générés sont facultatifs et ne s’affichent que s’ils citent des avis enregistrés ; un texte de thème qui ne peut pas être justifié est écarté. Si leur génération échoue, vos avis et statistiques restent disponibles.

Rechercher, filtrer, rouvrir une exécution et exporter les lignes correspondantes en CSV n’utilise pas de nouvelle unité. Le texte des avis est toujours affiché en texte brut.

## Choisissez quand synchroniser

La fonction travaille **à la demande**. Elle ne surveille pas les fiches en continu, n’envoie pas d’alertes et ne répond pas aux avis. Lancez une nouvelle synchronisation lorsque vous voulez un inventaire plus récent. Une pause des nouvelles synchronisations ne masque pas les données stockées.

Ouvrez l’onglet **Avis** d’un site, configurez une source au minimum, vérifiez l’aperçu, puis confirmez. Voir [Plans, limites & crédits](./plans-limits-credits.fr.md).

[Retour à l’index de la documentation](./index.fr.md)
