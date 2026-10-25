---
title: 'RankMeFast MCP'
description: 'Conecta RankMeFast con agentes de programación, IDE y CLI compatibles con MCP.'
locale: es
slug: rankmefast-mcp
section: developers
order: 2
---

# Conecta RankMeFast con tus herramientas de IA

RankMeFast ofrece un endpoint remoto de [Model Context Protocol (MCP)](https://modelcontextprotocol.io/). Permite que un agente de programación, IDE o CLI compatible consulte tus datos SEO e inicie auditorías sin salir de tu flujo de trabajo.

## Configúralo en cinco minutos

1. Abre [Ajustes → Claves de API](/profile?tab=api-keys), selecciona **Crear clave** y copia la clave cuando aparezca. RankMeFast solo muestra la clave completa una vez.
2. Usa el endpoint MCP de RankMeFast:

   ```text
   https://rankme.fast/api/mcp
   ```

3. En los clientes que admitan variables de entorno, define la clave antes de iniciar el cliente:

   ```bash
   export RANKMEFAST_API_KEY='rmf_REPLACE_WITH_YOUR_KEY'
   ```

   En PowerShell:

   ```powershell
   $env:RANKMEFAST_API_KEY = 'rmf_REPLACE_WITH_YOUR_KEY'
   ```

4. Elige tu cliente a continuación, pega su configuración y reinícialo o vuelve a cargarlo.
5. Comprueba la conexión con: **«Usa RankMeFast para listar mis sitios».**

> Trata la clave como una contraseña: guárdala en una variable de entorno, una solicitud de contraseña o una configuración de usuario, y nunca la subas a un repositorio. Puedes limitar los ámbitos de cada clave (más abajo). Ten en cuenta que `start_audit` consume tu cuota mensual de auditorías.

## Controlar permisos y ámbitos de clave

Abre [Ajustes → MCP](/profile?tab=mcp) para administrar los valores predeterminados de la cuenta que comparten MCP y el Asistente de IA con sesión iniciada:

1. Activa o desactiva cada herramienta de RankMeFast.
2. Deja **Sitios permitidos** en todos los sitios o selecciona los que pueden usar las herramientas.
3. Desactiva **Permitir acciones con gasto** si `start_audit` no debe ejecutarse nunca.
4. Guarda los ajustes. La tarjeta de inicio rápido de la misma pestaña muestra el endpoint, un acceso a las claves de API y una configuración de cliente que puedes copiar.

Los valores de la cuenta son totalmente permisivos hasta que los cambias, por lo que las claves existentes siguen funcionando. El Asistente los usa directamente mediante tu sesión iniciada.

Puedes añadir ámbitos más estrictos al crear una clave en [Ajustes → Claves de API](/profile?tab=api-keys) y editarlos más adelante. Los ámbitos solo pueden restringir el acceso. El acceso efectivo de MCP siempre es la intersección:

- Una herramienta solo está disponible si la cuenta y la clave la permiten.
- Si la cuenta y la clave seleccionan sitios, solo están disponibles los incluidos en ambas listas.
- `start_audit` exige que la herramienta y las acciones con gasto estén permitidas en ambos niveles.

Un ámbito sin restricciones simplemente sigue el valor de la cuenta. Las herramientas no permitidas no aparecen en el cliente, y un sitio bloqueado devuelve el mismo resultado de no encontrado que un sitio ajeno.

## Idioma y contrato JSON-RPC

Para `tools/list` y cualquier llamada sin argumento `locale`, MCP elige el idioma con `x-lang`, después `Accept-Language` y, si no hay ninguno, `en`. Las etiquetas regionales como `fr-CA` se convierten en `fr`. El endpoint bearer ignora las cookies del navegador, el idioma de la cuenta y las preferencias del espacio de trabajo.

Todas las herramientas aceptan además un argumento `locale` opcional, que debe ser exactamente `en`, `ar`, `fr`, `de`, `es`, `ru` o `zh`. Anula las cabeceras en esa llamada: textos de error y de éxito, el campo `locale` del resultado estructurado y la cabecera HTTP `Content-Language`. Cualquier otro valor se rechaza como parámetro no válido (`-32602`) en el idioma de las cabeceras; a diferencia de una cabecera, no se convierte desde una etiqueta regional. Las respuestas añaden `x-lang, Accept-Language` a `Vary` y conservan los valores existentes.

Solo se traducen las descripciones de herramientas, los resúmenes legibles y los mensajes de error seguros. Los datos para máquinas son iguales en todos los idiomas: nombres y esquemas de herramientas, `jsonrpc`, `code` e `id` de JSON-RPC, nombres de propiedades, valores de enumeración y estado, booleanos, recuentos, ID, dominios, URL, palabras clave, marcas de tiempo, cursores, pruebas y textos guardados del usuario o proveedor. Los resultados estructurados ganan un campo `locale` sin perder nada.

Los errores de protocolo mantienen su código numérico: `-32700` error de análisis, `-32600` solicitud no válida, `-32601` método desconocido, `-32602` parámetros o herramienta no válidos y `-32603` error interno. El mensaje se traduce a partir del código y nunca se devuelven diagnósticos sin filtrar del SDK, la validación o el proveedor. MCP no devuelve CSV; la [guía de la API pública](./public-api.es.md) describe el formato CSV estable byte a byte.

## Elige tu cliente

| Cliente o entorno | Configuración directa | Configuración |
| --- | --- | --- |
| Claude Code y su pestaña Code de escritorio | Sí | Servidor HTTP con cabecera bearer |
| Cursor IDE y Cursor Agent CLI | Sí | JSON de MCP de usuario o proyecto |
| VS Code con GitHub Copilot | Sí | `mcp.json` de usuario o espacio de trabajo |
| GitHub Copilot CLI | Sí | Comando de CLI o JSON de usuario |
| Windsurf / Cascade | Sí | JSON de MCP de usuario |
| Codex CLI, extensión para IDE y Codex en ChatGPT de escritorio | Sí | TOML compartido de Codex |
| Gemini CLI | Sí | Comando de CLI o JSON de usuario |
| OpenCode | Sí | JSON de MCP remoto |
| JetBrains AI Assistant y Junie | Sí | Ajustes de MCP del IDE |
| Zed | Sí | Servidor de contexto remoto |
| Cline | Sí | Servidor Streamable HTTP |
| Roo Code | Sí | Servidor Streamable HTTP |
| Kiro IDE y CLI | Sí | JSON de MCP de usuario o proyecto |
| Copilot en Visual Studio, JetBrains, Xcode y Eclipse | Sí | JSON de MCP de Copilot |
| Claude.ai / conector de chat de Claude Desktop | No directamente | El conector necesita OAuth; RankMeFast usa actualmente claves bearer |
| ChatGPT web | No directamente | No lee la configuración MCP local de Codex |

Cualquier otro cliente puede conectarse si admite **Streamable HTTP** remoto y una cabecera `Authorization` personalizada. RankMeFast no ofrece un servidor stdio local ni un servidor SSE obsoleto.

## Claude Code

Añade un servidor de usuario. Las comillas simples mantienen intacta la referencia a la variable de entorno:

```bash
claude mcp add-json --scope user rankmefast \
  '{"type":"http","url":"https://rankme.fast/api/mcp","headers":{"Authorization":"Bearer ${RANKMEFAST_API_KEY}"}}'
```

Comprueba la conexión con:

```bash
claude mcp get rankmefast
```

También puedes ejecutar `/mcp` dentro de Claude Code. El entorno de Claude Code en la aplicación de escritorio usa la misma configuración. Consulta la [guía oficial de MCP para Claude Code](https://code.claude.com/docs/en/mcp).

El **conector de chat** de Claude.ai y Claude Desktop es diferente: su flujo de conectores remotos documenta OAuth, no una cabecera bearer estática arbitraria. No puede conectarse directamente hasta que RankMeFast ofrezca OAuth; usa Claude Code mientras tanto. Consulta los [conectores personalizados de Claude](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

## Cursor IDE y Cursor Agent CLI

Crea `~/.cursor/mcp.json` para una configuración de usuario. Sustituye ambos marcadores y mantén el archivo privado:

```json
{
  "mcpServers": {
    "rankmefast": {
      "url": "https://rankme.fast/api/mcp",
      "headers": {
        "Authorization": "Bearer rmf_REPLACE_WITH_YOUR_KEY"
      }
    }
  }
}
```

Cursor IDE y Cursor Agent CLI leen la misma configuración. Compruébala con:

```bash
cursor-agent mcp list
cursor-agent mcp list-tools rankmefast
```

Para una configuración de equipo, usa `.cursor/mcp.json`, pero no incluyas una clave literal en ese archivo versionado. Consulta la [guía oficial de MCP para Cursor](https://docs.cursor.com/context/model-context-protocol).

## VS Code y GitHub Copilot

Ejecuta **MCP: Open User Configuration** desde la paleta de comandos y usa una entrada de contraseña para que el secreto no se escriba en el archivo:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "rankmefast-key",
      "description": "RankMeFast API key",
      "password": true
    }
  ],
  "servers": {
    "rankmefast": {
      "type": "http",
      "url": "https://rankme.fast/api/mcp",
      "headers": {
        "Authorization": "Bearer ${input:rankmefast-key}"
      }
    }
  }
}
```

Ejecuta **MCP: List Servers** para iniciar o inspeccionar el servidor. La configuración del espacio de trabajo puede guardarse en `.vscode/mcp.json`; la variante con entrada de contraseña se puede compartir de forma segura. Consulta la [referencia oficial de configuración MCP de VS Code](https://code.visualstudio.com/docs/agents/reference/mcp-configuration).

## GitHub Copilot CLI

Con `RANKMEFAST_API_KEY` definida en tu shell:

```bash
copilot mcp add \
  rankmefast \
  --type http \
  --url https://rankme.fast/api/mcp \
  --header "Authorization=Bearer $RANKMEFAST_API_KEY" \
  --tools "*"
```

La shell expande la clave antes de que Copilot guarde la configuración de usuario, así que protege `~/.copilot/mcp-config.json`. Consulta [Añadir servidores MCP a Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers).

## Windsurf / Cascade

Añade lo siguiente a `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "rankmefast": {
      "serverUrl": "https://rankme.fast/api/mcp",
      "headers": {
        "Authorization": "Bearer ${env:RANKMEFAST_API_KEY}"
      }
    }
  }
}
```

Vuelve a cargarlo desde **Windsurf Settings → Cascade → MCP Servers**. Consulta la [guía oficial de MCP para Windsurf](https://docs.windsurf.com/windsurf/cascade/mcp).

## Codex CLI, extensión para IDE y ChatGPT de escritorio

Codex CLI, la extensión de Codex para IDE y el entorno de Codex en ChatGPT de escritorio comparten `~/.codex/config.toml` en el mismo equipo:

```toml
[mcp_servers.rankmefast]
url = "https://rankme.fast/api/mcp"
bearer_token_env_var = "RANKMEFAST_API_KEY"
```

Reinicia el IDE o la aplicación de escritorio después de definir la variable de entorno. En la CLI, compruébalo con:

```bash
codex mcp list
```

También puedes ejecutar `/mcp` en una sesión de Codex. Consulta la [guía oficial de MCP para Codex](https://learn.chatgpt.com/docs/extend/mcp).

ChatGPT web no lee la configuración local de Codex, por lo que esta configuración solo se aplica a los entornos de Codex del equipo configurado.

## Gemini CLI

Con `RANKMEFAST_API_KEY` definida en tu shell:

```bash
gemini mcp add \
  --scope user \
  --transport http \
  --header "Authorization: Bearer $RANKMEFAST_API_KEY" \
  rankmefast https://rankme.fast/api/mcp
