---
title: 'Benachrichtigungen'
description: 'Welche Benachrichtigungen heute auslösen, wie Exactly-once-Zustellung funktioniert und warum eine Ranking-Abfall-Regel konfigurierbar ist, bevor sie zustellen kann.'
locale: de
slug: alerts
section: product
order: 6
---

# Benachrichtigungen

Sie legen Benachrichtigungsregeln je Site an. Zugestellt wird per E-Mail, per Slack-Incoming-Webhook oder per generischem Webhook mit HMAC-Signatur. Zustellungen werden nicht abgerechnet.

<!-- docs-truth: metric=none; unit=none-deliveries-not-metered; cache-hits=not-applicable; refund=not-applicable; cadence=on-observed-transition; estimates=provider-observation -->

## Was heute auslöst

Benachrichtigungen zu neuen und verlorenen verweisenden Domains. Sie lösen aus, nachdem zwei Linkprüfungen hintereinander abgeschlossen wurden, und jede Nachricht enthält den Vorher-Nachher-Beleg, der sie ausgelöst hat.

Ranking-Abfall-Regeln lassen sich ebenfalls anlegen und speichern, stellen aber aus bestätigten Abfall-Beobachtungen zu, die die ausgelieferte Rankingpipeline noch nicht erzeugt. Backlink-Änderungen sind der Kanal, der heute auslöst.

## Eine Nachricht je Änderung

Jede beobachtete Änderung wird genau einmal zugestellt, als eine Nachricht und nicht eine pro Domain. Bringt eine Prüfung 300 neue Links, erhalten Sie eine einzige Nachricht mit einer Stichprobe von bis zu 50 Domains und der vollständigen Anzahl.

Ihre erste Linkprüfung hat nichts zum Vergleichen und löst daher nie eine Nachricht aus. Das Zustellprotokoll hält jeden Versuch als gesendet, fehlgeschlagen oder unterdrückt fest.

Fällt ein Transport aus, wird die Zustellung als fehlgeschlagen protokolliert, statt endlos wiederholt zu werden. Dieselbe Änderung wird nie als zweite Nachricht verschickt.

## Kanäle und Regelgrenzen

E-Mail gibt es in jedem kostenpflichtigen Tarif; Slack und der generische Webhook setzen Pro oder höher voraus. Sie können bis zu 2 Regeln in Starter, 10 in Pro und 50 in Agency anlegen.

Für Slack fügen Sie eine Incoming-Webhook-URL ein. Eine RankMeFast-Slack-App oder einen Bot gibt es nicht.

Generische Webhooks sind signiert, damit Ihr Empfänger prüfen kann, dass eine Nutzlast wirklich von RankMeFast stammt.

## Was eine Benachrichtigung bedeutet

Eine Benachrichtigung zeigt, dass sich zwischen zwei gespeicherten Momentaufnahmen etwas geändert hat. Sie bewertet weder die Linkqualität noch sagt sie eine Wirkung auf Rankings voraus.

Einheiten und Tarifgrenzen finden Sie unter [Preise](./pricing.de.md).

[Zurück zum Doku-Index](./index.de.md)
