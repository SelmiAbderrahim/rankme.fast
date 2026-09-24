---
title: 'Tendencias de palabras clave'
description: 'Explora dirección, impulso y estacionalidad del interés de búsqueda con etiquetas de estimación claras.'
locale: es
slug: keyword-trends
section: research
order: 9
---

# Tendencias de palabras clave

Tendencias de palabras clave muestra cómo cambia el interés de búsqueda. Una exploración ofrece un índice relativo, dirección interanual, impulso reciente y meses estacionales para un máximo de cinco palabras clave.

<!-- docs-truth: metric=trend_explorations; unit=one-exploration-up-to-five-keywords; cache-hits=count; refund=provider-failure-zero-retained-series; cadence=on-demand; estimates=required -->

## Qué cubre una unidad

Una exploración confirmada usa una unidad de `trend_explorations`, tanto si introduces una palabra como cinco. Previsualizar, cancelar, abrir una ejecución guardada o seleccionar una consulta relacionada antes de confirmar no consume nada. Una continuación confirmada es una exploración nueva.

Consulta [Precios](./pricing.es.md) para ver límites y paquetes actuales.

## El índice es una estimación

Cada serie y lectura lleva la etiqueta **Estimación**. El índice de interés de 0 a 100 es relativo al mercado y periodo elegidos. No es volumen mensual absoluto, tráfico ni una previsión.

- La comparación interanual necesita al menos 56 observaciones válidas.
- El impulso necesita 12 observaciones y puede subir, bajar o mantenerse estable.
- La estacionalidad necesita 24 meses distintos. Si no hay historial suficiente, RankMeFast lo indica en vez de inventar un patrón.

Una respuesta correcta pero plana, escasa o vacía es un resultado real, no un error.

## Caché y reembolsos

Un resultado desde caché también usa una unidad. Una exploración correcta sin series igualmente cuenta.

Si la fuente falla antes de conservar una serie, la unidad reservada se devuelve una sola vez y la ejecución aparece como reembolsada. En cuanto se guarda una serie útil, la unidad permanece consumida aunque falte otra lectura.

## Cuándo explorar

La función trabaja **bajo demanda**, no como monitorización continua. Ejecútala de nuevo cuando necesites una vista más reciente. Si se pausan nuevas exploraciones, las ejecuciones guardadas siguen disponibles.

Abre **Tendencias en vivo** desde Investigación de palabras clave, introduce hasta cinco frases, elige mercado e idioma, revisa la vista previa y confirma. Consulta [Planes, límites y créditos](./plans-limits-credits.es.md).

[Volver al índice de la documentación](./index.es.md)
