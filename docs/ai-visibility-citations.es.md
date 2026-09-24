---
title: 'Citas de IA y brechas de fuentes'
description: 'Comprobaciones de prompts muestreadas: qué fuentes citan las respuestas de IA y dónde faltas tú.'
locale: es
slug: ai-visibility-citations
section: audits
order: 10
---

# Citas de IA y brechas de fuentes

AI Visibility comprueba qué responden los asistentes de IA a los prompts que sigues y qué fuentes citan esas respuestas.

## Una muestra, nunca cobertura total

Sigues un conjunto pequeño de prompts por sitio (hasta diez). Una comprobación consulta esos prompts en los motores que cubre tu plan, así que el resultado es una muestra de lo que la gente podría ver (tamaño de muestra = prompts × cohorte). No cubre todo lo que se pregunta a una IA.

## Motores admitidos

Las comprobaciones de menciones leen el índice de menciones del proveedor para los resultados de Google y ChatGPT. Las comprobaciones de respuestas cubren ChatGPT, Gemini y Claude; Perplexity solo admite respuestas en vivo. Si el proveedor informa de un producto de IA nuevo, aparece con el nombre que le da el proveedor.

## Citas

Una cita es una URL más la identidad de la fuente a la que apuntó la respuesta. Registramos la URL citada siempre que el motor la informa, y si una respuesta te citó a ti o a un competidor seguido.

## Brechas de fuentes

Una brecha de fuentes significa que las respuestas de tu tema citan otras fuentes, pero nunca la tuya. Las brechas aparecen como elementos en [Próximas acciones](./next-actions.es.md), cada una señalando las fuentes que los motores prefirieron.

## Estados

- **Resultados parciales**: algunos motores devolvieron datos y otros no. Mostramos lo que llegó y nombramos lo que falta.
- **No admitido para este motor / mercado**: el motor no puede ejecutar esta comprobación donde estás. Se deja fuera en lugar de mostrarse como cero.
- **No disponible (no es cero)**: no llegó ningún dato. `unavailable ≠ 0`: significa que no lo sabemos, no que nunca te citaran.

## No es cuota de mercado de IA

La cuota de voz compara con qué frecuencia las respuestas te nombran a ti frente a los competidores que sigues, solo dentro de tus prompts muestreados. No es una medida de cuota de mercado.

## Qué cuesta una comprobación

Una comprobación usa una unidad `ai_mentions_checks` por prompt seguido. Leer resultados guardados, citas y brechas de fuentes es gratis.

[Volver al índice de la documentación](./index.es.md)
