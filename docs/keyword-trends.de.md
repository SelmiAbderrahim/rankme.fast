---
title: 'Keyword-Trends'
description: 'Untersuchen Sie Suchinteresse, Dynamik und Saisonalität mit klar gekennzeichneten Schätzwerten.'
locale: de
slug: keyword-trends
section: research
order: 9
---

# Keyword-Trends

Keyword-Trends zeigt, wie sich Suchinteresse im Zeitverlauf verändert. Eine Exploration liefert einen relativen Index, den Vorjahrestrend, die jüngste Dynamik und saisonale Monate für bis zu fünf Keywords.

<!-- docs-truth: metric=trend_explorations; unit=one-exploration-up-to-five-keywords; cache-hits=count; refund=provider-failure-zero-retained-series; cadence=on-demand; estimates=required -->

## Was eine Einheit abdeckt

Eine bestätigte Exploration verbraucht eine Einheit `trend_explorations`, unabhängig davon, ob Sie ein oder fünf Keywords eingeben. Vorschau, Abbruch, Öffnen eines gespeicherten Laufs und die Auswahl einer verwandten Anfrage vor der Bestätigung sind kostenlos. Eine bestätigte Folgeanfrage ist eine neue Exploration.

Aktuelle Kontingente und Paketpreise finden Sie unter [Preise](./pricing.de.md).

## Der Index ist eine Schätzung

Jede Reihe und Auswertung ist als **Schätzung** gekennzeichnet. Der Suchinteresse-Index von 0 bis 100 ist relativ zu Markt und Zeitraum. Er ist weder absolutes monatliches Suchvolumen noch Traffic oder Prognose.

- Der Vorjahresvergleich benötigt mindestens 56 gültige Beobachtungen.
- Die Dynamik benötigt 12 Beobachtungen und kann steigen, fallen oder flach sein.
- Saisonalität benötigt 24 unterschiedliche Monate. Fehlt die Historie, weist RankMeFast darauf hin, statt ein Muster zu erfinden.

Eine erfolgreiche Antwort, die flach, dünn oder leer ist, ist ein echtes Ergebnis und kein Fehler.

## Cache und Erstattungen

Ein Cache-Ergebnis verbraucht ebenfalls eine Einheit. Auch eine erfolgreiche Exploration ohne Reihe zählt.

Scheitert die Quelle, bevor eine Reihe gespeichert wurde, wird die reservierte Einheit genau einmal zurückgegeben und der Lauf als erstattet markiert. Sobald eine brauchbare Reihe vorliegt, bleibt die Einheit verbraucht, auch wenn eine andere Auswertung fehlt.

## Wann explorieren

Keyword-Trends läuft **auf Abruf** und überwacht nicht dauerhaft. Starten Sie für eine aktuellere Sicht neu. Bei pausierten neuen Explorationen bleiben gespeicherte Läufe lesbar.

Öffnen Sie **Live-Trends** in der Keyword-Recherche, geben Sie bis zu fünf Begriffe ein, wählen Sie Markt und Sprache, prüfen Sie die Vorschau und bestätigen Sie. Details: [Pläne, Limits & Credits](./plans-limits-credits.de.md).

[Zurück zum Doku-Index](./index.de.md)
