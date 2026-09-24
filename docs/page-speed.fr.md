---
title: 'Vitesse des pages'
description: 'Core Web Vitals en langage clair : visiteurs réels vs estimation de labo.'
locale: fr
slug: page-speed
section: audits
order: 1
---

# Vitesse des pages

Google évalue les pages via les **Core Web Vitals**. RankMeFast sépare les mesures terrain et laboratoire et n’affiche que les preuves réellement renvoyées par le fournisseur configuré.

## Données visiteurs réels
Le Chrome UX Report agrège des visites réelles :
- **LCP** : apparition du plus grand élément. Sous 2,5 s.
- **INP** : réactivité au clic/tap. Sous 200 ms.
- **CLS** : décalages visuels. Sous 0,1.

Les données terrain n’apparaissent que si Google CrUX est configuré et dispose d’un trafic suffisant pour l’URL ou l’origine. Le fournisseur DataForSEO Lighthouse utilisé en production est uniquement laboratoire : cette ligne reste absente au lieu d’inventer des visiteurs réels.

## Estimation labo (Lighthouse)
RankMeFast exécute un test Lighthouse synthétique dans un environnement contrôlé ; la production utilise DataForSEO Lighthouse Live pour ce signal laboratoire. Il reste indicatif et une exécution peut varier d’environ 10 points.

## Mobile
Mesuré séparément. Sans viewport ou avec des zones trop petites, le point passe en **À corriger**.

[Retour à l’index de la documentation](./index.fr.md)
