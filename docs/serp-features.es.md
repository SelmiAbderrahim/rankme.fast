---
title: 'Seguimiento de funciones SERP'
description: 'Qué registra RankMeFast sobre las funciones de resultados en cada comprobación de posición y qué nunca afirma.'
locale: es
slug: serp-features
section: product
order: 1
---

# Seguimiento de funciones SERP

Cada comprobación de posición que ejecuta RankMeFast también registra qué funciones de resultados aparecieron para esa palabra clave. No pagas nada extra por ello, y la comprobación no pide al proveedor más resultados de lo habitual.

<!-- docs-truth: metric=none; unit=byproduct-of-serp_checks; cache-hits=count; refund=not-applicable; cadence=follows-rank-check; estimates=provider-observation -->

## Qué se registra

En cada comprobación, RankMeFast anota si en la página de resultados había alguno de estos elementos:

- un fragmento destacado
- un bloque «Otras preguntas»
- un paquete local
- resultados de vídeo, imágenes o compras
- un panel de grafo de conocimiento

También guarda los resultados orgánicos, hasta 100 filas.

Una función cuenta como tuya cuando su host coincide exactamente con el de tu sitio, una vez normalizados ambos. Cualquier otra se registra como presente, pero no tuya.

## Historial

Cada palabra clave con seguimiento tiene un historial comprobación a comprobación. Puedes verlo como matriz de puntos o como tabla, que contiene los mismos datos y funciona mejor con lectores de pantalla y exportaciones.

Las observaciones se conservan 90 días, junto con las 30 comprobaciones más recientes de cada palabra clave. Las filas más antiguas desaparecen y no se pueden reconstruir.

## Límites

Como la comprobación de posición no pide profundidad extra, una comprobación en vivo puede devolver menos de 100 filas orgánicas.

RankMeFast solo puede decir que una función fue **observada** o **no observada** en una comprobación guardada. Eso no prueba que Google nunca la muestre, y los huecos se quedan como huecos: no se rellenan con estimaciones.

## Disponibilidad

No hay una asignación aparte, porque la captura viene con las comprobaciones de posición que tu plan ya incluye. Un operador puede desactivarla con el indicador `SERP_FEATURE_TRACKING_ENABLED`; en ese caso, las nuevas ejecuciones se rechazan con un mensaje en tu idioma y los resultados guardados siguen disponibles. Consulta [Precios](./pricing.es.md) para ver unidades y límites del plan.

[Volver al índice de documentación](./index.es.md)
