---
title: 'Suivi Bing, YouTube et Amazon'
description: 'Comment RankMeFast suit les moteurs hors Google, ce qu''est un jeton cible exact, et pourquoi une position Amazon est une position d''index.'
locale: fr
slug: alt-engine-tracking
section: product
order: 3
---

# Suivi Bing, YouTube et Amazon

Les mots-clés des autres moteurs passent par le parcours d'ajout habituel, avec un sélecteur de moteur. L'historique des positions est étiqueté par moteur, et la vue d'historique propose un filtre de moteur conservé dans l'URL.

<!-- docs-truth: metric=alt_engine_checks; unit=one-keyword-one-engine-check; cache-hits=count; refund=provider-failure-zero-retained; cadence=weekly; estimates=provider-observation -->

## Comment chaque moteur est apparié

- **Bing** fonctionne comme Google : un résultat est le vôtre quand son hôte normalisé est identique à celui de votre site.
- **YouTube** s'appuie sur un identifiant de chaîne exact.
- **Amazon** s'appuie sur un ASIN exact.

Tous les résultats YouTube ou Amazon sont hébergés sur le domaine de la plateforme : comparer les hôtes ne vous apprendrait rien, et RankMeFast ne tente pas non plus d'appariement approximatif sur la marque.

Sans l'identifiant ou l'ASIN exact, il ne devine pas. Le mot-clé ne peut tout simplement pas être suivi sur ce moteur tant que vous n'en ajoutez pas un.

## Cadence et unités

Les cibles hors Google sont vérifiées une fois par semaine, quelle que soit la cadence du site par ailleurs. Chaque vérification mot-clé + moteur réserve une unité de moteur alternatif avant l'envoi de la requête.

Les résultats en cache comptent aussi dans votre quota. Si le fournisseur échoue, rien n'est conservé et l'unité vous est rendue.

## Lire une position Amazon

Une position Amazon est une place dans l'index produit renvoyé par le fournisseur, pas une position en rayon en temps réel. Les blocs sponsorisés sont retirés avant le classement.

Comme pour tous les moteurs, une position correspond à ce qui a été observé à une date donnée. Ce n'est pas une prévision.

## Forfaits et disponibilité

Les quotas mensuels sont Starter 0, Pro 20 et Agency 240. Si vous êtes à court, un pack de crédits ponctuel peut compléter le quota.

Un opérateur peut désactiver ce suivi avec le drapeau `ALT_ENGINE_TRACKING_ENABLED`. Les nouvelles exécutions sont alors refusées avec un message localisé, et l'historique existant reste lisible.

Pour les unités et les limites de forfait, voir [Tarifs](./pricing.fr.md).

[Retour à l'index de la documentation](./index.fr.md)
