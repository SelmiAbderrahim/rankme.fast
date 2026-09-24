---
title: 'Markenradar'
description: 'Prüfen Sie eine Markenanfrage auf Abruf, untersuchen Sie gespeicherte Erwähnungen und verstehen Sie Add-on und Erstattung.'
locale: de
slug: brand-radar
section: research
order: 11
---

# Brand Radar

Brand Radar sucht öffentliche Erwähnungen einer Markenanfrage, speichert brauchbare Zeilen und berechnet Anzahl, Stimmung, Top-Domains und die Veränderung zur vorherigen abgeschlossenen Prüfung derselben Anfrage auf derselben Website. Auf Wunsch entsteht auch ein kurzer Digest mit Quellen.

Öffnen Sie eine Website und wählen Sie den Tab **Brand Radar**. Jede Prüfung gehört zu dieser Website; zwei Websites mit derselben Marke behalten getrennte Listen und getrennte Vergleichswerte.

Das optionale Feld **Land der veröffentlichenden Website** ist durchsuchbar. Es filtert nach dem Registrierungsland der Website, auf der die Erwähnung erschien, nicht nach dem Standort der Leser. Wählen Sie **Alle Länder** für eine weltweite Prüfung. Ältere Scans, die nur eine ungenutzte Standortnummer speicherten, erscheinen als weltweit, weil diese Nummer ihre Ergebnisse nie beeinflusst hat.

<!-- docs-truth: metric=brand_mention_scans; unit=one-scan-one-brand-query; cache-hits=not-applicable-fresh-required; refund=search-provider-failure-zero-retained; cadence=on-demand; estimates=ai-digest-labeled -->

## Was eine Einheit abdeckt

Ein bestätigter Scan einer Markenanfrage verbraucht eine Einheit `brand_mention_scans`. Optionale Filter für Sprache und Land der veröffentlichenden Website sowie der belegte Digest sind enthalten. Wettbewerberanfragen lassen sich nicht in dieselbe Einheit bündeln.

Vorschau und Abbruch sind kostenlos. Die Vorschau zeigt immer einen neuen Abruf, weil Erwähnungen zu Ihrem Konto gehören und nie für andere Konten zwischengespeichert werden. Basisgrenzen, Brand-Radar-Add-on und Pakete finden Sie unter [Preise](./pricing.de.md).

## Erstattungen und Teilergebnisse

Sie erhalten die Einheit nur dann (einmalig) zurück, wenn die erste Erwähnungssuche bei der Quelle fehlschlägt und RankMeFast keine Erwähnung speichert.

In diesen Fällen wird die Einheit trotzdem verbraucht:

- erfolgreiche Suche ohne Erwähnungen;
- gespeicherte Erwähnungen vor einem späteren Quellen- oder Budgetstopp;
- fehlgeschlagene Zusammenfassung oder Digest-Erstellung;
- alle Digest-Sätze werden wegen nicht prüfbarer Belege verworfen.

RankMeFast löscht gefundene Erwähnungen nicht, nur um eine Erstattung zu ermöglichen.

## Fakten und generierten Text trennen

Anzahl, Stimmung, Top-Domains und Änderung zur vorherigen gleichen Anfrage werden aus gespeicherten Zeilen berechnet. Ohne vorherigen Scan sehen Sie „noch kein Vergleich“ statt einer Null.

Digest-Sätze schreibt die KI; sie erscheinen nur, wenn sie gespeicherte Erwähnungen zitieren. Bleibt kein verlässlicher Satz übrig, wird das angezeigt. Erwähnungen lassen sich prüfen und als CSV exportieren.

## Zeitpunkt selbst wählen

Brand Radar läuft **auf Abruf**, nicht als Dauerüberwachung. Starten Sie für eine neue Beobachtung erneut. Weekly Pulse kann gespeicherte Unterschiede derselben Website zusammenfassen, startet aber keinen Scan und verbraucht keine Einheit. Bei einer Pause bleiben gespeicherte Daten lesbar.

Details stehen unter [Pläne, Limits & Credits](./plans-limits-credits.de.md).

[Zurück zum Doku-Index](./index.de.md)
