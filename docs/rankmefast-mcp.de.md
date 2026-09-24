---
title: 'RankMeFast MCP'
description: 'Verbinden Sie RankMeFast mit Coding-Agenten, IDEs und MCP-fähigen CLIs.'
locale: de
slug: rankmefast-mcp
section: developers
order: 2
---

# RankMeFast mit Ihren KI-Tools verbinden

RankMeFast stellt einen Remote-Endpunkt für das [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) bereit. Damit können kompatible Coding-Agenten, IDEs oder CLIs Ihre SEO-Daten lesen und Audits starten, ohne dass Sie Ihren aktuellen Arbeitsablauf verlassen müssen.

## In fünf Minuten einrichten

1. Öffnen Sie [Einstellungen → API-Schlüssel](/profile?tab=api-keys), wählen Sie **Schlüssel erstellen** und kopieren Sie den Schlüssel, sobald er angezeigt wird. RankMeFast zeigt den vollständigen Schlüssel nur einmal an.
2. Verwenden Sie den RankMeFast-MCP-Endpunkt:

   ```text
   https://rankme.fast/api/mcp
   ```

3. Legen Sie den Schlüssel vor dem Start des Clients als Umgebungsvariable fest, sofern der Client Umgebungsvariablen unterstützt:

   ```bash
   export RANKMEFAST_API_KEY='rmf_REPLACE_WITH_YOUR_KEY'
   ```

   In PowerShell:

   ```powershell
   $env:RANKMEFAST_API_KEY = 'rmf_REPLACE_WITH_YOUR_KEY'
   ```

4. Wählen Sie unten Ihren Client aus, fügen Sie dessen Konfiguration ein und starten oder laden Sie den Client neu.
5. Prüfen Sie die Verbindung mit: **„Verwende RankMeFast, um meine Websites aufzulisten.“**

> Behandeln Sie den Schlüssel wie ein Passwort: Legen Sie ihn in eine Umgebungsvariable, eine Passwortabfrage oder eine Konfiguration auf Benutzerebene, und committen Sie ihn nie in ein Repository. Die Bereiche jedes Schlüssels lassen sich einschränken (siehe unten). Beachten Sie, dass `start_audit` Ihr monatliches Audit-Kontingent verbraucht.

Der MCP-Zugriff ist in Starter, Pro und Agency enthalten. Agency-Schlüssel funktionieren außerdem mit der öffentlichen Read-only-REST-API.

## Berechtigungen und Schlüsselbereiche steuern

Unter [Einstellungen → MCP](/profile?tab=mcp) verwalten Sie die Kontovorgaben, die MCP und der angemeldete KI-Assistent gemeinsam nutzen:

1. Aktivieren oder deaktivieren Sie jedes RankMeFast-Werkzeug.
2. Lassen Sie **Erlaubte Websites** auf allen Websites oder wählen Sie die Websites aus, die Werkzeuge verwenden dürfen.
3. Deaktivieren Sie **Ausgabewirksame Aktionen erlauben**, wenn `start_audit` niemals laufen darf.
4. Speichern Sie die Einstellungen. Die Schnellstart-Karte im selben Tab zeigt Endpunkt, API-Schlüssel-Verknüpfung und eine kopierbare Client-Konfiguration.

Die Kontovorgaben sind vollständig freizügig, bis Sie sie ändern. Bestehende Schlüssel funktionieren deshalb weiter. Der Assistent nutzt diese Vorgaben direkt über Ihre angemeldete Sitzung.

Beim Erstellen eines Schlüssels unter [Einstellungen → API-Schlüssel](/profile?tab=api-keys) können Sie engere Bereiche festlegen und später bearbeiten. Schlüsselbereiche können Zugriff nur einschränken. Der wirksame MCP-Zugriff ist immer die Schnittmenge:

- Ein Werkzeug ist nur verfügbar, wenn Konto und Schlüssel es erlauben.
- Wenn Konto und Schlüssel Websites auswählen, sind nur Websites in beiden Listen verfügbar.
- `start_audit` benötigt auf beiden Ebenen die Freigabe für Werkzeug und ausgabewirksame Aktionen.

Ein uneingeschränkter Schlüsselbereich übernimmt einfach die Kontovorgabe. Nicht erlaubte Werkzeuge erscheinen im Client nicht, und eine gesperrte Website liefert dasselbe Nicht-gefunden-Ergebnis wie eine fremde.

## Sprache und JSON-RPC-Vertrag

