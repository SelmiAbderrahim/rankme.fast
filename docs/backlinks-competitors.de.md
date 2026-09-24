---
title: 'Backlinks und Wettbewerbsanalyse'
description: 'Vergleichen Sie Backlinks, Keyword-Landschaften, Ranking-Seiten und gespeicherte Wettbewerberberichte.'
locale: de
slug: backlinks-competitors
section: audits
order: 6
---

# Backlinks und Wettbewerbsanalyse

Backlinks und Wettbewerbsanalyse beantworten unterschiedliche Fragen. Backlinks zeigen, welche Websites auf eine Domain verweisen. Die Wettbewerbsanalyse vergleicht Suchbegriffe und Ranking-Seiten von Wettbewerbern, die Sie für eine eigene Website bestätigt haben.

<!-- generated: finite-backlink-limits:start -->
Backlink-Zeilen werden monatlich gemessen. Pro enthält bis zu 10.000 Zeilen pro Monat, Agency bis zu 100.000. Gespeicherte Berichte bleiben lesbar, auch wenn das Monatslimit erreicht ist.
<!-- generated: finite-backlink-limits:end -->

## Der Website-Arbeitsbereich

Öffnen Sie eine Website und wählen Sie **Wettbewerber**. Portfolio, Keyword-Landschaften, Content-Vergleiche, Monitoring, Traffic-Schätzungen und gespeicherte Berichte liegen dort an einer Stelle. Mit Pro können Sie bis zu drei bestätigte Wettbewerber pro Bericht auswählen, mit Agency bis zu zehn. Eine Website kann höchstens zehn aktive Wettbewerber speichern.

Starter zeigt einen Upgrade-Hinweis. Pausiert ein Betreiber neue Aufträge, bleiben gespeicherte Berichte lesbar. Nach einem Tarifwechsel können vorhandene Daten außerdem schreibgeschützt bleiben.

## Einheiten und Bestätigung

Ein Landschaftsbericht verbraucht pro ausgewähltem Wettbewerber eine Einheit `keyword_lookups`. Drei Wettbewerber kosten also drei Einheiten. Vor der Bestätigung zeigt RankMeFast, wie viele Einheiten und Zeilen der Bericht verbraucht. Cache-Treffer zählen ebenfalls. Eine neue Wettbewerbersuche ist optional. Sie verbraucht eine weitere Einheit `keyword_lookups`, und zwar erst nach eigener Vorschau und Bestätigung.

Der Vergleich führt für jeden Wettbewerber drei Keyword-Abfragen aus: gemeinsame Begriffe, Begriffe nur Ihrer Website und Begriffe nur des Wettbewerbers. Jede Abfrage speichert höchstens 100 Zeilen, ein Agency-Bericht mit zehn Wettbewerbern also maximal 3.000 Keyword-Zeilen.

## Eine Landschaft lesen

Der Bericht verwendet fünf Klassen:

- `missing`: Der Wettbewerber rankt, Ihre Website wurde nicht beobachtet.
- `owned_only`: Ihre Website rankt, der Wettbewerber wurde nicht beobachtet.
- `shared_behind`: Beide ranken, Ihre Position ist schlechter.
- `shared_ahead`: Beide ranken, Ihre Position ist besser.
- `shared_even`: Beide haben dieselbe beobachtete Position.

Positionen, Ranking-URLs und Beobachtungsdaten kommen direkt aus der Datenquelle. Suchvolumen und Schwierigkeit sind Schätzungen des Anbieters. Klassen, Konfidenz und Empfehlungen werden aus den im Bericht gespeicherten Zeilen berechnet. Ein fehlender Wert bleibt leer und wird nicht geschätzt. Teilberichte zeigen, wie viele Wettbewerber und Quellschritte verwertbare Daten geliefert haben.

## Ranking-Seiten und Content

Agency-Berichte können Paare von Ranking-Seiten vorschlagen. Prüfen Sie beide URLs, bevor Sie einen Content-Vergleich starten. Sie dürfen die vorgeschlagene Wettbewerber-URL durch eine andere öffentliche URL derselben bestätigten Domain ersetzen. Ein Vorschlag startet nie von selbst einen Crawl, und RankMeFast setzt nicht stillschweigend die Startseite ein.

Der bestätigte Content-Vergleich verbraucht eine separate Einheit `competitor_content_runs`. Das Prüfen eines Seitenpaars verbraucht diese Einheit nicht. Monitoring ist ebenfalls eine getrennte, ausdrücklich bestätigte Aktion.

Empfehlungen bleiben im Bericht, bis Sie eine davon annehmen. Erst dann kommt ein einzelner Eintrag in Nächste Aktionen hinzu. Dabei wird weder Content veröffentlicht noch ein weiterer bezahlter Auftrag gestartet.

## Gespeicherte Berichte und Exporte

Das erneute Öffnen einer Landschaft oder eines historischen Content-Laufs ruft den Anbieter nicht auf und verbraucht keine Einheit. PDF-, CSV- und JSON-Exporte lesen den gespeicherten Stand. PDF lehnt eine Auswahl mit mehr als 1.000 Keyword-Zeilen ab und verweist auf CSV oder JSON. Diese Formate behalten die vollständige Auswahl innerhalb der Grenze von 3.000 Zeilen und des allgemeinen Download-Limits.

Alte Wettbewerber-Lesezeichen öffnen den Tab Wettbewerber. Der frühere Wettbewerber-Link in Content Intelligence öffnet die Ansicht Content. Das eigenständige Keyword Gap behält seinen Verlauf und seine Abrechnung von einer Einheit `keyword_lookups` pro Wettbewerber.

Backlink-Werte und Traffic-Zahlen sind Schätzungen auf Basis der Anbieterabdeckung. Vergleichen Sie Beobachtungen aus derselben Quelle und vom selben Datum, und lesen Sie sie nicht als eigene Analytics-Daten.

Aktuelle Kontingente stehen unter [Pläne, Limits und Credits](./plans-limits-credits.de.md). Der getrennte Content-Ablauf ist unter [Content Intelligence](./content-intelligence.de.md) beschrieben.

[Zurück zum Doku-Index](./index.de.md)
