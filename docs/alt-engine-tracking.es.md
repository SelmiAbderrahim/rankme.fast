---
title: 'Seguimiento en Bing, YouTube y Amazon'
description: 'Cómo hace RankMeFast el seguimiento en motores que no son Google, qué es un token de destino exacto y por qué una posición de Amazon es una posición de índice.'
locale: es
slug: alt-engine-tracking
section: product
order: 3
---

# Seguimiento en Bing, YouTube y Amazon

Las palabras clave de otros motores se añaden con el flujo habitual, eligiendo el motor en un selector. El historial de posiciones se etiqueta por motor, y la vista de historial tiene un filtro de motor que se guarda en la URL.

<!-- docs-truth: metric=alt_engine_checks; unit=one-keyword-one-engine-check; cache-hits=count; refund=provider-failure-zero-retained; cadence=weekly; estimates=provider-observation -->

## Cómo se empareja cada motor

- **Bing** funciona como Google: un resultado es tuyo cuando su host normalizado coincide con el de tu sitio.
- **YouTube** se empareja por un identificador de canal exacto.
- **Amazon** se empareja por un ASIN exacto.

Todos los resultados de YouTube o Amazon están en el propio dominio de la plataforma, así que emparejar por host no diría nada, y RankMeFast tampoco intenta coincidencias aproximadas de marca.

Sin el identificador o el ASIN exactos, no adivina. La palabra clave simplemente no puede seguirse en ese motor hasta que añadas uno.

## Cadencia y unidades

Los objetivos que no son de Google se comprueban una vez por semana, sea cual sea la cadencia del sitio. Cada comprobación de palabra clave y motor reserva una unidad de motor alternativo antes de hacer la petición.

Los resultados en caché también cuentan para tu asignación. Si el proveedor falla, no se guarda nada y recuperas la unidad.

## Cómo leer las posiciones de Amazon

Una posición de Amazon es un lugar dentro del índice de productos que devuelve el proveedor, no una posición real en la estantería. Los bloques patrocinados se eliminan antes de ordenar.

Como en cualquier motor, una posición es lo que se observó en una fecha concreta. No es un pronóstico.

## Planes y disponibilidad

Las asignaciones mensuales son Starter 0, Pro 20 y Agency 240. Si se te acaban, un paquete de créditos puntual puede ampliarlas.

Un operador puede desactivar esta función con el indicador `ALT_ENGINE_TRACKING_ENABLED`. Entonces las nuevas ejecuciones se rechazan con un mensaje localizado, y el historial existente sigue disponible.

Para unidades y límites del plan, consulta [Precios](./pricing.es.md).

[Volver al índice de documentación](./index.es.md)
