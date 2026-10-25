---
title: 'Toxische Links und Disavow'
description: 'Wie RankMeFast Backlinks mit festen Regeln in Risikostufen einordnet, wann die KI eine Zeile kommentieren darf und warum die Disavow-Datei nie für Sie eingereicht wird.'
locale: de
slug: toxic-links
section: product
order: 5
---

# Toxische Links und Disavow

Eine Toxizitätsprüfung bewertet bereits abgerufene Backlink-Zeilen nach festen Regeln und lässt Sie dann eine Disavow-Datei im Google-Format erstellen. RankMeFast reicht diese Datei nie ein.

<!-- docs-truth: metric=toxicity_reviews; unit=one-review-up-to-1000-stored-rows; cache-hits=count; refund=provider-failure-zero-retained; cadence=on-demand; estimates=rubric-observation -->

## Wie Zeilen eine Risikostufe erhalten

Die Regeln (Version `toxicity-rubric-v1`) lesen den Spam-Score jeder gespeicherten Backlink-Zeile und ordnen sie der Risikostufe unauffällig, beobachten oder toxisch zu. Signale für defekte Links und nofollow passen die Stufe an.

Die Regeln liefern jedes Mal dasselbe Ergebnis: Dieselben gespeicherten Zeilen und Spam-Scores ergeben immer dieselben Risikostufen, und jede Stufe wird mit den Belegen angezeigt, auf denen sie beruht.

## Was eine Prüfung kostet

Eine Prüfung erfasst bis zu 1.000 bereits abgerufene Zeilen und bezahlt höchstens 100 neue Domain-Spam-Scores. Hat die Site noch keine gespeicherten Backlink-Zeilen, laden Sie zuerst ihre Backlink-Liste.

Zu einer markierten Zeile können Sie eine KI-Begründung anfordern. Sie zitiert entweder genau diese gespeicherte Zeile oder enthält sich. Fällt der Anbieterschritt aus, wird nichts gespeichert und die Einheit zurückgegeben.

## Die Disavow-Datei bauen

1. Schließen Sie jede Zeile ein oder aus.
2. Wählen Sie Domain- oder URL-Geltung.
3. Exportieren Sie eine schlichte `.txt`-Datei im Google-Format. Ausgeschlossene Zeilen fehlen darin.

RankMeFast exportiert die Datei zu Ihrer eigenen Prüfung und Einreichung bei Google. Es ist nicht mit dem Disavow-Werkzeug der Search Console verbunden und kann nichts in Ihrem Namen hochladen.

## Ehrliche Grenzen

Eine Risikostufe beschreibt, was die Regeln in einem Link gefunden haben. Sie ist nie eine Vorhersage einer Google-Abstrafung, einer manuellen Maßnahme oder einer Ranking-Änderung.

Die KI darf eine Zeile kommentieren, die die Regeln bereits markiert haben, aber niemals eine Domain hinzufügen, die die Regeln nicht markiert haben. Jede Domain im Export lässt sich auf eine gespeicherte Zeile zurückführen.

Vergleichen Sie diese Anleitung vor einer Änderung mit den gespeicherten Belegen und dem in RankMeFast angezeigten Status.

Einheiten und Tarifgrenzen finden Sie unter [Preise](./pricing.de.md).

[Zurück zum Doku-Index](./index.de.md)
