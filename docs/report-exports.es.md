---
title: 'Descargar y compartir informes'
description: 'Elige el formato adecuado, conserva los filtros y gestiona enlaces privados.'
locale: es
slug: report-exports
section: product
order: 12
---

# Descargar y compartir informes

RankMeFast exporta una copia fija del informe que estás viendo. El archivo y cualquier enlace creado desde esa instantánea conservan filtros, fechas de origen, etiquetas, idioma y marca. Crear un export no ejecuta otra consulta al proveedor ni consume créditos.

## Descargar un informe

1. Abre un informe terminado o un resultado almacenado.
2. Ajusta el periodo, las filas, el motor, el dispositivo, la ubicación o las secciones.
3. Elige **Descargar o compartir** y uno de los formatos disponibles.
4. Para repetir la descarga, abre **Exportaciones → Descargas**.

El menú solo muestra formatos capaces de representar ese informe. Si la selección no cabe completa, RankMeFast rechaza el export y pide reducir filtros o usar CSV/JSON. Nunca elimina filas en silencio.

## Formatos por tipo de informe

Estos identificadores forman el catálogo completo y también aparecen en los JSON versionados.

| Formatos | Tipos de informe |
|---|---|
| PDF, CSV, JSON | `audit.run`; `ranks.current`; `ranks.history`; `ranks.serp_features`; `google.gsc_search`; `google.gsc_sitemaps`; `google.gsc_generative_appearance`; `google.ga4`; `keyword.research_result`; `keyword.trends_run`; `keyword.ai_cluster_run`; `keyword.serp_cluster_run`; `keyword.cannibalization`; `backlinks.deep_run`; `backlinks.gap_run`; `backlinks.toxicity_run`; `competitors.organic`; `competitors.tech_stack`; `competitors.traffic_snapshot`; `competitors.traffic_comparison`; `competitors.content_run`; `competitors.landscape_run`; `actions.plan`; `ai.visibility`; `audience.research_run`; `brand.radar_scan`; `content.inventory_run`; `internal_links.run`; `local.seo_snapshot`; `local.reviews`; `local.geogrid_scan`; `pages.performance`; `app.keyword_tracking`; `app.research_result` |
| PDF, JSON | `client.composite`; `backlinks.summary`; `content.recommendation_outcome`; `weekly_pulse.run` |
| PDF, JSON, Markdown | `content.analysis`; `content.brief` |
| CSV, JSON | `backlinks.inventory`; `content.monitor_feed` |
| JSON, JSON-LD | `schema.generation` |
| Texto sin formato | `backlinks.disavow` |

PDF sirve para leer y presentar. CSV solo se ofrece para datos realmente tabulares. JSON conserva el documento versionado completo. Markdown, JSON-LD y el texto disavow solo se ofrecen en los informes que los generan de forma natural.

## Filtros, periodos y fechas de origen

La instantánea registra la selección actual. Un historial de posiciones guarda las palabras clave y el periodo; un informe de reseñas guarda fuente, puntuación, consulta y fechas. Cada representación incluye fecha o rango de observación y distingue observaciones, valores derivados, estimaciones y texto generado. Cambiar la pantalla después no altera el snapshot.

## Marca y marca blanca

PDF y vistas públicas usan RankMeFast por defecto. Una cuenta que ya tenga derecho a PDF de marca blanca puede aplicar nombre, color y logotipo guardados. CSV, JSON, Markdown, JSON-LD y texto no llevan marca visual, aunque sus metadatos conservan el modo. Exportar no amplía el plan.

## Enlaces compartidos

Si el informe lo permite, elige **Compartir**, los formatos públicos admitidos y una duración entre uno y 90 días. El valor inicial es 30 días y el enlace no puede superar la caducidad del snapshot. Cópialo cuando aparezca: RankMeFast no guarda el enlace legible para volver a mostrarlo.

Quien tenga el enlace puede abrirlo sin iniciar sesión. Las páginas son noindex y no-store, pero debes elegir bien a los destinatarios. Usa **Exportaciones → Compartidos** para revocarlo de inmediato. Un enlace caducado, revocado o sin fuente devuelve la misma respuesta de no encontrado.

## Privacidad y uso externo

Los exports pueden incluir URL, búsquedas, fragmentos, posiciones, reseñas, analítica propia y marca del cliente. Entrégalos solo a personas autorizadas para ver el informe original. RankMeFast guarda la instantánea permitida y su hash, no credenciales del proveedor, cookies, tokens de enlace sin procesar ni datos de facturación. Los snapshots caducan a los 90 días y se bloquean en cuanto se elimina el sitio o la cuenta; la purga física ocurre después.

CSV usa UTF-8. Las celdas que empiezan con un marcador de fórmula (`=`, `+`, `-`, `@`, tabulador o retorno de carro, incluso tras espacios) reciben un prefijo de texto antes del escapado CSV. Conserva esa protección en Excel o Sheets.

JSON usa actualmente `schemaVersion: 1` y un `kindVersion` por tipo. Lee ambos y rechaza versiones desconocidas. No dependas de IDs internos ni del nombre del archivo.

Haz que una persona revise los archivos disavow, Markdown y JSON-LD antes de usarlos. RankMeFast no envía el disavow a Google, no publica Markdown ni despliega JSON-LD por ti.

[Volver al índice de la documentación](./index.es.md)
