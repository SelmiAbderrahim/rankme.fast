---
title: 'Agrupación de palabras clave'
description: 'Cómo agrupa RankMeFast las palabras clave con seguimiento según las URL de resultados compartidas y por qué es aritmética y no una puntuación de similitud.'
locale: es
slug: keyword-clustering
section: product
order: 2
---

# Agrupación de palabras clave

La agrupación reúne tus palabras clave con seguimiento según cuántas URL de resultados comparten. Solo trabaja con observaciones SERP que RankMeFast ya tiene guardadas y nunca lanza una comprobación de posición para rellenar un hueco.

<!-- docs-truth: metric=keyword_cluster_runs; unit=one-run-up-to-200-keywords; cache-hits=count; refund=none-blocked-keywords-are-reported; cadence=on-demand; estimates=shared-url-arithmetic -->

## Cómo se forma un grupo

1. Para cada palabra clave, RankMeFast toma las 10 primeras URL de resultados de su observación guardada más reciente.
2. Dos palabras clave quedan unidas cuando comparten al menos 3 de esas URL.
3. Las uniones se encadenan: si A se une con B y B con C, las tres acaban en el mismo grupo.

Una ejecución cubre hasta 200 palabras clave. La pertenencia es simple aritmética sobre URL compartidas, así que las mismas observaciones guardadas dan siempre los mismos grupos.

## Qué palabras clave pueden entrar

Solo participan las palabras clave de Google con una observación de los últimos 7 días. Antes de empezar, una comprobación previa te muestra cuáles cumplen.

Las que no pueden participar aparecen con su motivo (ausente, obsoleta o vacía) en lugar de desaparecer sin avisar. La ejecución consume su unidad al iniciarse, y las palabras clave bloqueadas no se reembolsan.

## Etiquetas

El motor de IA puede sugerir un nombre para cada grupo, que se muestra con un marcador de IA. Si el etiquetado falla, obtienes grupos sin nombre. La agrupación en sí no cambia, porque nunca depende del modelo.

Tres URL compartidas son un umbral, no una puntuación de similitud, y un grupo no dice nada sobre la intención de búsqueda. RankMeFast nunca inventa una palabra clave, una URL ni una observación para completar un grupo.

## Planes y disponibilidad

Asignaciones mensuales por plan:

- Starter: 0
- Pro: 4
- Agency: 20

Un operador puede desactivar la agrupación con el indicador `KEYWORD_CLUSTERING_ENABLED`. Entonces las nuevas ejecuciones se rechazan con un mensaje localizado, y los grupos que ya tienes siguen disponibles. En [Precios](./pricing.es.md) se explica cómo funcionan las unidades.

[Volver al índice de documentación](./index.es.md)
