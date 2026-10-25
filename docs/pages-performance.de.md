---
title: 'Seitenleistung'
description: 'Wie der Seiten-Tab gespeicherte Suchdaten, Crawl-Kontext und Seitenmetriken zeigt.'
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

## Gespeicherte Daten und Aktualisierung

Die Seitenspalte bleibt beim horizontalen Scrollen sichtbar. Über **Spalten** können Sie andere Felder ein- oder ausblenden. Ein Strich kennzeichnet fehlende Werte; Null bedeutet, dass die Quelle tatsächlich Null gemessen hat. Seiten ohne Titel werden mit ihrem Pfad benannt. Wenn eine gemessene URL einer gecrawlten Seite mit Sprachpräfix entspricht, zeigt **Gecrawlt als** deren Pfad.

Der Search-Console-Hinweis nennt die genauen Tage der Seitensummen. Google kann für jede Seite in einem Suchergebnis eine Impression zählen, auch wenn die Suchanfrage verborgen bleibt. Deshalb können die Seitensummen höher sein als die Website-Summen im Google-Tab. **Zu wenige Daten** kennzeichnet Seiten mit wenigen Impressionen und ohne Klicks; sie erhalten noch keine Bewegungskennzeichnung. Der Crawl-Hinweis nennt die Zahl der beim letzten Audit abgerufenen URLs und, soweit erfasst, den Grund für das Ende des Crawls.

Details öffnen, suchen, filtern, sortieren sowie Spalten und Ergebnisseiten wechseln liest gespeicherte Daten. Mit **Aktualisieren** fordern Sie neue Quelldaten an. Schlägt dies fehl, bleibt der letzte erfolgreiche Snapshot sichtbar und wird als veraltet markiert. Versuchen Sie es erneut, sobald die Verbindung verfügbar ist.

## Löschung und Export

Beim Löschen einer Website oder nach Abschluss einer Kontolöschung werden die gespeicherten Seiten-Snapshots entfernt. Der aktuelle Kontoexport enthält weder Seiten-Snapshots noch die Zeitreihen aus GSC und Ranking-Tracking. Er ist deshalb keine Sicherung dieser Verläufe.

## Fehlerbehebung

- Warten Sie bei **Synchronisierung** auf die erste Search-Console-Erfassung.
- Stellen Sie bei **Erneut verbinden** die Google-Verbindung im Google-Tab wieder her.
- Wählen Sie bei einer unpassenden Property eine Property für das richtige URL-Präfix oder die Domain.
- Verbinden Sie ohne gespeicherte Quelle Search Console oder wählen Sie **Rankingdaten abrufen**.
- Versuchen Sie bei Nichtverfügbarkeit dieselbe Quelle erneut. RankMeFast wechselt nicht heimlich von einer nutzbaren Search Console weg.

Siehe auch [Google Search Console verbinden](./google-search-console.de.md) und [Ranking-Tracking](./rank-tracking.de.md).

[Zurück zum Doku-Index](./index.de.md)
