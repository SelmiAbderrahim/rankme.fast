---
title: 'Content Intelligence'
description: 'Analysieren Sie eine eigene Seite, erhalten Sie Score und Klartext-Briefing mit Zitaten.'
locale: de
slug: content-intelligence
section: audits
order: 3
---

# Content Intelligence

Content Intelligence prüft eine Seite, die Sie besitzen, und liefert
einen Score, Belege, ein Klartext-Briefing und, nach
Opt-in, einen KI-Entwurf. Eine Analyse verbraucht ein
`content_analyses`-Guthaben aus Ihrem Monatskontingent oder Ihrem Pack. Der Score folgt festen Regeln: Dieselbe Seite bekommt immer
denselben Score.

## Was sie tut

- Ruft eine zulässige Seite über den konfigurierten Crawling-Dienst ab.
- Extrahiert Überschriften, Links, strukturierte Daten und On-Page-Signale.
- Berechnet den Score mit derselben Regel-Engine wie der Audit-Report.
- Liefert Belege je Fund: Regel-ID, Fundstelle, Zitat, Konfidenz.
- Nur mit Opt-in: ruft die serverseitige KI-Provider-Reihenfolge auf, um
  Briefing und optional einen Entwurf zu erzeugen.

## Was sie NICHT tut

- Sie veröffentlicht nichts. Entwürfe gehören Ihnen.
- Sie crawlt keine beliebigen URLs, nur eigene Sites oder Agency-Wettbewerber.
- Keine Rohantwort, kein Prompt, keine Completion in der Antwort.

## Analyse starten

- **Sites → Content**: URL aus Ihrem Inventar wählen.
- **Report → Fix now / Watch**: Empfehlung öffnet den Flow.
- **Keyword Research → verfolgtes Keyword**: analysiert die rankende URL.
- **Search Console → Query**: analysiert die von Google gezeigte URL.
- **Wettbewerber → Agency-Wettbewerberseite**: nur Agency.

Jeder dieser Wege prüft und reserviert Ihr Kontingent, bevor die Analyse startet, siehe
[Pläne, Limits & Guthaben](./plans-limits-credits.de.md).

## Was ein Guthaben umfasst

Ein `content_analyses`-Guthaben deckt: den Abruf einer eigenen Seite, bis zu
drei geprüfte öffentliche Vergleichsseiten, verfügbare Keyword- und
Suchergebnisbelege, den Score mit Belegen, das Briefing und,
bei Opt-in, einen Entwurf. Regenerieren verbraucht ein weiteres Guthaben.

## Score, Belege, Konfidenz, Zitate, Briefing, Entwurf

- **Score.** 0 bis 100. Gleiche Regeln wie der Audit-Report.
- **Belege.** Regel-ID, Fundstelle, Zitat pro Finding.
- **Konfidenz.** `high` / `medium` / `low`.
- **Zitate.** Jede KI-Aussage zitiert URL und Textstelle.
- **Briefing.** Kurzer, teilbarer Plan.
- **Entwurf.** Opt-in. Sie akzeptieren, editieren oder verwerfen.

## Opt-in-KI-Verarbeitung und Aufbewahrung

Nur mit Opt-in senden wir Textausschnitte. Ausschnitte werden sieben
Tage aufbewahrt, dann gelöscht. Export- und Kontolöschung siehe
[Kontosicherheit](./settings-security.de.md).

## Teilweise und erstattete Ergebnisse

Wenn ein Anbieter Probleme hat, wird die Analyse `partial` markiert.
Eine Neugenerierung ist eine neue Analyse und verbraucht einen weiteren Credit. Bricht der Lauf ohne verwertbares Ergebnis ab, wird er `refunded` und das
Guthaben automatisch rückgebucht.

## Empfehlungen und 28-Tage-Korrelation

Sie können **akzeptieren**, **verwerfen** oder **anwenden**. Die
28-Tage-Korrelation misst Rang, Klicks und Impressionen vorher/nachher. Sie zeigt, ob sich
etwas bewegt hat, beweist aber nicht, dass die Änderung die Ursache war.

## Pro-Inventar und Kannibalisierung

Pro und Agency öffnen ein Seiten-Inventar mit Themen-Clustern und
Kannibalisierungs-Markern. Das Inventar nutzt die separate Zuteilung
`content_inventory_page_blocks`: Ein Block deckt bis zu vier angeforderte
eigene Seiten ab, aufgerundet auf volle Blöcke. Vollständig ungenutzte Blöcke
werden erstattet, wenn der Lauf endet.

## Agency-Wettbewerberportfolio und Monitoring

Agency-Vergleiche beginnen mit geprüften Ranking-Seiten, nicht mit den
Startseiten der Wettbewerber. Öffnen Sie einen Landscape-Bericht, prüfen Sie
den Seitenvorschlag samt Keyword-Belegen und bestätigen Sie ihn oder tragen Sie
eine andere Seite derselben Domain ein. Ein Vorschlag allein startet keine
kostenpflichtige Arbeit. Eine nicht verfügbare Seite wird nie unbemerkt durch
die Startseite ersetzt.

Ein bestätigter Content-Lauf kann bis zu 15 geprüfte Wettbewerberseiten mit
den ausgewählten eigenen Seiten vergleichen. Vor der Reservierung zeigt die
Prüfung Seitenzahl und Einheiten. RankMeFast speichert abgeleitete Fakten und
kurze Auszüge, kein Roh-HTML; Auszüge verfallen nach sieben Tagen.

Monitoring bleibt eine separate Entscheidung. „Diese geprüfte Seite
überwachen“ öffnet das bestehende Formular. Dort bestätigen Sie die genaue URL,
bevor ein Monitoring-Platz belegt wird. Eine Analyse erstellt keinen Monitor;
wöchentlicher Rhythmus und Tariflimit bleiben unverändert. Eine verworfene
Firecrawl-Änderung meldet sich nicht erneut.

Aus einer Landscape-Chance lässt sich außerdem eine fokussierte Inhaltsanalyse
öffnen. Eigene URL, Keyword und geprüfte Wettbewerberseite sind vorausgefüllt,
der Start muss aber weiterhin bestätigt werden.

## Kontingent verwalten und 20er-Pack

Das Monatskontingent hängt vom Tarif ab, siehe
[Pläne, Limits & Guthaben](./plans-limits-credits.de.md). Der 20er-Pack
verfällt nie und addiert sich zum Kontingent.

## Fehlerbehebung

- **Zugriff.** Die URL muss Ihnen gehören. Sonst lautet die Antwort "nicht
  gefunden" statt "verboten", damit nicht erkennbar ist, ob die URL existiert.
- **robots.txt.** Blockiert Ihre eigene Seite den Crawl, schlägt der Lauf fehl
  und das Guthaben wird erstattet. Eine blockierte optionale Vergleichsseite
  kann ein `partial`-Ergebnis hinterlassen. RankMeFast umgeht die Regeln nie.
- **URL noch nicht in Search Console.** Die Analyse läuft auf dem abgerufenen
  HTML, ohne Search-Console-Vergleich.
- **Limits.** Lokalisierte Meldung mit Metrik `content_analyses`.
- **Anbieterausfall.** Ergebnis `partial` oder `refunded`, nie als Erfolg
  gemeldet.

## MCP-Anbindung

Aus Claude Code, Claude Desktop, Cursor oder VS Code, siehe
[RankMeFast MCP](./rankmefast-mcp.de.md).

## Export und Löschung

Analysen sind im Konto-Export enthalten. Details zu Export und Löschung in
[Kontosicherheit](./settings-security.de.md).
