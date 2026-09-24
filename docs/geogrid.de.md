---
title: 'Lokales Raster-Tracking'
description: 'Wie Local-Pack-Raster je Koordinate erhoben werden, was eine fehlgeschlagene Zelle bedeutet und warum Koordinaten eingetippt statt auf einer Karte gewählt werden.'
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

Der Agency-Tarif enthält 6 Scans pro Monat. Pro erhält Raster über das Guthabenpaket `geogrid-scans-10`, Starter hat kein Rasterkontingent.

Einheiten und Tarifgrenzen finden Sie unter [Preise](./pricing.de.md).

## Grenzen

Koordinaten tippen Sie von Hand ein. RankMeFast nutzt keinen Kartenkachel-Anbieter, daher gibt es keine interaktive Karte zum Anklicken.

Ein Raster zeigt, was der Anbieter zu diesem Zeitpunkt von diesen Koordinaten aus gesehen hat. Es ist keine Prognose und sagt nicht, was eine bestimmte suchende Person sehen wird.

[Zurück zum Doku-Index](./index.de.md)
