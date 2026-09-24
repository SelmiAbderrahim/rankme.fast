---
title: 'Performance des pages'
description: 'Comment l’onglet Pages choisit sa source, compare les instantanés et compte les actualisations.'
locale: fr
slug: pages-performance
section: research
order: 13
---

# Performance des pages

Ouvrez un site puis choisissez **Pages** pour rapprocher les performances de recherche du dernier inventaire exploré. L'ouverture lit les données stockées. Une nouvelle collecte démarre uniquement avec **Actualiser** ou **Collecter les données de secours**.

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

## Coût et données obsolètes

Une actualisation Search Console réutilise la synchronisation connectée sans dépenser de recherche de mot-clé. Une actualisation de secours coûte une recherche, y compris en cas de cache. L'ouverture d'un détail, la recherche, les filtres, le tri et la pagination restent gratuits.

Après un échec, le dernier instantané réussi reste visible avec le statut obsolète. Un ancien instantané de secours devient aussi obsolète après la fenêtre de fraîcheur du cache.

## Suppression et export

La suppression d'un site, ou l'achèvement d'une demande de suppression du compte, efface ses instantanés Pages stockés. L'export de compte actuel n'inclut ni les instantanés Pages ni l'historique chronologique de GSC et du suivi de positions. Il ne constitue donc pas une sauvegarde de ces tendances.

## Dépannage

- Pour **Synchronisation**, attendez la première collecte Search Console.
- Pour **Reconnexion**, rétablissez Google depuis son onglet.
- Si la propriété ne correspond pas, choisissez une propriété couvrant le préfixe d'URL ou le domaine.
- Sans source stockée, connectez Search Console ou lancez la collecte de secours comptabilisée.
- À la limite, consultez l'usage ou le forfait. Les instantanés existants restent lisibles.
- En cas d'indisponibilité, réessayez la même source. RankMeFast ne remplace pas silencieusement une source Search Console utilisable.

Voir aussi [Connexion à Google Search Console](./google-search-console.fr.md) et [Suivi de positions](./rank-tracking.fr.md).

[Retour à l’index de la documentation](./index.fr.md)
