---
title: 'Generador de marcado Schema'
description: 'Cómo construye RankMeFast JSON-LD a partir de hechos de página guardados, qué significa aquí la conformidad y por qué una propiedad ausente se omite en lugar de inventarse.'
locale: es
slug: schema-markup
section: product
order: 10
---

# Generador de marcado Schema

El generador escribe JSON-LD para una página a partir de datos que RankMeFast ya tiene: una página auditada, una página del inventario o una URL que pegues. Tú copias o descargas el resultado.

<!-- docs-truth: metric=schema_generations; unit=one-generation-one-page-one-type; cache-hits=count; refund=missing-evidence-omitted-with-reason; cadence=on-demand; estimates=first-party-facts -->

## Tipos y evidencia

Se admiten siete tipos: `WebPage`, `WebSite`, `Organization`, `Article`, `BreadcrumbList`, `FAQPage` y `HowTo`. Tú eliges el tipo y RankMeFast reúne la evidencia.

Cada propiedad de la salida va ligada al dato guardado del que procede, así que puedes seguir cada valor hasta su página antes de publicar nada. `FAQPage` y `HowTo` van al final de la lista, cada uno con una nota breve. Google solo muestra respuestas de preguntas frecuentes en los resultados de búsqueda para sitios gubernamentales y de salud muy conocidos, y ya no muestra los pasos de HowTo. Ambos tipos siguen generando marcado schema.org válido.

## El informe de conformidad

La comprobación de conformidad separa lo que encuentra en dos grupos:

- **Huecos obligatorios**: propiedades que el tipo necesita.
- **Sugerencias**: propiedades que harían el marcado más completo.

Pasarla significa que la salida cumple los requisitos de schema.org para el tipo que elegiste. Nunca es una garantía de que Google muestre un resultado enriquecido.

## Por qué faltan propiedades

Si no hay evidencia guardada para una propiedad, se deja fuera y el informe explica por qué. Nunca se inventan valoraciones, precios, reseñas, autores ni fechas. Por eso `Article` suele mostrar un hueco en `datePublished`. Cuando la página no expone una fecha de publicación que RankMeFast pueda leer, el generador te lo dice en lugar de adivinarla.

## Nombres y datos que añades

Para `WebSite` y `Organization`, el nombre sale de la primera fuente que ofrezca la página: su etiqueta `og:site_name`, luego un nombre ya declarado por el marcado `Organization` o `WebSite` de la página, luego la parte de marca del título de la página (se descartan los separadores y palabras como «Bienvenido»), luego el nombre que diste al sitio y solo después el dominio. La lista de evidencias muestra qué fuente se usó. En **Lo que dejamos fuera** puedes escribir un valor para propiedades como la descripción, el idioma, las fechas o las direcciones de imágenes. El generador lo añade exactamente como lo escribes y lo marca como **Aportado por ti**. Elige **Reconstruir con mis datos** para aplicarlos. La reconstrucción reutiliza los datos que ya halló la generación original, no hace ninguna llamada nueva a la IA y no consume ninguna generación. El original no cambia y la reconstrucción se guarda como una generación nueva.

## Cómo se comprueban los valores

Un modelo de IA elige qué propiedades rellenar. Después, una comprobación compara cada valor con su dato guardado, y todo lo que no sea una copia literal se rechaza antes de que lo veas.

El marcado lo añades tú a tu sitio. RankMeFast no lo inyecta en tu sitio, tu tema ni un gestor de etiquetas, y no tiene credenciales que se lo permitan.

[Volver al índice de documentación](./index.es.md)
