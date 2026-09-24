---
title: 'Traffic-Analyse'
description: 'Vergleichen Sie modellierten Wettbewerber-Traffic mit klar gekennzeichneten Schätzungen, Einheiten und Erstattungen.'
locale: de
slug: traffic-insights
section: research
order: 8
---

# Traffic Insights

Traffic Insights erstellt einen gespeicherten Snapshot einer Wettbewerber-Domain: modellierte monatliche organische Besuche, Domain-Rang, Keyword-Anzahl, wichtige Länder und Verlauf. Nutzen Sie ihn als Richtungssignal, nicht als Ersatz für die Analytics des Wettbewerbers.

<!-- docs-truth: metric=traffic_snapshots; unit=one-target-domain-snapshot; cache-hits=count; refund=all-provider-parts-fail-zero-retained; cadence=on-demand; estimates=required -->

## Was eine Einheit abdeckt

Jeder bestätigte Snapshot einer Ziel-Domain verbraucht eine Einheit `traffic_snapshots`. Eine Vorschau mehrerer Domains zeigt eine Einheit je Domain; jede bestätigte Domain wird jedoch als eigener Snapshot ausgeführt. Vorschau und Abbruch verbrauchen nichts.

Aktuelle Monatskontingente und Paketpreise stehen unter [Preise](./pricing.de.md). Gespeicherte Snapshots zu öffnen, zu filtern oder zu vergleichen kostet keine weitere Einheit.

## Jede Zahl ist eine Schätzung

Jeder numerische Wert ist als **Schätzung** gekennzeichnet. Die Werte werden aus einem Suchdatenindex modelliert; sie sind keine echten Besuche, Conversions oder Analytics-Daten. Fehlende Werte bleiben unverfügbar. Ein teilweiser Snapshot kann trotzdem nützlich sein und wird sichtbar als teilweise markiert.

Der Vergleich richtet bis zu fünf gespeicherte Snapshots aus. Fehlende Länder- oder Verlaufswerte werden weder aufgefüllt noch abgeleitet.

## Cache und Erstattungen

Ein Snapshot aus dem Cache zählt als Einheit, ebenso ein erfolgreiches, aber leeres Ergebnis.

Ein Snapshot sammelt mehrere zusammengehörige Beobachtungen. Scheitern alle und RankMeFast speichert kein Ergebnis, wird die Einheit genau einmal zurückgegeben. Sobald eine brauchbare Beobachtung gespeichert ist, bleibt der teilweise oder vollständige Snapshot verbraucht. Ein Wiederholungsversuch kann nicht doppelt erstatten.

## Wann aktualisieren

Traffic Insights läuft **auf Abruf** und überwacht Wettbewerber nicht ständig. Starten Sie für eine aktuellere Schätzung einen neuen Snapshot. Werden neue Snapshots pausiert, bleiben gespeicherte Listen, Details und Vergleiche verfügbar.

Öffnen Sie den Tab **Traffic** einer Website, geben Sie eine öffentliche Domain ein, prüfen Sie die Vorschau und bestätigen Sie. Weitere Regeln stehen unter [Pläne, Limits & Credits](./plans-limits-credits.de.md).

[Zurück zum Doku-Index](./index.de.md)
