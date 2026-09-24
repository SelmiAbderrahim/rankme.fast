---
title: 'Apparence IA générative dans Search Console'
description: 'Combien de fois Google a affiché votre site dans ses fonctionnalités d''IA générative, directement depuis Search Console.'
locale: fr
slug: gsc-generative-appearance
section: research
order: 4
---

# Apparence IA générative dans Search Console

Google Search Console indique combien de fois vos pages sont apparues dans les fonctionnalités d'IA générative de Google, comme les AI Overviews. Cette carte affiche ces chiffres tels que Google les envoie. Nous n'ajoutons ni n'estimons rien.

## Ce que nous lisons

Nous interrogeons l'API Search Console avec `dimensions=['searchAppearance']` sur les 28 derniers jours, en s'arrêtant il y a trois jours pour tenir compte du délai de reporting de Google. Chaque ligne renvoyée est classée d'après la documentation de Google :

- Les valeurs génératives connues reçoivent une étiquette stable.
- Les valeurs inconnues apparaissent en **Autre**, avec leur nom d'origine conservé pour que le support puisse les examiner. Nous ne supposons jamais qu'une valeur inconnue est générative.

## États

- **Disponible** : Google a renvoyé au moins une ligne générative reconnue. La carte affiche, pour chaque ligne, les clics, impressions, CTR et position moyenne envoyés par Google.
- **Indisponible** : Google n'a renvoyé aucune ligne générative reconnue pour cette propriété et cette période. Ce n'est pas un zéro : Google n'a rien signalé du tout, donc nous laissons la case vide au lieu d'afficher 0.
- **Partiel** : Google a renvoyé des lignes mais a marqué la réponse comme partielle (limite de débit ou troncature). Les lignes reçues restent affichées.
- **Reconnexion requise** : la connexion Google doit être renouvelée. Ouvrez l'espace Google du site et suivez l'invite de reconnexion.

## Distinct des métriques fournisseur

Ce sont les données de Google sur votre site. Elles apparaissent dans l'espace Google à côté de vos autres cartes Search Console. Elles ne sont pas mélangées aux graphiques de mentions et de part de voix de l'espace AI Visibility, qui viennent d'un autre fournisseur et mesurent autre chose.

## Ce que ces données ne disent pas

Search Console compte les impressions et les clics, c'est-à-dire combien de fois Google a inclus votre page dans une fonctionnalité générative. Il n'indique pas si la réponse de l'IA vous a nommé, cité, lié ou a préféré un concurrent. Pour cela, utilisez [AI Visibility](./ai-visibility.fr.md).

[Retour à l'index de la documentation](./index.fr.md)
