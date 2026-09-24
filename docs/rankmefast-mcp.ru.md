---
title: 'RankMeFast MCP'
description: 'Подключите RankMeFast к агентам для программирования, IDE и CLI с поддержкой MCP.'
locale: ru
slug: rankmefast-mcp
section: developers
order: 2
---

# Подключите RankMeFast к своим ИИ-инструментам

RankMeFast предоставляет удалённую конечную точку [Model Context Protocol (MCP)](https://modelcontextprotocol.io/). Она позволяет совместимому агенту для программирования, IDE или CLI читать ваши SEO-данные и запускать аудиты, не покидая текущий рабочий процесс.

## Настройка за пять минут

1. Откройте [Настройки → API-ключи](/profile?tab=api-keys), нажмите **Создать ключ** и скопируйте появившийся ключ. RankMeFast показывает ключ целиком только один раз.
2. Используйте конечную точку MCP RankMeFast:

   ```text
   https://rankme.fast/api/mcp
   ```

3. Если клиент поддерживает переменные окружения, задайте ключ перед его запуском:

   ```bash
   export RANKMEFAST_API_KEY='rmf_REPLACE_WITH_YOUR_KEY'
   ```

   В PowerShell:

   ```powershell
   $env:RANKMEFAST_API_KEY = 'rmf_REPLACE_WITH_YOUR_KEY'
   ```

4. Выберите ниже свой клиент, вставьте его конфигурацию и перезапустите или перезагрузите клиент.
5. Проверьте подключение запросом: **«Используй RankMeFast, чтобы показать список моих сайтов».**

> Обращайтесь с ключом как с паролем: храните его в переменной окружения, запросе пароля или пользовательской конфигурации и никогда не коммитьте в репозиторий. Области доступа каждого ключа можно сузить (см. ниже). Учтите, что `start_audit` расходует месячный лимит аудитов.

Доступ к MCP включён в тарифы Starter, Pro и Agency. Ключи Agency также работают с публичным REST API только для чтения.

## Управление разрешениями и областями ключа

Откройте [Настройки → MCP](/profile?tab=mcp), чтобы управлять правилами аккаунта, общими для MCP и ИИ-помощника в активной сессии:

1. Включите или отключите каждый инструмент RankMeFast.
2. Оставьте **Разрешённые сайты** без ограничений или выберите сайты, доступные инструментам.
3. Отключите **Разрешить расходующие действия**, если `start_audit` не должна запускаться никогда.
4. Сохраните настройки. Карточка быстрого старта на той же вкладке показывает конечную точку, ссылку на API-ключи и конфигурацию клиента для копирования.

Изначально правила аккаунта разрешают всё, поэтому существующие ключи продолжают работать. Помощник использует эти правила напрямую через вашу активную сессию.

Более узкие области можно задать при создании ключа в разделе [Настройки → API-ключи](/profile?tab=api-keys) и изменить позже. Области ключа могут только ограничивать доступ. Итоговый доступ MCP всегда является пересечением:

- Инструмент доступен, только если его разрешают и аккаунт, и ключ.
- Если аккаунт и ключ выбирают сайты, доступны только сайты из обоих списков.
- Для `start_audit` инструмент и расходующие действия должны быть разрешены на обоих уровнях.

Область без ограничений просто следует правилу аккаунта. Запрещённые инструменты не видны клиенту, а запрещённый сайт возвращает тот же ответ «не найден», что и чужой.

## Язык и контракт JSON-RPC

Для `tools/list` и любого вызова без аргумента `locale` MCP выбирает язык по `x-lang`, затем по `Accept-Language`, а если их нет, использует `en`. Региональные теги вроде `fr-CA` превращаются в `fr`. Bearer-эндпоинт не учитывает браузерные cookie, язык аккаунта и настройки рабочего пространства.

Каждый инструмент также принимает необязательный аргумент `locale` со значением ровно `en`, `ar`, `fr`, `de`, `es`, `ru` или `zh`. Он переопределяет заголовки для этого вызова: тексты ошибок и успеха, поле `locale` структурированного результата и HTTP-заголовок `Content-Language`. Любое другое значение отклоняется как недопустимый параметр (`-32602`) на языке заголовков; в отличие от заголовка, региональный тег здесь не преобразуется. Ответы дополняют `Vary` значениями `x-lang, Accept-Language` и сохраняют существующие.

Переводятся только описания инструментов, понятные человеку сводки и безопасные сообщения об ошибках. Машиночитаемые данные одинаковы на всех языках: имена и схемы инструментов, JSON-RPC-поля `jsonrpc`, `code` и `id`, имена свойств, значения перечислений и статусов, логические значения, количества, идентификаторы, домены, URL, ключевые слова, метки времени, курсоры, свидетельства и сохранённый текст пользователя или поставщика. Структурированные результаты получают поле `locale` и ничего не теряют.

Ошибки протокола сохраняют числовые коды: `-32700` ошибка разбора, `-32600` недопустимый запрос, `-32601` неизвестный метод, `-32602` недопустимые параметры или инструмент и `-32603` внутренняя ошибка. Сообщение переводится по коду, а исходная диагностика SDK, валидации или поставщика никогда не возвращается. MCP не выдаёт CSV; побайтово стабильный формат CSV описан в [руководстве по публичному API](./public-api.ru.md).

## Выберите клиент

| Клиент или интерфейс | Прямое подключение | Конфигурация |
| --- | --- | --- |
| Claude Code и вкладка Code в приложении для компьютера | Да | HTTP-сервер с Bearer-заголовком |
| Cursor IDE и Cursor Agent CLI | Да | Пользовательская или проектная конфигурация MCP JSON |
| VS Code с GitHub Copilot | Да | Пользовательский или рабочий `mcp.json` |
| GitHub Copilot CLI | Да | Команда CLI или пользовательский JSON |
| Windsurf / Cascade | Да | Пользовательская конфигурация MCP JSON |
| Codex CLI, расширение для IDE и Codex в приложении ChatGPT для компьютера | Да | Общая конфигурация Codex TOML |
| Gemini CLI | Да | Команда CLI или пользовательский JSON |
| OpenCode | Да | Конфигурация удалённого MCP в JSON |
| JetBrains AI Assistant и Junie | Да | Настройки MCP в IDE |
| Zed | Да | Удалённый контекстный сервер |
| Cline | Да | Сервер Streamable HTTP |
| Roo Code | Да | Сервер Streamable HTTP |
| Kiro IDE и CLI | Да | Пользовательская или проектная конфигурация MCP JSON |
| Copilot в Visual Studio, JetBrains, Xcode и Eclipse | Да | Конфигурация Copilot MCP в JSON |
| Чат-коннектор Claude.ai / Claude Desktop | Не напрямую | Коннектор требует OAuth, а RankMeFast сейчас использует Bearer-ключи |
| ChatGPT в браузере | Не напрямую | Он не читает локальную конфигурацию Codex MCP |

Любой другой клиент сможет подключиться, если он поддерживает удалённый **Streamable HTTP** и пользовательский заголовок `Authorization`. RankMeFast не предоставляет локальный сервер stdio или устаревший сервер SSE.

## Claude Code

Добавьте сервер на уровне пользователя. Одинарные кавычки сохраняют ссылку на переменную окружения без изменений:

```bash
claude mcp add-json --scope user rankmefast \
  '{"type":"http","url":"https://rankme.fast/api/mcp","headers":{"Authorization":"Bearer ${RANKMEFAST_API_KEY}"}}'
```

Проверьте подключение командой:

```bash
claude mcp get rankmefast
```

В Claude Code также можно выполнить `/mcp`. Интерфейс Claude Code в приложении для компьютера использует ту же конфигурацию. См. официальное [руководство Claude Code по MCP](https://code.claude.com/docs/en/mcp).

**Чат-коннектор** Claude.ai и Claude Desktop устроен иначе: его процесс удалённого подключения предусматривает OAuth, а не произвольный статический Bearer-заголовок. Он не сможет подключиться напрямую, пока RankMeFast не добавит OAuth; используйте Claude Code. См. документацию по [пользовательским коннекторам Claude](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

## Cursor IDE и Cursor Agent CLI

Для настройки на уровне пользователя создайте `~/.cursor/mcp.json`. Замените оба заполнителя и не раскрывайте содержимое файла:

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

Cursor IDE и Cursor Agent CLI читают одну конфигурацию. Проверьте её командами:

```bash
cursor-agent mcp list
cursor-agent mcp list-tools rankmefast
```

Для командной конфигурации используйте `.cursor/mcp.json`, но не добавляйте буквальное значение ключа в файл, который попадёт в репозиторий. См. официальное [руководство Cursor по MCP](https://docs.cursor.com/context/model-context-protocol).

## VS Code и GitHub Copilot

Выполните **MCP: Open User Configuration** через палитру команд, а затем используйте поле ввода пароля, чтобы секрет не записывался в файл:

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

Выполните **MCP: List Servers**, чтобы запустить или проверить сервер. Конфигурацию рабочей области можно хранить в `.vscode/mcp.json`; вариант с запросом пароля безопасно передавать другим. См. официальную [справку по конфигурации MCP в VS Code](https://code.visualstudio.com/docs/agents/reference/mcp-configuration).

## GitHub Copilot CLI

Задайте `RANKMEFAST_API_KEY` в командной оболочке и выполните:

```bash
copilot mcp add \
  rankmefast \
  --type http \
  --url https://rankme.fast/api/mcp \
  --header "Authorization=Bearer $RANKMEFAST_API_KEY" \
  --tools "*"
```

Оболочка подставит ключ до того, как Copilot сохранит пользовательскую конфигурацию, поэтому защитите `~/.copilot/mcp-config.json`. См. руководство по [добавлению MCP-серверов в Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers).

## Windsurf / Cascade

Добавьте следующее в `~/.codeium/windsurf/mcp_config.json`:

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

Перезагрузите конфигурацию через **Windsurf Settings → Cascade → MCP Servers**. См. официальное [руководство Windsurf по MCP](https://docs.windsurf.com/windsurf/cascade/mcp).

## Codex CLI, расширение для IDE и ChatGPT для компьютера

Codex CLI, расширение Codex для IDE и интерфейс Codex в приложении ChatGPT для компьютера используют общий файл `~/.codex/config.toml` на одном компьютере:

```toml
[mcp_servers.rankmefast]
url = "https://rankme.fast/api/mcp"
bearer_token_env_var = "RANKMEFAST_API_KEY"
```

После задания переменной окружения перезапустите IDE или приложение. В CLI проверьте подключение командой:

```bash
codex mcp list
```

В сеансе Codex также можно выполнить `/mcp`. См. официальное [руководство Codex по MCP](https://learn.chatgpt.com/docs/extend/mcp).

ChatGPT в браузере не читает локальную конфигурацию Codex, поэтому эта настройка относится только к интерфейсам Codex на настроенном компьютере.

## Gemini CLI

Задайте `RANKMEFAST_API_KEY` в командной оболочке и выполните:

```bash
gemini mcp add \
  --scope user \
  --transport http \
  --header "Authorization: Bearer $RANKMEFAST_API_KEY" \
  rankmefast https://rankme.fast/api/mcp
```

Проверьте подключение командой `gemini mcp list` или `/mcp` внутри Gemini CLI. Команда сохраняет подставленный заголовок в `~/.gemini/settings.json`, поэтому не раскрывайте этот файл. В JSON используйте `httpUrl`: Gemini оставляет `url` для устаревшего SSE. См. официальное [руководство Gemini CLI по MCP](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md).

## OpenCode

Добавьте следующее в глобальный файл `~/.config/opencode/opencode.json`:

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

`oauth: false` отключает обнаружение OAuth, поскольку RankMeFast использует Bearer-ключ. Проверьте настройку командами:

```bash
opencode mcp list
opencode mcp debug rankmefast
```

См. официальное [руководство OpenCode по MCP](https://opencode.ai/docs/mcp-servers/).

## JetBrains AI Assistant и Junie

Откройте **Settings → Tools → AI Assistant → Model Context Protocol (MCP)**, добавьте HTTP-сервер и вставьте:

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

Храните эту конфигурацию в настройках IDE, а не в файле проекта. Включите **Pass custom MCP servers**, когда нужно передать инструменты Junie или другому встроенному агенту. См. официальное [руководство JetBrains по MCP](https://www.jetbrains.com/help/ai-assistant/mcp.html).

## Zed

Откройте **Settings → AI → MCP Servers → Add Remote Server** или добавьте следующее в пользовательские настройки:

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

Храните буквальное значение ключа в пользовательских, а не проектных настройках. Зелёный индикатор рядом с сервером подтверждает подключение. См. официальное [руководство Zed по MCP](https://zed.dev/docs/ai/mcp).

## Cline

Откройте настройки MCP в Cline и добавьте сервер Streamable HTTP:

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

Оставьте `autoApprove` пустым, чтобы запуск аудита требовал вашего подтверждения. См. официальное [руководство Cline по MCP](https://docs.cline.bot/mcp/mcp-overview).

## Roo Code

Используйте глобальные настройки MCP или `.roo/mcp.json`:

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

Оставьте `alwaysAllow` пустым, чтобы действия с расходованием лимитов требовали подтверждения. См. официальное [руководство Roo Code по MCP](https://docs.roocode.com/features/mcp/using-mcp-in-roo).

## Kiro IDE и CLI

Используйте `~/.kiro/settings/mcp.json` для глобальной конфигурации или `.kiro/settings/mcp.json` для проекта:

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

Kiro подставляет переменные окружения в заголовках. См. официальную [документацию по конфигурации MCP в Kiro](https://kiro.dev/docs/mcp/configuration/).

## Copilot в других IDE

GitHub Copilot в Visual Studio, IDE JetBrains, Xcode и Eclipse использует формат, отличный от VS Code:

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

Храните эту конфигурацию на уровне пользователя и не добавляйте ключ в репозиторий. Расположение файла конфигурации для своей IDE найдите в [руководстве GitHub по настройке MCP для расширений Copilot в IDE](https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/extend-copilot-chat-with-mcp).

## Доступные инструменты RankMeFast

| Инструмент | Назначение | Расходует лимит тарифа? |
| --- | --- | --- |
| `list_sites` | Показывает сайты, принадлежащие вашему аккаунту | Нет |
| `get_latest_audit_report` | Возвращает последний завершённый аудит сайта | Нет |
| `list_keywords` | Показывает отслеживаемые ключевые слова сайта | Нет |
| `get_rank_history` | Возвращает историю позиций ключевого слова | Нет |
| `list_content_analyses` | Показывает анализы Content Intelligence | Нет |
| `get_content_analysis` | Возвращает один анализ Content Intelligence | Нет |
| `start_audit` | Запускает аудит сайта в пределах лимита страниц тарифа | **Да, один аудит** |
| `get_audit_status` | Проверяет выполнение аудита | Нет |
| `list_actions` | Возвращает приоритетный список следующих действий сайта | Нет |
| `set_action_state` | Отмечает действие запланированным, отклонённым, выполненным или открытым | Нет |

Всё ограничено аккаунтом, которому принадлежит ключ, поэтому идентификатор сайта, анализа или запуска из другого аккаунта возвращает «не найден». Если нужного инструмента нет, сначала проверьте разрешения, а потом подключение.

## Устранение неполадок

- **Клиент не обнаруживает инструменты:** убедитесь, что URL заканчивается на `/api/mcp`, выберите Streamable HTTP вместо SSE или stdio, затем перезапустите клиент.
- **Нет ожидаемого инструмента:** проверьте переключатель аккаунта в **Настройки → MCP** и области этого ключа в **Настройки → API-ключи**.
- **Сайт возвращается как не найденный:** убедитесь, что его разрешают и аккаунт, и области ключа. Запрещённый и чужой сайт намеренно дают одинаковый ответ.
- **Расходующие действия запрещены:** разрешите `start_audit` и расходующие действия на обоих уровнях или оставьте их отключёнными для клиента только для чтения.
- **401 Unauthorized:** используйте точный заголовок `Authorization: Bearer rmf_…`. Ключ может содержать опечатку, быть отозван или принадлежать неактивному аккаунту.
- **402 Upgrade required:** для MCP нужен тариф Starter, Pro или Agency. См. [Тарифы, лимиты и кредиты](./plans-limits-credits.ru.md).
- **405 Method not allowed в браузере:** это ожидаемо, поскольку конечная точка принимает MCP-запросы `POST`, а не обычные браузерные запросы `GET`.
- **429 Too many requests:** дождитесь окончания окна ограничения частоты из заголовков ответа и повторите запрос.
- **503 Unavailable:** MCP отключён или временно недоступен в этой установке RankMeFast; обратитесь к её оператору.
- **Локально работает, а через прокси, нет:** убедитесь, что прокси передаёт заголовки `Authorization`, `Content-Type` и `Accept` в `/api/mcp`.

Чтобы заменить ключ, создайте новый, обновите и проверьте каждый клиент, а затем отзовите старый в разделе [Настройки → API-ключи](/profile?tab=api-keys). Отзыв действует немедленно.

## Совместимость

В этом выпуске десять перечисленных выше инструментов. Восемь работают только на чтение, `set_action_state` пишет, но ничего не расходует, а `start_audit` единственный расходует лимит тарифа. У «Радара бренда», «Аналитики отзывов», «Аналитики ссылок», «Данных о трафике» и «Трендов ключевых слов» нет инструментов MCP. Изменения только добавляются: имена существующих инструментов и формы их аргументов остаются прежними, а с новыми функциями могут появляться новые инструменты.

<!-- mcp-tools: list_sites; get_latest_audit_report; list_keywords; get_rank_history; list_content_analyses; get_content_analysis; start_audit; get_audit_status; list_actions; set_action_state -->

## Связанные руководства

- [ИИ-помощник](./ai-assistant.ru.md): используйте те же разрешённые инструменты в чате RankMeFast.
- [Публичный API](./public-api.ru.md): API только для чтения, доступный на тарифе Agency.
- [Content Intelligence](./content-intelligence.ru.md): описание данных анализа, возвращаемых через MCP.
- [Безопасность аккаунта](./settings-security.ru.md): защита аккаунта и ключей.
