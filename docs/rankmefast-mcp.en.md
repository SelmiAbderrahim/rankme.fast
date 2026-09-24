---
title: 'RankMeFast MCP'
description: 'Connect RankMeFast to coding agents, IDEs, and MCP-ready CLIs.'
locale: en
slug: rankmefast-mcp
section: developers
order: 2
---

# Connect RankMeFast to your AI tools

RankMeFast has a remote [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) endpoint. It lets a compatible coding agent, IDE, or CLI read your SEO data and start audits without leaving your current workflow.

## Set up in five minutes

1. Open [Settings → API keys](/profile?tab=api-keys), select **Create key**, and copy the key when it appears. RankMeFast shows the full key only once.
2. Use the RankMeFast MCP endpoint:

   ```text
   https://rankme.fast/api/mcp
   ```

3. For clients that support environment variables, set the key before starting the client:

   ```bash
   export RANKMEFAST_API_KEY='rmf_REPLACE_WITH_YOUR_KEY'
   ```

   In PowerShell:

   ```powershell
   $env:RANKMEFAST_API_KEY = 'rmf_REPLACE_WITH_YOUR_KEY'
   ```

4. Choose your client below, paste its configuration, and restart or reload the client.
5. Verify it with: **“Use RankMeFast to list my sites.”**

> Treat the key like a password. Keep it in an environment variable, a password prompt, or user-level config, and never commit it to a repository. You can narrow each key's scopes (see below), and remember that `start_audit` uses your monthly audit allowance.

MCP access is included with Starter, Pro, and Agency. Agency keys also work with the read-only public REST API.

## Control permissions and key scopes

Open [Settings → MCP](/profile?tab=mcp) to manage the account defaults shared by MCP and the signed-in AI Assistant:

1. Turn each RankMeFast tool on or off.
2. Leave **Allowed sites** at all sites, or select the sites tools may use.
3. Turn **Allow spending actions** off when `start_audit` must never run.
4. Save the settings. The quick-start card on the same tab shows the endpoint, an API-key shortcut, and a copyable client configuration.

Account defaults are fully permissive until you change them, so existing keys keep working. The Assistant uses these account defaults directly because it runs through your signed-in session.

You can add narrower scopes while creating a key under [Settings → API keys](/profile?tab=api-keys), or edit an existing key later. Key scopes can only restrict access. Effective MCP access is always the intersection:

- A tool is available only when both the account and the key allow it.
- When account and key both select sites, only sites present in both lists are available.
- `start_audit` requires the tool and spending actions to be allowed at both levels.

An unrestricted key scope simply follows the account default. Tools that aren't allowed don't show up in the client, and a blocked site returns the same not-found result as a site you don't own.

## Language and JSON-RPC contract

For `tools/list` and any call without a `locale` argument, MCP picks the language from `x-lang`, then `Accept-Language`, then falls back to `en`. Regional tags such as `fr-CA` resolve to `fr`. The bearer endpoint ignores browser cookies, account language, and workspace preferences.

Every tool also accepts an optional `locale` argument: exactly one of `en`, `ar`, `fr`, `de`, `es`, `ru`, or `zh`. It overrides the headers for that call, including error and success text, the `locale` field of the structured result, and the HTTP `Content-Language` header. Any other value is rejected as invalid parameters (`-32602`), in the header language; unlike a header, it isn't mapped from a regional tag. Responses add `x-lang, Accept-Language` to `Vary` and keep any existing values.

Only tool descriptions, human-readable result summaries, and safe error messages are translated. Machine-readable data is the same in every language: tool names and schemas, JSON-RPC `jsonrpc`, `code` and `id`, property names, enum and status values, booleans, counts, IDs, domains, URLs, keywords, timestamps, cursors, evidence, and stored user or provider text. Structured results gain a `locale` field and lose nothing.

Protocol errors keep their numeric codes: `-32700` parse error, `-32600` invalid request, `-32601` unknown method, `-32602` invalid parameters or tool, and `-32603` internal error. The message is translated from the code, and raw SDK, validation, or vendor diagnostics are never returned. MCP doesn't return CSV; the [Public API guide](./public-api.en.md) documents the byte-stable CSV format.

## Choose your client

| Client or surface | Direct setup | Configuration |
| --- | --- | --- |
| Claude Code and its desktop Code tab | Yes | HTTP server with bearer header |
| Cursor IDE and Cursor Agent CLI | Yes | User or project MCP JSON |
| VS Code with GitHub Copilot | Yes | User or workspace `mcp.json` |
| GitHub Copilot CLI | Yes | CLI command or user JSON |
| Windsurf / Cascade | Yes | User MCP JSON |
| Codex CLI, IDE extension, and ChatGPT desktop Codex | Yes | Shared Codex TOML |
| Gemini CLI | Yes | CLI command or user JSON |
| OpenCode | Yes | Remote MCP JSON |
| JetBrains AI Assistant and Junie | Yes | IDE MCP settings |
| Zed | Yes | Remote context server |
| Cline | Yes | Streamable HTTP server |
| Roo Code | Yes | Streamable HTTP server |
| Kiro IDE and CLI | Yes | User or project MCP JSON |
| Copilot in Visual Studio, JetBrains, Xcode, and Eclipse | Yes | Copilot MCP JSON |
| Claude.ai / Claude Desktop chat connector | Not directly | The connector requires OAuth; RankMeFast currently uses bearer keys |
| ChatGPT web | Not directly | It does not read local Codex MCP configuration |

