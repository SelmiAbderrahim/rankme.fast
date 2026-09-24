---
title: 'Enlaces y Competitor Intelligence'
description: 'Compara enlaces, panoramas de palabras clave, páginas posicionadas e informes de competidores guardados.'
locale: es
slug: backlinks-competitors
section: audits
order: 6
---

# Enlaces y Competitor Intelligence

Los enlaces entrantes y Competitor Intelligence responden a preguntas distintas. Los enlaces indican qué sitios apuntan a un dominio. Competitor Intelligence compara las búsquedas y las páginas posicionadas de los competidores que has confirmado para uno de tus sitios.

<!-- generated: finite-backlink-limits:start -->
Las filas de backlinks se miden cada mes. Pro incluye hasta 10.000 filas al mes y Agency hasta 100.000. Los informes guardados siguen disponibles después de alcanzar el tope mensual.
<!-- generated: finite-backlink-limits:end -->

## El espacio del sitio

Abre un sitio y elige **Competidores**. La cartera, los panoramas de palabras clave, las comparaciones de contenido, la monitorización, las estimaciones de tráfico y los informes guardados están en el mismo lugar. Pro permite seleccionar hasta tres competidores confirmados por informe. Agency permite hasta diez. Cada sitio puede conservar hasta diez competidores activos.

Las cuentas Starter ven la explicación para mejorar el plan. Si un operador pausa los trabajos nuevos, los informes guardados siguen disponibles. Un cambio de plan también puede dejar los datos existentes en modo de solo lectura.

## Unidades y confirmación

Un informe de panorama consume una unidad `keyword_lookups` por competidor seleccionado. Comparar tres competidores consume tres unidades. Antes de confirmar, RankMeFast muestra cuántas unidades y filas usará el informe. Los resultados en caché también cuentan. La actualización del descubrimiento es opcional. Usa una unidad `keyword_lookups` más, y solo después de su propia vista previa y confirmación.

La comparación ejecuta tres consultas de palabras clave por competidor: términos compartidos, términos donde solo posiciona tu sitio y términos donde solo posiciona el competidor. Cada consulta guarda como máximo 100 filas, así que un informe Agency con diez competidores tiene hasta 3.000 filas.

## Cómo leer el panorama

El informe usa cinco clases:

- `missing`: el competidor posiciona y tu sitio no fue observado.
- `owned_only`: tu sitio posiciona y el competidor no fue observado.
- `shared_behind`: ambos posicionan y tu posición es peor.
- `shared_ahead`: ambos posicionan y tu posición es mejor.
- `shared_even`: ambos tienen la misma posición observada.

Las posiciones, las URL posicionadas y las fechas de observación vienen directamente de la fuente. El volumen y la dificultad son estimaciones del proveedor. Las clases, la confianza y las recomendaciones se calculan a partir de las filas que guarda el informe. Un valor ausente se queda vacío; no se rellena con una suposición. Los informes parciales indican cuántos competidores y pasos de origen aportaron datos útiles.

## Páginas posicionadas y contenido

Los informes Agency pueden sugerir parejas de páginas posicionadas. Revisa ambas URL antes de iniciar una comparación de contenido. Puedes sustituir la URL sugerida del competidor por otra URL pública del mismo dominio confirmado. Una sugerencia nunca inicia un rastreo por sí sola, y RankMeFast no pone la página de inicio en su lugar sin avisar.

La comparación de contenido confirmada usa una unidad `competitor_content_runs` independiente. Revisar una pareja de páginas no consume esa unidad. La monitorización también requiere una acción y una confirmación aparte.

Las recomendaciones permanecen en el informe hasta que aceptas una. Al aceptarla se añade un solo elemento a Próximas acciones. No se publica contenido ni se inicia otro trabajo de pago.

## Informes guardados y exportaciones

Volver a abrir un panorama o una ejecución histórica de contenido no llama al proveedor ni consume otra unidad. Las exportaciones PDF, CSV y JSON leen la instantánea guardada. PDF rechaza selecciones de más de 1.000 filas y recomienda CSV o JSON. Estos formatos conservan toda la selección dentro del límite de 3.000 filas y del límite general de descarga.

Los marcadores antiguos de competidores abren la pestaña Competidores. El enlace anterior de competidores en Content Intelligence abre la vista Contenido. Keyword Gap independiente conserva su historial y su coste de una unidad `keyword_lookups` por competidor.

Las puntuaciones de enlaces y las cifras de tráfico son estimaciones condicionadas por la cobertura del proveedor. Compara observaciones de la misma fuente y fecha, y no las leas como si fueran tu propia analítica.

Consulta [Planes, límites y créditos](./plans-limits-credits.es.md) para ver los cupos actuales y [Content Intelligence](./content-intelligence.es.md) para el proceso de contenido independiente.

[Volver al índice de la documentación](./index.es.md)
