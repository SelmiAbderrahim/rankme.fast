---
title: 'Content Intelligence'
description: 'Analiza una página tuya, obtén puntuación y resumen en lenguaje claro con citas.'
locale: es
slug: content-intelligence
section: audits
order: 3
---

# Content Intelligence

Content Intelligence examina una página que posees y devuelve una
puntuación, evidencias, un resumen en lenguaje claro y,
si aceptas, un borrador generado por IA. Un análisis consume un
crédito `content_analyses` de tu cuota mensual o de tu pack. La puntuación sigue reglas fijas: la misma página siempre obtiene
la misma puntuación.

## Qué hace

- Obtiene una página válida mediante el servicio de rastreo configurado.
- Extrae encabezados, enlaces, datos estructurados y señales de página.
- Puntúa con el mismo motor de reglas que el informe de auditoría.
- Devuelve evidencias por hallazgo: regla, ubicación, cita, confianza.
- Con opt-in llama al orden de proveedores IA del servidor para
  producir resumen y borrador opcional.

## Qué NO hace

- Nunca publica. Los borradores son tuyos.
- No rastrea URLs arbitrarias, solo sitios que posees o competidores
  Agency.
- No devuelve cargas útiles, prompts ni completaciones.

## Iniciar un análisis

- **Sitios → Contenido**: elige una URL de tu inventario.
- **Informe → Fix now / Watch**: la recomendación abre el flujo.
- **Investigación de keywords → keyword rastreada**: analiza la URL que
  posiciona.
- **Search Console → consulta**: analiza la URL que muestra Google.
- **Competidores → página competidora Agency**: solo Agency.

Cada acceso comprueba y reserva tu cuota antes de iniciar el análisis, ver
[Planes, límites y créditos](./plans-limits-credits.es.md).

## Qué cubre un crédito

Un crédito `content_analyses` cubre: la obtención de una página propia, hasta
tres páginas públicas de comparación revisadas, las evidencias de palabra
clave y resultados disponibles, la puntuación con sus evidencias, el resumen y,
con IA activa, un borrador. Regenerar consume otro crédito.

## Puntuación, evidencia, confianza, citas, resumen, borrador

- **Puntuación.** De 0 a 100. Mismas reglas que la auditoría.
- **Evidencia.** Regla, ubicación y cita por hallazgo.
- **Confianza.** `high` / `medium` / `low`.
- **Citas.** Cada afirmación IA cita URL y extracto.
- **Resumen.** Plan breve compartible.
- **Borrador.** Opt-in. Aceptas, editas o rechazas.

## Procesamiento IA opt-in y retención

Solo con opt-in enviamos extractos. Se conservan siete días y luego se
purgan. Los controles de exportación y borrado siguen en
[Seguridad de la cuenta](./settings-security.es.md).

## Resultados parciales y reembolsados

Si el proveedor tiene problemas, el análisis se marca `partial`.
Regenerar crea un análisis nuevo y consume otro crédito. Un fallo total se marca `refunded` y el crédito se
reintegra automáticamente.

## Recomendaciones y correlación de 28 días

Puedes **aceptar**, **descartar** o **aplicar** una recomendación. La
correlación de 28 días mide ranking, clics e impresiones antes/después. Muestra si
los números cambiaron, pero no prueba que el cambio fuera la causa.

## Inventario Pro y canibalización

Pro y Agency abren un inventario por intención con marcas de
canibalización. El inventario usa la asignación independiente
`content_inventory_page_blocks`: un bloque cubre hasta cuatro páginas propias
solicitadas, redondeando hacia arriba. Los bloques enteros no usados se
reembolsan cuando la ejecución termina.

## Portafolio competidor y monitoreo Agency

Las comparaciones de Agency parten de páginas de posicionamiento revisadas, no
de las páginas de inicio de los competidores. Abre un informe de panorama,
comprueba la página sugerida y las palabras clave que la respaldan, y confírmala
o introduce otra página del mismo dominio. Una sugerencia por sí sola no inicia
trabajo de pago, y una página no disponible nunca se sustituye silenciosamente
por la página de inicio.

Una ejecución confirmada puede comparar hasta 15 páginas competidoras revisadas
con las páginas propias que hayas elegido. La revisión muestra el número de
páginas y las unidades antes de reservar nada. RankMeFast guarda datos derivados
y extractos breves, no HTML sin procesar; los extractos caducan a los siete días.

La monitorización es una decisión aparte. «Monitorizar esta página revisada»
abre el formulario existente, donde confirmas la URL exacta antes de utilizar
una plaza. El análisis no crea monitores; la frecuencia semanal y los límites
del plan no cambian. Un cambio de Firecrawl descartado no vuelve a
avisar.

También puedes abrir un análisis de contenido específico desde una oportunidad
del informe. La URL propia, la palabra clave y la página competidora revisada
aparecen rellenadas, pero debes confirmar el análisis antes de iniciarlo.

## Gestionar cuota y pack de 20

La cuota mensual depende del plan, ver
[Planes, límites y créditos](./plans-limits-credits.es.md). El pack de
20 no caduca y se suma a la cuota.

## Solución de problemas

- **Acceso.** La URL debe pertenecerte. Si no, la respuesta es "no encontrado"
  en lugar de "prohibido", para no revelar si la URL existe.
- **robots.txt.** Si tu página propia bloquea el rastreo, la ejecución falla y
  se reembolsa el crédito. Una comparación opcional bloqueada puede dejar un
  resultado `partial`. RankMeFast nunca elude estas reglas.
- **URL aún no en Search Console.** El análisis usa el HTML obtenido, sin
  comparación de Search Console.
- **Límites.** Mensaje localizado con la métrica `content_analyses`.
- **Caída del proveedor.** El resultado es `partial` o `refunded`, nunca
  se presenta como un éxito.

## Conexión MCP

Desde Claude Code, Claude Desktop, Cursor o VS Code, ver
[RankMeFast MCP](./rankmefast-mcp.es.md).

## Exportación y borrado

Los análisis se incluyen en la exportación de la cuenta. Los controles están en
[Seguridad de la cuenta](./settings-security.es.md).
