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

## Quand Google demande de se reconnecter
Si Google invalide le jeton (par exemple après un changement de mot de passe de votre compte), la carte Google Search Console de l’onglet **Google** du site affiche une alerte rouge, **Votre connexion Google doit être renouvelée**, avec un bouton **Reconnecter**. Les cartes qui lisent Search Console ou Google Analytics affichent **Search Console n’est pas connecté** ou **Google Analytics n’est pas connecté**, avec **Connecter Google**. Tant que vous ne vous reconnectez pas, les trois règles repassent en « données insuffisantes ».

## Choisir la propriété
L’onglet **Google** du site associe automatiquement votre site à une propriété Search Console. Si aucune ne correspond, ou si plusieurs correspondent, RankMeFast vous demande d’en choisir une. Une propriété qui appartient à un autre site ne peut être liée qu’après votre confirmation, car ses données de recherche s’afficheraient alors sur ce site. Google Analytics fonctionne de la même façon. Si les données Google Analytics les plus récentes sont plus anciennes que prévu, un message l’indique et **Actualiser** relance la synchronisation ; RankMeFast la lance aussi une fois par jour.

## Performances dans Pages

Le [guide Performance des pages](./pages-performance.fr.md) explique comment l’onglet Pages utilise les lignes Search Analytics enregistrées. L'indexabilité affichée vient du dernier crawl RankMeFast ; elle ne dit pas si Google a indexé l’URL.

[Retour à l’index de la documentation](./index.fr.md)
