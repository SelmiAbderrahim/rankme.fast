---
title: 'Pulso semanal'
description: 'Un resumen semanal por sitio, hecho con señales que ya pagaste.'
locale: es
slug: weekly-pulse
section: audits
order: 7
---

# Pulso semanal

El Pulso semanal es un correo resumen opcional que resume qué cambió en tu sitio durante la última semana ISO. Viene desactivado por defecto. Cada miembro verificado del equipo lo activa para sí mismo. Nadie puede activarlo por ti.

## Coste de un pulso

Enviar un resumen para un sitio usa **una unidad `ai_mentions_checks`** de ese sitio, sin importar cuántos compañeros estén suscritos. Leer el historial, reabrir un resumen anterior o exportar datos guardados no cuesta nada y no llama a ningún proveedor.

## Qué contiene

El resumen se arma solo con señales ya almacenadas:

- Citas nuevas y perdidas en los motores de IA que cubre tu plan.
- Caídas de posición confirmadas de tus palabras clave rastreadas.
- Acciones completadas o retrocedidas desde el pulso compatible anterior.
- Tus próximas tres acciones abiertas.
- Aparición generativa en Google Search Console, cuando Google devuelve filas.

El pulso no pide respuestas nuevas a los motores de IA ni lanza peticiones SERP nuevas.

## Cuándo se ejecuta

Cada sitio tiene una franja semanal fija, calculada a partir del ID del sitio y repartida entre lunes y sábado, 09:00–14:00 UTC. El domingo queda reservado para operaciones. Verás la próxima franja en el workspace de AI Visibility del sitio.

## Estados posibles

- **Completo**: todos los motores admitidos devolvieron datos y el resumen está listo.
- **Parcial**: algunos motores devolvieron datos parciales. El resumen se envía igualmente con lo que llegó.
- **No admitido**: ningún motor de tu plan cubre el mercado y cohorte de este sitio; no se consume unidad.
- **Bloqueado**: tu cupo `ai_mentions_checks` mensual está agotado; no se llama al proveedor.
- **Fallido**: todos los motores admitidos fallaron en esta ejecución. La unidad se usa y no se reembolsa.

## Activar y desactivar

Abre el workspace de AI Visibility del sitio, revisa la previsualización de gasto y activa **Pulso semanal**. Al desactivarlo, los próximos correos dejan de enviarse al momento. Reactivar toma la siguiente franja semanal.

## Privacidad

Los correos contienen solo resúmenes breves: host, recuento, texto de palabra clave, número de posición, verbo de acción, nombre de aparición. Las respuestas de IA en crudo, extractos de fuentes, texto de competidores, prompts e IDs de tarea del proveedor nunca aparecen en el resumen.

[Volver al índice de la documentación](./index.es.md)
