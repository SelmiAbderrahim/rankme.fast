---
title: 'Connexion à Google Search Console'
description: 'Pourquoi connecter, à quoi nous accédons, comment déconnecter.'
locale: fr
slug: google-search-console
section: research
order: 3
---

# Connexion à Google Search Console

Search Console est l’outil gratuit de Google. Une fois connecté à RankMeFast, trois règles s’appuient sur la réponse de Google plutôt que sur une estimation :
- **Non indexé** : la page apparaît-elle vraiment dans les résultats ?
- **Résultats enrichis** : vos données structurées sont-elles valides ?
- **Indexé avec avertissement** : Google a-t-il signalé un problème de canonique ou de doublon ?

## Ce à quoi nous accédons
- Portée **lecture seule** : `webmasters.readonly`.
- Aucun accès à Gmail ni à Drive. Nous stockons seulement un jeton de renouvellement chiffré.

## Connecter
1. Paramètres → Google Search Console.
2. Cliquez sur **Connecter Google Search Console**.
3. Connectez-vous et accordez l’accès.

## Déconnecter
Cliquez sur **Déconnecter** : le jeton est supprimé immédiatement. Vous pouvez aussi révoquer l’accès sur https://myaccount.google.com/permissions.

## « Reconnexion requise »
Si Google invalide le jeton, une bannière rouge apparaît. Les trois règles repassent en « données insuffisantes » jusqu’à la reconnexion.

## Performances dans Pages

Le [guide Performance des pages](./pages-performance.fr.md) explique comment l’onglet Pages utilise les lignes Search Analytics enregistrées. L'indexabilité affichée vient du dernier crawl RankMeFast ; elle ne dit pas si Google a indexé l’URL.

[Retour à l’index de la documentation](./index.fr.md)
