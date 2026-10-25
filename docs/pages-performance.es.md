---
title: 'Rendimiento de páginas'
description: 'Cómo la pestaña Páginas muestra datos de búsqueda guardados, contexto del rastreo y métricas.'
locale: es
slug: pages-performance
section: research
order: 13
---

# Rendimiento de páginas

Abre un sitio y elige **Páginas** para comparar el rendimiento de búsqueda con el inventario del último rastreo. Al abrirse, la pestaña solo lee datos guardados. La recopilación empieza cuando eliges **Actualizar** o **Recopilar datos alternativos**.

## Fuente utilizada

RankMeFast usa Google Search Console cuando la propiedad conectada cubre el sitio. Search Console sigue siendo la fuente principal durante la primera sincronización y cuando la ventana elegida no contiene filas. Una fuente de Search Console válida pero vacía no se sustituye por estimaciones.

Sin una conexión válida, la pestaña puede usar la última instantánea guardada de palabras clave posicionadas. La etiqueta distingue DataForSEO de los datos de demostración. Si no hay datos guardados, la pantalla indica qué conectar o recopilar.

## Métricas y ventanas

Los clics, impresiones, CTR y posición media de Search Console son valores observados para una ventana móvil de 7, 28 o 90 días. Google informa con tres días de retraso. Search Console puede muestrear o limitar filas, así que revisa la nota de cobertura antes de comparar totales.

La posición, volumen, dificultad, cantidad de palabras posicionadas y tráfico estimado de la fuente alternativa proceden de una instantánea puntual. Los clics, impresiones y CTR muestran **No disponible**, algo distinto de un cero real. Cambiar la ventana altera el historial y la comparación, no las métricas principales de esa instantánea.

**Desde la sincronización anterior** compara la instantánea actual con la anterior que sea válida. No compara periodos consecutivos. El detalle muestra consultas de Search Console o palabras clave asociadas y un máximo de 90 puntos históricos.

## Oportunidades y rastreo

- **A poca distancia** corresponde a posiciones superiores a 3 y hasta 20 con demanda suficiente.
- **CTR bajo** solo se aplica a filas de Search Console que cumplen los umbrales de impresiones y posición.
- **En descenso** y **Ganadora** comparan la posición o los clics observados con la sincronización anterior.
- **Visible pero no indexable por rastreo** indica rendimiento cuando el último rastreo marcó la página como no indexable.
- **Sin medir** indica una página rastreable e indexable sin fila en la fuente de rendimiento.

La indexabilidad de rastreo describe lo que encontró RankMeFast al rastrear. No demuestra que Google haya indexado una URL. Una página visible y no indexable se conserva para que puedas investigar el conflicto.

## Datos guardados y actualización

La columna Página permanece visible al desplazar la tabla. Usa **Columnas** para mostrar u ocultar los demás campos. Un guion indica que falta un valor; el cero indica que la fuente midió cero. Las páginas sin título se identifican por su ruta. Si una URL medida coincide con una página rastreada bajo un prefijo de idioma, **Rastreada como** muestra esa ruta.

La nota de Search Console indica los días exactos que abarcan los totales por página. Google puede contar una impresión por cada página mostrada en una búsqueda, incluso cuando oculta el texto de la consulta. Por eso, los totales por página pueden superar los totales del sitio en la pestaña Google. **Datos insuficientes** señala páginas con pocas impresiones y ningún clic; todavía no reciben una etiqueta de cambio. La nota de rastreo indica cuántas URL obtuvo la última auditoría y, si consta, por qué terminó.

Abrir detalles, buscar, filtrar, ordenar y cambiar columnas o páginas de resultados lee datos guardados. **Actualizar** solicita datos nuevos a la fuente. Si falla, la última instantánea válida permanece visible y se marca como obsoleta. Vuelve a intentarlo cuando la conexión esté disponible.

## Eliminación y exportación

Al eliminar un sitio o completar una solicitud de eliminación de cuenta se borran sus instantáneas de Páginas. La exportación de cuenta actual no incluye las instantáneas de Páginas ni el historial temporal de GSC y del seguimiento de posiciones. Por tanto, no sirve como copia de seguridad de esas tendencias.

## Solución de problemas

- Para **Sincronizando**, espera a la primera recopilación de Search Console.
- Para **Reconectar**, restaura Google desde su pestaña.
- Si la propiedad no coincide, elige una que cubra el prefijo de URL o el dominio.
- Sin fuente guardada, conecta Search Console o elige **Obtener datos de posiciones**.
- Si no está disponible, reintenta la misma fuente. RankMeFast no abandona en silencio una fuente de Search Console válida.

Consulta también [Conectar Google Search Console](./google-search-console.es.md) y [Seguimiento de posiciones](./rank-tracking.es.md).

[Volver al índice de la documentación](./index.es.md)
