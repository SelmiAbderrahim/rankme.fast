---
title: 'Bewertungsanalyse'
description: 'Synchronisieren Sie öffentliche Bewertungen auf Abruf und verstehen Sie Trends, belegte Themen und Erstattungen.'
locale: de
slug: review-intelligence
section: research
order: 10
---

# Bewertungsanalyse

Die Bewertungsanalyse holt öffentliche Bewertungen aus den Google-, Trustpilot- und Tripadvisor-Einträgen, die Sie einrichten, und sammelt sie an einem Ort. Sie berechnet Bewertungsstatistiken und kann wiederkehrendes Lob und Kritik zu Themen bündeln, die jeweils die zugrunde liegenden gespeicherten Bewertungen zitieren.

<!-- docs-truth: metric=review_syncs; unit=one-sync-one-to-three-sources; cache-hits=count; refund=all-sources-provider-fail-zero-new-rows; cadence=on-demand; estimates=stored-observations -->

## Was eine Einheit abdeckt

Eine bestätigte Synchronisierung verbraucht eine Einheit `review_syncs` für den gesamten Auftrag. Sie können eine bis drei konfigurierte Quellen und bis zu 100 Bewertungen je Quelle wählen; mehr Quellen kosten nicht mehr. Die Themenanalyse ist enthalten.

Vorschau und Abbruch sind kostenlos. Aktuelle Kontingente und Pakete finden Sie unter [Preise](./pricing.de.md).

## Cache, Duplikate und Erstattungen

Öffentliche Bewertungen aus dem Cache zählen ebenfalls. RankMeFast entfernt Duplikate anhand von Quelle und Bewertungs-ID. Eine erfolgreiche Synchronisierung ohne neue Zeile zählt deshalb: Die Quelle wurde geprüft und der Bestand bestätigt.

Sie erhalten die Einheit nur dann (einmal) zurück, wenn **alle ausgewählten Quellen** fehlschlagen und keine neue Bewertung gespeichert wird. Eine teilweise Synchronisierung, eine erfolgreiche ohne neue Bewertungen oder eine fehlgeschlagene Themenanalyse verbraucht die Einheit trotzdem, weil die Arbeit an den Bewertungen lief oder Bewertungen gespeichert wurden. Ein erneuter Versuch erstattet dieselbe Einheit nicht zweimal.

## Themen und Statistiken lesen

Bewertungen, Mengen, Quellenanteile und Monatsverläufe stammen aus gespeicherten Zeilen. Generierte Themen sind optional und erscheinen nur, wenn sie gespeicherte Bewertungen zitieren; Thementext, der sich nicht belegen lässt, wird verworfen. Schlägt die Themenerstellung fehl, bleiben Ihre Bewertungen und Statistiken verfügbar.

Suche, Filter, gespeicherte Läufe und CSV-Export verbrauchen keine weitere Einheit. Bewertungstext wird immer als reiner Text angezeigt.

## Zeitpunkt selbst wählen

Die Bewertungsanalyse läuft **auf Abruf**. Sie überwacht Einträge nicht ständig, sendet keine Bewertungsalarme und antwortet nicht. Starten Sie bei Bedarf neu. Eine Pause neuer Synchronisierungen lässt gespeicherte Daten sichtbar.

Öffnen Sie den Tab **Bewertungen**, richten Sie mindestens eine Quelle ein, prüfen Sie die Vorschau und bestätigen Sie. Details: [Pläne, Limits & Credits](./plans-limits-credits.de.md).

[Zurück zum Doku-Index](./index.de.md)