Für `tools/list` und jeden Aufruf ohne `locale`-Argument wählt MCP die Sprache über `x-lang`, dann `Accept-Language` und sonst `en`. Regionale Tags wie `fr-CA` werden zu `fr`. Der Bearer-Endpunkt ignoriert Browser-Cookies, Kontosprache und Workspace-Einstellungen.

Jedes Tool akzeptiert zusätzlich ein optionales Argument `locale` mit genau einem der Werte `en`, `ar`, `fr`, `de`, `es`, `ru` oder `zh`. Es überschreibt die Header für diesen Aufruf: Fehler- und Erfolgstexte, das Feld `locale` im strukturierten Ergebnis und den HTTP-Header `Content-Language`. Jeder andere Wert wird als ungültiger Parameter (`-32602`) in der Header-Sprache abgelehnt; anders als bei einem Header wird kein regionales Tag umgesetzt. Antworten ergänzen `Vary` um `x-lang, Accept-Language` und behalten vorhandene Werte.

Übersetzt werden nur Toolbeschreibungen, lesbare Ergebniszusammenfassungen und sichere Fehlermeldungen. Maschinenlesbare Daten sind in jeder Sprache gleich: Toolnamen und -schemas, JSON-RPC-`jsonrpc`, `code` und `id`, Eigenschaftsnamen, Enum- und Statuswerte, boolesche Werte, Anzahlen, IDs, Domains, URLs, Keywords, Zeitstempel, Cursor, Nachweise sowie gespeicherte Benutzer- oder Anbietertexte. Strukturierte Ergebnisse erhalten ein Feld `locale` und verlieren nichts.

Protokollfehler behalten ihren Zahlencode: `-32700` Analysefehler, `-32600` ungültige Anfrage, `-32601` unbekannte Methode, `-32602` ungültige Parameter oder Tool und `-32603` interner Fehler. Die Meldung wird anhand des Codes übersetzt; rohe SDK-, Validierungs- oder Anbieterdiagnosen werden nie zurückgegeben. MCP liefert kein CSV. Das byte-stabile CSV-Format beschreibt der [Leitfaden zur öffentlichen API](./public-api.de.md).

## Client auswählen

| Client oder Oberfläche | Direkte Einrichtung | Konfiguration |
| --- | --- | --- |
| Claude Code und dessen Code-Tab in der Desktop-App | Ja | HTTP-Server mit Bearer-Header |
| Cursor IDE und Cursor Agent CLI | Ja | MCP-JSON auf Benutzer- oder Projektebene |
| VS Code mit GitHub Copilot | Ja | `mcp.json` auf Benutzer- oder Workspace-Ebene |
| GitHub Copilot CLI | Ja | CLI-Befehl oder Benutzer-JSON |
| Windsurf / Cascade | Ja | Benutzer-MCP-JSON |
| Codex CLI, IDE-Erweiterung und Codex in der ChatGPT-Desktop-App | Ja | Gemeinsame Codex-TOML |
| Gemini CLI | Ja | CLI-Befehl oder Benutzer-JSON |
| OpenCode | Ja | Remote-MCP-JSON |
| JetBrains AI Assistant und Junie | Ja | MCP-Einstellungen der IDE |
| Zed | Ja | Remote-Kontextserver |
| Cline | Ja | Streamable-HTTP-Server |
| Roo Code | Ja | Streamable-HTTP-Server |
| Kiro IDE und CLI | Ja | MCP-JSON auf Benutzer- oder Projektebene |
| Copilot in Visual Studio, JetBrains, Xcode und Eclipse | Ja | Copilot-MCP-JSON |
| Claude.ai / Chat-Connector von Claude Desktop | Nicht direkt | Der Connector benötigt OAuth; RankMeFast verwendet derzeit Bearer-Schlüssel |
| ChatGPT Web | Nicht direkt | Liest die lokale Codex-MCP-Konfiguration nicht |

Jeder andere Client kann eine Verbindung herstellen, wenn er Remote-**Streamable HTTP** und einen benutzerdefinierten `Authorization`-Header unterstützt. RankMeFast stellt weder einen lokalen stdio- noch einen veralteten SSE-Server bereit.

## Claude Code

Fügen Sie einen Server auf Benutzerebene hinzu. Die einfachen Anführungszeichen sorgen dafür, dass der Verweis auf die Umgebungsvariable erhalten bleibt:

```bash
claude mcp add-json --scope user rankmefast \
  '{"type":"http","url":"https://rankme.fast/api/mcp","headers":{"Authorization":"Bearer ${RANKMEFAST_API_KEY}"}}'
```

Prüfen Sie die Verbindung mit:

