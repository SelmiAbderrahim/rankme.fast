---
title: 'SERP-Feature-Erfassung'
description: 'Was RankMeFast bei jeder Rankingprüfung über Suchergebnis-Features festhält und wo diese Daten enden.'
locale: de
slug: serp-features
section: product
order: 1
---

# SERP-Feature-Erfassung

Jede Rankingprüfung, die RankMeFast ausführt, hält auch fest, welche Suchergebnis-Features für dieses Keyword zu sehen waren. Das kostet nichts extra, und die Prüfung fordert beim Anbieter nicht mehr Ergebnisse an als sonst.

<!-- docs-truth: metric=none; unit=byproduct-of-serp_checks; cache-hits=count; refund=not-applicable; cadence=follows-rank-check; estimates=provider-observation -->

## Was erfasst wird

Zu jeder Prüfung notiert RankMeFast, ob eines dieser Elemente auf der Ergebnisseite stand:

- ein Featured Snippet
- ein „Ähnliche Fragen“-Block
- ein Local Pack
- Video-, Bild- oder Shopping-Ergebnisse
- ein Knowledge-Graph-Kasten

Dazu speichert es die organischen Ergebnisse, bis zu 100 Zeilen.

Ein Feature gilt als Ihres, wenn sein Host nach der Normalisierung exakt mit dem Host Ihrer Site übereinstimmt. Alles andere wird als vorhanden erfasst, aber nicht Ihnen zugeordnet.

## Verlauf

Jedes verfolgte Keyword hat einen Verlauf Prüfung für Prüfung. Sie können ihn als Punktmatrix lesen oder als Tabelle, die dieselben Daten enthält und besser mit Screenreadern und Exporten funktioniert.

Beobachtungen bleiben 90 Tage erhalten, dazu die neuesten 30 Prüfungen je Keyword. Ältere Zeilen fallen weg und lassen sich nicht wiederherstellen.

## Grenzen

Weil die Rankingprüfung keine zusätzliche Tiefe anfordert, kann eine Live-Prüfung weniger als 100 organische Zeilen liefern.

RankMeFast kann nur sagen, dass ein Feature in einer gespeicherten Prüfung **beobachtet** oder **nicht beobachtet** wurde. Das beweist nicht, dass Google es nie zeigt, und Lücken bleiben Lücken: Es wird nichts geschätzt, um sie zu füllen.

## Verfügbarkeit

Ein eigenes Kontingent gibt es nicht, die Erfassung läuft mit den Rankingprüfungen, die Ihr Tarif ohnehin enthält. Ein Betreiber kann sie mit dem Flag `SERP_FEATURE_TRACKING_ENABLED` abschalten. Dann werden neue Läufe mit einer Meldung in Ihrer Sprache abgelehnt, gespeicherte Ergebnisse bleiben lesbar. Einheiten und Tarifgrenzen finden Sie unter [Preise](./pricing.de.md).

[Zurück zum Doku-Index](./index.de.md)
