---
title: 'Radar de marca'
description: 'Analiza una consulta de marca bajo demanda, revisa menciones guardadas y entiende el complemento y los reembolsos.'
locale: es
slug: brand-radar
section: research
order: 11
---

# Radar de marca

Radar de marca busca menciones públicas de una consulta de marca, guarda las menciones que conserva y calcula cantidad, distribución de sentimiento, dominios principales y cambio frente al análisis anterior terminado de la misma consulta en el mismo sitio. También puede crear un resumen breve con citas.

Abre un sitio y elige la pestaña **Radar de marca**. Cada análisis pertenece a ese sitio, así que dos sitios que siguen la misma marca mantienen listas y referencias de tendencia separadas.

El campo opcional **País del sitio editor** admite búsquedas. Filtra por el país donde está registrado el sitio que publicó la mención, no por la ubicación del lector. Elige **Todos los países** para analizar todo el mundo. Los análisis antiguos que solo guardaban un número de ubicación sin uso se muestran como mundiales, porque ese número nunca afectó a sus resultados.

<!-- docs-truth: metric=brand_mention_scans; unit=one-scan-one-brand-query; cache-hits=not-applicable-fresh-required; refund=search-provider-failure-zero-retained; cadence=on-demand; estimates=ai-digest-labeled -->

## Conoce qué cubre una unidad

Cada análisis confirmado de una consulta de marca usa una unidad de `brand_mention_scans`. Los filtros opcionales de idioma y país del sitio editor y el resumen citado están incluidos. No se pueden agrupar consultas de competidores en esa unidad.

Previsualizar o cancelar no consume nada. La vista previa siempre muestra una consulta nueva, porque las menciones pertenecen a tu cuenta y nunca se guardan en caché para otras cuentas. Consulta [Precios](./pricing.es.md) para límites, complemento y paquetes actuales.

## Entiende reembolsos y resultados parciales

Recuperas la unidad, una sola vez, solo si la primera búsqueda falla en la fuente y RankMeFast no guarda ninguna mención.

Estos casos sí consumen la unidad:

- la búsqueda correcta no encuentra menciones;
- se guardan menciones antes de un límite de fuente o presupuesto;
- falla el resumen o el texto generado;
- todas las frases generadas se descartan porque sus citas no se verifican.

RankMeFast no borra menciones encontradas solo para devolverte la unidad.

## Separa hechos de texto generado

Cantidad, sentimiento, dominios y cambio frente al análisis anterior de la misma consulta se calculan con filas guardadas. Si no hay un análisis previo, verás «sin comparación todavía» en lugar de un cero.

Las frases del resumen las escribe la IA y solo aparecen si citan menciones guardadas. Si no queda ninguna frase fiable, la interfaz lo indica. Puedes revisar las menciones y exportarlas en CSV.

## Decide cuándo analizar

Radar de marca funciona **bajo demanda**, no como monitorización continua. Inicia otro análisis cuando necesites una observación nueva. Weekly Pulse puede resumir diferencias ya guardadas de ese mismo sitio, pero no inicia ni consume un análisis. Si se pausan análisis nuevos, los datos guardados siguen disponibles.

Consulta [Planes, límites y créditos](./plans-limits-credits.es.md).

[Volver al índice de la documentación](./index.es.md)