```

Compruébalo con `gemini mcp list` o `/mcp` dentro de Gemini CLI. El comando guarda la cabecera expandida en `~/.gemini/settings.json`, así que mantén ese archivo privado. En JSON, usa `httpUrl`; Gemini reserva `url` para SSE obsoleto. Consulta la [guía oficial de MCP para Gemini CLI](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md).

## OpenCode

Añade lo siguiente al archivo global `~/.config/opencode/opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "rankmefast": {
      "type": "remote",
      "url": "https://rankme.fast/api/mcp",
      "enabled": true,
      "oauth": false,
      "headers": {
        "Authorization": "Bearer {env:RANKMEFAST_API_KEY}"
      }
    }
  }
}
```

`oauth: false` evita la detección de OAuth porque RankMeFast usa una clave bearer. Comprueba la configuración con:

```bash
opencode mcp list
opencode mcp debug rankmefast
```

Consulta la [guía oficial de MCP para OpenCode](https://opencode.ai/docs/mcp-servers/).

## JetBrains AI Assistant y Junie

Abre **Settings → Tools → AI Assistant → Model Context Protocol (MCP)**, añade un servidor HTTP y pega:

```json
{
  "mcpServers": {
    "rankmefast": {
      "url": "https://rankme.fast/api/mcp",
      "headers": {
        "Authorization": "Bearer rmf_REPLACE_WITH_YOUR_KEY"
      }
    }
  }
}
```

Guárdalo en los ajustes del IDE, no en un archivo de proyecto. Activa **Pass custom MCP servers** cuando quieras que Junie u otro agente integrado reciba las herramientas. Consulta la [guía oficial de MCP para JetBrains](https://www.jetbrains.com/help/ai-assistant/mcp.html).

## Zed

Abre **Settings → AI → MCP Servers → Add Remote Server** o añade lo siguiente a tus ajustes de usuario:

```json
{
  "context_servers": {
    "rankmefast": {
      "url": "https://rankme.fast/api/mcp",
      "headers": {
        "Authorization": "Bearer rmf_REPLACE_WITH_YOUR_KEY"
      }
    }
  }
}
```

Guarda la clave literal en los ajustes de usuario, no en los del proyecto. Un indicador verde junto al servidor confirma la conexión. Consulta la [guía oficial de MCP para Zed](https://zed.dev/docs/ai/mcp).

## Cline

Abre los ajustes de MCP de Cline y añade un servidor Streamable HTTP:

```json
{
  "mcpServers": {
    "rankmefast": {
      "type": "streamableHttp",
      "url": "https://rankme.fast/api/mcp",
      "headers": {
        "Authorization": "Bearer rmf_REPLACE_WITH_YOUR_KEY"
      },
      "disabled": false,
      "autoApprove": []
    }
  }
}
```

Deja `autoApprove` vacío para que iniciar una auditoría requiera tu aprobación. Consulta la [guía oficial de MCP para Cline](https://docs.cline.bot/mcp/mcp-overview).

## Roo Code

Usa los ajustes globales de MCP o `.roo/mcp.json`:

```json
{
  "mcpServers": {
    "rankmefast": {
      "type": "streamable-http",
      "url": "https://rankme.fast/api/mcp",
      "headers": {
        "Authorization": "Bearer rmf_REPLACE_WITH_YOUR_KEY"
      },
      "disabled": false,
      "alwaysAllow": []
    }
  }
}
```

Deja `alwaysAllow` vacío para que las acciones con consumo requieran aprobación. Consulta la [guía oficial de MCP para Roo Code](https://docs.roocode.com/features/mcp/using-mcp-in-roo).

## Kiro IDE y CLI

Usa `~/.kiro/settings/mcp.json` de forma global o `.kiro/settings/mcp.json` para un proyecto:

```json
{
  "mcpServers": {
    "rankmefast": {
      "url": "https://rankme.fast/api/mcp",
      "headers": {
        "Authorization": "Bearer ${RANKMEFAST_API_KEY}"
      }
    }
  }
}
```

Kiro expande las variables de entorno en las cabeceras. Consulta la [configuración oficial de MCP para Kiro](https://kiro.dev/docs/mcp/configuration/).

## Copilot en otros IDE

GitHub Copilot usa un formato diferente al de VS Code en Visual Studio, los IDE de JetBrains, Xcode y Eclipse:

```json
{
  "servers": {
    "rankmefast": {
      "url": "https://rankme.fast/api/mcp",
      "requestInit": {
        "headers": {
          "Authorization": "Bearer rmf_REPLACE_WITH_YOUR_KEY"
        }
      }
    }
  }
}
```

Guarda esto como configuración de usuario y no confirmes la clave en el repositorio. Consulta la [guía de configuración de MCP para las extensiones de Copilot en IDE](https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/extend-copilot-chat-with-mcp) de GitHub para encontrar el archivo de configuración de tu IDE.

## Herramientas de RankMeFast disponibles

| Herramienta | Qué hace | ¿Gasta presupuesto del proveedor? |
| --- | --- | --- |
| `list_sites` | Lista los sitios que pertenecen a tu cuenta | No |
| `get_latest_audit_report` | Devuelve la última auditoría completada de un sitio | No |
| `list_keywords` | Lista las palabras clave seguidas de un sitio | No |
| `get_rank_history` | Devuelve el historial de posiciones de una palabra clave de un sitio | No |
| `list_content_analyses` | Lista los análisis de Content Intelligence | No |
| `get_content_analysis` | Devuelve un análisis de Content Intelligence | No |
| `start_audit` | Inicia una auditoría del sitio | **Sí: un rastreo** |
| `get_audit_status` | Comprueba una ejecución de auditoría | No |
| `list_actions` | Lista las próximas acciones priorizadas de un sitio | No |
| `set_action_state` | Marca una acción como planificada, descartada, completada o abierta | No |
| `get_gsc_search_summary` | Devuelve clics, impresiones, CTR y posición de Search Console de 7, 28 o 90 días | No |
| `list_gsc_top_queries` | Lista las principales búsquedas almacenadas de Search Console para un sitio y un rango | No |
| `list_gsc_top_pages` | Lista las principales páginas almacenadas de Search Console para un sitio y un rango | No |
| `get_ga4_summary` | Devuelve sesiones, usuarios y eventos clave de Google Analytics 4 de 7, 28 o 90 días | No |
| `list_pages` | Lista el inventario de páginas almacenado con el estado de rastreo de cada página | No |
| `get_page_detail` | Devuelve el detalle almacenado de una página | No |
| `get_backlinks_summary` | Devuelve el total de backlinks y los dominios de referencia distintos de un sitio | No |
| `list_backlinks` | Lista los backlinks almacenados, uno por dominio de referencia | No |
| `list_competitors` | Lista la cartera de competidores de un sitio, activos y archivados | No |
| `get_ai_visibility_summary` | Devuelve los prompts de AI Visibility, las últimas comprobaciones y la cuota de voz | No |
| `get_local_seo_summary` | Devuelve la instantánea del perfil de SEO local y las posiciones del paquete local | No |
| `get_reviews_summary` | Devuelve las fuentes de reseñas, las estadísticas de valoración y los temas almacenados | No |
| `list_client_reports` | Lista los informes de clientes de un sitio, sus programaciones y entregas | No |

Todo se limita a la cuenta propietaria de la clave, así que un ID de sitio, análisis o ejecución de otra cuenta devuelve no encontrado. Si falta una herramienta que esperabas, revisa los permisos antes de investigar la conexión.

## Lectura de datos almacenados

Las herramientas añadidas después de las diez primeras solo leen datos que RankMeFast ya tiene almacenados. No llaman a Google ni a ningún otro proveedor, no actualizan nada y no inician ninguna tarea.

- **El alcance se indica.** Los resultados de Search Console y Google Analytics incluyen el `range` (7d, 28d o 90d), las fechas de inicio y fin, la fecha `asOf` y la fuente, así que una respuesta como «clics de los últimos 28 días» puede citar exactamente lo que cubre. El total del sitio y las tablas de búsquedas, páginas, países y dispositivos pueden diferir, y el resultado explica por qué.
- **Los datos que faltan se indican.** Si Google no está conectado, no hay una propiedad vinculada o todavía no existe una instantánea, el resultado trae `status: "unavailable"` o `"empty"` con un motivo claro. Nunca devuelve ceros en lugar de datos que faltan.
- **Los permisos se aplican en cada llamada.** Los interruptores de la cuenta en **Ajustes → MCP**, los alcances de la propia clave y las listas de sitios permitidos se comprueban en cada llamada. Un sitio al que no puedes acceder, o que pertenece a otra cuenta, se devuelve como no encontrado.
- **Las herramientas nuevas empiezan permitidas.** Siguen el mismo valor predeterminado que las demás herramientas de lectura, y los permisos guardados antes de que existieran siguen funcionando igual.
- **Los resultados tienen tope.** Las listas devuelven 100 filas como máximo y un resultado se mantiene pequeño; cuando se recortan filas, el resultado indica `truncated: true`.

El [asistente de IA](./ai-assistant.es.md) usa las mismas herramientas y los mismos permisos. En una conversación vinculada a un sitio, usa ese sitio directamente y no necesita listar antes tus sitios.

## Solución de problemas

- **El cliente no encuentra las herramientas:** confirma que la URL termina en `/api/mcp`, elige Streamable HTTP en lugar de SSE o stdio y reinicia el cliente.
- **Falta una herramienta esperada:** revisa el interruptor de la cuenta en **Ajustes → MCP** y los ámbitos de esa clave en **Ajustes → Claves de API**.
- **Un sitio aparece como no encontrado:** confirma que la cuenta y los ámbitos de clave lo permiten. Los sitios bloqueados y ajenos usan la misma respuesta a propósito.
- **No se permiten acciones con gasto:** permite `start_audit` y las acciones con gasto en ambos niveles, o déjalas desactivadas para un cliente de solo lectura.
- **401 Unauthorized:** usa exactamente la cabecera `Authorization: Bearer rmf_…`. La clave puede estar mal escrita, revocada o vinculada a una cuenta inactiva.
- **405 Method not allowed en el navegador:** es lo esperado, porque el endpoint acepta solicitudes `POST` de MCP, no solicitudes `GET` normales del navegador.
- **429 Too many requests:** espera a que termine el intervalo del límite de frecuencia indicado en las cabeceras de respuesta y vuelve a intentarlo.
- **503 Unavailable:** MCP está desactivado o temporalmente no disponible en esa instalación de RankMeFast; consulta a su operador.
- **Funciona en local, pero no a través de un proxy:** asegúrate de que el proxy reenvía las cabeceras `Authorization`, `Content-Type` y `Accept` a `/api/mcp`.

Para sustituir una clave, crea una nueva, actualiza y comprueba todos los clientes y, después, revoca la antigua desde [Ajustes → Claves de API](/profile?tab=api-keys). La revocación es inmediata.

## Compatibilidad

Esta versión incluye las 23 herramientas de la tabla. 21 son de solo lectura, `set_action_state` escribe sin coste y `start_audit` es la única que gasta presupuesto del proveedor. Radar de marca, Inteligencia de reseñas, Inteligencia de enlaces, Información de tráfico y Tendencias de palabras clave no tienen herramientas MCP. Los cambios son acumulativos: los nombres de herramientas y la forma de sus argumentos se mantienen, y pueden aparecer herramientas nuevas a medida que se publican funciones.

<!-- mcp-tools: list_sites; get_latest_audit_report; list_keywords; get_rank_history; list_content_analyses; get_content_analysis; start_audit; get_audit_status; list_actions; set_action_state; get_gsc_search_summary; list_gsc_top_queries; list_gsc_top_pages; get_ga4_summary; list_pages; get_page_detail; get_backlinks_summary; list_backlinks; list_competitors; get_ai_visibility_summary; get_local_seo_summary; get_reviews_summary; list_client_reports -->

## Guías relacionadas

- [Asistente de IA](./ai-assistant.es.md): usa las mismas herramientas autorizadas en el chat de RankMeFast.
- [API pública](./public-api.es.md): la API de solo lectura.
- [Content Intelligence](./content-intelligence.es.md): entiende los datos de análisis que devuelve MCP.
- [Seguridad de la cuenta](./settings-security.es.md): protege tu cuenta y tus claves.
