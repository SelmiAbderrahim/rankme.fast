---
title: 'Alertas'
description: 'Qué alertas se disparan hoy, cómo funciona la entrega exactamente-una-vez y por qué una regla de caída de posición puede configurarse antes de poder entregar.'
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

También puedes configurar y guardar reglas de caída de posición, pero entregan a partir de observaciones de caída confirmadas que el pipeline de posiciones publicado todavía no produce. Las alertas de cambios de enlaces son el canal que funciona hoy.

## Una alerta por cambio

Cada cambio observado se entrega una sola vez, como una única alerta y no una por dominio. Si una revisión añade 300 enlaces, recibes una sola alerta con una muestra de hasta 50 dominios y el recuento completo.

Tu primera revisión de enlaces no tiene con qué compararse, así que nunca genera alerta. El registro de entregas anota cada intento como enviado, fallido o suprimido.

Cuando falla un transporte, la entrega se registra como fallida en lugar de reintentarse sin fin. El mismo cambio nunca se envía como una segunda alerta.

## Canales y límite de reglas

El correo funciona en todos los planes de pago; Slack y el webhook genérico requieren Pro o superior. Puedes tener hasta 2 reglas de alerta en Starter, 10 en Pro y 50 en Agency.

Para Slack, pegas una URL de webhook entrante. No hay aplicación de Slack de RankMeFast ni bot.

Los webhooks genéricos van firmados, para que tu receptor pueda comprobar que la carga viene de verdad de RankMeFast.

## Qué significa una alerta

Una alerta te dice que algo cambió entre dos instantáneas guardadas. No juzga la calidad de los enlaces ni predice un efecto en el posicionamiento.

Para unidades y límites del plan, consulta [Precios](./pricing.es.md).

[Volver al índice de documentación](./index.es.md)
