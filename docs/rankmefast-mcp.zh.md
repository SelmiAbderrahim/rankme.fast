---
title: 'RankMeFast MCP'
description: '将 RankMeFast 连接到编程智能体、IDE 和支持 MCP 的 CLI。'
locale: zh
slug: rankmefast-mcp
section: developers
order: 2
---

# 将 RankMeFast 连接到你的 AI 工具

RankMeFast 提供远程 [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) 端点。兼容的编程智能体、IDE 或 CLI 可以通过它读取你的 SEO 数据并启动审计，无需离开当前工作流程。

## 五分钟完成设置

1. 打开[设置 → API 密钥](/profile?tab=api-keys)，选择**创建密钥**，并在密钥出现后立即复制。RankMeFast 只会完整显示一次密钥。
2. 使用 RankMeFast MCP 端点：

   ```text
   https://rankme.fast/api/mcp
   ```

3. 如果客户端支持环境变量，请在启动客户端前设置密钥：

   ```bash
   export RANKMEFAST_API_KEY='rmf_REPLACE_WITH_YOUR_KEY'
   ```

   在 PowerShell 中：

   ```powershell
   $env:RANKMEFAST_API_KEY = 'rmf_REPLACE_WITH_YOUR_KEY'
   ```

4. 在下方选择你的客户端，粘贴相应配置，然后重启或重新加载客户端。
5. 使用这条指令验证连接：**“使用 RankMeFast 列出我的站点。”**

> 请像保管密码一样保管密钥：放在环境变量、密码输入框或用户级配置中，绝不要提交到代码仓库。你可以收紧每个密钥的范围（见下文）。注意 `start_audit` 会消耗每月审计额度。

Starter、Pro 和 Agency 套餐均包含 MCP 访问权限。Agency 密钥还可用于只读公共 REST API。

## 控制权限与密钥范围

打开[设置 → MCP](/profile?tab=mcp)，可管理 MCP 与登录状态下的 AI 助手共同使用的账户默认权限：

1. 开启或关闭每个 RankMeFast 工具。
2. 将**允许的站点**保留为全部站点，或选择工具可以使用的站点。
3. 如果绝不允许运行 `start_audit`，请关闭**允许产生支出的操作**。
4. 保存设置。同一标签页的快速开始卡片会显示端点、API 密钥入口和可复制的客户端配置。

在你主动修改之前，账户默认权限全部开放，因此现有密钥会继续工作。助手通过你的登录会话直接使用这些默认权限。

你可以在[设置 → API 密钥](/profile?tab=api-keys)中创建密钥时添加更严格的范围，也可以之后编辑。密钥范围只能收紧访问权限。MCP 的最终访问权限始终是两者的交集：

- 只有账户和密钥都允许时，工具才可用。
- 如果账户和密钥都选择了站点，则只有同时出现在两个列表中的站点可用。
- `start_audit` 要求两个层级都允许该工具和产生支出的操作。

不受限的密钥范围直接沿用账户默认权限。不允许的工具不会出现在客户端中；被阻止的站点与不属于你的站点一样，返回相同的“未找到”结果。

## 语言和 JSON-RPC 契约

对于 `tools/list` 以及未传 `locale` 参数的调用，MCP 依次根据 `x-lang`、`Accept-Language` 选择语言，都没有时使用 `en`。`fr-CA` 等区域标签会归为 `fr`。Bearer 端点不读取浏览器 Cookie、账户语言或工作区偏好。

每个工具还接受可选的 `locale` 参数，取值必须正好是 `en`、`ar`、`fr`、`de`、`es`、`ru` 或 `zh` 之一。它会覆盖本次调用的请求头设置：错误和成功文本、结构化结果中的 `locale` 字段以及 HTTP `Content-Language` 头。其他值会以请求头语言返回无效参数错误（`-32602`）；与请求头不同，这里不会按区域标签换算。响应会向 `Vary` 添加 `x-lang, Accept-Language`，并保留现有值。

只有工具说明、人类可读的结果摘要和安全错误消息会被翻译。机器可读数据在所有语言下都相同：工具名称和架构、JSON-RPC 的 `jsonrpc`、`code` 和 `id`、属性名、枚举和状态值、布尔值、计数、ID、域名、URL、关键词、时间戳、游标、证据以及已存储的用户或供应商文本。结构化结果会多一个 `locale` 字段，其余字段不变。

