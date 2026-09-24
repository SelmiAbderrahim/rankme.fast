---
title: 'Télécharger et partager des rapports'
description: 'Choisissez le bon format, conservez vos filtres et gérez les liens privés.'
locale: fr
slug: report-exports
section: product
order: 12
---

# Télécharger et partager des rapports

RankMeFast exporte une copie figée du rapport affiché. Le fichier et tout partage créé depuis cet instantané conservent les mêmes filtres, dates des sources, libellés, langue et marque. Créer un export ne lance aucun nouvel appel fournisseur et ne consomme aucun crédit.

## Télécharger un rapport

1. Ouvrez un rapport terminé ou un résultat stocké.
2. Réglez la période, les lignes, le moteur, l’appareil, le lieu ou les sections voulues.
3. Choisissez **Télécharger ou partager**, puis un format proposé.
4. Pour récupérer à nouveau le fichier, ouvrez **Exports**, onglet **Téléchargements**.

Le menu ne montre que les formats capables de représenter le rapport. Si la sélection est trop grande pour être complète, RankMeFast refuse l’export et demande de réduire les filtres ou d’utiliser CSV/JSON. Aucune ligne n’est supprimée en silence.

## Formats par type de rapport

Ces identifiants forment le catalogue complet et figurent aussi dans les fichiers JSON versionnés.

| Formats | Types de rapport |
|---|---|
| PDF, CSV, JSON | `audit.run` ; `ranks.current` ; `ranks.history` ; `ranks.serp_features` ; `google.gsc_search` ; `google.gsc_sitemaps` ; `google.gsc_generative_appearance` ; `google.ga4` ; `keyword.research_result` ; `keyword.trends_run` ; `keyword.ai_cluster_run` ; `keyword.serp_cluster_run` ; `keyword.cannibalization` ; `backlinks.deep_run` ; `backlinks.gap_run` ; `backlinks.toxicity_run` ; `competitors.organic` ; `competitors.tech_stack` ; `competitors.traffic_snapshot` ; `competitors.traffic_comparison` ; `competitors.content_run` ; `competitors.landscape_run` ; `actions.plan` ; `ai.visibility` ; `audience.research_run` ; `brand.radar_scan` ; `content.inventory_run` ; `internal_links.run` ; `local.seo_snapshot` ; `local.reviews` ; `local.geogrid_scan` ; `pages.performance` ; `app.keyword_tracking` ; `app.research_result` |
| PDF, JSON | `client.composite` ; `backlinks.summary` ; `content.recommendation_outcome` ; `weekly_pulse.run` |
| PDF, JSON, Markdown | `content.analysis` ; `content.brief` |
| CSV, JSON | `backlinks.inventory` ; `content.monitor_feed` |
| JSON, JSON-LD | `schema.generation` |
| Texte brut | `backlinks.disavow` |

Le PDF sert à lire et présenter. Le CSV n’est proposé que si le rapport est réellement un tableau. Le JSON conserve le document versionné complet. Markdown, JSON-LD et le texte de désaveu ne sont proposés que pour les rapports qui les produisent naturellement.

## Filtres, périodes et dates des sources

L’instantané enregistre la sélection actuelle. Un historique de positions garde les mots-clés et la période choisis ; un export d’avis garde la source, la note, la recherche et les dates. Chaque représentation indique les dates d’observation et distingue observations, valeurs dérivées, estimations et texte généré. Modifier l’écran ensuite ne modifie pas l’instantané.

## Marque et marque blanche

Les PDF et vues publiques portent RankMeFast par défaut. Un compte disposant déjà du PDF en marque blanche peut employer son nom, sa couleur et son logo enregistrés. CSV, JSON, Markdown, JSON-LD et texte n’ont pas de marque visuelle, mais leurs métadonnées conservent le mode choisi. L’export n’ajoute aucun droit au forfait.

## Liens de partage

Si le rapport l’autorise, choisissez **Partager**, les formats publics permis et une durée de un à 90 jours. La valeur par défaut est 30 jours et le lien ne dépasse jamais l’expiration de l’instantané. Copiez-le lors de son affichage : RankMeFast ne conserve pas le lien lisible pour le remontrer.

Toute personne possédant ce lien peut l’ouvrir sans connexion. Les pages sont noindex et no-store, mais vous devez tout de même choisir les destinataires avec soin. Utilisez **Exports → Partages** pour révoquer immédiatement. Un lien expiré, révoqué ou lié à une source supprimée renvoie la même réponse introuvable.

## Confidentialité et utilisation externe

Les exports peuvent contenir URL, requêtes, extraits, positions, avis, analyses de première partie et marque client. Ne les remettez qu’aux personnes autorisées à voir le rapport source. RankMeFast conserve l’instantané autorisé et son empreinte, jamais les identifiants fournisseur, cookies, jetons de partage bruts ni charges de facturation. Les instantanés expirent après 90 jours et sont bloqués dès la suppression du site ou du compte, avant la purge physique.

Les CSV sont en UTF-8. Les cellules commençant par un marqueur de formule (`=`, `+`, `-`, `@`, tabulation ou retour chariot, même après des espaces) reçoivent un préfixe texte avant l’échappement CSV. Gardez-le dans Excel ou Sheets.

Le JSON utilise actuellement `schemaVersion: 1` et un `kindVersion` propre au type. Vérifiez les deux et refusez une version inconnue. Ne dépendez pas des identifiants internes ni du nom de fichier.

Faites relire les fichiers de désaveu, Markdown et JSON-LD par une personne avant usage. RankMeFast ne soumet pas le désaveu à Google, ne publie pas le Markdown et ne déploie pas le JSON-LD à votre place.

[Retour à l’index de la documentation](./index.fr.md)
