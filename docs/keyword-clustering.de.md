---
title: 'Keyword-Clustering'
description: 'Wie RankMeFast verfolgte Keywords anhand gemeinsamer Ergebnis-URLs gruppiert und warum das Arithmetik ist und kein Ähnlichkeitswert.'
locale: de
slug: keyword-clustering
section: product
order: 2
---

# Keyword-Clustering

Das Clustering gruppiert Ihre verfolgten Keywords danach, wie viele Ergebnis-URLs sie teilen. Es arbeitet nur mit SERP-Beobachtungen, die RankMeFast bereits gespeichert hat, und startet nie eine Rankingprüfung, um eine Lücke zu füllen.

<!-- docs-truth: metric=keyword_cluster_runs; unit=one-run-up-to-200-keywords; cache-hits=count; refund=none-blocked-keywords-are-reported; cadence=on-demand; estimates=shared-url-arithmetic -->

## Wie ein Cluster entsteht

1. Für jedes Keyword nimmt RankMeFast die obersten 10 Ergebnis-URLs aus seiner jüngsten gespeicherten Beobachtung.
2. Zwei Keywords werden verbunden, wenn sie mindestens 3 dieser URLs teilen.
3. Verbindungen setzen sich fort: Ist A mit B und B mit C verbunden, landen alle drei im selben Cluster.

Ein Lauf umfasst bis zu 200 Keywords. Die Zugehörigkeit ist reine Rechnung mit gemeinsamen URLs, dieselben gespeicherten Beobachtungen ergeben also immer dieselben Cluster.

## Welche Keywords teilnehmen

Nur Google-Keywords mit einer Beobachtung aus den letzten 7 Tagen nehmen teil. Vor dem Start zeigt Ihnen eine Vorprüfung, welche Keywords infrage kommen.

Keywords, die nicht teilnehmen können, werden mit Grund aufgeführt (fehlend, veraltet oder leer), statt einfach zu verschwinden. Der Lauf verbraucht seine Einheit ab dem Start, und für blockierte Keywords gibt es keine Erstattung.

## Namen

Die KI-Laufzeit kann für jedes Cluster einen Namen vorschlagen, gekennzeichnet mit einer KI-Markierung. Schlägt die Benennung fehl, erhalten Sie Cluster ohne Namen. An der Gruppierung ändert das nichts, denn sie hängt nie vom Modell ab.

Drei gemeinsame URLs sind eine Schwelle, kein Ähnlichkeitswert, und ein Cluster sagt nichts über die Suchintention aus. RankMeFast erfindet nie ein Keyword, eine URL oder eine Beobachtung, um eine Gruppe aufzufüllen.

## Tarife und Verfügbarkeit

Monatliche Kontingente je Tarif:

- Starter: 0
- Pro: 4
- Agency: 20

Ein Betreiber kann das Clustering mit dem Flag `KEYWORD_CLUSTERING_ENABLED` abschalten. Neue Läufe werden dann mit einer lokalisierten Meldung abgelehnt, vorhandene Cluster bleiben lesbar. Wie Einheiten funktionieren, steht unter [Preise](./pricing.de.md).

[Zurück zum Doku-Index](./index.de.md)
