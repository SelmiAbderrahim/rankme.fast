---
title: 'Fehlerbehebung'
description: 'Häufige Probleme und ihre Lösungen.'
locale: de
slug: troubleshooting
section: start
order: 3
---

# Fehlerbehebung

## Audit fehlgeschlagen oder nicht verfügbar
- Firewall/Cloudflare prüfen.
- Sicherstellen, dass robots.txt `RankMeFastBot` nicht blockiert.
- Später erneut versuchen.

## Rank-Check nicht verfügbar
Meist vorübergehend; nächster Lauf wiederholt automatisch.

## Search Console fordert zum erneuten Verbinden auf
Google hat unseren Token ungültig gemacht. Im Tab **Google** der Website zeigt die Karte Google Search Console **Ihre Google-Verbindung muss erneuert werden**; wählen Sie **Neu verbinden**. Das kann passieren, wenn Sie Ihr Google-Passwort geändert oder die App widerrufen haben. Karten, die Search Console oder Google Analytics lesen, zeigen **Search Console ist nicht verbunden** oder **Google Analytics ist nicht verbunden**, bis Google wieder verbunden ist, und erholen sich beim nächsten Lesen.

## Limit erreicht
Siehe [Pläne, Limits & Credits](./plans-limits-credits.de.md).

## Limit in einem Recherche-Tool erreicht (402)
Die Meldung nennt die aufgebrauchte Einheit, etwa `keyword_lookups` oder `audience_research_runs`. Warten Sie auf den Monatsreset, kaufen Sie ein Credit-Paket, wo es eines gibt, oder upgraden Sie; für Audience-Recherche-Läufe gibt es kein Paket.

## Teilergebnisse in einem Recherche-Tool
Einige Engines oder Quellen haben geantwortet, andere nicht. Das Ergebnis erscheint mit dem, was ankam, und wird als **Teilergebnisse** gekennzeichnet. Der fehlende Teil wird benannt, nie mit Nullen aufgefüllt.

## Nicht unterstützt für diese Engine / diesen Markt
Der Check kann für diese Engine oder diesen Markt nicht laufen. Der nicht unterstützte Teil wird aus dem Ergebnis ausgeschlossen und nie als Null angezeigt.

## Nicht verfügbar (nicht null)
Für das Fenster kamen keine Daten zurück. `unavailable ≠ 0`: Behandeln Sie es als unbekannt, nicht als Absturz auf null. Sie sehen das auf Share-of-Voice- und Search-Console-Generative-KI-Karten.

## „Erneut verbinden" auf Analytics- oder Generative-KI-Karten
Gleiche Ursache wie beim Search-Console-Reconnect oben: Google hat das Token für ungültig erklärt. Verbinden Sie im Google-Workspace der Site neu; die Karten aktualisieren sich beim nächsten Laden.

## Bestätigungsmail fehlt
Spam prüfen; Link läuft nach 24 h ab.

## Zusammenfassung zeigt „gekürzt"
Lange Audits werden vor Versand gekürzt; **Neu generieren**.

## Report bleibt im Ladezustand
Harter Refresh (⌘/Strg + Umschalt + R). Sonst Support kontaktieren.

[Zurück zum Doku-Index](./index.de.md)
