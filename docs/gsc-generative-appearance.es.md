---
title: 'Aparición de IA generativa en Search Console'
description: 'Cuántas veces Google mostró tu sitio en sus funciones de IA generativa, directamente desde Search Console.'
locale: es
slug: gsc-generative-appearance
section: research
order: 4
---

# Aparición de IA generativa en Search Console

Google Search Console informa cuántas veces tus páginas aparecieron dentro de las funciones de IA generativa de Google, como AI Overviews. Esta tarjeta muestra esas cifras tal como las envía Google. No añadimos ni estimamos nada.

## Qué leemos

Consultamos la API de Search Console con `dimensions=['searchAppearance']` para los últimos 28 días, terminando hace tres días para respetar el retraso de los informes de Google. Cada fila que devuelve Google se clasifica según la documentación de Google:

- Los valores generativos conocidos reciben una etiqueta fija.
- Los valores desconocidos aparecen como **Otro**, con su nombre original guardado para que soporte pueda revisarlo. Nunca damos por hecho que un valor desconocido sea generativo.

## Estados

- **Disponible**: Google devolvió al menos una fila generativa reconocida. La tarjeta muestra, fila por fila, los clics, impresiones, CTR y posición media que envió Google.
- **No disponible**: Google no devolvió ninguna fila generativa reconocida para esta propiedad y periodo. No es lo mismo que cero: Google no informó nada, así que dejamos el dato vacío en lugar de mostrar 0.
- **Parcial**: Google devolvió filas pero marcó la respuesta como parcial (por límite de solicitudes o truncamiento). Las filas recibidas se siguen mostrando.
- **Reconexión necesaria**: hay que volver a conectar Google. Abre el workspace de Google del sitio y sigue el aviso de reconexión.

## Separado de las métricas del proveedor

Son los datos de Google sobre tu sitio. Aparecen en el workspace de Google junto a tus otras tarjetas de Search Console. No se mezclan con los gráficos de menciones y cuota de voz del workspace de AI Visibility, que vienen de otro proveedor y miden otra cosa.

## Lo que no te dice

Search Console cuenta impresiones y clics, es decir, cuántas veces Google incluyó tu página en una función generativa. No te dice si la respuesta de la IA te nombró, te enlazó, te citó o prefirió a un competidor. Para eso, usa [AI Visibility](./ai-visibility.es.md).

[Volver al índice de la documentación](./index.es.md)
