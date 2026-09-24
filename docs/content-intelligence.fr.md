---
title: 'Content Intelligence'
description: 'Analysez une page que vous possédez, obtenez un score et une note en clair avec citations.'
locale: fr
slug: content-intelligence
section: audits
order: 3
---

# Content Intelligence

Content Intelligence examine une page que vous possédez et renvoie un
score de préparation, les preuves, une note en langage clair
et, si vous l'acceptez, un brouillon généré par IA. Une analyse
consomme un crédit `content_analyses` de votre quota mensuel ou de votre
pack de crédits. Le score repose sur des règles fixes : une même page obtient
toujours le même score.

## Ce qu'elle fait

- Récupère une page admissible via le service d'exploration configuré.
- Extrait titres, liens, données structurées et signaux de la page.
- Calcule le score avec le même moteur de règles que le rapport d'audit.
- Renvoie les preuves : identifiant de règle, emplacement, extrait et
  niveau de confiance.
- Si vous l'acceptez, appelle l'ordre des fournisseurs IA configuré côté
  serveur pour produire une note et un brouillon optionnel.

## Ce qu'elle ne fait PAS

- Elle ne publie jamais. Le brouillon vous appartient.
- Elle ne parcourt jamais une URL arbitraire. L'URL doit appartenir à un
  site que vous possédez (ou un concurrent Agency).
- Elle ne renvoie jamais la charge utile du fournisseur, l'invite ou la
  complétion. La réponse publique est celle affichée dans l'application.

## Lancer une analyse

- **Sites → Contenu**: choisissez une URL de votre inventaire.
- **Rapport → Fix now / Watch**: la recommandation ouvre le flux.
- **Recherche de mots-clés → mot-clé suivi**: analyse l'URL qui classe.
- **Search Console → requête**: analyse l'URL affichée par Google.
- **Concurrents → page concurrente Agency**: niveau Agency uniquement.

Chaque accès vérifie et réserve votre quota avant de lancer l'analyse (voir
[Plans, limites & crédits](./plans-limits-credits.fr.md)).

## Ce qu'un crédit couvre

Un crédit `content_analyses` couvre : la récupération d'une page possédée,
jusqu'à trois pages publiques de comparaison validées, les données de mot-clé
et de résultats disponibles, le score et ses preuves, la note en
clair et, si l'IA est activée, un brouillon. Une régénération consomme un
autre crédit.

## Score, preuves, confiance, citations, note, brouillon

- **Score.** De 0 à 100. Mêmes règles que le rapport d'audit.
- **Preuves.** Chaque constatation cite la règle, l'emplacement et un
  extrait.
- **Confiance.** `high` / `medium` / `low`.
- **Citations.** Toute affirmation IA cite son URL et son extrait.
- **Note.** Un plan court à partager avec un rédacteur.
- **Brouillon.** Optionnel. Vous acceptez, modifiez ou rejetez.

## Traitement IA opt-in et rétention

Le brouillon IA est opt-in. Les extraits envoyés sont conservés sept
jours puis purgés. Vos contrôles d'export et de suppression dans
[Sécurité du compte](./settings-security.fr.md) restent en vigueur.

## Résultats partiels et remboursés

Si Firecrawl ou un fournisseur IA rencontre un problème, l'analyse est marquée
`partial`. Une régénération est une nouvelle analyse et consomme un autre crédit. Un échec complet est marqué
`refunded` et le crédit est remboursé automatiquement.

## Recommandations et corrélations à 28 jours

Vous pouvez **accepter**, **rejeter** ou **appliquer** une
recommandation. La corrélation 28 jours mesure l'évolution du
classement, des clics et des impressions avant/après. Elle montre ce qui a bougé, sans prouver que
le changement en est la cause.

## Inventaire Pro et cannibalisation

Pro et Agency ouvrent un inventaire de pages regroupées par intention,
avec repérage de cannibalisation. L'inventaire utilise l'allocation distincte
`content_inventory_page_blocks` : un bloc couvre jusqu'à quatre pages possédées
demandées, arrondies au bloc supérieur. Les blocs entiers non utilisés sont
remboursés à la fin de l'exécution.

## Portefeuille de concurrents et monitoring Agency

Les comparaisons Agency partent de pages de classement vérifiées, et non de
pages d’accueil concurrentes. Ouvrez un rapport de paysage, examinez la page
suggérée et ses mots-clés justificatifs, puis confirmez-la ou saisissez une
autre page du même domaine. Une suggestion seule ne lance aucun travail payant,
et une page indisponible n’est jamais remplacée discrètement par l’accueil.

Une analyse confirmée peut comparer jusqu’à 15 pages concurrentes vérifiées
aux pages de votre site que vous avez choisies. L’étape de validation affiche
le nombre de pages et les unités avant toute réservation. RankMeFast conserve
des faits dérivés et de courts extraits, jamais le HTML brut ; les extraits
expirent après sept jours.

Le monitoring reste une action distincte. « Surveiller cette page vérifiée »
ouvre le formulaire existant, où vous confirmez l’URL exacte avant d’utiliser
un emplacement. Aucune surveillance n’est créée pendant l’analyse ; la cadence
hebdomadaire et les limites du forfait restent inchangées. Un changement
Firecrawl ignoré ne déclenche plus d'alerte.

Vous pouvez aussi ouvrir une analyse ciblée depuis une opportunité du rapport.
L’URL de votre site, le mot-clé et la page concurrente vérifiée sont préremplis,
mais vous devez encore confirmer avant le lancement.

## Gérer l'allocation et le pack de 20 analyses

Le quota mensuel dépend de votre offre, voir
[Plans, limites & crédits](./plans-limits-credits.fr.md). Le pack de 20
crédits n'expire jamais et s'ajoute au quota.

## Dépannage

- **Accès.** L'URL doit vous appartenir. Sinon, la réponse est "introuvable"
  plutôt que "interdit", pour ne pas révéler si l'URL existe.
- **robots.txt.** Si votre page possédée bloque l'exploration, l'exécution
  échoue et son crédit est remboursé. Une comparaison facultative bloquée peut
  laisser un résultat `partial`. RankMeFast ne contourne jamais ces règles.
- **URL pas encore dans Search Console.** L'analyse porte sur le HTML
  récupéré, sans comparaison Search Console.
- **Limites.** Message localisé nommant la métrique `content_analyses`.
- **Panne d'un fournisseur.** Le résultat est `partial` ou `refunded`,
  jamais présenté comme un succès.

## Connexion MCP

Depuis Claude Code, Claude Desktop, Cursor ou VS Code, voir
[RankMeFast MCP](./rankmefast-mcp.fr.md).

## Export et suppression

Les analyses sont incluses dans l'export du compte. Les contrôles sont
décrits dans [Sécurité du compte](./settings-security.fr.md).
