---
title: 'Inteligencia de enlaces'
description: 'Ejecuta análisis de backlinks más profundos y compara brechas de enlaces sabiendo qué cubre cada unidad.'
locale: es
slug: link-intelligence
section: research
order: 7
---

# Inteligencia de enlaces

Usa Inteligencia de enlaces cuando el resumen normal de backlinks no sea suficiente. Puedes obtener dominios de referencia, textos ancla, historial o rangos de dominios, y comparar tu sitio con un máximo de tres competidores.

<!-- docs-truth: metric=link_intel_checks; unit=deep-one-gap-per-competitor; cache-hits=count; refund=provider-failure-zero-retained-per-leg; cadence=on-demand; estimates=provider-observation -->

## Qué cubre una unidad

- Cada consulta profunda enviada usa una unidad de `link_intel_checks`.
- Un análisis de brecha usa una unidad por competidor. Comparar tres competidores consume tres unidades.
- La vista previa muestra el desglose exacto y no consume nada. Al confirmar se comprueba de nuevo tu saldo.

Consulta [Precios](./pricing.es.md) para ver los límites y precios actuales. Las herramientas profundas requieren un plan compatible; abrir un resultado guardado solo lee datos almacenados.

## Caché y reembolsos

Un resultado servido desde caché también cuenta. Un análisis correcto sin filas cuenta igualmente: confirma que la fuente no encontró enlaces coincidentes en ese momento.

Si la fuente falla antes de que RankMeFast conserve una fila, esa unidad se devuelve una sola vez. En una comparación múltiple, cada competidor se liquida por separado: los resultados útiles siguen consumidos y se reembolsa el competidor que falló sin datos guardados. Una vista previa, cancelarla o leer un resultado almacenado no usa unidades.

## Cómo leer los resultados

Los resultados profundos indican cuándo se observaron. Si falta la fecha de primera detección, se queda vacía; no la inventamos. Los porcentajes de brecha se calculan con las filas guardadas y se conserva el orden de competidores que introdujiste.

Los análisis se ejecutan **bajo demanda**; no son monitorización continua. Inicia uno nuevo cuando necesites una observación más reciente. Desactivar la función bloquea nuevas consultas, pero los resultados guardados siguen disponibles.

## Inicia un análisis

Abre el espacio de Backlinks de un sitio. Elige **Dominios**, **Anclas**, **Historial** o **Brecha**, revisa la vista previa de consumo y confirma. Usa la lista de ejecuciones para volver a abrir resultados sin gastar otra unidad.

Para límites mensuales, paquetes y la regla de reembolso, consulta [Planes, límites y créditos](./plans-limits-credits.es.md).

[Volver al índice de la documentación](./index.es.md)