```bash
claude mcp get rankmefast
```

Sie können auch `/mcp` in Claude Code ausführen. Die Claude-Code-Oberfläche in der Desktop-App verwendet dieselbe Konfiguration. Weitere Informationen finden Sie im offiziellen [MCP-Leitfaden für Claude Code](https://code.claude.com/docs/en/mcp).

Der **Chat-Connector** von Claude.ai und Claude Desktop ist etwas anderes: Dessen Ablauf für Remote-Connectoren beschreibt OAuth, keinen beliebigen statischen Bearer-Header. Er kann erst dann eine direkte Verbindung herstellen, wenn RankMeFast OAuth anbietet; verwenden Sie bis dahin Claude Code. Siehe [benutzerdefinierte Claude-Connectoren](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp).

## Cursor IDE und Cursor Agent CLI

Erstellen Sie für eine Einrichtung auf Benutzerebene die Datei `~/.cursor/mcp.json`. Ersetzen Sie beide Platzhalter und halten Sie diese Datei privat:

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

Cursor IDE und Cursor Agent CLI lesen dieselbe Konfiguration. Prüfen Sie sie mit:

```bash
cursor-agent mcp list
cursor-agent mcp list-tools rankmefast
```

Verwenden Sie für eine Teamkonfiguration `.cursor/mcp.json`, tragen Sie aber keinen wörtlichen Schlüssel in diese versionierte Datei ein. Weitere Informationen finden Sie im offiziellen [MCP-Leitfaden für Cursor](https://docs.cursor.com/context/model-context-protocol).

## VS Code und GitHub Copilot

Führen Sie **MCP: Open User Configuration** über die Befehlspalette aus und verwenden Sie anschließend eine Passwortabfrage, damit das Geheimnis nicht in die Datei geschrieben wird:

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

Führen Sie **MCP: List Servers** aus, um den Server zu starten oder zu prüfen. Die Workspace-Konfiguration kann in `.vscode/mcp.json` liegen; die Variante mit Passwortabfrage kann sicher geteilt werden. Weitere Informationen finden Sie in der offiziellen [Referenz zur MCP-Konfiguration von VS Code](https://code.visualstudio.com/docs/agents/reference/mcp-configuration).

## GitHub Copilot CLI

Wenn `RANKMEFAST_API_KEY` in Ihrer Shell gesetzt ist:

```bash
copilot mcp add \
  rankmefast \
  --type http \
  --url https://rankme.fast/api/mcp \
  --header "Authorization=Bearer $RANKMEFAST_API_KEY" \
  --tools "*"
```

Die Shell erweitert den Schlüssel, bevor Copilot die Benutzerkonfiguration speichert. Schützen Sie daher `~/.copilot/mcp-config.json`. Siehe [MCP-Server zur Copilot CLI hinzufügen](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers).

## Windsurf / Cascade

Fügen Sie Folgendes zu `~/.codeium/windsurf/mcp_config.json` hinzu:

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

Laden Sie die Konfiguration über **Windsurf Settings → Cascade → MCP Servers** neu. Weitere Informationen finden Sie im offiziellen [MCP-Leitfaden für Windsurf](https://docs.windsurf.com/windsurf/cascade/mcp).

## Codex CLI, IDE-Erweiterung und ChatGPT Desktop

Codex CLI, die Codex-IDE-Erweiterung und die Codex-Oberfläche in der ChatGPT-Desktop-App verwenden auf demselben Rechner gemeinsam `~/.codex/config.toml`:

```toml
[mcp_servers.rankmefast]
url = "https://rankme.fast/api/mcp"
bearer_token_env_var = "RANKMEFAST_API_KEY"
```

Starten Sie die IDE oder Desktop-App neu, nachdem Sie die Umgebungsvariable gesetzt haben. Prüfen Sie die Verbindung in der CLI mit:

```bash
codex mcp list
```

Sie können auch `/mcp` in einer Codex-Sitzung ausführen. Weitere Informationen finden Sie im offiziellen [MCP-Leitfaden für Codex](https://learn.chatgpt.com/docs/extend/mcp).

ChatGPT Web liest die lokale Codex-Konfiguration nicht. Diese Einrichtung gilt daher nur für Codex-Oberflächen auf dem konfigurierten Rechner.

## Gemini CLI

Wenn `RANKMEFAST_API_KEY` in Ihrer Shell gesetzt ist:

```bash
gemini mcp add \
  --scope user \
  --transport http \
  --header "Authorization: Bearer $RANKMEFAST_API_KEY" \
  rankmefast https://rankme.fast/api/mcp
```

Prüfen Sie die Verbindung mit `gemini mcp list` oder `/mcp` in Gemini CLI. Der Befehl speichert den erweiterten Header in `~/.gemini/settings.json`. Halten Sie diese Datei daher privat. Verwenden Sie in JSON `httpUrl`; Gemini reserviert `url` für das veraltete SSE. Weitere Informationen finden Sie im offiziellen [MCP-Leitfaden für Gemini CLI](https://github.com/google-gemini/gemini-cli/blob/main/docs/tools/mcp-server.md).

## OpenCode

Fügen Sie Folgendes zur globalen Datei `~/.config/opencode/opencode.json` hinzu:

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

`oauth: false` verhindert die OAuth-Erkennung, da RankMeFast einen Bearer-Schlüssel verwendet. Prüfen Sie die Einrichtung mit:

```bash
opencode mcp list
opencode mcp debug rankmefast
```

Weitere Informationen finden Sie im offiziellen [MCP-Leitfaden für OpenCode](https://opencode.ai/docs/mcp-servers/).

## JetBrains AI Assistant und Junie

Öffnen Sie **Settings → Tools → AI Assistant → Model Context Protocol (MCP)**, fügen Sie einen HTTP-Server hinzu und setzen Sie Folgendes ein:

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

Speichern Sie dies in den IDE-Einstellungen statt in einer Projektdatei. Aktivieren Sie **Pass custom MCP servers**, wenn Junie oder ein anderer integrierter Agent die Tools erhalten soll. Weitere Informationen finden Sie im offiziellen [MCP-Leitfaden für JetBrains](https://www.jetbrains.com/help/ai-assistant/mcp.html).

## Zed

Öffnen Sie **Settings → AI → MCP Servers → Add Remote Server** oder fügen Sie Folgendes zu Ihren Benutzereinstellungen hinzu:

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

Speichern Sie den wörtlichen Schlüssel in den Benutzer- und nicht in den Projekteinstellungen. Eine grüne Anzeige neben dem Server bestätigt die Verbindung. Weitere Informationen finden Sie im offiziellen [MCP-Leitfaden für Zed](https://zed.dev/docs/ai/mcp).

## Cline

Öffnen Sie die MCP-Einstellungen von Cline und fügen Sie einen Streamable-HTTP-Server hinzu:

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

Lassen Sie `autoApprove` leer, damit das Starten eines Audits Ihre Zustimmung erfordert. Weitere Informationen finden Sie im offiziellen [MCP-Leitfaden für Cline](https://docs.cline.bot/mcp/mcp-overview).

## Roo Code

Verwenden Sie die globalen MCP-Einstellungen oder `.roo/mcp.json`:

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

Lassen Sie `alwaysAllow` leer, damit Aktionen mit Kontingentverbrauch eine Zustimmung erfordern. Weitere Informationen finden Sie im offiziellen [MCP-Leitfaden für Roo Code](https://docs.roocode.com/features/mcp/using-mcp-in-roo).

## Kiro IDE und CLI

Verwenden Sie `~/.kiro/settings/mcp.json` global oder `.kiro/settings/mcp.json` für ein Projekt:

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

Kiro erweitert Umgebungsvariablen in Headern. Weitere Informationen finden Sie in der offiziellen [MCP-Konfiguration von Kiro](https://kiro.dev/docs/mcp/configuration/).

## Copilot in anderen IDEs

GitHub Copilot verwendet in Visual Studio, JetBrains-IDEs, Xcode und Eclipse ein anderes Format als in VS Code:

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

Speichern Sie dies als Konfiguration auf Benutzerebene und übertragen Sie den Schlüssel nicht in die Versionsverwaltung. Informationen zum Speicherort der Konfigurationsdatei in Ihrer IDE finden Sie im [MCP-Einrichtungsleitfaden für Copilot-IDE-Erweiterungen](https://docs.github.com/en/copilot/how-tos/provide-context/use-mcp-in-your-ide/extend-copilot-chat-with-mcp) von GitHub.

## Verfügbare RankMeFast-Tools

| Tool | Funktion | Verbraucht Plankontingent? |
| --- | --- | --- |
| `list_sites` | Listet die Websites auf, die Ihrem Konto gehören | Nein |
| `get_latest_audit_report` | Gibt das letzte abgeschlossene Audit einer Website zurück | Nein |
| `list_keywords` | Listet die verfolgten Keywords einer Website auf | Nein |
| `get_rank_history` | Gibt den Rankingverlauf eines Keywords für eine Website zurück | Nein |
| `list_content_analyses` | Listet Content-Intelligence-Analysen auf | Nein |
| `get_content_analysis` | Gibt eine Content-Intelligence-Analyse zurück | Nein |
| `start_audit` | Startet ein Website-Audit innerhalb des Seitenlimits Ihres Plans | **Ja, ein Audit** |
| `get_audit_status` | Prüft einen Audit-Lauf | Nein |
| `list_actions` | Listet die priorisierten nächsten Schritte einer Website | Nein |
| `set_action_state` | Markiert eine Aufgabe als geplant, verworfen, erledigt oder offen | Nein |

Alles ist auf das Konto beschränkt, dem der Schlüssel gehört. Eine Website-, Analyse- oder Lauf-ID aus einem anderen Konto liefert daher „nicht gefunden“. Fehlt ein erwartetes Werkzeug, prüfen Sie zuerst die Berechtigungen und erst dann die Verbindung.

## Fehlerbehebung

- **Der Client findet keine Tools:** Prüfen Sie, ob die URL mit `/api/mcp` endet, wählen Sie Streamable HTTP statt SSE oder stdio und starten Sie anschließend den Client neu.
- **Ein erwartetes Werkzeug fehlt:** Prüfen Sie den Kontoschalter unter **Einstellungen → MCP** und die Bereiche des Schlüssels unter **Einstellungen → API-Schlüssel**.
- **Eine Website wird nicht gefunden:** Prüfen Sie, ob Konto und Schlüsselbereiche sie erlauben. Gesperrte und fremde Websites verwenden absichtlich dieselbe Antwort.
- **Ausgabewirksame Aktionen sind nicht erlaubt:** Erlauben Sie `start_audit` und ausgabewirksame Aktionen auf beiden Ebenen oder lassen Sie sie für einen reinen Lese-Client gesperrt.
- **401 Unauthorized:** Verwenden Sie exakt den Header `Authorization: Bearer rmf_…`. Der Schlüssel könnte falsch eingegeben, widerrufen oder einem inaktiven Konto zugeordnet sein.
- **402 Upgrade required:** MCP benötigt Starter, Pro oder Agency. Siehe [Pläne, Limits und Credits](./plans-limits-credits.de.md).
- **405 Method not allowed im Browser:** Das ist zu erwarten, da der Endpunkt MCP-`POST`-Anfragen und keine gewöhnlichen Browser-`GET`-Anfragen akzeptiert.
- **429 Too many requests:** Warten Sie das in den Antwort-Headern angegebene Rate-Limit-Zeitfenster ab und versuchen Sie es erneut.
- **503 Unavailable:** MCP ist auf dieser RankMeFast-Installation deaktiviert oder vorübergehend nicht verfügbar. Wenden Sie sich an deren Betreiber.
- **Funktioniert lokal, aber nicht über einen Proxy:** Stellen Sie sicher, dass der Proxy die Header `Authorization`, `Content-Type` und `Accept` an `/api/mcp` weiterleitet.

Um einen Schlüssel zu ersetzen, erstellen Sie einen neuen, aktualisieren und prüfen Sie jeden Client und widerrufen Sie anschließend den alten Schlüssel unter [Einstellungen → API-Schlüssel](/profile?tab=api-keys). Der Widerruf wird sofort wirksam.

## Kompatibilität

Dieses Release enthält die zehn oben aufgeführten Werkzeuge. Acht sind schreibgeschützt, `set_action_state` schreibt kostenfrei, und nur `start_audit` verbraucht ein Tarifkontingent. Für Markenradar, Bewertungsanalyse, Link-Intelligenz, Traffic-Analyse und Keyword-Trends gibt es keine MCP-Werkzeuge. Änderungen sind additiv: Vorhandene Werkzeugnamen und Argumentformen bleiben gleich, und mit neuen Funktionen können neue Werkzeuge hinzukommen.

<!-- mcp-tools: list_sites; get_latest_audit_report; list_keywords; get_rank_history; list_content_analyses; get_content_analysis; start_audit; get_audit_status; list_actions; set_action_state -->

## Verwandte Leitfäden

- [KI-Assistent](./ai-assistant.de.md): dieselben freigegebenen Werkzeuge im RankMeFast-Chat verwenden.
- [Öffentliche API](./public-api.de.md): die schreibgeschützte API nur für Agency.
- [Content Intelligence](./content-intelligence.de.md): Erläuterungen zu den von MCP zurückgegebenen Analysedaten.
- [Kontosicherheit](./settings-security.de.md): so schützen Sie Ihr Konto und Ihre Schlüssel.
