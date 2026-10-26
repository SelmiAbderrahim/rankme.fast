---
title: 'Lokales Raster-Tracking'
description: 'Wie Local-Pack-Raster je Koordinate erhoben werden, wie Sie die Mitte des Rasters wählen und was eine fehlgeschlagene Zelle bedeutet.'
locale: de
slug: geogrid
section: product
order: 9
---

# Lokales Raster-Tracking

Ein Raster-Scan prüft das Local Pack von vielen Punkten rund um einen Ort in einem Durchgang. So sehen Sie, wie sich die Sichtbarkeit über ein Viertel verändert, statt nur an einer Stelle.

<!-- docs-truth: metric=geogrid_scans; unit=one-grid-scan-up-to-49-cells; cache-hits=count; refund=all-cell-failure-only; cadence=on-demand; estimates=provider-observation -->

## Einen Scan starten

Wählen Sie eine Rastergröße (3×3, 5×5 oder 7×7), einen Abstand und eine Zoomstufe. RankMeFast führt je Zelle eine Maps-Prüfung aus, und das ganze Raster zählt als ein abgerechneter Scan.

Für jede Zelle speichert es die gesehene Position, die Größe des Local Packs und den Zeitpunkt der Prüfung. Die Ergebnisse erscheinen als Heat-Raster, immer mit einer barrierefreien Tabelle daneben.

## Eine Zelle lesen

Jede Zelle zeigt eines von drei Dingen:

- eine beobachtete Position
- „nicht im Local Pack“
- eine fehlgeschlagene Prüfung, die keine Position speichert und nie als Rang dargestellt wird

Jede Zelle hat ihre eigene Erfassungszeit. Ein Raster ist eine Reihe zeitnah erhobener Prüfungen, keine einzelne Momentaufnahme des gesamten Gebiets.

## Einheiten und Erstattungen

Ein Scan mit mindestens einer verwertbaren Zelle verbraucht seine Einheit. Erstattet wird nur, wenn alle Zellen fehlschlagen, denn auch ein Teilraster enthält verwertbare Beobachtungen.

## Die Mitte wählen

Die Auswahl **Rastermitte** beginnt bei **Mein Unternehmen**, dem Standort, der mit dem Unternehmen der Website unter [Lokales SEO](./local-seo.de.md) gespeichert ist. Das ist kostenlos, und ohne gespeichertes Unternehmen führt die Auswahl zur Einrichtung von Lokalem SEO. **Ort suchen** sucht nach einem Unternehmensnamen oder einer Straßenadresse. Jede Suche fragt Ihren Anbieter für lokale Einträge einmal ab, und die Wahl eines Treffers füllt nur die Mitte aus: Ihr Unternehmen in Lokalem SEO bleibt unverändert. **Koordinaten eingeben** ist die erweiterte Option, die Mitte des letzten Scans ist einen Klick entfernt (**Mitte des letzten Scans verwenden**). Beim Abstand wählen Sie feste Werte oder einen eigenen Abstand in Kilometern.

## Grenzen

Es gibt keine interaktive Karte zum Anklicken, weil RankMeFast keinen Anbieter für Kartenkacheln nutzt.

Ein Raster zeigt, was der Anbieter zu diesem Zeitpunkt von diesen Koordinaten aus gesehen hat. Es ist keine Prognose und sagt nicht, was eine bestimmte suchende Person sehen wird.

[Zurück zum Doku-Index](./index.de.md)
