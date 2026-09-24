---
title: 'Inteligencia de reseñas'
description: 'Sincroniza reseñas públicas bajo demanda y entiende tendencias, temas citados y la devolución de unidades.'
locale: es
slug: review-intelligence
section: research
order: 10
---

# Inteligencia de reseñas

Inteligencia de reseñas recoge las reseñas públicas de las fichas de Google, Trustpilot y Tripadvisor que configures y las guarda en un solo lugar. Calcula estadísticas de valoración y puede agrupar elogios y quejas repetidos en temas, cada uno citando las reseñas guardadas en las que se basa.

<!-- docs-truth: metric=review_syncs; unit=one-sync-one-to-three-sources; cache-hits=count; refund=all-sources-provider-fail-zero-new-rows; cadence=on-demand; estimates=stored-observations -->

## Conoce qué cubre una unidad

Una sincronización confirmada usa una unidad de `review_syncs` para todo el trabajo. Puedes elegir una, dos o tres fuentes configuradas y una profundidad de hasta 100 reseñas por fuente; el coste no aumenta con el número de fuentes. El análisis de temas está incluido.

Previsualizar o cancelar no consume nada. Consulta [Precios](./pricing.es.md) para ver límites y paquetes actuales.

## Entiende la caché, la deduplicación y los reembolsos

Las reseñas públicas obtenidas desde caché también cuentan. RankMeFast elimina duplicados por fuente e identificador de reseña, así que una sincronización correcta sin filas nuevas igualmente cuenta: la fuente se comprobó.

Recuperas la unidad, una sola vez, solo cuando **todas las fuentes elegidas** fallan y no se guarda ninguna reseña nueva. Una sincronización parcial, una correcta sin nada nuevo o un fallo al generar temas sigue usando la unidad, porque el trabajo con las reseñas se hizo o se guardaron reseñas. Reintentar no puede devolver la misma unidad dos veces.

## Lee temas y estadísticas

Valoraciones, cantidades, reparto por fuente y tendencias mensuales proceden de reseñas guardadas. Los temas generados son opcionales y solo aparecen si citan reseñas guardadas; el texto de un tema que no se puede respaldar se descarta. Si esa generación falla, tus reseñas y estadísticas siguen disponibles.

Buscar, filtrar, abrir una ejecución y exportar filas en CSV no usa otra unidad. El texto de las reseñas siempre se muestra como texto sin formato.

## Decide cuándo sincronizar

La función trabaja **bajo demanda**. No monitoriza fichas continuamente, no envía alertas, no responde a reseñas ni redacta respuestas. Inicia otra sincronización cuando quieras datos más recientes. Pausar nuevas sincronizaciones no oculta lo almacenado.

Abre la pestaña **Reseñas** de un sitio, configura al menos una fuente, revisa la vista previa y confirma. Consulta [Planes, límites y créditos](./plans-limits-credits.es.md).

[Volver al índice de la documentación](./index.es.md)
