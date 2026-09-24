---
title: 'Conectar Looker Studio'
description: 'Copia el conector de solo lectura de RankMeFast en Apps Script y lleva datos SEO almacenados a Looker Studio. Función Agency.'
locale: es
slug: looker-studio
section: developers
order: 4
---

# Conectar Looker Studio

El conector comunitario permite que una cuenta **Agency** lea datos ya almacenados en su propia instancia de RankMeFast. No inicia comprobaciones, no llama a proveedores y no consume métricas. Siguen vigentes los límites por IP y por clave. Consulta la [API pública](./public-api.es.md) para ver el contrato HTTP.

## Antes de empezar

Pide al operador que active `PUBLIC_EXPORTS_ENABLED`. Crea una clave en **Cuenta → Claves API** y cópiala cuando se muestre una sola vez; después RankMeFast conserva únicamente su resumen SHA-256. Necesitas también el origen HTTPS de la instancia, sin `/api/v1`.

## Instalar y conectar

1. Crea un proyecto de Google Apps Script.
2. Copia `tools/looker-connector/Code.gs` en el editor y `appsscript.json` en el editor del manifiesto.
3. Crea un despliegue de prueba de Community Connector y ábrelo en Looker Studio.
4. Introduce la clave en la pantalla separada de autenticación **Key** de Google, nunca en la configuración o el código.
5. Indica la URL y el conjunto de datos. El historial, las funciones SERP y los backlinks requieren el ID de sitio de 24 caracteres. El filtro admite Todos, Google, Bing, YouTube y Amazon.

La URL se facilita durante la configuración; el conector no contiene un origen fijo. El historial sigue páginas `X-Next-Cursor` de 10 grupos de palabras clave; las palabras clave, las funciones SERP y los backlinks usan páginas de 1.000 filas. Todos se detienen en 10.000 filas por actualización, y un cursor repetido produce un error en vez de un bucle. Si Looker proporciona un intervalo de fechas, sus límites inclusivos se envían en cada página del historial.

## Mapeo de campos

| Conjunto | Ruta API | IDs de campo de Looker |
|---|---|---|
| Sitios | `/api/v1/sites` | `id`, `domain`, `url`, `paused`, `created_at` |
| Historial | `/api/v1/sites/:siteId/rank-history` | `keyword_id`, `phrase`, `engine`, `checked_at`, `position`, `rank_absolute`, `source`, `found_url`, `ai_overview_present`, `ai_cited`, `ai_cited_url` |
| Palabras clave | `/api/v1/keywords` | `id`, `site_id`, `phrase`, `location_code`, `language_code`, `device`, `active`, `created_at`, `updated_at`, `latest_position`, `previous_position`, `delta`, `last_checked_at`, `ai_overview_present`, `ai_cited`, `ai_cited_url`, `track_local_pack`, `last_failed_check_at`, `engine`, `engine_target` |
| Funciones SERP | `/api/v1/serp-features?siteId=…` | `id`, `site_id`, `keyword_id`, `engine`, `checked_at`, `source`, `features_json`, `top_results_json`, `created_at`, `source_kind` |
| Backlinks | `/api/v1/backlink-rows?siteId=…` | `id`, `review_id`, `site_id`, `url`, `domain`, `spam_score`, `rubric_band`, `rubric_version`, `first_seen`, `last_seen`, `dofollow`, `is_broken`, `rationale`, `rationale_status`, `captured_at`, `source_kind` |

`source_kind=provider_observation` identifica una observación almacenada del proveedor, no una estimación. Los campos JSON siguen siendo texto y las cadenas parecidas a fórmulas permanecen neutralizadas.

## Solución de problemas y seguridad

`401` indica una clave ausente o revocada; `402`, un plan distinto de Agency; `404`, un sitio ajeno; `429`, el límite normal; y `503`, exportaciones desactivadas. Usa HTTPS, revoca de inmediato cualquier clave expuesta y crea fuentes separadas por sitio o conjunto.

El artefacto sigue las guías de Google de [construcción](https://developers.google.com/looker-studio/connector/build), [autenticación](https://developers.google.com/looker-studio/connector/auth), [referencia API](https://developers.google.com/looker-studio/connector/reference) y [manifiesto](https://developers.google.com/looker-studio/connector/manifest), consultadas el 2026-08-04. No incluye publicación en la galería.

[Volver al índice](./index.es.md)
