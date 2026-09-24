---
title: 'Planes, límites y créditos'
description: 'Límites de Starter, Pro y Agency, y créditos adicionales.'
locale: es
slug: plans-limits-credits
section: account
order: 2
---

# Planes, límites y créditos

<!-- generated: finite-free-intro:start -->
RankMeFast ofrece tres suscripciones de pago: Starter, Pro y Agency.
<!-- generated: finite-free-intro:end -->

## Planes a medida

Además de los planes fijos y los paquetes de créditos, puedes montar tu propio plan en **Precios** o en **Facturación → Plan a medida**. Eliges las cuotas mensuales, cuántos sitios y puestos necesitas, qué funciones activar y cada cuánto se comprueban las posiciones. Cada ajuste tiene su mínimo, su máximo y su incremento, y algunas opciones requieren o excluyen otras. El precio del navegador es solo una estimación; el presupuesto real lo calcula el servidor.

Las cuotas mensuales de un plan a medida se restablecen cada mes en tu fecha de facturación (UTC). Una compra anual incluye 12 de esas cuotas mensuales. Los sitios, las palabras clave y los puestos no se restablecen: si eliminas uno, su espacio queda libre. Los límites por ejecución, como las páginas de una auditoría, se aplican a cada ejecución.

Pagar al año descuenta hasta un 20% sobre 12 pagos mensuales. La vista previa muestra el descuento que obtienes de verdad tras el mínimo, el redondeo al alza y nuestro suelo de costes. Si el descuento completo dejara el precio por debajo de ese suelo, verás un descuento menor, ninguno, o no habrá opción anual. Nunca mostramos un descuento que no vayas a recibir.

El titular con sesión iniciada y correo verificado puede reservar un presupuesto durante 30 minutos. El botón de compra solo aparece cuando el servidor confirma que las compras están abiertas. Los precios están en USD y Polar añade los impuestos que correspondan al pagar. En el entorno de pruebas, sin pagos configurados, con datos de precios caducados o con las ventas en pausa, puedes ver la vista previa pero no comprar.

Un plan a medida empieza cuando se confirma su pago. No hay prueba, cupón, saldo de cartera ni prorrateo a mitad de periodo. Lo que pagaste se mantiene hasta el final del periodo. Cambiar el plan, pasar de mensual a anual (o al revés) o moverte entre un plan fijo y uno a medida requiere un nuevo pago al terminar el periodo pagado. Si la renovación necesita un precio nuevo, acéptalo antes de la fecha indicada o el plan no se renovará. La cancelación se aplica al final del periodo. Los saldos de paquetes que sigan siendo válidos se conservan, y los complementos recurrentes nunca se suman sin avisar a tus límites a medida. Los reembolsos siguen las condiciones mostradas al pagar. Si se cobra tarde un importe con un precio que no era seguro, te lo devolvemos completo de forma automática.

## Los tres planes

<!-- generated: finite-plan-table:start -->
<!-- source: tiers.ts -->
| Plan     | Monthly (USD) | Yearly (USD) | Sites | Keywords | Audits/month | Audit pages | Backlink rows | AI summaries | Seats | Audience Research runs |
|----------|---------------|--------------|-------|----------|--------------|-------------|---------------|--------------|-------|------------------------|
| Starter  | $49           | $470.40      | 2     | 250      | 10           | 1,000       | 0             | 20           | 1     | 2                      |
| Pro      | $159          | $1,526.40    | 5     | 1,000    | 30           | 3,000       | 10,000        | 100          | 3     | 10                     |
| Agency   | $499          | $4,790.40    | 50    | 2,000 | 45           | 5,000       | 100,000       | 480          | 15    | 30                 |
<!-- generated: finite-plan-table:end -->

Precios en USD. Anual con 20 % de descuento. El seguimiento diario es complemento pagado en todos los planes.

<!-- generated: finite-limit-semantics:start -->
**Cómo funcionan los límites.** Los sitios, las palabras clave monitorizadas y los asientos cuentan lo que tienes en este momento; si eliminas uno, se libera su hueco. Las auditorías, comprobaciones de posición, filas de backlinks, trabajo de IA y demás unidades medidas se reinician al comienzo de cada mes natural (UTC). Cada auditoría tiene además su propio tope de páginas. Los paquetes comprados siguen en la cuenta hasta que los uses. Los complementos recurrentes solo añaden la cantidad que aparece en Facturación.
<!-- generated: finite-limit-semantics:end -->

## Ejecuciones de Investigación de audiencia

<!-- source: tiers.ts -->
Una ejecución es un trabajo de investigación completo, sin importar cuántas páginas lea. Las cuentas Starter tienen 2 ejecuciones; Pro 10, Agency 30 al mes. No hay pack de créditos para esta métrica. Al llegar al tope, espera al reinicio mensual o mejora de plan. Véase [Investigación de audiencia](./audience-research.es.md).

## Unidades de Inteligencia de palabras clave y Pulso semanal

<!-- source: tiers.ts -->
- Una comprobación de gap usa una unidad `keyword_lookups` por competidor comparado.
- Una lectura de resumen o de tendencias usa una unidad `keyword_lookups` por palabra clave. Los resultados servidos desde caché siguen contando.
- Agrupar una lista de palabras clave usa una unidad `ai_summaries`; repetir la lista idéntica es gratis.
- Un resumen del Pulso semanal usa una unidad `ai_mentions_checks` por sitio y semana, sin importar cuántos compañeros lo reciban.

Los detalles están en [Inteligencia de palabras clave](./keyword-intelligence.es.md) y [Pulso semanal](./weekly-pulse.es.md).

### Límites de Competitor Intelligence

