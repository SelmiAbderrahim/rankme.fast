---
title: 'Google Search Console verbinden'
description: 'Warum verbinden, worauf wir zugreifen, wie trennen.'
locale: de
slug: google-search-console
section: research
order: 3
---

# Google Search Console verbinden

Die Search Console ist das kostenlose Google-Tool, das zeigt, wie Google Ihre Website sieht. Nach dem Verbinden stützen sich drei Regeln auf Googles eigene Antwort statt auf eine Schätzung.

## Zugriff
- Nur der **Lese**-Scope `webmasters.readonly`.
- Kein Zugriff auf Gmail oder Drive. Wir speichern nur einen verschlüsselten Refresh-Token.

## Verbinden
1. Einstellungen → Google Search Console.
2. Auf **Google Search Console verbinden** klicken.
3. Bei Google anmelden und den Zugriff erlauben.

## Trennen
Klicken Sie auf **Trennen**. Der Token wird sofort gelöscht. Sie können den Zugriff auch jederzeit über https://myaccount.google.com/permissions widerrufen.

## „Erneut verbinden"
Wird der Token ungültig, erscheint ein rotes Banner. Bis Sie neu verbinden, zeigen die drei Regeln wieder "unzureichende Daten".

## Suchleistung im Seiten-Tab

Der [Leitfaden zur Seitenleistung](./pages-performance.de.md) erklärt, wie der Seiten-Tab gespeicherte Search-Analytics-Zeilen nutzt. Die angezeigte Crawl-Indexierbarkeit stammt aus dem letzten RankMeFast-Crawl und sagt nichts darüber, ob Google die URL indexiert hat.

[Zurück zum Doku-Index](./index.de.md)
