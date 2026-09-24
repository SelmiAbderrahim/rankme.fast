---
title: 'Alertas de posición confirmadas'
description: 'Cómo un cambio de posición pasa a confirmado y qué significan las etiquetas de observación.'
locale: es
slug: confirmed-rank-alerts
section: audits
order: 8
---

# Alertas de posición confirmadas

Una caída solo se convierte en alerta cuando la hemos visto dos veces. Así los altibajos pasajeros no llegan a tu bandeja de entrada.

## Cómo un cambio pasa a confirmado

1. Una comprobación de posiciones programada detecta que una de tus palabras clave principales cayó varias posiciones.
2. Volvemos a comprobar esa palabra clave en el mismo mercado con una consulta nueva. Para este paso nunca usamos un resultado en caché.
3. Si la segunda comprobación sigue mostrando la caída, es un **cambio de posición confirmado**, y solo entonces te avisamos.

## Cambios volátiles y sin confirmar

- **Volátil**: la segunda comprobación muestra que la palabra clave se recuperó. Guardamos el registro en el historial y no enviamos nada.
- **Sin confirmar**: no pudimos hacer la segunda comprobación porque se agotó tu cupo mensual o falló el proveedor. Queda solo como información y no genera alerta.

Los tres resultados siguen visibles junto al historial de posiciones de la palabra clave.

## Etiquetas de observación

Cada entrada indica qué vimos y cuándo:

- **Mercado**: el país, el idioma y el dispositivo usados en la comprobación.
- **Ventana**: cuándo se hicieron la primera y la segunda comprobación.
- **Frescura de la observación**: lo reciente que es el dato. Los datos antiguos se marcan como antiguos y nunca se presentan como tiempo real.
- **Fuente**: el servicio del proveedor del que salen los datos.

## A dónde van las alertas

Un cambio de posición confirmado aparece en [Próximas acciones](./next-actions.es.md) con un enlace al registro de la caída. Allí puedes descartarlo o reabrirlo, y cada decisión queda en el historial.

## Consultar es gratis

Abrir la lista de alertas, un registro de caída o el historial solo lee datos guardados. No se lanza ninguna consulta SERP nueva ni se consume ninguna unidad de tu plan.

[Volver al índice de la documentación](./index.es.md)
