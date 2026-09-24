---
title: 'Rendimiento de páginas'
description: 'Cómo la pestaña Páginas elige la fuente, compara instantáneas y cuenta las actualizaciones.'
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

## Coste y datos obsoletos

Actualizar Search Console reutiliza su sincronización y no gasta una búsqueda de palabra clave. Actualizar la fuente alternativa cuesta una búsqueda, incluso si se acierta en caché. Abrir detalles, buscar, filtrar, ordenar y paginar solo leen datos guardados y no gastan cuota.

Si falla una actualización, la última instantánea válida sigue visible con estado obsoleto. Una instantánea alternativa también pasa a obsoleta cuando supera la ventana de frescura de la caché.

## Eliminación y exportación

Al eliminar un sitio o completar una solicitud de eliminación de cuenta se borran sus instantáneas de Páginas. La exportación de cuenta actual no incluye las instantáneas de Páginas ni el historial temporal de GSC y del seguimiento de posiciones. Por tanto, no sirve como copia de seguridad de esas tendencias.

## Solución de problemas

- Para **Sincronizando**, espera a la primera recopilación de Search Console.
- Para **Reconectar**, restaura Google desde su pestaña.
- Si la propiedad no coincide, elige una que cubra el prefijo de URL o el dominio.
- Sin fuente guardada, conecta Search Console o inicia la recopilación alternativa contabilizada.
- Al alcanzar el límite, revisa el uso o el plan. Las instantáneas existentes siguen disponibles.
- Si no está disponible, reintenta la misma fuente. RankMeFast no abandona en silencio una fuente de Search Console válida.

Consulta también [Conectar Google Search Console](./google-search-console.es.md) y [Seguimiento de posiciones](./rank-tracking.es.md).

[Volver al índice de la documentación](./index.es.md)
