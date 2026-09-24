---
title: 'Asistente de IA'
description: 'Pregunta por tus pruebas SEO, recibe respuestas en directo y ejecuta herramientas autorizadas de RankMeFast.'
locale: es
slug: ai-assistant
section: developers
order: 3
---

# Trabajar con el Asistente de IA

El Asistente de IA de [/assistant](/assistant) reúne tus conversaciones de RankMeFast en un espacio de trabajo. Muestra las respuestas mientras se generan y puede usar herramientas autorizadas de RankMeFast para leer pruebas SEO guardadas o iniciar una auditoría. Está disponible en Starter, Pro y Agency; las cuentas sin plan de pago ven una pantalla de mejora.

## Iniciar una conversación

1. Abre **Asistente de IA** en la barra lateral.
2. Si quieres, elige un sitio antes del primer mensaje. El sitio aporta contexto; el acceso a herramientas sigue dependiendo de los permisos de la cuenta.
3. Escribe una pregunta y pulsa **Intro**. Usa **Mayús+Intro** para crear una línea nueva.
4. Observa la respuesta en directo. Despliega una tarjeta de herramienta para revisar sus argumentos y el resultado estructurado.
5. Selecciona **Detener** para terminar una respuesta. La parte ya generada permanece en la conversación.

Las conversaciones se guardan automáticamente y siguen disponibles tras recargar la página. Crea una conversación nueva para trabajar sin sitio o con uno distinto.

## Herramientas disponibles

El Asistente usa el mismo registro de herramientas que RankMeFast MCP. Según tus permisos, puede ejecutar:

- `list_sites`, `get_latest_audit_report`, `list_keywords` y `get_rank_history` para consultar pruebas guardadas de sitios y posiciones.
- `list_content_analyses` y `get_content_analysis` para consultar trabajos guardados de Content Intelligence.
- `start_audit` para iniciar una auditoría y `get_audit_status` para comprobar su progreso.

Las herramientas de lectura consultan datos ya guardados en RankMeFast. `start_audit` es la única herramienta que genera gasto y también consume una auditoría de tu plan. Usa las respuestas como orientación y comprueba los cambios importantes con las pruebas mostradas.

## Permisos

Abre [Ajustes → MCP](/profile?tab=mcp) para definir los valores predeterminados de la cuenta que comparten el Asistente y los clientes MCP. Puedes activar o desactivar cada herramienta, permitir solo ciertos sitios y bloquear acciones con gasto. Los valores iniciales son permisivos para que las cuentas existentes sigan funcionando hasta que las restrinjas.

El Asistente funciona con tu sesión iniciada, así que solo le afectan estos valores de la cuenta. Una herramienta desactivada no se ofrece al modelo, un sitio bloqueado aparece como no encontrado y `start_audit` también exige **Permitir acciones con gasto**. Los ámbitos de las claves de API solo afectan a los clientes MCP externos, donde una clave puede restringir los valores de la cuenta, nunca ampliarlos. Consulta los detalles en [RankMeFast MCP](./rankmefast-mcp.es.md).

## Mensajes, límites y créditos

Cada mensaje aceptado que envías consume una unidad `ai_chat_messages`. Los límites mensuales son Starter 100, Pro 200 y Agency 400. Detener una respuesta también cuenta porque el trabajo ya ha empezado. Una auditoría iniciada desde el chat consume por separado una auditoría.

Cuando se agota el límite, el cuadro de texto muestra una opción de mejora o créditos antes de iniciar otra solicitud de IA. Un paquete único **Chat de IA** añade 100 mensajes por 19 $ en **Facturación → Créditos**. Consulta [Planes, límites y créditos](./plans-limits-credits.es.md) para ver las cuotas actuales.

## Solución de problemas

- **El Asistente está bloqueado:** la cuenta no tiene un plan de pago. Mejora a Starter o superior.
- **Límite de mensajes alcanzado:** espera al reinicio mensual, cambia de plan o añade un paquete de Chat de IA.
- **Falta una herramienta:** revisa su interruptor en **Ajustes → MCP**. Los ámbitos de claves MCP no cambian el acceso del Asistente con sesión iniciada.
- **Un sitio no está disponible:** comprueba el sitio vinculado a la conversación y que esté permitido en los valores de la cuenta.
- **No comienza una auditoría:** activa la herramienta y las acciones con gasto y comprueba la cuota de auditorías.
- **Asistente no disponible:** la instalación ha desactivado `CHAT_ENABLED` o el servicio no está disponible temporalmente. Reintenta más tarde o consulta al operador.
- **El flujo se corta:** vuelve a enviar el mensaje. Puede quedar una respuesta parcial en la conversación.

## Guías relacionadas

- [RankMeFast MCP](./rankmefast-mcp.es.md): conecta un cliente de IA externo y limita su clave.
- [Planes, límites y créditos](./plans-limits-credits.es.md): compara cuotas de mensajes y auditorías.
- [Volver al índice de la documentación](./index.es.md)
