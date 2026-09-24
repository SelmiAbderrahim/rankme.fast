---
title: 'Canibalización de palabras clave'
description: 'Cómo encuentra RankMeFast las consultas en las que compiten dos o más de tus páginas, usando solo las filas de Search Console ya almacenadas.'
locale: es
slug: cannibalization
section: product
order: 4
---

# Canibalización de palabras clave

Un informe de canibalización lee las filas `query,page` de Google Search Console que RankMeFast ya sincroniza para tu sitio. No genera gasto de proveedor y funciona aunque Google esté desconectado.

<!-- docs-truth: metric=cannibalization_reports; unit=one-report-one-window; cache-hits=count; refund=no-stored-rows-no-unit-consumed; cadence=on-demand; estimates=first-party-gsc-rows -->

## Qué muestra un informe

Para cada consulta en la que aparecen dos o más de tus páginas, ves las páginas que compiten con sus clics, impresiones, posición media y cuota del total de la consulta.

RankMeFast también sugiere qué página debería ser la principal. Siempre elige en el mismo orden, así que las mismas filas dan la misma respuesta:

1. Más clics.
2. Mejor posición media, si hay empate en clics.
3. Un orden de desempate fijo, si empatan en ambos.

## Ventanas y confianza

Puedes lanzar un informe sobre 7, 28 o 90 días de filas guardadas. Una ventana más larga solo usa más de lo que ya está guardado; no descarga nada nuevo.

Cada hallazgo recibe una confianza alta, media o baja. La calificación refleja la solidez de la evidencia guardada (cuántas filas hay y cuánto se separan las páginas), no lo que pasará si actúas.

## Antes de lanzar uno

Si tu sitio aún no tiene filas `query,page` guardadas, no hay nada sobre lo que informar. RankMeFast te pide sincronizar Search Console primero y no consume ninguna unidad del plan.

## Lo que decides tú

El informe no predice cambios de posición ni toca tu sitio. Si conviene consolidar una página, redirigirla o dejarla como está, lo decides tú.

## Planes y disponibilidad

Las asignaciones mensuales son Starter 4, Pro 20 y Agency 100. Para saber cómo funcionan las unidades, consulta [Precios](./pricing.es.md).

Si un operador desactiva `CANNIBALIZATION_ENABLED`, los nuevos informes se rechazan con un mensaje localizado. Los informes que ya tienes siguen disponibles.

[Volver al índice de documentación](./index.es.md)
