---
title: 'Lire votre rapport d’audit'
description: 'À corriger, À surveiller, Réussis : ce que signifie chaque onglet et chaque règle.'
locale: fr
slug: audit-report
section: start
order: 2
---

# Lire votre rapport d’audit

Après chaque audit, vous arrivez sur un rapport à trois onglets avec un bouton **Relancer**.

## Les trois onglets
- **À corriger** : les problèmes auxquels Google réagit le plus vite.
- **À surveiller** : des points moins urgents, ou des données insuffisantes.
- **Réussis** : les vérifications passées.

## Ce qu’affiche chaque problème
- **Titre** : le nom du problème, en clair.
- **Pourquoi c'est important** : une phrase sur l’impact.
- **URL concernées** : les pages où le problème a été trouvé.
- **Comment corriger** : la modification à faire, avec un bouton pour la copier.

## Relancer et badges d’évolution
Après une correction, cliquez sur **Relancer**. Deux badges peuvent apparaître :
- **Corrigé** : la règle passe désormais.
- **Régression** : la règle échoue alors qu’elle passait.

## Fichier `llms.txt`
Une convention récente qui indique aux assistants IA les pages que vous préférez voir citées. Chez nous, cette règle est **indicative**.

## Chaque règle en clair
- **Bloqué de Google** : Une règle `robots.txt` empêche Google d’y accéder.
- **Sitemap manquant ou faible** : Ajoutez `sitemap.xml` et référencez-le dans `robots.txt`.
- **Titres de page manquants ou faibles** : Titre unique de 30 à 60 caractères par page.
- **Meta descriptions manquantes ou dupliquées** : Une description unique par page.
- **Titres H1/H2 mal utilisés** : Un seul `<h1>` par page.
- **Canonical manquant ou cassé** : Ajoutez un `<link rel="canonical">` valide.
- **Données structurées manquantes** : Ajoutez le JSON-LD adapté.
- **Liens internes cassés** : Corrigez ou supprimez les liens en erreur.
- **Contenu trop léger** : Pages en-dessous d’environ 200 mots.
- **Aucun signal FAQ** : Ajoutez une section FAQ quand pertinent.
- **Fichier llms.txt absent (informatif)** : Convention récente destinée aux robots d’IA.
- **HTTPS non appliqué** : Redirigez http vers https.
- **Performances visiteurs réelles faibles** : Données Chrome UX indiquant une expérience lente.
- **Estimation labo faible** : Un seul passage Lighthouse varie beaucoup d’une fois à l’autre.
- **Non adapté au mobile** : Vérifiez viewport et taille des cibles.
- **Non indexé** : Google n’a pas ajouté la page à l’index.
- **Problèmes de résultats enrichis** : Erreurs dans les données structurées.
- **Indexé avec avertissements** : Signal de canonisation/doublon détecté.

[Retour à l’index de la documentation](./index.fr.md)
