---
title: 'Seguimiento local por cuadrícula'
description: 'Cómo se recogen las cuadrículas del paquete local por coordenada, qué significa una celda fallida y por qué las coordenadas se escriben en vez de elegirse en un mapa.'
locale: es
slug: geogrid
section: product
order: 9
---

# Seguimiento local por cuadrícula

Un escaneo de cuadrícula comprueba el paquete local desde muchos puntos alrededor de una ubicación de una sola vez. Así ves cómo cambia la visibilidad por todo un barrio y no desde un único punto.

<!-- docs-truth: metric=geogrid_scans; unit=one-grid-scan-up-to-49-cells; cache-hits=count; refund=all-cell-failure-only; cadence=on-demand; estimates=provider-observation -->

## Lanzar un escaneo

Elige un tamaño de cuadrícula (3×3, 5×5 o 7×7), un espaciado y un nivel de zoom. RankMeFast hace una comprobación de Maps por celda, y la cuadrícula entera cuenta como un solo escaneo medido.

En cada celda guarda la posición que vio, el tamaño del paquete local y el momento de la comprobación. Los resultados se muestran como cuadrícula de calor, siempre con una tabla accesible al lado.

## Cómo leer una celda

Cada celda muestra una de tres cosas:

- una posición observada
- «no está en el paquete local»
- una comprobación fallida, que no guarda posición y nunca se dibuja como un puesto

Cada celda tiene su propia hora de captura. Una cuadrícula es un conjunto de comprobaciones hechas muy seguidas, no una instantánea única de toda la zona.

## Unidades y reembolsos

Un escaneo con al menos una celda utilizable consume su unidad. Solo se reembolsa si fallan todas las celdas, porque una cuadrícula parcial sigue aportando observaciones útiles.

El plan Agency incluye 6 escaneos al mes. Pro accede a las cuadrículas con el paquete de créditos `geogrid-scans-10`, y Starter no tiene asignación de cuadrículas.

Consulta [Precios](./pricing.es.md) para ver unidades y límites del plan.

## Límites

Las coordenadas se escriben a mano. RankMeFast no usa ningún proveedor de teselas de mapa, así que no hay un mapa interactivo donde hacer clic.

Una cuadrícula muestra lo que vio el proveedor desde esas coordenadas en ese momento. No es un pronóstico, y no te dice lo que verá una persona concreta al buscar.

[Volver al índice de documentación](./index.es.md)
