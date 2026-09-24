---
title: 'Toxische Links und Disavow'
description: 'Wie RankMeFast Backlinks mit einem deterministischen Regelwerk einstuft, wann die KI eine Zeile kommentieren darf und warum die Disavow-Datei nie für Sie eingereicht wird.'
locale: de
slug: toxic-links
section: product
order: 5
---

# Toxische Links und Disavow

Eine Toxizitätsprüfung bewertet bereits abgerufene Backlink-Zeilen anhand eines festen Regelwerks. Daraus können Sie eine Disavow-Datei im Google-Format bauen. RankMeFast reicht sie nie für Sie ein.

<!-- docs-truth: metric=toxicity_reviews; unit=one-review-up-to-1000-stored-rows; cache-hits=count; refund=provider-failure-zero-retained; cadence=on-demand; estimates=rubric-observation -->

## Wie Zeilen eingestuft werden

Das Regelwerk `toxicity-rubric-v1` liest den Spam-Score des Anbieters zu jeder gespeicherten Backlink-Zeile und ordnet die Zeile einem der Bänder sauber, beobachten oder toxisch zu. Signale für tote Links und nofollow können das Band verschieben.

Dieselben Zeilen mit denselben Spam-Scores landen immer in denselben Bändern, und jedes Band steht neben dem Beleg, auf dem es beruht.

## Was eine Prüfung kostet

Eine Prüfung erfasst bis zu 1.000 bereits abgerufene Zeilen und bezahlt höchstens 100 neue Domain-Spam-Scores. Hat die Site noch keine gespeicherten Backlink-Zeilen, laden Sie zuerst ihre Backlink-Liste.

Zu einer markierten Zeile können Sie eine KI-Begründung anfordern. Sie zitiert entweder genau diese gespeicherte Zeile oder enthält sich. Fällt der Anbieterschritt aus, wird nichts gespeichert und die Einheit zurückgegeben.

## Die Disavow-Datei bauen

1. Schließen Sie jede Zeile ein oder aus.
2. Wählen Sie Domain- oder URL-Geltung.
3. Exportieren Sie eine schlichte `.txt`-Datei im Google-Format. Ausgeschlossene Zeilen fehlen darin.

RankMeFast exportiert die Datei zu Ihrer eigenen Prüfung und Einreichung bei Google. Es ist nicht mit dem Disavow-Werkzeug der Search Console verbunden und kann nichts in Ihrem Namen hochladen.

## Was ein Band bedeutet

Ein Band ist die Einschätzung des Regelwerks zu einem Link. Es sagt keine Google-Strafe, keine manuelle Maßnahme und keine Rankingänderung voraus.

Die KI kann eine Zeile kommentieren, die das Regelwerk bereits markiert hat, aber keine Domain hinzufügen, die es nicht markiert hat. Jede Domain im Export lässt sich auf eine gespeicherte Zeile zurückführen.

Einheiten und Tarifgrenzen finden Sie unter [Preise](./pricing.de.md).

[Zurück zum Doku-Index](./index.de.md)
