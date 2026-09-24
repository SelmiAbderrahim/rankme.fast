---
title: 'API publique'
description: 'Lisez vos sites, rapports, positions et mots-clés via une API simple authentifiée par clé. Fonction Agency.'
locale: fr
slug: public-api
section: developers
order: 1
---

# API publique

L'API publique offre un accès en lecture seule aux données que RankMeFast détient déjà pour votre compte : sites, dernier rapport d'audit, historique des positions et mots-clés suivis. C'est une fonction **Agency** (voir [Plans, limites et crédits](./plans-limits-credits.fr.md)). Elle ne déclenche jamais de nouveau travail chez un fournisseur et lit uniquement ce que vos audits et vérifications de position ont déjà produit.

Content Intelligence ne fait pas partie de `/api/v1` : lancer une analyse ou modifier une recommandation se fait uniquement dans l'application, une fois connecté. MCP peut lire les analyses enregistrées, mais ne peut ni en lancer une ni modifier une recommandation.

## Authentification

Créez une clé dans **Compte → Clés API** (`/profile?tab=api-keys`). La clé complète n'est affichée **qu'une seule fois** : copiez-la immédiatement ; ensuite seul son préfixe reste visible. Vous pouvez détenir jusqu'à dix clés actives et en révoquer à tout moment. Une clé révoquée cesse de fonctionner immédiatement.

Envoyez la clé comme jeton bearer sur chaque requête :

```
Authorization: Bearer rmf_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

Remplacez `https://your-rankme-host` dans les exemples ci-dessous par l'origine de votre api (le `SERVER_URL` de votre installation).

## Langue de réponse et contrat de données

Choisissez la langue de la réponse avec `x-lang`, puis `Accept-Language` ; à défaut, l’API utilise `en`. Une valeur régionale comme `fr-CA` devient `fr`. `/api/v1` ignore les cookies du navigateur, la langue du compte et les préférences de l’espace de travail. Chaque réponse indique la langue utilisée dans `Content-Language` et ajoute `x-lang, Accept-Language` à `Vary` en conservant les valeurs existantes.

Seuls les textes rédigés par RankMeFast (rapports, constats, actions et messages d’erreur sûrs) sont traduits. Les propriétés JSON, statuts HTTP, codes d’erreur stables, valeurs d’énumération et d’état, identifiants, domaines, URL, mots-clés, horodatages, mesures, observations, curseurs et textes enregistrés de l’utilisateur ou du fournisseur ne changent pas. La langue ne modifie jamais le tri ni le format des nombres et des dates.

Le CSV est identique octet par octet dans toutes les langues : BOM UTF-8, noms et ordre des colonnes, ordre des lignes, échappement RFC-4180, valeurs, fins de ligne, nom de fichier, en-têtes de pagination et comportement du curseur. `Content-Language` indique la langue choisie, mais ne traduit ni ne renomme rien dans le CSV.

## Points d'accès

### Lister vos sites

```bash
curl -H "Authorization: Bearer rmf_..." \
  https://your-rankme-host/api/v1/sites
```

Renvoie `{ "sites": [{ "id", "domain", "url", "createdAt" }] }`.

### Dernier rapport d'audit d'un site

```bash
curl -H "Authorization: Bearer rmf_..." \
  https://your-rankme-host/api/v1/sites/<siteId>/report/latest
```

Renvoie l'audit **réussi** le plus récent sous la forme `{ "runId", "report" }`, avec les mêmes constats, catégories et textes localisés que le tableau de bord. Répond `404` si le site n'a pas encore d'audit terminé.

### Historique des positions d'un site

```bash
curl -H "Authorization: Bearer rmf_..." \
  "https://your-rankme-host/api/v1/sites/<siteId>/rank-history?from=2026-06-01&to=2026-07-01"
```

Renvoie `{ "keywords": [{ "id", "phrase", "series": [...] }] }`. Chaque point porte la position, l'URL classée et les signaux Google AI Overview (`aiOverviewPresent`, `aiCited`, `aiCitedUrl`). `from` et `to` sont des dates ISO facultatives.

### Tous les mots-clés suivis

```bash
curl -H "Authorization: Bearer rmf_..." \
  https://your-rankme-host/api/v1/keywords
```

Renvoie chaque mot-clé suivi sur l'ensemble de vos sites avec sa dernière position, son delta et les champs AI Overview.

## Exports CSV et lignes stockées

Avec `PUBLIC_EXPORTS_ENABLED`, demandez un CSV sur chaque route de liste avec `?format=csv` ou `Accept: text/csv`. Les fichiers ont des colonnes stables, un BOM UTF-8, l'échappement RFC-4180 et une neutralisation des formules. Le JSON des quatre routes d'origine ne change pas. L'historique accepte `engine=google|bing|youtube|amazon` ; sans filtre, la colonne `engine` contient tous les moteurs.

Les CSV d'historique et de mots-clés conservent leur sortie historique non paginée, sauf si vous ajoutez `limit` ou un `cursor` opaque. Une page d'historique accepte de 1 à 25 groupes de mots-clés (730 points au plus par groupe), contre 1 à 1 000 lignes pour les mots-clés. Transmettez la valeur de `X-Next-Cursor` à la requête suivante et arrêtez-vous lorsque cet en-tête disparaît. Le JSON ignore ces paramètres de pagination CSV et conserve son contrat d'origine.

Deux lectures stockées s'ajoutent : `GET /api/v1/serp-features?siteId=<siteId>` et `GET /api/v1/backlink-rows?siteId=<siteId>`. Elles acceptent `limit` de 1 à 1 000 et un `cursor` opaque, restent limitées au compte et portent `sourceKind=provider_observation` (`source_kind` en CSV). Si le drapeau est désactivé, les nouvelles routes et le CSV répondent `503`, mais le JSON d'origine reste disponible. Suivez le [guide Looker Studio](./looker-studio.fr.md) pour le connecteur et les champs.

## Compatibilité

Cette version expose exactement six routes en lecture seule :

- `GET /api/v1/sites`
- `GET /api/v1/sites/:siteId/report/latest`
- `GET /api/v1/sites/:siteId/rank-history`
- `GET /api/v1/keywords`
- `GET /api/v1/serp-features`
- `GET /api/v1/backlink-rows`

Le Radar de marque, l’Intelligence des avis, l’Intelligence des liens, l’Analyse du trafic et les Tendances de mots-clés n’ont pas de route sous `/api/v1`. Ce sont des fonctions du tableau de bord qui exigent une connexion. Les champs existants conservent leur sens, et les clients doivent ignorer les nouveaux champs qu’ils ne reconnaissent pas.

<!-- public-api-routes: GET /api/v1/sites; GET /api/v1/sites/:siteId/report/latest; GET /api/v1/sites/:siteId/rank-history; GET /api/v1/keywords; GET /api/v1/serp-features; GET /api/v1/backlink-rows -->

## Limites de débit

Par défaut, chaque clé peut effectuer **120 requêtes par minute**. Au-delà, l'API répond `429` jusqu'à la réinitialisation de la fenêtre.

## Erreurs

Les erreurs utilisent la forme `{ "error": { "message": "...", "details": ... } }`. Le message lisible suit `x-lang`, puis `Accept-Language`, puis `en` ; le statut, les champs, les codes stables et les détails ne changent pas selon la langue :

- `401` : la clé est absente, malformée, révoquée ou inconnue.
- `402` : votre plan n'inclut pas l'API.
- `404` : le site ou le rapport n'existe pas sur votre compte.
- `429` : limite de débit dépassée (corps : `{ "error": "..." }`).

[Retour à l'index de la documentation](./index.fr.md)
