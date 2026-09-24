---
title: 'Plans, limites & crédits'
description: 'Plafonds Starter, Pro et Agency, et crédits de dépassement.'
locale: fr
slug: plans-limits-credits
section: account
order: 2
---

# Plans, limites & crédits

<!-- generated: finite-free-intro:start -->
RankMeFast propose trois abonnements payants : Starter, Pro et Agency.
<!-- generated: finite-free-intro:end -->

## Offres sur mesure

En plus des offres fixes et des packs de crédits, vous pouvez composer votre propre offre dans **Tarifs** ou sous **Facturation → Offre sur mesure**. Vous choisissez les quotas mensuels, le nombre de sites et de sièges, les fonctions à activer et la fréquence de suivi des positions. Chaque réglage a son minimum, son maximum et son pas, et certaines options en exigent ou en excluent d'autres. Le prix affiché dans le navigateur n'est qu'une estimation : c'est le serveur qui fixe le devis.

Les quotas mensuels d'une offre sur mesure se réinitialisent chaque mois à votre date de facturation (UTC). Un achat annuel vous donne 12 de ces quotas mensuels. Les sites, mots-clés et sièges ne se réinitialisent pas : supprimez-en un et sa place se libère. Les limites par exécution, comme le nombre de pages d'un audit, s'appliquent à chaque exécution.

Le paiement annuel retire jusqu'à 20% du coût de 12 paiements mensuels. L'aperçu affiche la remise que vous obtenez vraiment après le minimum, l'arrondi supérieur et notre plancher de coût. Si la remise complète faisait passer le prix sous ce plancher, vous voyez une remise plus faible, aucune remise, ou pas d'option annuelle. Nous n'affichons jamais une remise que vous n'obtiendrez pas.

Un titulaire connecté dont l'adresse e-mail est confirmée peut bloquer un devis pendant 30 minutes. Le bouton de paiement n'apparaît que lorsque le serveur confirme que les achats sont ouverts. Les prix sont en USD et Polar ajoute les taxes éventuelles au paiement. En bac à sable, si le paiement n'est pas configuré, si les données tarifaires sont périmées ou si les ventes sont suspendues, vous pouvez prévisualiser une offre sans pouvoir l'acheter.

