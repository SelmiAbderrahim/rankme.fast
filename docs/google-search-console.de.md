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

## Wenn Google zur erneuten Verbindung auffordert
Macht Google den Token ungültig (zum Beispiel nach einer Änderung Ihres Kontopassworts), zeigt die Karte Google Search Console im Tab **Google** der Website eine rote Meldung, **Ihre Google-Verbindung muss erneuert werden**, mit der Schaltfläche **Neu verbinden**. Karten, die Search Console oder Google Analytics lesen, zeigen **Search Console ist nicht verbunden** oder **Google Analytics ist nicht verbunden** mit **Google verbinden**. Bis Sie neu verbinden, zeigen die drei Regeln wieder „unzureichende Daten“.

## Property auswählen
Der Tab **Google** der Website ordnet Ihre Website automatisch einer Search-Console-Property zu. Passt keine oder passen mehrere, bittet RankMeFast Sie um eine Auswahl. Eine Property, die zu einer anderen Website gehört, lässt sich nur nach Ihrer Bestätigung verknüpfen, weil deren Suchdaten dann auf dieser Website erscheinen. Google Analytics funktioniert genauso. Sind die neuesten Google-Analytics-Daten älter als erwartet, weist ein Hinweis darauf hin, und **Aktualisieren** startet die Synchronisierung erneut; RankMeFast synchronisiert außerdem einmal täglich.

## Suchleistung im Seiten-Tab

Der [Leitfaden zur Seitenleistung](./pages-performance.de.md) erklärt, wie der Seiten-Tab gespeicherte Search-Analytics-Zeilen nutzt. Die angezeigte Crawl-Indexierbarkeit stammt aus dem letzten RankMeFast-Crawl und sagt nichts darüber, ob Google die URL indexiert hat.

[Zurück zum Doku-Index](./index.de.md)
