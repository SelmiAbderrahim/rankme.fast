---
title: 'Información de tráfico'
description: 'Compara el tráfico modelado de competidores con estimaciones, unidades y reembolsos claramente explicados.'
locale: es
slug: traffic-insights
section: research
order: 8
---

# Información de tráfico

Información de tráfico crea una instantánea guardada de un dominio competidor: visitas orgánicas mensuales modeladas, rango del dominio, número de palabras clave, países principales e historial. Úsala para comparar direcciones, no como sustituto de las analíticas reales del competidor.

<!-- docs-truth: metric=traffic_snapshots; unit=one-target-domain-snapshot; cache-hits=count; refund=all-provider-parts-fail-zero-retained; cadence=on-demand; estimates=required -->

## Qué cubre una unidad

Cada instantánea confirmada de un dominio usa una unidad de `traffic_snapshots`. Una vista previa con varios dominios muestra una unidad por dominio, pero cada dominio confirmado se ejecuta como instantánea independiente. Previsualizar o cancelar no consume nada.

Los límites y precios actuales están en [Precios](./pricing.es.md). Abrir, filtrar o comparar instantáneas guardadas no usa unidades nuevas.

## Cada cifra es una estimación

Todos los campos numéricos llevan la etiqueta **Estimación**. Los valores se modelan a partir de un índice de búsqueda; no son visitas, conversiones ni datos analíticos reales. Los valores ausentes siguen como no disponibles. Una instantánea parcial puede ser útil y se identifica claramente como parcial.

La comparación alinea hasta cinco instantáneas guardadas y no rellena ni deduce datos de países o historial que falten.

## Caché y reembolsos

Una instantánea servida desde caché cuenta como una unidad, igual que un resultado correcto pero vacío.

La instantánea reúne varias observaciones relacionadas. Si todas fallan y RankMeFast no conserva ningún resultado, la unidad se devuelve una sola vez. Si se guarda cualquier observación útil, la instantánea parcial o completa permanece consumida. Un reintento no puede devolver dos veces la misma unidad.

## Cuándo actualizar

Información de tráfico funciona **bajo demanda** y no monitoriza competidores continuamente. Crea otra instantánea cuando necesites una estimación más reciente. Si se pausan las solicitudes nuevas, tus listas, detalles y comparaciones guardadas siguen disponibles.

Abre la pestaña **Tráfico** de un sitio, introduce un dominio público, revisa la vista previa y confirma. Consulta [Planes, límites y créditos](./plans-limits-credits.es.md) para límites, paquetes y reembolsos.

[Volver al índice de la documentación](./index.es.md)
