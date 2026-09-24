---
title: 'Sugerencias de enlazado interno'
description: 'Cómo encuentra RankMeFast páginas huérfanas y poco enlazadas en tu inventario de contenido guardado y redacta anclas que citan su evidencia.'
locale: es
slug: internal-linking
section: product
order: 7
---

# Sugerencias de enlazado interno

El enlazado interno parte de dos cosas que RankMeFast ya tiene: tu inventario de contenido completado y las consultas de Search Console guardadas para tu sitio. No rastrea nada por su cuenta.

<!-- docs-truth: metric=internal_link_runs; unit=one-run-over-stored-inventory; cache-hits=count; refund=ai-failure-keeps-deterministic-output; cadence=on-demand; estimates=first-party-inventory -->

## Cómo se encuentran los candidatos

RankMeFast busca en el inventario páginas huérfanas y páginas con pocos enlaces.

Para cada una, encuentra páginas origen probables: páginas que comparten con ella consultas de Search Console guardadas o cuyos encabezados se solapan.

Cada sugerencia muestra esa evidencia, para que puedas revisar el razonamiento antes de añadir un enlace.

## Texto de ancla

El motor de IA redacta textos de ancla y los ordena sobre la lista de candidatos basada en reglas. Cada ancla de IA se marca como interpretación de IA, y la sugerencia de debajo se sostiene sin ella.

Si falla el paso de IA, sigues teniendo las sugerencias basadas en reglas con anclas de respaldo. Una ejecución nunca vuelve vacía por culpa del modelo.

Las sugerencias se pueden exportar a CSV.

## Tu inventario tiene que ser reciente

Las sugerencias solo salen de un inventario de contenido completado con siete días o menos. Si el tuyo falta o es más antiguo, RankMeFast te pide actualizarlo en lugar de rastrear por su cuenta.

Cada origen y destino es una página que ya está en ese inventario, y las páginas marcadas como `noindex` nunca se sugieren como destino.

## Límites

- La confianza refleja la evidencia (cuántas consultas se comparten y cuánto se solapan los encabezados), no el tráfico ni las mejoras de posición esperadas.
- No se escribe nada en tu sitio. Recibes una lista y añades los enlaces tú mismo en tu CMS.

Consulta [Precios](./pricing.es.md) para ver unidades y límites del plan.

[Volver al índice de documentación](./index.es.md)
