---
title: 'Leyendo tu informe de auditoría'
description: 'Corregir ahora, Vigilar, Aprobados: qué significa cada pestaña y cada regla.'
locale: es
slug: audit-report
section: start
order: 2
---

# Leyendo tu informe de auditoría

Después de cada auditoría llegas a un informe con tres pestañas y un botón **Reauditar**.

## Las tres pestañas
- **Corregir ahora**: los problemas a los que Google reacciona antes.
- **Vigilar**: cuestiones menores o comprobaciones sin datos suficientes.
- **Aprobados**: las comprobaciones superadas.

## Qué muestra cada problema
- **Título**: el nombre del problema, en palabras claras.
- **Por qué es importante**: una frase sobre el impacto.
- **URLs afectadas**: las páginas donde lo encontramos.
- **Cómo corregirlo**: el cambio que hay que hacer, con un botón para copiarlo.

## Reauditar y etiquetas de cambio
Después de un arreglo pulsa **Reauditar**. Pueden aparecer dos etiquetas:
- **Corregido**: la regla ya pasa.
- **Empeoró**: la regla falla donde antes pasaba.

## Fichero `llms.txt`
Una convención reciente que indica a los asistentes de IA qué páginas prefieres que citen. Para nosotros es una regla **solo informativa**.

## Cada regla en lenguaje sencillo
- **Bloqueado para Google**: Una regla `robots.txt` impide el acceso.
- **Sitemap ausente o débil**: Añade `sitemap.xml` y enlázalo desde `robots.txt`.
- **Títulos ausentes o débiles**: Título único de 30 – 60 caracteres por página.
- **Meta descripciones ausentes o duplicadas**: Una descripción única por página.
- **Encabezados débiles**: Un solo `<h1>` por página.
- **Canonical ausente o roto**: Coloca un `<link rel="canonical">` válido.
- **Datos estructurados ausentes**: Añade JSON-LD adecuado.
- **Enlaces internos rotos**: Corrige o elimina los enlaces con error.
- **Contenido escaso**: Páginas por debajo de ~200 palabras.
- **Sin señales de FAQ**: Añade sección de preguntas frecuentes.
- **Falta llms.txt (informativo)**: Convención reciente para los bots de IA.
- **HTTPS no forzado**: Redirige http a https.
- **Rendimiento pobre en visitantes reales**: Datos de Chrome UX muestran lentitud.
- **Estimación de laboratorio baja**: Una sola ejecución de Lighthouse varía mucho de una vez a otra.
- **No apto para móvil**: Revisa viewport y tamaño de botones.
- **No indexado**: Google no incluyó la página.
- **Problemas de resultados enriquecidos**: Errores en datos estructurados.
- **Indexado con avisos**: Señal de canónico/duplicado.
- **Páginas que responden con un error**: Direcciones rastreadas que devolvieron un error (4xx o 5xx). Recupera la página o redirige la dirección. Si rechazaron al rastreador (401, 403 o 429), puede ser una protección contra bots: ábrelas antes en un navegador.
- **Cadenas y bucles de redirecciones**: Direcciones que pasan por dos o más redirecciones, o que nunca llegan a una página. Haz que la primera apunte directamente a la página final.
- **Enlaces que apuntan a redirecciones**: Enlaces internos cuyo destino redirige. Enlaza directamente a la dirección final.
- **Páginas que redirigen con una etiqueta de actualización**: Una etiqueta `<meta http-equiv="refresh">` reenvía al visitante. Usa en su lugar una redirección permanente (301) en el servidor.
- **Etiquetas canonical que apuntan al lugar equivocado**: Un canonical que apunta a una página rota, a una redirección, a otro canonical o que va y viene entre dos páginas. Haz que apunte a una página activa que se declare a sí misma.
- **Páginas sin enlaces desde otras páginas**: Páginas de tu sitemap a las que no llega ningún enlace interno. Enlázalas desde una página relacionada o desde un menú.
- **Páginas enterradas en lo más hondo del sitio**: Páginas a más de tres clics de la página de inicio. Acerca las importantes.
- **Páginas que comparten título**: Dos o más páginas con el mismo `<title>`. Da a cada una el suyo.
- **Páginas que parecen copias unas de otras**: Páginas casi idénticas según el rastreador, con una puntuación de similitud sobre diez. Únelas o haz que cada una sea distinta.
- **Texto de relleno en páginas publicadas**: Texto de relleno tipo «Lorem ipsum» en una página publicada. Sustitúyelo por el texto definitivo.
- **Páginas seguras que enlazan a direcciones no seguras**: Páginas HTTPS que enlazan a direcciones `http://`. Cámbialas a `https://`.
- **Imágenes sin texto alternativo**: Imágenes sin atributo `alt`. Describe las imágenes con contenido y deja un `alt` vacío en las decorativas.
- **Páginas que tardan en empezar a cargar**: El rastreador esperó más de 1,5 segundos al primer byte, o más de tres segundos a la página. Es una sola carga de laboratorio, no la experiencia de cada visitante.
- **Páginas muy pesadas**: HTML de más de 1 MB. Por encima de 3 MB, el resultado pasa a Corregir ya.
- **Páginas enviadas sin comprimir**: HTML enviado sin compresión gzip ni Brotli. Activa la compresión en el servidor.
- **Scripts y estilos que retrasan la primera vista**: Archivos que bloquean la primera visualización, con su número. Carga los scripts con `async` o `defer`.
- **Páginas sin las declaraciones HTML básicas**: Falta la línea `<!DOCTYPE html>` o la declaración del juego de caracteres.
- **HTML obsoleto en tus páginas**: Etiquetas retiradas, Flash o marcos. Algunos marcos, como los vídeos incrustados, pueden estar bien: revísalos antes de quitarlos.
- **Direcciones difíciles de leer**: Direcciones con caracteres poco habituales, parámetros de consulta o más de 120 caracteres.
- **Páginas sin etiquetas para redes sociales**: Sin etiquetas Open Graph, un enlace compartido puede mostrar un título, un texto o una imagen equivocados.
- **Sin favicon**: Falta el pequeño icono del sitio para las pestañas del navegador y los resultados de búsqueda.
- **Imágenes, scripts o estilos rotos**: Archivos que necesita una página y que responden con un error. Solo se comprueba en una auditoría iniciada con el análisis de recursos; si no, aparece en No evaluado.
- **Imágenes más grandes de lo necesario**: Imágenes de más de 500 KB. Se comprueba con el análisis completo de recursos, como la anterior.
- **Archivos que los navegadores no pueden guardar en caché**: Imágenes, scripts y hojas de estilo enviados con cabeceras que impiden que el navegador los guarde en caché. Se comprueba con el análisis completo de recursos.

## Analizar imágenes, scripts y estilos

Las tres últimas comprobaciones necesitan cargar cada imagen, script y hoja de estilo de tus páginas. Eso hace el rastreo más lento y gasta más de tu presupuesto de rastreo, así que cada auditoría tiene su propia opción.

- **Analizar imágenes, scripts y estilos** viene marcada por defecto al iniciar una auditoría. Desmárcala para omitir el análisis en esa ejecución.
- Una auditoría con análisis carga estos archivos en 1.000 páginas como máximo. Las páginas que superen ese número se rastrean igualmente, pero sin sus archivos.
- Si el análisis no se puede leer, la auditoría termina igualmente y las tres comprobaciones aparecen en No evaluado con el motivo.
- Una auditoría hecha sin el análisis muestra estas comprobaciones en No evaluado. Inicia una auditoría nueva con la opción marcada para incluirlas.

[Volver al índice de la documentación](./index.es.md)
