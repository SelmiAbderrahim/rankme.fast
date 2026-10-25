---
title: 'Seguimiento local por cuadrícula'
description: 'Cómo se recogen las cuadrículas del paquete local por coordenada, cómo elegir el centro de la cuadrícula y qué significa una celda fallida.'
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

## Elegir el centro

El selector **Centro de la cuadrícula** parte de **Mi negocio**, la ubicación guardada con el negocio del sitio en [SEO local](./local-seo.es.md). Es gratuito, y sin un negocio guardado el selector te lleva a la configuración de SEO local. **Buscar un lugar** busca un nombre de negocio o una dirección. Cada búsqueda consulta una vez a tu proveedor de fichas locales, y elegir un resultado solo rellena el centro: tu negocio de SEO local no cambia. **Introducir coordenadas** es la opción avanzada, con el centro del último escaneo a un clic (**Usar el centro del último escaneo**). El espaciado ofrece distancias predefinidas o una distancia personalizada en kilómetros.

## Límites

No hay un mapa interactivo en el que hacer clic, porque RankMeFast no usa ningún proveedor de teselas de mapa.

Una cuadrícula muestra lo que vio el proveedor desde esas coordenadas en ese momento. No es un pronóstico, y no te dice lo que verá una persona concreta al buscar.

[Volver al índice de documentación](./index.es.md)
