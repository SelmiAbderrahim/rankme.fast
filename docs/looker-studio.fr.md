---
title: 'Connecter Looker Studio'
description: 'Copiez le connecteur RankMeFast en lecture seule dans Apps Script et affichez les données SEO stockées dans Looker Studio. Fonction Agency.'
locale: fr
slug: looker-studio
section: developers
order: 4
---

# Connecter Looker Studio

Le connecteur communautaire permet à un compte **Agency** de lire les données déjà stockées par sa propre instance RankMeFast. Il ne lance aucun contrôle, n'appelle aucun fournisseur et ne consomme aucune métrique. Les limites par IP et par clé restent actives. Consultez l'[API publique](./public-api.fr.md) pour le contrat HTTP.

## Avant de commencer

Demandez à l'opérateur d'activer `PUBLIC_EXPORTS_ENABLED`. Créez une clé sous **Compte → Clés API** et copiez-la lors de son unique affichage ; RankMeFast ne conserve ensuite que son empreinte SHA-256. Munissez-vous aussi de l'origine HTTPS de l'instance, sans `/api/v1`.

## Installation et connexion

1. Créez un projet Google Apps Script.
2. Copiez `tools/looker-connector/Code.gs` dans l'éditeur et `appsscript.json` dans l'éditeur du manifeste.
3. Créez un déploiement de test Community Connector et ouvrez-le dans Looker Studio.
4. Saisissez la clé dans l'écran d'authentification **Key** séparé de Google, jamais dans la configuration ou le code.
5. Saisissez l'URL de l'instance, choisissez le jeu de données et indiquez l'identifiant de site à 24 caractères pour l'historique, les fonctionnalités SERP ou les backlinks. Le filtre moteur propose Tous, Google, Bing, YouTube et Amazon.

L'origine est fournie à la configuration : aucun serveur RankMeFast n'est codé en dur. L'historique suit des pages `X-Next-Cursor` de 10 groupes de mots-clés ; les mots-clés, fonctionnalités SERP et backlinks utilisent des pages de 1 000 lignes. Tous s'arrêtent à 10 000 lignes par actualisation, et un curseur répété déclenche une erreur au lieu d'une boucle. Si Looker fournit une plage de dates, ses bornes inclusives sont transmises sur chaque page d'historique.

## Correspondance des champs

| Jeu | Route API | Identifiants Looker |
|---|---|---|
| Sites | `/api/v1/sites` | `id`, `domain`, `url`, `paused`, `created_at` |
| Historique | `/api/v1/sites/:siteId/rank-history` | `keyword_id`, `phrase`, `engine`, `checked_at`, `position`, `rank_absolute`, `source`, `found_url`, `ai_overview_present`, `ai_cited`, `ai_cited_url` |
| Mots-clés | `/api/v1/keywords` | `id`, `site_id`, `phrase`, `location_code`, `language_code`, `device`, `active`, `created_at`, `updated_at`, `latest_position`, `previous_position`, `delta`, `last_checked_at`, `ai_overview_present`, `ai_cited`, `ai_cited_url`, `track_local_pack`, `last_failed_check_at`, `engine`, `engine_target` |
| Fonctionnalités SERP | `/api/v1/serp-features?siteId=…` | `id`, `site_id`, `keyword_id`, `engine`, `checked_at`, `source`, `features_json`, `top_results_json`, `created_at`, `source_kind` |
| Backlinks | `/api/v1/backlink-rows?siteId=…` | `id`, `review_id`, `site_id`, `url`, `domain`, `spam_score`, `rubric_band`, `rubric_version`, `first_seen`, `last_seen`, `dofollow`, `is_broken`, `rationale`, `rationale_status`, `captured_at`, `source_kind` |

`source_kind=provider_observation` identifie une observation fournisseur stockée, jamais une estimation. Les champs JSON restent du texte et les valeurs ressemblant à des formules restent neutralisées.

## Dépannage et sécurité

`401` signale une clé absente ou révoquée, `402` un plan non-Agency, `404` un site étranger au compte, `429` une limite atteinte et `503` des exports désactivés. Utilisez HTTPS, révoquez immédiatement toute clé exposée et créez une source Looker par site ou jeu.

L'artifact suit les guides Google de [construction](https://developers.google.com/looker-studio/connector/build), d'[authentification](https://developers.google.com/looker-studio/connector/auth), la [référence API](https://developers.google.com/looker-studio/connector/reference) et la [référence du manifeste](https://developers.google.com/looker-studio/connector/manifest), consultés le 2026-08-04. La publication dans la galerie est hors périmètre.

[Retour à l'index](./index.fr.md)