Competitor Intelligence comienza en Pro. Un panorama Pro puede incluir hasta tres competidores confirmados y Agency hasta diez. Cada competidor seleccionado consume una unidad `keyword_lookups`. La actualización opcional del descubrimiento consume otra unidad después de una confirmación independiente. La comparación Agency de páginas posicionadas es un proceso separado y consume una unidad `competitor_content_runs` por ejecución confirmada. Leer un informe, revisar una pareja de páginas, aceptar una recomendación o exportar no consume ninguna de estas unidades. Consulta [Enlaces y Competitor Intelligence](./backlinks-competitors.es.md).

## Mensajes del asistente de IA

<!-- source: tiers.ts ai-chat -->
Una unidad es un mensaje que envías al asistente de IA. Las cuentas Starter tienen 100 mensajes; Pro 200, Agency 400 al mes. Los aciertos de caché y las respuestas detenidas también cuentan. Un paquete único añade 100 mensajes por 19 $ en **Facturación → Créditos**.

## Límites y unidades de inteligencia

<!-- source: tiers.ts intelligence-caps -->
| Plan | Exploraciones Tendencias | Instantáneas Tráfico | Comprobaciones Enlaces | Sincronizaciones Reseñas | Análisis Radar |
|---|---:|---:|---:|---:|---:|
| Starter | 10 | 5 | 0 | 0 | 0 |
| Pro | 40 | 25 | 25 | 10 | 0 |
| Agency | 80 | 80 | 80 | 50 | 20 |

Una unidad de Tendencias cubre hasta cinco frases. Una de Tráfico cubre un dominio. Una de Enlaces cubre una consulta profunda o una parte de competidor. Una de Reseñas cubre un trabajo completo de una a tres fuentes. Una de Radar cubre una consulta de marca y su resumen citado.

Cuentan los resultados en caché y también las búsquedas correctas que no encuentran nada. Solo recuperas una unidad (una vez) si la fuente falla antes de que la función haya guardado algo útil. Consulta [Inteligencia de enlaces](./link-intelligence.es.md), [Información de tráfico](./traffic-insights.es.md), [Tendencias](./keyword-trends.es.md), [Inteligencia de reseñas](./review-intelligence.es.md) y [Radar de marca](./brand-radar.es.md).

## Complemento de Radar y paquetes

<!-- source: tiers.ts intelligence-products -->
<!-- intelligence-products: brand-addon=60@1900; brand-scans-40=40@2900; link-intel-100=50@1900; review-syncs-100=50@1900; traffic-snapshots-100=100@1900; trend-explorations-200=200@1900 -->
Pro y Agency pueden añadir 60 análisis de Radar al mes por 19 $/mes. Los 20 análisis base de Agency están disponibles sin complemento; la base de Pro es cero.

Paquetes de un solo pago: 40 análisis de Radar por 29 $, 50 comprobaciones de Enlaces por 19 $, 50 sincronizaciones de Reseñas por 19 $, 100 instantáneas de Tráfico por 19 $ y 200 exploraciones de Tendencias por 19 $. El saldo permanece hasta usarlo. Consulta [Precios](./pricing.es.md) o **Facturación → Créditos**.

## Límites ASO, complemento y paquetes

<!-- source: tiers.ts app-seo-caps -->
| Plan | Comprobaciones de palabras clave | Auditorías de fichas | Comprobaciones de listas | Investigación de palabras clave | Búsquedas de competidores | Análisis de reseñas | Perfiles de apps | Palabras clave de apps seguidas |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Starter | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Pro | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 25 |
| Agency | 50 | 4 | 20 | 2 | 0 | 0 | 5 | 50 |

<!-- source: tiers.ts app-seo-products -->
<!-- app-seo-products: addon=app_keyword_checks:600,app_listing_audits:8,app_chart_checks:60,app_keyword_lookups:40,app_competitor_lookups:10,app_review_runs:10@2900; app-keyword-checks-500=500@1900; app-research-50=50@1900; app-competitors-20=20@1900; app-review-runs-10=10@1900 -->
Pro y Agency pueden añadir cada mes 600 comprobaciones de palabras clave, 8 auditorías de fichas, 60 comprobaciones de listas, 40 páginas de investigación, 10 búsquedas de competidores y 10 análisis de reseñas por 29 $ al mes. Agency conserva además su asignación base.

Hay cuatro paquetes de un solo uso para Pro y Agency: 500 comprobaciones de palabras clave, 50 páginas de investigación, 20 búsquedas de competidores o 10 análisis de reseñas. Cada paquete cuesta 19 $. Los créditos permanecen hasta que se usan y solo se consumen después de la asignación mensual.

## Disponibilidad de las pruebas
Las pruebas son opcionales y no están incluidas en todos los planes de pago. Si una oferta incluye una, verás su duración y la fecha del primer cobro antes de confirmar el pago.

## Al alcanzar el tope
La acción se bloquea con opciones de mejora o **pack de créditos de exceso**.

## Packs de créditos
Pequeñas recargas de la métrica correspondiente que permanecen en la cuenta hasta que las uses.

## Cancelar y bajar de plan
La cancelación mantiene el acceso hasta fin de periodo. Bajar de plan tiene efecto en la próxima renovación; los recursos extra pasan a solo lectura.

## Planes para empresas
<!-- generated: finite-enterprise-plan:start -->
Enterprise empieza con 100 sitios activos y 25 asientos. El acuerdo recoge cualquier tope mayor, siempre como cifra fija; los límites que no menciona conservan su valor base de Enterprise. Consulta [Planes para empresas](./enterprise.es.md).
<!-- generated: finite-enterprise-plan:end -->

[Volver al índice de la documentación](./index.es.md)
