---
title: 'Bing-, YouTube- und Amazon-Tracking'
description: 'Wie RankMeFast Nicht-Google-Engines verfolgt, was ein exaktes Ziel-Token ist und warum eine Amazon-Position eine Indexposition ist.'
locale: de
slug: alt-engine-tracking
section: product
order: 3
---

# Bing-, YouTube- und Amazon-Tracking

Keywords für andere Suchmaschinen legen Sie über den gewohnten Ablauf zum Hinzufügen an, mit einer Engine-Auswahl. Der Rankingverlauf ist nach Engine markiert, und die Verlaufsansicht hat einen Engine-Filter, der in der URL gespeichert wird.

<!-- docs-truth: metric=alt_engine_checks; unit=one-keyword-one-engine-check; cache-hits=count; refund=provider-failure-zero-retained; cadence=weekly; estimates=provider-observation -->

## Wie jede Engine zugeordnet wird

- **Bing** funktioniert wie Google: Ein Ergebnis ist Ihres, wenn sein normalisierter Host dem Host Ihrer Site entspricht.
- **YouTube** wird über ein exaktes Kanal-Handle zugeordnet.
- **Amazon** wird über eine exakte ASIN zugeordnet.

Jedes YouTube- oder Amazon-Ergebnis liegt auf der Domain der Plattform, ein Abgleich über den Host wäre also nutzlos. Einen unscharfen Markenabgleich versucht RankMeFast ebenfalls nicht.

Ohne exaktes Handle oder exakte ASIN wird nicht geraten. Das Keyword lässt sich auf dieser Engine dann schlicht nicht verfolgen, bis Sie eines ergänzen.

## Frequenz und Einheiten

Nicht-Google-Ziele werden einmal pro Woche geprüft, unabhängig von der sonstigen Frequenz der Site. Jede Prüfung aus Keyword und Engine reserviert vor dem Aufruf eine Einheit für alternative Engines.

Auch zwischengespeicherte Ergebnisse zählen auf Ihr Kontingent. Fällt der Anbieter aus, wird nichts gespeichert und Sie erhalten die Einheit zurück.

## Amazon-Positionen lesen

Eine Amazon-Position ist ein Platz im Produktindex, den der Anbieter liefert, keine Live-Regalposition. Gesponserte Blöcke werden vor der Platzierung entfernt.

Wie bei jeder Engine ist eine Position das, was an einem bestimmten Datum beobachtet wurde. Eine Prognose ist sie nicht.

## Tarife und Verfügbarkeit

Die monatlichen Kontingente betragen Starter 0, Pro 20 und Agency 240. Reicht das nicht, kann ein einmaliges Guthabenpaket aufstocken.

Ein Betreiber kann die Funktion mit dem Flag `ALT_ENGINE_TRACKING_ENABLED` abschalten. Neue Läufe werden dann mit einer lokalisierten Meldung abgelehnt, der vorhandene Verlauf bleibt lesbar.

Einheiten und Tarifgrenzen finden Sie unter [Preise](./pricing.de.md).

[Zurück zum Doku-Index](./index.de.md)
