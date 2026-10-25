---
title: 'Alertas'
description: 'Qué alertas se disparan, cómo funciona la entrega exactamente-una-vez y cuándo entrega una regla de caída de posición.'
locale: es
slug: alerts
section: product
order: 6
---

# Alertas

Las reglas de alerta se configuran por sitio. Pueden enviarse por correo, por webhook entrante de Slack o por un webhook genérico firmado con HMAC. Las entregas no consumen unidades.

<!-- docs-truth: metric=none; unit=none-deliveries-not-metered; cache-hits=not-applicable; refund=not-applicable; cadence=on-observed-transition; estimates=provider-observation -->

## Qué se dispara hoy

Las alertas de dominios de referencia nuevos y perdidos. Se disparan cuando se completan dos revisiones de enlaces seguidas, y cada alerta incluye la evidencia de antes y después que la provocó.

Las reglas de caída de posición solo se disparan cuando la caída está confirmada: una comprobación programada detecta la caída y una segunda comprobación nueva de la misma palabra clave en el mismo mercado la sigue mostrando. Si la palabra clave se recupera o la segunda comprobación no puede hacerse, la regla no envía nada. Consulta [Alertas de posición confirmadas](./confirmed-rank-alerts.es.md).

## Una alerta por cambio

Cada cambio observado se entrega una sola vez, como una única alerta y no una por dominio. Si una revisión añade 300 enlaces, recibes una sola alerta con una muestra de hasta 50 dominios y el recuento completo.

Tu primera revisión de enlaces no tiene con qué compararse, así que nunca genera alerta. El registro de entregas anota cada intento como enviado, fallido o suprimido.

Cuando falla un transporte, la entrega se registra como fallida en lugar de reintentarse sin fin. El mismo cambio nunca se envía como una segunda alerta.

## Canales

El correo, Slack y el webhook genérico están disponibles.

Para Slack, pegas una URL de webhook entrante. No hay aplicación de Slack de RankMeFast ni bot.

Los webhooks genéricos van firmados, para que tu receptor pueda comprobar que la carga viene de verdad de RankMeFast.

## Qué significa una alerta

Una alerta te dice que algo cambió entre dos instantáneas guardadas. No juzga la calidad de los enlaces ni predice un efecto en el posicionamiento.

Para unidades y límites del plan, consulta [Precios](./pricing.es.md).

[Volver al índice de documentación](./index.es.md)
