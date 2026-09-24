---
title: 'Keyword-Kannibalisierung'
description: 'Wie RankMeFast Suchanfragen findet, bei denen mehrere Ihrer Seiten konkurrieren, allein anhand bereits gespeicherten Search-Console-Zeilen.'
locale: de
slug: cannibalization
section: product
order: 4
---

# Keyword-Kannibalisierung

Ein Kannibalisierungsbericht liest die `query,page`-Zeilen der Google Search Console, die RankMeFast ohnehin für Ihre Site synchronisiert. Er verursacht keine Anbieterkosten und funktioniert auch, während Google getrennt ist.

<!-- docs-truth: metric=cannibalization_reports; unit=one-report-one-window; cache-hits=count; refund=no-stored-rows-no-unit-consumed; cadence=on-demand; estimates=first-party-gsc-rows -->

## Was ein Bericht zeigt

Für jede Suchanfrage, bei der mindestens zwei Ihrer Seiten erscheinen, sehen Sie die konkurrierenden Seiten mit Klicks, Impressionen, durchschnittlicher Position und Anteil an der Gesamtsumme der Anfrage.

RankMeFast schlägt außerdem vor, welche Seite die Hauptseite sein sollte. Die Auswahl folgt immer derselben Reihenfolge, dieselben Zeilen ergeben also dieselbe Antwort:

1. Die meisten Klicks.
2. Die beste Durchschnittsposition, wenn die Klicks gleich sind.
3. Eine feste Reihenfolge, wenn auch das gleich ist.

## Zeitfenster und Konfidenz

Ein Bericht kann 7, 28 oder 90 Tage gespeicherter Zeilen abdecken. Ein längeres Fenster nutzt einfach mehr von dem, was schon gespeichert ist; es ruft nichts Neues ab.

Jeder Befund erhält hohe, mittlere oder niedrige Konfidenz. Die Stufe zeigt, wie stark die gespeicherten Belege sind (wie viele Zeilen es gibt und wie klar sich die Seiten unterscheiden), nicht, was passiert, wenn Sie handeln.

## Bevor Sie einen Bericht starten

Hat Ihre Site noch keine gespeicherten `query,page`-Zeilen, gibt es nichts auszuwerten. RankMeFast bittet Sie dann, zuerst die Search Console zu synchronisieren, und verbraucht keine Tarifeinheit.

## Was bei Ihnen bleibt

Der Bericht sagt keine Rankingänderungen voraus und ändert nichts an Ihrer Site. Ob Sie eine Seite zusammenführen, weiterleiten oder belassen, entscheiden Sie.

## Tarife und Verfügbarkeit

Die monatlichen Kontingente betragen Starter 4, Pro 20 und Agency 100. Wie Einheiten funktionieren, steht unter [Preise](./pricing.de.md).

Schaltet ein Betreiber `CANNIBALIZATION_ENABLED` ab, werden neue Berichte mit einer lokalisierten Meldung abgelehnt. Vorhandene Berichte bleiben lesbar.

[Zurück zum Doku-Index](./index.de.md)
