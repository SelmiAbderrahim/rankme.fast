---
title: 'Seitenleistung'
description: 'Wie der Seiten-Tab Quellen auswählt, Snapshots vergleicht und Aktualisierungen zählt.'
locale: de
slug: pages-performance
section: research
order: 13
---

# Seitenleistung

Öffnen Sie eine Website und wählen Sie **Seiten**, um Suchleistung und den Bestand des letzten Crawls zusammen zu betrachten. Beim Öffnen werden nur gespeicherte Daten gelesen. Neue Daten werden erst mit **Aktualisieren** oder **Fallback-Daten erfassen** gesammelt.

## Datenquelle

RankMeFast verwendet Google Search Console, wenn die verbundene Property die Website abdeckt. Search Console bleibt auch während der ersten Synchronisierung und bei einer leeren Auswahl maßgeblich. Eine nutzbare, leere Search-Console-Quelle wird nicht durch Schätzwerte ersetzt.

Ohne nutzbare Verbindung kann der Tab den neuesten gespeicherten Ranking-Keyword-Snapshot verwenden. Die Kennzeichnung unterscheidet DataForSEO und Demodaten. Sind keine Daten gespeichert, zeigt der Tab die möglichen nächsten Schritte.

## Metriken und Zeitfenster

Klicks, Impressionen, CTR und durchschnittliche Position aus Search Console sind beobachtete Werte für ein rollierendes Fenster von 7, 28 oder 90 Tagen. Google meldet mit drei Tagen Verzögerung. Search Console kann Zeilen stichprobenartig erfassen oder begrenzen. Prüfen Sie deshalb den Abdeckungshinweis.

Fallback-Position, Suchvolumen, Schwierigkeit, Anzahl rankender Keywords und geschätzter Traffic stammen aus einem Zeitpunkt-Snapshot. Klicks, Impressionen und CTR sind dort **Nicht verfügbar**. Das ist etwas anderes als eine echte Null. Das gewählte Fenster ändert beim Fallback nur Verlauf und Vergleich, nicht die Hauptwerte.

**Seit der vorherigen Synchronisierung** vergleicht den aktuellen erfolgreichen Snapshot mit dem direkt vorherigen passenden Snapshot. Es ist kein Vorperiodenvergleich. Die Seitendetails zeigen zugeordnete Suchanfragen oder Keywords und höchstens 90 gespeicherte Verlaufspunkte.

## Chancen und Crawl-Kontext

- **In Reichweite** gilt für Positionen über 3 bis einschließlich 20 mit ausreichender Nachfrage.
- **Niedrige CTR** gilt nur für Search-Console-Zeilen, die die Schwellen für Impressionen und Position erfüllen.
- **Rückläufig** und **Gewinner** vergleichen Position oder beobachtete Klicks mit der vorherigen Synchronisierung.
- **Sichtbar, aber nicht crawl-indexierbar** bedeutet, dass Suchleistung vorliegt, obwohl der letzte Crawl die Seite als nicht indexierbar markiert.
- **Nicht gemessen** bedeutet, dass der Crawl eine indexierbare Seite fand, die Leistungsquelle aber keine Zeile enthält.

Crawl-Indexierbarkeit beschreibt das Ergebnis des RankMeFast-Crawls. Sie beweist nicht, ob Google eine URL indexiert hat. Sichtbare, aber nicht indexierbare Seiten bleiben zur Prüfung des Konflikts in der Liste.

## Kosten und veraltete Daten

Eine Search-Console-Aktualisierung nutzt die bestehende Synchronisierung und kostet keine Keyword-Suche. Eine Fallback-Aktualisierung kostet eine Keyword-Suche, auch bei einem Cache-Treffer. Details, Suche, Filter, Sortierung und Seitennavigation lesen nur gespeicherte Daten und kosten nichts.

Scheitert eine Aktualisierung, bleibt der letzte erfolgreiche Snapshot sichtbar und wird als veraltet markiert. Ein Fallback-Snapshot wird auch nach Ablauf des Cache-Frischefensters veraltet.

## Löschung und Export

Beim Löschen einer Website oder nach Abschluss einer Kontolöschung werden die gespeicherten Seiten-Snapshots entfernt. Der aktuelle Kontoexport enthält weder Seiten-Snapshots noch die Zeitreihen aus GSC und Ranking-Tracking. Er ist deshalb keine Sicherung dieser Verläufe.

## Fehlerbehebung

- Warten Sie bei **Synchronisierung** auf die erste Search-Console-Erfassung.
- Stellen Sie bei **Erneut verbinden** die Google-Verbindung im Google-Tab wieder her.
- Wählen Sie bei einer unpassenden Property eine Property für das richtige URL-Präfix oder die Domain.
- Verbinden Sie ohne gespeicherte Quelle Search Console oder starten Sie die gezählte Fallback-Erfassung.
- Prüfen Sie beim Limit die Nutzung oder den Tarif. Gespeicherte Snapshots bleiben lesbar.
- Versuchen Sie bei Nichtverfügbarkeit dieselbe Quelle erneut. RankMeFast wechselt nicht heimlich von einer nutzbaren Search Console weg.

Siehe auch [Google Search Console verbinden](./google-search-console.de.md) und [Ranking-Tracking](./rank-tracking.de.md).

[Zurück zum Doku-Index](./index.de.md)
