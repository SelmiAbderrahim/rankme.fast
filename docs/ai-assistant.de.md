---
title: 'KI-Assistent'
description: 'Fragen Sie Ihre SEO-Belege ab, verfolgen Sie Antworten live und führen Sie freigegebene RankMeFast-Werkzeuge aus.'
locale: de
slug: ai-assistant
section: developers
order: 3
---

# Mit dem KI-Assistenten arbeiten

Der KI-Assistent unter [/assistant](/assistant) bündelt Ihre RankMeFast-Unterhaltungen in einem Arbeitsbereich. Antworten erscheinen während der Erstellung. Freigegebene RankMeFast-Werkzeuge können gespeicherte SEO-Belege lesen oder ein Audit starten.

## Unterhaltung beginnen

1. Öffnen Sie **KI-Assistent** in der Seitenleiste.
2. Wählen Sie vor der ersten Nachricht optional eine Website. Sie liefert Kontext; der Werkzeugzugriff folgt weiterhin Ihren Kontoberechtigungen.
3. Geben Sie eine Frage ein und drücken Sie **Eingabe**. Mit **Umschalt+Eingabe** fügen Sie eine neue Zeile ein.
4. Verfolgen Sie die laufende Antwort. Klappen Sie eine Werkzeugkarte auf, um Argumente und strukturierte Ergebnisse zu prüfen.
5. Wählen Sie **Stoppen**, um eine Antwort zu beenden. Der bisherige Teil bleibt in der Unterhaltung.

Unterhaltungen werden automatisch gespeichert und sind nach dem Neuladen weiterhin verfügbar. Beginnen Sie eine neue Unterhaltung, wenn Sie ohne oder mit einer anderen Website arbeiten möchten.

Ist eine Website gewählt, beziehen sich die vorgeschlagenen Fragen auf diese Website. Mit **Keine Website — allgemeine Hinweise** decken sie stattdessen Ihr Konto und allgemeine SEO-Fragen ab. Jede Unterhaltung trägt den Namen Ihrer ersten Nachricht, ergänzt um die Domain der Website, wenn das ähnliche Unterhaltungen unterscheidbar macht. Zum Entfernen wählen Sie das Papierkorb-Symbol daneben und bestätigen; **Abbrechen** behält die Unterhaltung. Wird eine Antwort vor dem Ende abgeschnitten, bleibt der empfangene Teil mit einem Hinweis und der Schaltfläche **Erneut versuchen** in der Unterhaltung.

## Verfügbare Werkzeuge

Der Assistent nutzt dieselbe Werkzeug-Registry wie RankMeFast MCP. Abhängig von Ihren Berechtigungen kann er Folgendes ausführen:

- `list_sites`, `get_latest_audit_report`, `list_keywords` und `get_rank_history` für gespeicherte Website- und Rankingbelege.
- `list_content_analyses` und `get_content_analysis` für gespeicherte Content-Intelligence-Arbeiten.
- `start_audit` zum Starten eines Audits und `get_audit_status` zum Prüfen des Fortschritts.

Lese-Werkzeuge nutzen Daten, die bereits in RankMeFast gespeichert sind, ohne einen Datenanbieter aufzurufen. Die Werkzeugkarten zeigen, welches Werkzeug lief, und [RankMeFast MCP](./rankmefast-mcp.de.md) listet alle auf. `start_audit` ist das einzige kostenpflichtige Werkzeug: Es startet ein Audit und verbraucht Guthaben bei Ihrem eigenen Anbieterkonto. Betrachten Sie Antworten des Assistenten als Orientierung und prüfen Sie wichtige Änderungen anhand der angezeigten Belege.

## Berechtigungen

Unter [Einstellungen → MCP](/settings/profile?tab=mcp) legen Sie die Kontovorgaben für Assistent und MCP-Clients fest. Sie können einzelne Werkzeuge deaktivieren, nur bestimmte Websites zulassen und ausgabewirksame Aktionen sperren. Die Vorgaben sind zunächst freizügig, damit bestehende Konten ohne Einschränkung weiterarbeiten.

Der Assistent läuft über Ihre angemeldete Sitzung, daher gelten für ihn nur diese Kontovorgaben. Ein deaktiviertes Werkzeug wird dem Modell nicht angeboten, eine gesperrte Website erscheint als nicht gefunden und `start_audit` benötigt zusätzlich **Ausgabewirksame Aktionen erlauben**. API-Schlüsselbereiche betreffen nur externe MCP-Clients: Dort kann ein Schlüssel die Kontovorgaben einschränken, aber nie erweitern. Details stehen im Leitfaden [RankMeFast MCP](./rankmefast-mcp.de.md).

## Nachrichten und Limits

Jede gesendete Nachricht öffnet eine gestreamte KI-Antwort, daher ist der Assistent pro Konto ratenbegrenzt: Senden Sie in kurzer Zeit viele Nachrichten, warten Sie einen Moment und versuchen Sie es erneut. Beim Stoppen einer Antwort bleibt das bereits Geschriebene erhalten. Ein Audit aus dem Chat zu starten verbraucht dieselben Anbieter-Guthaben wie ein selbst gestartetes. Der Betreiber Ihrer Installation kann den Assistenten mit `CHAT_ENABLED` abschalten und begrenzt die Länge jeder Antwort.

## Fehlerbehebung

- **Ein Werkzeug fehlt:** Prüfen Sie den Schalter unter **Einstellungen → MCP**. MCP-Schlüsselbereiche ändern den Zugriff des angemeldeten Assistenten nicht.
- **Eine Website ist nicht verfügbar:** Stellen Sie sicher, dass die Unterhaltung mit der richtigen Website verknüpft ist und diese in den Konto-Standards zugelassen ist.
- **Ein Audit startet nicht:** Aktivieren Sie das Werkzeug und die kostenpflichtigen Aktionen und prüfen Sie, dass für die Website nicht schon ein Audit läuft.
- **Zu viele Anfragen:** Warten Sie einen Moment und versuchen Sie es erneut.
- **Assistent nicht verfügbar:** Die Installation hat `CHAT_ENABLED` deaktiviert oder der Dienst ist vorübergehend nicht erreichbar. Versuchen Sie es später erneut oder wenden Sie sich an den Betreiber.
- **Der Stream bricht unerwartet ab:** Nutzen Sie **Erneut versuchen** im Hinweis. Die Teilantwort bleibt in der Unterhaltung.

## Verwandte Leitfäden

- [RankMeFast MCP](./rankmefast-mcp.de.md): externen KI-Client verbinden und seinen Schlüssel begrenzen.
- [Zurück zum Doku-Index](./index.de.md)