协议错误保留数字代码：`-32700` 表示解析错误，`-32600` 表示无效请求，`-32601` 表示未知方法，`-32602` 表示无效参数或工具，`-32603` 表示内部错误。消息按代码翻译，绝不会返回原始 SDK、验证或供应商诊断信息。MCP 不输出 CSV；逐字节稳定的 CSV 格式见[公共 API 指南](./public-api.zh.md)。

## 选择你的客户端

| 客户端或使用端 | 可直接设置 | 配置方式 |
| --- | --- | --- |
| Claude Code 及桌面应用中的 Code 标签页 | 是 | 带 Bearer 请求头的 HTTP 服务器 |
| Cursor IDE 和 Cursor Agent CLI | 是 | 用户级或项目级 MCP JSON |
| 配合 GitHub Copilot 的 VS Code | 是 | 用户级或工作区 `mcp.json` |
| GitHub Copilot CLI | 是 | CLI 命令或用户级 JSON |
| Windsurf / Cascade | 是 | 用户级 MCP JSON |
| Codex CLI、IDE 扩展及 ChatGPT 桌面版中的 Codex | 是 | 共享的 Codex TOML |
| Gemini CLI | 是 | CLI 命令或用户级 JSON |
| OpenCode | 是 | 远程 MCP JSON |
| JetBrains AI Assistant 和 Junie | 是 | IDE MCP 设置 |
| Zed | 是 | 远程上下文服务器 |
| Cline | 是 | Streamable HTTP 服务器 |
| Roo Code | 是 | Streamable HTTP 服务器 |
| Kiro IDE 和 CLI | 是 | 用户级或项目级 MCP JSON |
| Visual Studio、JetBrains、Xcode 和 Eclipse 中的 Copilot | 是 | Copilot MCP JSON |
| Claude.ai / Claude Desktop 聊天连接器 | 无法直接设置 | 该连接器要求 OAuth；RankMeFast 目前使用 Bearer 密钥 |
| ChatGPT 网页版 | 无法直接设置 | 它不会读取本地 Codex MCP 配置 |

其他客户端只要支持远程 **Streamable HTTP** 和自定义 `Authorization` 请求头，也可以连接。RankMeFast 不提供本地 stdio 服务器或旧版 SSE 服务器。

## Claude Code

添加用户级服务器。单引号可以原样保留环境变量引用：

```bash
claude mcp add-json --scope user rankmefast \
  '{"type":"http","url":"https://rankme.fast/api/mcp","headers":{"Authorization":"Bearer ${RANKMEFAST_API_KEY}"}}'
```

使用以下命令检查连接：

```bash
claude mcp get rankmefast
```

