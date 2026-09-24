---
title: 'Enlaces tóxicos y desautorización'
description: 'Cómo clasifica RankMeFast los backlinks con una rúbrica determinista, cuándo la IA puede anotar una fila y por qué el archivo de desautorización nunca se envía por ti.'
locale: es
slug: toxic-links
section: product
order: 5
---

# Enlaces tóxicos y desautorización

Una revisión de toxicidad puntúa con una rúbrica fija las filas de backlinks que ya has descargado. A partir de ahí puedes crear un archivo de desautorización con el formato de Google. RankMeFast nunca lo envía por ti.

<!-- docs-truth: metric=toxicity_reviews; unit=one-review-up-to-1000-stored-rows; cache-hits=count; refund=provider-failure-zero-retained; cadence=on-demand; estimates=rubric-observation -->

## Cómo se clasifican las filas

La rúbrica, `toxicity-rubric-v1`, lee la puntuación de spam del proveedor en cada fila de backlink guardada y coloca la fila en una banda limpia, de vigilancia o tóxica. Las señales de enlace roto y nofollow pueden mover la banda.

Las mismas filas con las mismas puntuaciones de spam caen siempre en las mismas bandas, y cada banda se muestra junto a la evidencia que la justifica.

## Cuánto cuesta una revisión

Una revisión toma una instantánea de hasta 1.000 filas ya descargadas y paga como máximo 100 puntuaciones de spam de dominio nuevas. Si el sitio aún no tiene filas de backlinks guardadas, carga primero su lista de backlinks.

Puedes pedir una justificación de IA para una fila marcada. O cita esa fila guardada o no opina. Si falla el paso del proveedor, no se guarda nada y la unidad se devuelve.

## Crear el archivo de desautorización

1. Incluye o excluye cada fila.
2. Elige alcance de dominio o de URL.
3. Exporta un `.txt` sencillo con formato de Google. Las filas excluidas se quedan fuera.

RankMeFast exporta el archivo para tu propia revisión y envío a Google. No está conectado a la herramienta de desautorización de Search Console y no puede subir nada en tu nombre.

## Qué significa una banda

Una banda es lo que dice la rúbrica sobre un enlace. No predice una penalización de Google, una acción manual ni un cambio de posición.

La IA puede comentar una fila que la rúbrica ya marcó, pero no puede añadir un dominio que la rúbrica no marcó. Cada dominio de la exportación procede de una fila guardada.

Consulta [Precios](./pricing.es.md) para ver unidades y límites del plan.

[Volver al índice de documentación](./index.es.md)
