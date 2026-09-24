---
title: 'Velocidad de página'
description: 'Core Web Vitals en palabras simples: visitantes reales vs. estimación de laboratorio.'
locale: es
slug: page-speed
section: audits
order: 1
---

# Velocidad de página

Google evalúa las páginas con **Core Web Vitals**. RankMeFast separa las mediciones de campo y laboratorio y solo muestra la evidencia que devuelve el proveedor configurado.

## Datos de visitantes reales
El Chrome UX Report agrega visitas reales:
- **LCP**: mayor elemento visible. Menos de 2,5 s.
- **INP**: reactividad al clic/tap. Menos de 200 ms.
- **CLS**: saltos de diseño. Menos de 0,1.

Los datos de campo solo aparecen cuando Google CrUX está configurado y tiene tráfico suficiente para la URL o el origen. El proveedor DataForSEO Lighthouse de producción solo ofrece laboratorio, así que esta fila queda ausente en vez de inventar visitas reales a partir de una prueba sintética.

## Estimación de laboratorio (Lighthouse)
RankMeFast ejecuta una prueba sintética de Lighthouse en un entorno controlado; producción usa DataForSEO Lighthouse Live para esta señal de laboratorio. Es orientativa y una ejecución varía unos 10 puntos.

## Móvil
Se mide por separado. Sin viewport o con botones diminutos, el punto va a **Corregir ya**.

[Volver al índice de la documentación](./index.es.md)
