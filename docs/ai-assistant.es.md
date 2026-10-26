---
title: 'Asistente de IA'
description: 'Pregunta por tus pruebas SEO, recibe respuestas en directo y ejecuta herramientas autorizadas de RankMeFast.'
locale: es
slug: ai-assistant
section: developers
order: 3
---

# Trabajar con el Asistente de IA

El Asistente de IA, en [/assistant](/assistant), reúne tus conversaciones de RankMeFast en un solo espacio. Muestra las respuestas a medida que se generan y puede usar las herramientas de RankMeFast autorizadas para leer la evidencia SEO guardada o iniciar una auditoría.

## Iniciar una conversación

1. Abre **Asistente de IA** en la barra lateral.
2. Si quieres, elige un sitio antes del primer mensaje. El sitio aporta contexto; el acceso a herramientas sigue dependiendo de los permisos de la cuenta.
3. Escribe una pregunta y pulsa **Intro**. Usa **Mayús+Intro** para crear una línea nueva.
4. Observa la respuesta en directo. Despliega una tarjeta de herramienta para revisar sus argumentos y el resultado estructurado.
5. Selecciona **Detener** para terminar una respuesta. La parte ya generada permanece en la conversación.

Las conversaciones se guardan automáticamente y siguen disponibles tras recargar la página. Crea una conversación nueva para trabajar sin sitio o con uno distinto.

Con un sitio elegido, las preguntas sugeridas tratan de ese sitio. Con **Sin sitio — orientación general**, abarcan tu cuenta y preguntas generales de SEO. Cada conversación se llama como tu primer mensaje, con el dominio del sitio añadido cuando eso distingue conversaciones parecidas. Para eliminar una, selecciona el icono de papelera junto a ella y confirma; **Cancelar** la conserva. Si una respuesta se corta antes de terminar, la parte recibida se queda en la conversación con un aviso y un botón **Reintentar**.

## Herramientas disponibles

El Asistente usa el mismo registro de herramientas que RankMeFast MCP. Según tus permisos, puede ejecutar:

- `list_sites`, `get_latest_audit_report`, `list_keywords` y `get_rank_history` para consultar pruebas guardadas de sitios y posiciones.
- `list_content_analyses` y `get_content_analysis` para consultar trabajos guardados de Content Intelligence.
- `start_audit` para iniciar una auditoría y `get_audit_status` para comprobar su progreso.

Las herramientas de lectura usan datos ya guardados en RankMeFast, sin llamar a ningún proveedor de datos. Las tarjetas de herramienta muestran cuál se ejecutó, y [RankMeFast MCP](./rankmefast-mcp.es.md) las enumera todas. `start_audit` es la única herramienta que gasta: inicia una auditoría y consume saldo de tu propia cuenta de proveedor. Trata las respuestas del Asistente como orientación y verifica los cambios importantes con la evidencia mostrada.

## Permisos

Abre [Ajustes → MCP](/settings/profile?tab=mcp) para definir los valores predeterminados de la cuenta que comparten el Asistente y los clientes MCP. Puedes activar o desactivar cada herramienta, permitir solo ciertos sitios y bloquear acciones con gasto. Los valores iniciales son permisivos para que las cuentas existentes sigan funcionando hasta que las restrinjas.

El Asistente funciona con tu sesión iniciada, así que solo le afectan estos valores de la cuenta. Una herramienta desactivada no se ofrece al modelo, un sitio bloqueado aparece como no encontrado y `start_audit` también exige **Permitir acciones con gasto**. Los ámbitos de las claves de API solo afectan a los clientes MCP externos, donde una clave puede restringir los valores de la cuenta, nunca ampliarlos. Consulta los detalles en [RankMeFast MCP](./rankmefast-mcp.es.md).

## Mensajes y límites

Cada mensaje que envías abre una respuesta de IA en streaming, por lo que el Asistente tiene un límite de frecuencia por cuenta: si envías muchos mensajes en poco tiempo, espera un momento e inténtalo de nuevo. Detener una respuesta conserva lo ya escrito. Iniciar una auditoría desde el chat consume el mismo saldo de proveedor que iniciarla tú. El operador de tu instalación puede desactivar el Asistente con `CHAT_ENABLED` y acota la longitud de cada respuesta.

## Solución de problemas

- **Falta una herramienta:** revisa su interruptor en **Ajustes → MCP**. Los alcances de las claves MCP no cambian el acceso del Asistente con sesión iniciada.
- **Un sitio no está disponible:** confirma que la conversación está vinculada al sitio correcto y que el sitio está permitido en los valores predeterminados de la cuenta.
- **Una auditoría no se inicia:** activa la herramienta y las acciones con gasto, y comprueba que no haya ya una auditoría en curso para el sitio.
- **Demasiadas solicitudes:** espera un momento e inténtalo de nuevo.
- **Asistente no disponible:** la instalación ha desactivado `CHAT_ENABLED` o el servicio no está disponible temporalmente. Reintenta más tarde o contacta con el operador.
- **El flujo se detiene de repente:** usa **Reintentar** en el aviso. La respuesta parcial se queda en la conversación.

## Guías relacionadas

- [RankMeFast MCP](./rankmefast-mcp.es.md): conecta un cliente de IA externo y limita su clave.
- [Volver al índice de la documentación](./index.es.md)