Une offre sur mesure démarre une fois son paiement confirmé. Pas d'essai, de coupon, de crédit de portefeuille ni de prorata en cours de période. Ce que vous avez payé reste en place jusqu'à la fin de la période. Modifier l'offre, passer du mensuel à l'annuel (ou l'inverse), ou passer d'une offre fixe à une offre sur mesure demande un nouveau paiement à la fin de la période payée. Si le renouvellement demande un nouveau prix, acceptez-le avant l'échéance affichée, sinon l'offre ne sera pas renouvelée. La résiliation prend effet à la fin de la période. Les soldes de packs encore valables sont conservés, et les options récurrentes ne sont jamais fusionnées discrètement avec vos limites sur mesure. Les remboursements suivent les conditions affichées au paiement. Si un débit tardif passe à un prix qui n'était pas sûr, nous le remboursons intégralement et automatiquement.

## Les trois offres

<!-- generated: finite-plan-table:start -->
<!-- source: tiers.ts -->
| Plan     | Monthly (USD) | Yearly (USD) | Sites | Keywords | Audits/month | Audit pages | Backlink rows | AI summaries | Seats | Audience Research runs |
|----------|---------------|--------------|-------|----------|--------------|-------------|---------------|--------------|-------|------------------------|
| Starter  | $49           | $470.40      | 2     | 250      | 10           | 1,000       | 0             | 20           | 1     | 2                      |
| Pro      | $159          | $1,526.40    | 5     | 1,000    | 30           | 3,000       | 10,000        | 100          | 3     | 10                     |
| Agency   | $499          | $4,790.40    | 50    | 2,000 | 45           | 5,000       | 100,000       | 480          | 15    | 30                 |
<!-- generated: finite-plan-table:end -->

Prix en USD. L’annuel est à 20 % de remise. Le suivi quotidien est une option payante sur toutes les offres.

<!-- generated: finite-limit-semantics:start -->
**Fonctionnement des limites.** Les sites, les mots-clés suivis et les sièges sont comptés tels qu’ils sont à l’instant ; en supprimer un libère sa place. Les audits, contrôles de position, lignes de backlinks, travaux IA et autres unités mesurées repartent à zéro au début de chaque mois civil (UTC). Chaque audit a aussi son propre plafond de pages. Les packs achetés restent sur le compte jusqu’à ce que vous les utilisiez. Les options récurrentes ajoutent uniquement la quantité affichée dans Facturation.
<!-- generated: finite-limit-semantics:end -->

## Exécutions de Recherche d’audience

<!-- source: tiers.ts -->
Une exécution est un travail de recherche complet, quel que soit le nombre de pages lues. Les comptes Starter ont 2 exécutions ; Pro 10, Agency 30 par mois. Aucun pack de crédits n’existe pour cette métrique. Au plafond, attendez la réinitialisation mensuelle ou changez d’offre. Voir [Recherche d’audience](./audience-research.fr.md).

## Unités Intelligence mots-clés et Pulse hebdomadaire

<!-- source: tiers.ts -->
- Une vérification de gap consomme une unité `keyword_lookups` par concurrent comparé.
- Une lecture d’aperçu ou de tendances consomme une unité `keyword_lookups` par mot-clé. Les résultats servis depuis le cache comptent aussi.
- Le clustering d’une liste de mots-clés consomme une unité `ai_summaries` ; relancer la liste identique est gratuit.
- Un digest Pulse hebdomadaire consomme une unité `ai_mentions_checks` par site et par semaine, quel que soit le nombre de destinataires.

Les détails sont dans [Intelligence mots-clés](./keyword-intelligence.fr.md) et [Pulse hebdomadaire](./weekly-pulse.fr.md).

### Limites de la veille concurrentielle

La veille concurrentielle commence avec Pro. Un paysage Pro peut inclure trois concurrents confirmés, contre dix avec Agency. Chaque concurrent sélectionné utilise une unité `keyword_lookups`. L'actualisation facultative de la découverte consomme une unité supplémentaire après une confirmation distincte. La comparaison Agency des pages classées est un traitement séparé et utilise une unité `competitor_content_runs` par lancement confirmé. La lecture d'un rapport, la vérification d'une paire de pages, l'acceptation d'une recommandation et l'export ne consomment aucune de ces unités. Consultez [Backlinks et veille concurrentielle](./backlinks-competitors.fr.md).

## Messages de l'assistant IA

<!-- source: tiers.ts ai-chat -->
Une unité correspond à un message envoyé à l'assistant IA. Les comptes Starter ont 100 messages ; Pro 200, Agency 400 par mois. Les réponses servies du cache et les réponses arrêtées comptent aussi. Un pack unique ajoute 100 messages pour 19 $ sous **Facturation → Crédits**.

## Quotas et unités d’intelligence

<!-- source: tiers.ts intelligence-caps -->
| Offre | Explorations Tendances | Instantanés Trafic | Contrôles Liens | Synchronisations Avis | Analyses Brand Radar |
|---|---:|---:|---:|---:|---:|
| Starter | 10 | 5 | 0 | 0 | 0 |
| Pro | 40 | 25 | 25 | 10 | 0 |
| Agency | 80 | 80 | 80 | 50 | 20 |

Une unité Tendances couvre jusqu’à cinq expressions. Une unité Trafic couvre un domaine cible. Une unité Liens couvre une analyse approfondie ou une branche concurrent d’un écart. Une unité Avis couvre une synchronisation complète d’une à trois sources. Une unité Brand Radar couvre une requête et son résumé cité.

Les résultats en cache comptent, tout comme les recherches réussies qui ne trouvent rien. Une unité ne vous est rendue (une seule fois) que si la source échoue avant que la fonction ait enregistré quoi que ce soit d’utile. Voir [Link Intelligence](./link-intelligence.fr.md), [Traffic Insights](./traffic-insights.fr.md), [Tendances](./keyword-trends.fr.md), [Intelligence des avis](./review-intelligence.fr.md) et [Brand Radar](./brand-radar.fr.md).

## Option Brand Radar et packs

<!-- source: tiers.ts intelligence-products -->
<!-- intelligence-products: brand-addon=60@1900; brand-scans-40=40@2900; link-intel-100=50@1900; review-syncs-100=50@1900; traffic-snapshots-100=100@1900; trend-explorations-200=200@1900 -->
Pro et Agency peuvent ajouter 60 analyses Brand Radar par mois pour 19 $/mois. Les 20 analyses de base d’Agency restent disponibles sans option ; la base de Pro est nulle.

Packs ponctuels : 40 analyses Brand Radar pour 29 $, 50 contrôles Liens pour 19 $, 50 synchronisations Avis pour 19 $, 100 instantanés Trafic pour 19 $ et 200 explorations Tendances pour 19 $. Le solde reste disponible jusqu’à utilisation. Voir [Tarifs](./pricing.fr.md) ou **Facturation → Crédits**.

## Limites ASO, module et packs

<!-- source: tiers.ts app-seo-caps -->
| Offre | Vérifications de mots-clés | Audits de fiches | Vérifications de classements | Recherche de mots-clés | Recherches de concurrents | Analyses d’avis | Profils d’app | Mots-clés d’app suivis |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Starter | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Pro | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 25 |
| Agency | 50 | 4 | 20 | 2 | 0 | 0 | 5 | 50 |

<!-- source: tiers.ts app-seo-products -->
<!-- app-seo-products: addon=app_keyword_checks:600,app_listing_audits:8,app_chart_checks:60,app_keyword_lookups:40,app_competitor_lookups:10,app_review_runs:10@2900; app-keyword-checks-500=500@1900; app-research-50=50@1900; app-competitors-20=20@1900; app-review-runs-10=10@1900 -->
Pro et Agency peuvent ajouter chaque mois 600 vérifications de mots-clés, 8 audits de fiches, 60 vérifications de classements, 40 pages de recherche, 10 recherches de concurrents et 10 analyses d’avis pour 29 $ par mois. Agency conserve aussi son quota de base.

Quatre packs ponctuels sont proposés avec Pro et Agency : 500 vérifications de mots-clés, 50 pages de recherche, 20 recherches de concurrents ou 10 analyses d’avis. Chaque pack coûte 19 $. Les crédits restent disponibles jusqu’à leur utilisation et ne sont débités qu’après le quota mensuel.

## Disponibilité des essais
Les essais sont facultatifs et ne sont pas inclus dans chaque offre payante. Lorsqu'une offre en propose un, sa durée et la date du premier prélèvement apparaissent avant la confirmation du paiement.

## Plafond atteint
L’action bloquée propose l’upgrade ou un **pack de crédits de dépassement**.

## Packs de crédits
Petites recharges qui augmentent la métrique correspondante et restent disponibles jusqu’à utilisation.

## Résiliation et rétrogradation
La résiliation conserve l’accès jusqu’à la fin de la période. La rétrogradation prend effet au renouvellement suivant ; les ressources en trop deviennent en lecture seule.

## Offres entreprise
<!-- generated: finite-enterprise-plan:start -->
Enterprise commence avec 100 sites actifs et 25 sièges. L’accord consigne tout plafond plus élevé, toujours sous forme de nombre fixe ; les limites absentes conservent leur valeur Enterprise de base. Voir [Offres entreprise](./enterprise.fr.md).
<!-- generated: finite-enterprise-plan:end -->

[Retour à l’index de la documentation](./index.fr.md)
