---
title: 'KI-Assistent'
description: 'Fragen Sie Ihre SEO-Belege ab, verfolgen Sie Antworten live und führen Sie freigegebene RankMeFast-Werkzeuge aus.'
locale: de
slug: ai-assistant
section: developers
order: 3
---

# Mit dem KI-Assistenten arbeiten

Der KI-Assistent unter [/assistant](/assistant) bündelt Ihre RankMeFast-Unterhaltungen in einem Arbeitsbereich. Antworten erscheinen während der Erstellung. Freigegebene RankMeFast-Werkzeuge können gespeicherte SEO-Belege lesen oder ein Audit starten. Der Assistent ist in Starter, Pro und Agency enthalten; Konten ohne Bezahlplan sehen einen Upgrade-Hinweis.

## Unterhaltung beginnen

1. Öffnen Sie **KI-Assistent** in der Seitenleiste.
2. Wählen Sie vor der ersten Nachricht optional eine Website. Sie liefert Kontext; der Werkzeugzugriff folgt weiterhin Ihren Kontoberechtigungen.
3. Geben Sie eine Frage ein und drücken Sie **Eingabe**. Mit **Umschalt+Eingabe** fügen Sie eine neue Zeile ein.
4. Verfolgen Sie die laufende Antwort. Klappen Sie eine Werkzeugkarte auf, um Argumente und strukturierte Ergebnisse zu prüfen.
5. Wählen Sie **Stoppen**, um eine Antwort zu beenden. Der bisherige Teil bleibt in der Unterhaltung.

Unterhaltungen werden automatisch gespeichert und sind nach dem Neuladen weiterhin verfügbar. Beginnen Sie eine neue Unterhaltung, wenn Sie ohne oder mit einer anderen Website arbeiten möchten.

## Verfügbare Werkzeuge

Der Assistent nutzt dieselbe Werkzeug-Registry wie RankMeFast MCP. Abhängig von Ihren Berechtigungen kann er Folgendes ausführen:

- `list_sites`, `get_latest_audit_report`, `list_keywords` und `get_rank_history` für gespeicherte Website- und Rankingbelege.
- `list_content_analyses` und `get_content_analysis` für gespeicherte Content-Intelligence-Arbeiten.
- `start_audit` zum Starten eines Audits und `get_audit_status` zum Prüfen des Fortschritts.

Lesewerkzeuge greifen nur auf bereits in RankMeFast gespeicherte Daten zu. `start_audit` ist das einzige ausgabewirksame Werkzeug und verbraucht zusätzlich ein Audit Ihres Tarifs. Verstehen Sie Antworten als Orientierung und prüfen Sie wichtige Änderungen anhand der angezeigten Belege.

## Berechtigungen

Unter [Einstellungen → MCP](/profile?tab=mcp) legen Sie die Kontovorgaben für Assistent und MCP-Clients fest. Sie können einzelne Werkzeuge deaktivieren, nur bestimmte Websites zulassen und ausgabewirksame Aktionen sperren. Die Vorgaben sind zunächst freizügig, damit bestehende Konten ohne Einschränkung weiterarbeiten.

Der Assistent läuft über Ihre angemeldete Sitzung, daher gelten für ihn nur diese Kontovorgaben. Ein deaktiviertes Werkzeug wird dem Modell nicht angeboten, eine gesperrte Website erscheint als nicht gefunden und `start_audit` benötigt zusätzlich **Ausgabewirksame Aktionen erlauben**. API-Schlüsselbereiche betreffen nur externe MCP-Clients: Dort kann ein Schlüssel die Kontovorgaben einschränken, aber nie erweitern. Details stehen im Leitfaden [RankMeFast MCP](./rankmefast-mcp.de.md).

## Nachrichten, Limits und Credits

Jede akzeptierte Nachricht von Ihnen verbraucht eine Einheit `ai_chat_messages`. Die monatlichen Kontingente sind Starter 100, Pro 200 und Agency 400. Auch das Stoppen einer Antwort zählt, weil die Verarbeitung bereits begonnen hat. Ein im Chat gestartetes Audit verbraucht separat ein Audit.

Ist das Nachrichtenkontingent aufgebraucht, zeigt die Eingabe vor einem neuen KI-Aufruf eine Upgrade- oder Credit-Option. Ein einmaliges Paket **KI-Chat** ergänzt unter **Abrechnung → Credits** 100 Nachrichten für 19 $. Aktuelle Kontingente finden Sie unter [Pläne, Limits und Credits](./plans-limits-credits.de.md).

## Fehlerbehebung

- **Der Assistent ist gesperrt:** Das Konto hat keinen Bezahlplan. Wechseln Sie zu Starter oder höher.
- **Nachrichtenlimit erreicht:** Warten Sie auf die monatliche Erneuerung, wechseln Sie den Tarif oder fügen Sie ein KI-Chat-Paket hinzu.
- **Ein Werkzeug fehlt:** Prüfen Sie seinen Schalter unter **Einstellungen → MCP**. MCP-Schlüsselbereiche ändern den Zugriff des angemeldeten Assistenten nicht.
- **Eine Website ist nicht verfügbar:** Prüfen Sie die verknüpfte Website und deren Freigabe in den Kontovorgaben.
- **Ein Audit startet nicht:** Aktivieren Sie Werkzeug und ausgabewirksame Aktionen und prüfen Sie dann Ihr Audit-Kontingent.
- **Assistent nicht verfügbar:** `CHAT_ENABLED` ist in dieser Installation deaktiviert oder der Dienst ist vorübergehend nicht erreichbar. Versuchen Sie es später oder fragen Sie den Betreiber.
- **Der Stream bricht ab:** Senden Sie die Nachricht erneut. Eine Teilantwort kann in der Unterhaltung verbleiben.

## Verwandte Leitfäden

- [RankMeFast MCP](./rankmefast-mcp.de.md): externen KI-Client verbinden und seinen Schlüssel begrenzen.
- [Pläne, Limits und Credits](./plans-limits-credits.de.md): Nachrichten- und Audit-Kontingente vergleichen.
- [Zurück zum Doku-Index](./index.de.md)