你也可以在 Claude Code 中运行 `/mcp`。桌面应用中的 Claude Code 使用同一份配置。请参阅官方 [Claude Code MCP 指南](https://code.claude.com/docs/en/mcp)。

Claude.ai 和 Claude Desktop 的**聊天连接器**有所不同：它的远程连接流程使用 OAuth，不支持任意静态 Bearer 请求头。在 RankMeFast 提供 OAuth 之前，它无法直接连接；请改用 Claude Code。请参阅 [Claude 自定义连接器](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)。

## Cursor IDE 和 Cursor Agent CLI

创建 `~/.cursor/mcp.json` 进行用户级设置。替换两个占位符，并确保该文件不被公开：

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

Cursor IDE 和 Cursor Agent CLI 读取同一份配置。使用以下命令验证：

```bash
cursor-agent mcp list
cursor-agent mcp list-tools rankmefast
```

团队配置可使用 `.cursor/mcp.json`，但不要把明文密钥放入将要提交的文件。请参阅官方 [Cursor MCP 指南](https://docs.cursor.com/context/model-context-protocol)。

## VS Code 和 GitHub Copilot

从命令面板运行 **MCP: Open User Configuration**，然后使用密码输入项，以免将密钥写入文件：

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

运行 **MCP: List Servers** 以启动或检查服务器。工作区配置可以放在 `.vscode/mcp.json`；使用密码输入项的版本可以安全共享。请参阅官方 [VS Code MCP 配置参考](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)。

## GitHub Copilot CLI

在 shell 中设置 `RANKMEFAST_API_KEY` 后运行：

```bash
copilot mcp add \
  rankmefast \
  --type http \
  --url https://rankme.fast/api/mcp \
  --header "Authorization=Bearer $RANKMEFAST_API_KEY" \
  --tools "*"
```

shell 会在 Copilot 保存用户配置前展开密钥，因此请保护好 `~/.copilot/mcp-config.json`。请参阅[向 Copilot CLI 添加 MCP 服务器](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers)。

## Windsurf / Cascade

将以下内容添加到 `~/.codeium/windsurf/mcp_config.json`：

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

从 **Windsurf Settings → Cascade → MCP Servers** 重新加载配置。请参阅官方 [Windsurf MCP 指南](https://docs.windsurf.com/windsurf/cascade/mcp)。

## Codex CLI、IDE 扩展和 ChatGPT 桌面版

Codex CLI、Codex IDE 扩展和 ChatGPT 桌面版中的 Codex 在同一台设备上共享 `~/.codex/config.toml`：

```toml
[mcp_servers.rankmefast]
url = "https://rankme.fast/api/mcp"
bearer_token_env_var = "RANKMEFAST_API_KEY"
```

设置环境变量后，重启 IDE 或桌面应用。在 CLI 中使用以下命令检查：

```bash
codex mcp list
```

你也可以在 Codex 会话中运行 `/mcp`。请参阅官方 [Codex MCP 指南](https://learn.chatgpt.com/docs/extend/mcp)。

ChatGPT 网页版不会读取本地 Codex 配置，因此此设置仅适用于已配置设备上的 Codex 使用端。

## Gemini CLI

在 shell 中设置 `RANKMEFAST_API_KEY` 后运行：

```bash
gemini mcp add \
  --scope user \
  --transport http \
  --header "Authorization: Bearer $RANKMEFAST_API_KEY" \
  rankmefast https://rankme.fast/api/mcp
```

使用 `gemini mcp list` 或 Gemini CLI 中的 `/mcp` 验证。该命令会将展开后的请求头存入 `~/.gemini/settings.json`，因此请确保此文件不被公开。在 JSON 中请使用 `httpUrl`；Gemini 将 `url` 保留给旧版 SSE。请参阅官方 [Gemini CLI MCP 指南](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md)。

## OpenCode

将以下内容添加到全局文件 `~/.config/opencode/opencode.json`：

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

`oauth: false` 会阻止 OAuth 发现，因为 RankMeFast 使用 Bearer 密钥。使用以下命令检查设置：

```bash
opencode mcp list
opencode mcp debug rankmefast
```

请参阅官方 [OpenCode MCP 指南](https://opencode.ai/docs/mcp-servers/)。

## JetBrains AI Assistant 和 Junie

打开 **Settings → Tools → AI Assistant → Model Context Protocol (MCP)**，添加一个 HTTP 服务器，然后粘贴：

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

请将配置保存在 IDE 级设置中，而不是项目文件中。需要让 Junie 或其他集成智能体使用这些工具时，请启用 **Pass custom MCP servers**。请参阅官方 [JetBrains MCP 指南](https://www.jetbrains.com/help/ai-assistant/mcp.html)。

## Zed

打开 **Settings → AI → MCP Servers → Add Remote Server**，或将以下内容添加到用户设置：

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

请将明文密钥保存在用户设置中，而不是项目设置中。服务器旁的绿色指示灯表示连接成功。请参阅官方 [Zed MCP 指南](https://zed.dev/docs/ai/mcp)。

## Cline

打开 Cline 的 MCP 设置，添加一个 Streamable HTTP 服务器：

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

保持 `autoApprove` 为空，以便启动审计时需要你的批准。请参阅官方 [Cline MCP 指南](https://docs.cline.bot/mcp/mcp-overview)。

## Roo Code

使用全局 MCP 设置或 `.roo/mcp.json`：

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

保持 `alwaysAllow` 为空，使消耗额度的操作需要批准。请参阅官方 [Roo Code MCP 指南](https://docs.roocode.com/features/mcp/using-mcp-in-roo)。

## Kiro IDE 和 CLI

使用 `~/.kiro/settings/mcp.json` 进行全局配置，或使用 `.kiro/settings/mcp.json` 进行项目配置：

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

Kiro 会展开请求头中的环境变量。请参阅官方 [Kiro MCP 配置](https://kiro.dev/docs/mcp/configuration/)。

## 其他 IDE 中的 Copilot

Visual Studio、JetBrains IDE、Xcode 和 Eclipse 中的 GitHub Copilot 使用与 VS Code 不同的格式：

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

请将其保存为用户级配置，且不要提交密钥。请按照 GitHub 的 [Copilot IDE 扩展 MCP 设置指南](https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/extend-copilot-chat-with-mcp)，查找你的 IDE 所使用的配置文件位置。

## 可用的 RankMeFast 工具

| 工具 | 功能 | 是否消耗套餐额度？ |
| --- | --- | --- |
| `list_sites` | 列出你的账户所拥有的站点 | 否 |
| `get_latest_audit_report` | 返回某个站点最近完成的审计 | 否 |
| `list_keywords` | 列出某个站点跟踪的关键词 | 否 |
| `get_rank_history` | 返回关键词排名历史 | 否 |
| `list_content_analyses` | 列出 Content Intelligence 分析 | 否 |
| `get_content_analysis` | 返回一项 Content Intelligence 分析 | 否 |
| `start_audit` | 在套餐页面上限内启动站点审计 | **是, 一次审计** |
| `get_audit_status` | 检查审计任务 | 否 |
| `list_actions` | 列出站点按优先级排序的后续行动 | 否 |
| `set_action_state` | 将行动标记为已计划、已忽略、已完成或重新打开 | 否 |

所有内容都限定在密钥所属的账户内，因此其他账户的站点、分析或任务 ID 会返回“未找到”。如果缺少某个预期的工具，请先检查权限，再排查连接。

## 故障排除

- **客户端无法发现工具：**确认 URL 以 `/api/mcp` 结尾，选择 Streamable HTTP 而不是 SSE 或 stdio，然后重启客户端。
- **缺少预期工具：**检查**设置 → MCP**中的账户开关，以及**设置 → API 密钥**中该密钥的范围。
- **站点显示未找到：**确认账户与密钥范围都允许该站点。被阻止的站点和不属于账户的站点会有意返回相同结果。
- **不允许产生支出的操作：**在两个层级都允许 `start_audit` 和产生支出的操作，或为只读客户端保持关闭。
- **401 Unauthorized：**使用完全一致的 `Authorization: Bearer rmf_…` 请求头。密钥可能输入有误、已被吊销，或属于非活跃账户。
- **402 Upgrade required：**MCP 要求 Starter、Pro 或 Agency 套餐。请参阅[套餐、限额与额度](./plans-limits-credits.zh.md)。
- **浏览器中出现 405 Method not allowed：**这是正常现象，因为该端点接收 MCP `POST` 请求，而不是普通浏览器 `GET` 请求。
- **429 Too many requests：**等待响应头所示的限流窗口结束，然后重试。
- **503 Unavailable：**该 RankMeFast 安装的 MCP 已禁用或暂时不可用；请联系其运维人员。
- **本地可用，但通过代理后不可用：**确保代理将 `Authorization`、`Content-Type` 和 `Accept` 请求头转发到 `/api/mcp`。

如需更换密钥，请先创建新密钥，更新并验证每个客户端，然后从[设置 → API 密钥](/profile?tab=api-keys)吊销旧密钥。吊销会立即生效。

## 兼容性

此版本包含上表中的十个工具。其中八个只读，`set_action_state` 会写入但不消耗额度，`start_audit` 是唯一消耗套餐额度的工具。品牌雷达、评论智能、链接智能、流量洞察和关键词趋势均没有 MCP 工具。变更只做增量：现有工具的名称和参数结构保持不变，新功能上线时可能增加新工具。

<!-- mcp-tools: list_sites; get_latest_audit_report; list_keywords; get_rank_history; list_content_analyses; get_content_analysis; start_audit; get_audit_status; list_actions; set_action_state -->

## 相关指南

- [AI 助手](./ai-assistant.zh.md)：在 RankMeFast 聊天中使用相同的已获准工具。
- [公共 API](./public-api.zh.md)：仅限 Agency 套餐的只读 API。
- [Content Intelligence](./content-intelligence.zh.md)：了解 MCP 返回的分析数据。
- [账户安全](./settings-security.zh.md)：保护你的账户和密钥。
