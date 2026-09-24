---
title: 'Alertes de position confirmées'
description: 'Comment une variation devient un changement confirmé, et le sens des étiquettes d’observation.'
locale: fr
slug: confirmed-rank-alerts
section: audits
order: 8
---

# Alertes de position confirmées

Une baisse ne devient une alerte qu'après avoir été vue deux fois. Les variations passagères ne finissent donc pas dans votre boîte mail.

## Comment un changement est confirmé

1. Une vérification planifiée constate qu'un de vos principaux mots-clés a perdu plusieurs positions.
2. Nous revérifions ce mot-clé sur le même marché avec une nouvelle requête. Nous n'utilisons jamais de résultat en cache pour cette étape.
3. Si la seconde vérification montre toujours la baisse, c'est un **changement de position confirmé**, et c'est seulement là que nous vous alertons.

## Changements volatils et non confirmés

- **Volatil** : la seconde vérification montre que le mot-clé est remonté. Nous gardons l'enregistrement dans l'historique sans rien envoyer.
- **Non confirmé** : la seconde vérification n'a pas pu avoir lieu, parce que votre quota mensuel était épuisé ou que le fournisseur a échoué. L'entrée reste à titre d'information et ne déclenche aucune alerte.

Les trois cas restent visibles à côté de l'historique de position du mot-clé.

## Étiquettes d'observation

Chaque entrée indique ce que nous avons vu et quand :

- **Marché** : le pays, la langue et l'appareil utilisés pour la vérification.
- **Fenêtre** : l'heure de la première et de la seconde vérification.
- **Fraîcheur de l'observation** : l'âge des données. Des données anciennes sont signalées comme telles et jamais présentées comme du temps réel.
- **Source** : le service du fournisseur d'où viennent les données.

## Où vont les alertes

Un changement de position confirmé apparaît dans [Prochaines actions](./next-actions.fr.md) avec un lien vers l'enregistrement de la baisse. Vous pouvez l'ignorer ou le rouvrir là-bas, et chaque décision reste dans l'historique.

## Consulter est gratuit

Ouvrir la liste des alertes, un enregistrement de baisse ou l'historique ne fait que lire des données enregistrées. Aucune nouvelle requête SERP n'est envoyée et aucune unité de votre offre n'est consommée.

[Retour à l'index de la documentation](./index.fr.md)
