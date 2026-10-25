---
title: 'Performance des pages'
description: 'Comment l’onglet Pages présente les données de recherche enregistrées, le crawl et les mesures.'
locale: fr
slug: pages-performance
section: research
order: 13
---

# Performance des pages

Ouvrez un site puis choisissez **Pages** pour rapprocher les performances de recherche du dernier inventaire exploré. L'ouverture lit les données stockées. Une nouvelle collecte démarre uniquement avec **Actualiser** ou **Obtenir les données de classement**.

## Source utilisée

RankMeFast utilise Google Search Console lorsque la propriété connectée couvre le site. Search Console reste prioritaire pendant la première synchronisation et quand la fenêtre choisie ne contient aucune ligne. Une source Search Console utilisable mais vide n'est jamais remplacée par des estimations.

Sans connexion utilisable, l'onglet peut lire le dernier instantané stocké de mots-clés classés. Le libellé distingue DataForSEO des données de démonstration. En l'absence de toute donnée, l'écran indique quoi connecter ou collecter.

## Mesures et fenêtres

Les clics, impressions, CTR et position moyenne de Search Console sont observés sur une fenêtre glissante de 7, 28 ou 90 jours. Les données Google ont trois jours de retard. Search Console peut échantillonner ou plafonner les lignes, alors consultez la note de couverture avant de comparer les totaux.

La position, le volume, la difficulté, le nombre de mots-clés classés et le trafic estimé de la source de secours viennent d'un instantané ponctuel. Les clics, impressions et CTR affichent **Non disponible**. Cela reste distinct d'une vraie valeur zéro. Changer la fenêtre modifie l'historique et la comparaison, pas les chiffres principaux de l'instantané.

**Depuis la synchronisation précédente** compare deux instantanés réussis consécutifs. Ce n'est pas une comparaison avec la période précédente. Le détail d'une page montre ses requêtes Search Console ou ses mots-clés associés, ainsi que 90 points historiques au maximum.

## Opportunités et exploration

- **À portée** couvre une position supérieure à 3 et inférieure ou égale à 20 avec une demande suffisante.
- **CTR faible** concerne seulement les lignes Search Console qui satisfont les seuils d'impressions et de position.
- **En baisse** et **En progression** comparent la position ou les clics observés à la synchronisation précédente.
- **Visible mais non explorable pour indexation** signale une performance alors que le dernier crawl marque la page non indexable.
- **Non mesurée** signale une page explorable et indexable présente dans le crawl, mais absente de la source de performance.

L'indexabilité de crawl décrit ce que RankMeFast a trouvé en explorant le site. Elle ne prouve pas que Google a indexé l'URL. Une page visible mais non indexable reste affichée pour permettre l'analyse du conflit.

## Données enregistrées et actualisation

La colonne Page reste visible lors du défilement horizontal. Utilisez **Colonnes** pour afficher ou masquer les autres champs. Un tiret indique une valeur absente ; zéro signifie que la source a mesuré zéro. Une page sans titre porte le nom de son chemin. Si une URL mesurée correspond à une page explorée sous un préfixe de langue, **Explorée sous** affiche ce chemin.

La note Search Console précise les jours couverts par les totaux des pages. Google peut compter une impression pour chaque page affichée lors d’une recherche, même lorsque le texte de la requête reste privé. Les totaux des pages peuvent donc dépasser ceux du site dans l’onglet Google. **Données insuffisantes** signale une page avec peu d’impressions et aucun clic ; elle ne reçoit pas encore de libellé de progression. La note d’exploration indique combien d’URL le dernier audit a récupérées et, si cela a été enregistré, pourquoi il s’est arrêté.

L’ouverture des détails, la recherche, les filtres, le tri et le changement de colonnes ou de pages de résultats lisent les données enregistrées. **Actualiser** demande de nouvelles données à la source. En cas d’échec, le dernier instantané réussi reste visible et est marqué comme obsolète. Réessayez lorsque la connexion est disponible.

## Suppression et export

La suppression d'un site, ou l'achèvement d'une demande de suppression du compte, efface ses instantanés Pages stockés. L'export de compte actuel n'inclut ni les instantanés Pages ni l'historique chronologique de GSC et du suivi de positions. Il ne constitue donc pas une sauvegarde de ces tendances.

## Dépannage

- Pour **Synchronisation**, attendez la première collecte Search Console.
- Pour **Reconnexion**, rétablissez Google depuis son onglet.
- Si la propriété ne correspond pas, choisissez une propriété couvrant le préfixe d'URL ou le domaine.
- Sans source enregistrée, connectez Search Console ou choisissez **Obtenir des données de classement**.
- En cas d'indisponibilité, réessayez la même source. RankMeFast ne remplace pas silencieusement une source Search Console utilisable.

Voir aussi [Connexion à Google Search Console](./google-search-console.fr.md) et [Suivi de positions](./rank-tracking.fr.md).

[Retour à l’index de la documentation](./index.fr.md)
