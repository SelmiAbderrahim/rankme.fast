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

[Volver al índice de la documentación](./index.es.md)
