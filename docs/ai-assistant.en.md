---
title: 'AI Assistant'
description: 'Ask questions about your SEO evidence, stream answers, and run approved RankMeFast tools.'
locale: en
slug: ai-assistant
section: developers
order: 3
---

# Work with the AI Assistant

The AI Assistant at [/assistant](/assistant) keeps your RankMeFast conversations in one workspace. It streams answers as they are produced and can use approved RankMeFast tools to read stored SEO evidence or start an audit.

## Start a conversation

1. Open **AI Assistant** from the sidebar.
2. Optionally choose a site before the first message. The site gives the conversation context; tool access still follows your account permissions.
3. Enter a question and press **Enter**. Use **Shift+Enter** for a new line.
4. Watch the answer stream in. Expand a tool card to inspect its arguments and structured result.
5. Select **Stop** to end a response. The partial reply remains in the conversation.

Conversations are saved automatically and remain available after a reload. Start a new conversation when you want to work without a site or with a different site.

With a site chosen, the suggested questions are about that site. With **No site — general guidance**, they cover your account and general SEO questions instead. Each conversation is named after your first message, with the site's domain added when that tells similar conversations apart. To remove one, select the trash icon beside it and confirm; **Cancel** keeps it. If a response is cut off before it finishes, the partial reply stays in the conversation with a notice and a **Retry** button.

## Tools it can run

The Assistant uses the same tool registry as RankMeFast MCP. Depending on your permissions, it can run:

- `list_sites`, `get_latest_audit_report`, `list_keywords`, and `get_rank_history` for stored site and ranking evidence.
- `list_content_analyses` and `get_content_analysis` for stored Content Intelligence work.
- `start_audit` to begin one audit, and `get_audit_status` to check its progress.

Read tools use data already stored in RankMeFast, without calling a data provider. The tool cards show which tool ran, and [RankMeFast MCP](./rankmefast-mcp.en.md) lists all of them. `start_audit` is the only spending tool: it starts one audit and uses vendor credits of your own provider account. Treat Assistant answers as guidance and verify important changes against the displayed evidence.

## Permissions

Open [Settings → MCP](/settings/profile?tab=mcp) to set the account defaults used by both the Assistant and MCP clients. You can turn individual tools on or off, allow only selected sites, and disable spending actions. Defaults are permissive, so existing accounts continue to work until you restrict them.

The Assistant runs through your signed-in session, so only these account defaults apply to it. A disabled tool isn't offered to the model, a blocked site behaves as not found, and `start_audit` also needs **Allow spending actions**. API-key scopes only affect external MCP clients, where a key can narrow the account defaults but never widen them. See [RankMeFast MCP](./rankmefast-mcp.en.md) for details.

## Messages and limits

Each message you send opens one streamed AI response, so the Assistant is rate limited per account: if you send many messages in a short time, wait a moment and try again. Stopping a reply keeps what was already written. Starting an audit from chat uses the same vendor credits as starting it yourself. The operator of your installation can switch the Assistant off with `CHAT_ENABLED` and bounds the length of each response.

## Troubleshooting

- **A tool is missing:** check its account toggle under **Settings → MCP**. MCP key scopes do not change signed-in Assistant access.
- **A site is unavailable:** confirm the conversation is linked to the intended site and that the site is allowed in the account defaults.
- **An audit will not start:** enable the tool and spending actions, and check that an audit isn't already running for the site.
- **Too many requests:** wait a moment and try again.
- **Assistant unavailable:** the installation has disabled `CHAT_ENABLED` or the service is temporarily unavailable. Retry later or contact the operator.
- **The stream stops unexpectedly:** use **Retry** on the notice. The partial response stays in the conversation.

## Related guides

- [RankMeFast MCP](./rankmefast-mcp.en.md): connect an external AI client and restrict its key.
- [Back to the docs index](./index.en.md)
