---
title: 'Solución de problemas'
description: 'Problemas comunes y cómo resolverlos.'
locale: es
slug: troubleshooting
section: start
order: 3
---

# Solución de problemas

## Auditoría fallida o no disponible
- Revisa firewall y Cloudflare.
- Comprueba que robots.txt no bloquee `RankMeFastBot`.
- Reintenta en unos minutos.

## Comprobación de posición no disponible
Suele ser temporal; la siguiente ejecución reintenta.

## "Reconexión requerida" en Search Console
Abre Ajustes y reconecta.

## Tope alcanzado
Véase [Planes, límites y créditos](./plans-limits-credits.es.md).

## Tope alcanzado en una herramienta de investigación (402)
El mensaje nombra la unidad agotada, por ejemplo `keyword_lookups` o `audience_research_runs`. Espera al reinicio mensual, compra un pack de créditos donde exista o mejora de plan; las ejecuciones de Investigación de audiencia no tienen pack.

## Resultados parciales en una herramienta de investigación
Algunos motores o fuentes respondieron y otros no. El resultado llega con lo recibido y se etiqueta como **resultados parciales**. Lo que falta se nombra, nunca se rellena con ceros.

## No admitido para este motor / mercado
La comprobación no puede ejecutarse para ese motor o mercado. La parte no admitida se excluye del resultado y nunca se muestra como cero.

## No disponible (no es cero)
No llegó ningún dato para la ventana. `unavailable ≠ 0`: trátalo como desconocido, no como una caída a cero. Lo verás en la cuota de voz y en las tarjetas de IA generativa de Search Console.

## "Reconexión requerida" en tarjetas de analítica o IA generativa
La misma causa que la reconexión de Search Console de arriba: Google revocó el token. Reconecta desde el workspace de Google del sitio; las tarjetas se actualizan la próxima vez que se cargan.

## Falta correo de verificación
Revisa spam; el enlace expira en 24 h.

## El resumen indica "acortado"
Auditorías largas se recortan antes de enviarse; pulsa **Regenerar**.

## La pantalla de informe se queda cargando
Refresco completo (⌘/Ctrl + Mayús + R). Si persiste, contacta soporte.

[Volver al índice de la documentación](./index.es.md)
