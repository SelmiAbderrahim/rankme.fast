---
title: 'Enlaces tóxicos y desautorización'
description: 'Cómo clasifica RankMeFast los backlinks por nivel de riesgo con reglas fijas, cuándo la IA puede anotar una fila y por qué el archivo de desautorización nunca se envía por ti.'
locale: es
slug: toxic-links
section: product
order: 5
---

# Enlaces tóxicos y desautorización

Una revisión de toxicidad puntúa las filas de backlinks que ya obtuviste según reglas fijas y luego te permite crear un archivo de desautorización en formato de Google. RankMeFast nunca envía ese archivo.

<!-- docs-truth: metric=toxicity_reviews; unit=one-review-up-to-1000-stored-rows; cache-hits=count; refund=provider-failure-zero-retained; cadence=on-demand; estimates=rubric-observation -->

## Cómo recibe cada fila un nivel de riesgo

Las reglas (versión `toxicity-rubric-v1`) leen la puntuación de spam de cada fila de backlink guardada y la sitúan en un nivel de riesgo limpio, vigilar o tóxico. Las señales de enlace roto y nofollow ajustan ese nivel.

Las reglas dan siempre el mismo resultado: las mismas filas guardadas y las mismas puntuaciones de spam producen siempre los mismos niveles de riesgo, y cada nivel se muestra con las pruebas en las que se basa.

## Cuánto cuesta una revisión

Una revisión toma una instantánea de hasta 1.000 filas ya descargadas y paga como máximo 100 puntuaciones de spam de dominio nuevas. Si el sitio aún no tiene filas de backlinks guardadas, carga primero su lista de backlinks.

Puedes pedir una justificación de IA para una fila marcada. O cita esa fila guardada o no opina. Si falla el paso del proveedor, no se guarda nada y la unidad se devuelve.

## Crear el archivo de desautorización

1. Incluye o excluye cada fila.
2. Elige alcance de dominio o de URL.
3. Exporta un `.txt` sencillo con formato de Google. Las filas excluidas se quedan fuera.

RankMeFast exporta el archivo para tu propia revisión y envío a Google. No está conectado a la herramienta de desautorización de Search Console y no puede subir nada en tu nombre.

## Límites honestos

Un nivel de riesgo describe lo que las reglas encontraron en un enlace. Nunca es una predicción de una penalización de Google, una acción manual o un cambio de posiciones.

La IA puede anotar una fila que las reglas ya marcaron, pero nunca puede añadir un dominio que las reglas no marcaron. Cada dominio de la exportación remite a una fila guardada.

Antes de actuar, compara esta guía con la evidencia almacenada y el estado que muestra RankMeFast.

Consulta [Precios](./pricing.es.md) para ver unidades y límites del plan.

[Volver al índice de documentación](./index.es.md)