Any other client can connect if it supports remote **Streamable HTTP** and a custom `Authorization` header. RankMeFast does not expose a local stdio or legacy SSE server.

## Claude Code

Add a user-level server. The single quotes keep the environment variable reference intact:

```bash
claude mcp add-json --scope user rankmefast \
  '{"type":"http","url":"https://rankme.fast/api/mcp","headers":{"Authorization":"Bearer ${RANKMEFAST_API_KEY}"}}'
```

Check the connection with:

```bash
claude mcp get rankmefast
```

You can also run `/mcp` inside Claude Code. The Claude Code surface in the desktop app uses the same configuration. See the official [Claude Code MCP guide](https://code.claude.com/docs/en/mcp).

The Claude.ai and Claude Desktop **chat connector** is different: its remote connector flow documents OAuth, not an arbitrary static bearer header. It cannot connect directly until RankMeFast offers OAuth; use Claude Code instead. See [Claude custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

## Cursor IDE and Cursor Agent CLI

Create `~/.cursor/mcp.json` for a user-level setup. Replace both placeholders; keep this file private:

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

Cursor IDE and Cursor Agent CLI read the same configuration. Verify it with:

```bash
cursor-agent mcp list
cursor-agent mcp list-tools rankmefast
```

For a team configuration, use `.cursor/mcp.json` but do not put a literal key in that committed file. See the official [Cursor MCP guide](https://docs.cursor.com/context/model-context-protocol).

## VS Code and GitHub Copilot

Run **MCP: Open User Configuration** from the Command Palette, then use a password input so the secret is not written into the file:

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

Run **MCP: List Servers** to start or inspect it. Workspace configuration can live in `.vscode/mcp.json`; the password-input form is safe to share. See the official [VS Code MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration).

## GitHub Copilot CLI

With `RANKMEFAST_API_KEY` set in your shell:

```bash
copilot mcp add \
  rankmefast \
  --type http \
  --url https://rankme.fast/api/mcp \
  --header "Authorization=Bearer $RANKMEFAST_API_KEY" \
  --tools "*"
```

The shell expands the key before Copilot saves the user configuration, so protect `~/.copilot/mcp-config.json`. See [Adding MCP servers to Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers).

## Windsurf / Cascade

Add this to `~/.codeium/windsurf/mcp_config.json`:

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

Reload it from **Windsurf Settings → Cascade → MCP Servers**. See the official [Windsurf MCP guide](https://docs.windsurf.com/windsurf/cascade/mcp).

## Codex CLI, IDE extension, and ChatGPT desktop

Codex CLI, the Codex IDE extension, and the Codex surface in ChatGPT desktop share `~/.codex/config.toml` on the same machine:

```toml
[mcp_servers.rankmefast]
url = "https://rankme.fast/api/mcp"
bearer_token_env_var = "RANKMEFAST_API_KEY"
```

Restart the IDE or desktop app after setting the environment variable. In the CLI, check it with:

```bash
codex mcp list
```

You can also run `/mcp` in a Codex session. See the official [Codex MCP guide](https://learn.chatgpt.com/docs/extend/mcp).

ChatGPT web does not read local Codex configuration, so this setup applies only to Codex surfaces on the configured machine.

## Gemini CLI

With `RANKMEFAST_API_KEY` set in your shell:

```bash
gemini mcp add \
  --scope user \
  --transport http \
  --header "Authorization: Bearer $RANKMEFAST_API_KEY" \
  rankmefast https://rankme.fast/api/mcp
```

Verify it with `gemini mcp list` or `/mcp` inside Gemini CLI. The command stores the expanded header in `~/.gemini/settings.json`, so keep that file private. In JSON, use `httpUrl`; Gemini reserves `url` for legacy SSE. See the official [Gemini CLI MCP guide](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md).

## OpenCode

Add this to the global `~/.config/opencode/opencode.json` file:

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

`oauth: false` prevents OAuth discovery because RankMeFast uses a bearer key. Check the setup with:

```bash
opencode mcp list
opencode mcp debug rankmefast
```

See the official [OpenCode MCP guide](https://opencode.ai/docs/mcp-servers/).

## JetBrains AI Assistant and Junie

Open **Settings → Tools → AI Assistant → Model Context Protocol (MCP)**, add an HTTP server, and paste:

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

Keep this in IDE-level settings rather than a project file. Enable **Pass custom MCP servers** when you want Junie or another integrated agent to receive the tools. See the official [JetBrains MCP guide](https://www.jetbrains.com/help/ai-assistant/mcp.html).

## Zed

Open **Settings → AI → MCP Servers → Add Remote Server**, or add this to your user settings:

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

Keep the literal key in user settings, not project settings. A green indicator beside the server confirms the connection. See the official [Zed MCP guide](https://zed.dev/docs/ai/mcp).

## Cline

Open Cline's MCP settings and add a Streamable HTTP server:

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

Leave `autoApprove` empty so starting an audit requires your approval. See the official [Cline MCP guide](https://docs.cline.bot/mcp/mcp-overview).

## Roo Code

Use the global MCP settings or `.roo/mcp.json`:

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

Leave `alwaysAllow` empty so spending actions need approval. See the official [Roo Code MCP guide](https://docs.roocode.com/features/mcp/using-mcp-in-roo).

## Kiro IDE and CLI

Use `~/.kiro/settings/mcp.json` globally or `.kiro/settings/mcp.json` for a project:

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

Kiro expands environment variables in headers. See the official [Kiro MCP configuration](https://kiro.dev/docs/mcp/configuration/).

## Copilot in other IDEs

GitHub Copilot in Visual Studio, JetBrains IDEs, Xcode, and Eclipse uses a different shape from VS Code:

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

Store this as user-level configuration and do not commit the key. Follow GitHub's [MCP setup guide for Copilot IDE extensions](https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/extend-copilot-chat-with-mcp) for the config-file location in your IDE.

## Available RankMeFast tools

| Tool | What it does | Uses plan allowance? |
| --- | --- | --- |
| `list_sites` | Lists sites owned by your account | No |
| `get_latest_audit_report` | Returns the latest completed audit for a site | No |
| `list_keywords` | Lists tracked keywords for a site | No |
| `get_rank_history` | Returns keyword rank history for a site | No |
| `list_content_analyses` | Lists Content Intelligence analyses | No |
| `get_content_analysis` | Returns one Content Intelligence analysis | No |
| `start_audit` | Starts a site audit, within your plan's page cap | **Yes, one audit** |
| `get_audit_status` | Checks an audit run | No |
| `list_actions` | Lists the prioritized next actions for a site | No |
| `set_action_state` | Marks an action planned, dismissed, completed, or open | No |

Everything is scoped to the account that owns the key, so a site, analysis, or run ID from another account returns not found. If a tool you expect is missing, check permissions before debugging the connection.

## Troubleshooting

- **The client cannot discover tools:** confirm the URL ends in `/api/mcp`, choose Streamable HTTP rather than SSE or stdio, then restart the client.
- **One expected tool is missing:** check both the account toggle under **Settings → MCP** and that key’s scopes under **Settings → API keys**.
- **A site returns not found:** confirm that the account and key scopes both allow it. Blocked and non-owned sites intentionally use the same response.
- **Spending is not allowed:** allow `start_audit` and spending actions at both levels, or keep it disabled for a read-only client.
- **401 Unauthorized:** use the exact `Authorization: Bearer rmf_…` header. The key may be mistyped, revoked, or attached to an inactive account.
- **402 Upgrade required:** MCP needs Starter, Pro, or Agency. See [Plans, limits & credits](./plans-limits-credits.en.md).
- **405 Method not allowed in a browser:** this is expected because the endpoint accepts MCP `POST` requests, not ordinary browser `GET` requests.
- **429 Too many requests:** wait for the rate-limit window shown in the response headers, then retry.
- **503 Unavailable:** MCP is disabled or temporarily unavailable on that RankMeFast installation; ask its operator.
- **Works locally but not through a proxy:** make sure the proxy forwards `Authorization`, `Content-Type`, and `Accept` headers to `/api/mcp`.

To replace a key, create a new one, update and verify every client, then revoke the old key from [Settings → API keys](/profile?tab=api-keys). Revocation is immediate.

## Compatibility

This release has the ten tools listed above. Eight are read-only, `set_action_state` writes but costs nothing, and `start_audit` is the only one that spends plan allowance. Brand Radar, Review Intelligence, Link Intelligence, Traffic Insights, and Keyword Trends have no MCP tools. Changes are additive: existing tool names and argument shapes stay the same, and new tools may appear as features ship.

<!-- mcp-tools: list_sites; get_latest_audit_report; list_keywords; get_rank_history; list_content_analyses; get_content_analysis; start_audit; get_audit_status; list_actions; set_action_state -->

## Related guides

- [AI Assistant](./ai-assistant.en.md): use the same approved tools in RankMeFast chat.
- [Public API](./public-api.en.md): the Agency-only read API.
- [Content Intelligence](./content-intelligence.en.md): understand the analysis data returned by MCP.
- [Account security](./settings-security.en.md): keep your account and keys safe.
