---
title: 'Ihr Audit-Bericht'
description: 'Jetzt beheben, Beobachten, Bestanden: was die Tabs und jede Regel bedeuten.'
locale: de
slug: audit-report
section: start
order: 2
---

# Ihr Audit-Bericht

Nach jedem Audit landen Sie auf einem Bericht mit drei Tabs und der Schaltfläche **Erneut prüfen**.

## Die drei Tabs
- **Jetzt beheben**: Probleme, auf die Google am schnellsten reagiert.
- **Beobachten**: kleinere Punkte oder Prüfungen ohne ausreichende Daten.
- **Bestanden**: alles, was Ihre Website erfüllt.

## Was ein Befund zeigt
- **Titel**: der Name des Problems in einfachen Worten.
- **Warum das wichtig ist**: ein Satz zur Wirkung.
- **Betroffene URLs**: die Seiten, auf denen wir das Problem gefunden haben.
- **So beheben Sie es**: die konkrete Änderung, mit Kopier-Button.

## Erneut prüfen und Änderungs-Badges
Klicken Sie nach einer Korrektur auf **Erneut prüfen**. Zwei Badges können erscheinen:
- **Behoben**: die Regel besteht jetzt.
- **Verschlechtert**: die Regel schlägt neu fehl.

## `llms.txt`-Datei
Eine neuere Konvention, die KI-Assistenten auf Ihre bevorzugten Seiten hinweist. Bei uns ist diese Regel **nur ein Hinweis**.

## Jede Regel in einfacher Sprache
- **Von Google blockiert**: Eine `robots.txt`-Regel sperrt Google aus.
- **Sitemap fehlt oder schwach**: Fügen Sie `sitemap.xml` hinzu und verweisen Sie in `robots.txt`.
- **Titel fehlen oder schwach**: Eindeutiger Titel 30 – 60 Zeichen pro Seite.
- **Meta-Beschreibungen fehlen oder doppelt**: Eine eindeutige Beschreibung pro Seite.
- **Überschriften schwach**: Genau ein `<h1>` pro Seite.
- **Canonical fehlt oder defekt**: Setzen Sie einen gültigen `<link rel="canonical">`.
- **Strukturierte Daten fehlen**: Fügen Sie passendes JSON-LD hinzu.
- **Defekte interne Links**: Korrigieren oder entfernen Sie fehlerhafte Links.
- **Dünner Inhalt**: Seiten unter etwa 200 Wörtern.
- **Keine FAQ-Signale**: FAQ-Abschnitt hinzufügen, wo sinnvoll.
- **llms.txt fehlt (Hinweis)**: Neue Konvention für KI-Crawler.
- **HTTPS nicht erzwungen**: Leiten Sie http auf https um.
- **Schlechte reale Performance**: Chrome-UX-Daten zeigen langsames Erlebnis.
- **Niedrige Laborschätzung**: Ein Lighthouse-Lauf variiert stark.
- **Nicht mobilfreundlich**: Viewport und Tap-Targets prüfen.
- **Nicht indexiert**: Google hat die Seite nicht aufgenommen.
- **Rich-Results-Fehler**: Fehler in strukturierten Daten.
- **Indexiert mit Warnung**: Canonical-/Duplikat-Signal.
- **Seiten, die mit einem Fehler antworten**: Gecrawlte Adressen mit Fehler (4xx oder 5xx). Stellen Sie die Seite wieder her oder leiten Sie die Adresse um. Abweisungen (401, 403 oder 429) können Bot-Schutz sein, prüfen Sie diese zuerst im Browser.
- **Weiterleitungsketten und -schleifen**: Adressen mit zwei oder mehr Weiterleitungen oder ganz ohne Ziel. Leiten Sie die erste Adresse direkt auf die endgültige Seite.
- **Links, die auf Weiterleitungen zeigen**: Interne Links, deren Ziel weiterleitet. Verlinken Sie direkt die endgültige Adresse.
- **Seiten, die per Refresh-Tag weiterleiten**: Ein `<meta http-equiv="refresh">`-Tag leitet weiter. Nutzen Sie stattdessen eine permanente (301) Server-Weiterleitung.
- **Canonical-Tags, die an die falsche Stelle verweisen**: Canonical auf eine defekte Seite, eine Weiterleitung, einen weiteren Canonical oder hin und her. Verweisen Sie auf eine funktionierende Seite, die sich selbst angibt.
- **Seiten, auf die keine andere Seite verlinkt**: Seiten aus Ihrer Sitemap ohne internen Link. Verlinken Sie sie von einer passenden Seite oder einem Menü.
- **Seiten tief in der Website vergraben**: Mehr als drei Klicks von der Startseite entfernt. Holen Sie wichtige Seiten näher heran.
- **Seiten mit demselben Titel**: Zwei oder mehr Seiten mit gleichem `<title>`. Geben Sie jeder Seite einen eigenen.
- **Seiten, die wie Kopien voneinander wirken**: Nahezu identische Seiten mit einem Ähnlichkeitswert von höchstens zehn. Führen Sie sie zusammen oder machen Sie jede eigenständig.
- **Platzhaltertext auf veröffentlichten Seiten**: Fülltext wie „Lorem ipsum“ auf einer veröffentlichten Seite. Ersetzen Sie ihn durch den echten Text.
- **Sichere Seiten mit Verweisen auf unsichere Adressen**: HTTPS-Seiten verlinken auf `http://`-Adressen. Stellen Sie diese auf `https://` um.
- **Bilder ohne Alt-Text**: Bilder ohne `alt`-Attribut. Beschreiben Sie wichtige Bilder, dekorative erhalten ein leeres `alt`.
- **Seiten, die nur langsam zu laden beginnen**: Mehr als 1,5 Sekunden bis zum ersten Byte oder mehr als drei Sekunden für die Seite. Ein einzelner Lab-Ladevorgang, nicht das Erlebnis jedes Besuchers.
- **Sehr große Seiten**: HTML über 1 MB. Ab 3 MB rückt der Befund zu „Jetzt beheben“.
- **Seiten ohne Komprimierung ausgeliefert**: HTML ohne gzip- oder Brotli-Komprimierung. Aktivieren Sie die Komprimierung am Server.
- **Skripte und Styles, die die erste Anzeige verzögern**: Dateien, die die erste Darstellung blockieren, samt Anzahl. Laden Sie Skripte mit `async` oder `defer`.
- **Seiten ohne grundlegende HTML-Angaben**: Keine `<!DOCTYPE html>`-Zeile oder keine Zeichensatz-Angabe.
- **Veraltetes HTML auf Ihren Seiten**: Entfernte Tags, Flash oder Frames. Frames wie eingebettete Videos können in Ordnung sein, prüfen Sie sie also, statt sie zu entfernen.
- **Schwer lesbare Adressen**: Adressen mit ungewöhnlichen Zeichen, Abfrageparametern oder mehr als 120 Zeichen.
- **Seiten ohne Tags zum Teilen in sozialen Netzwerken**: Keine Open-Graph-Tags, daher zeigt ein geteilter Link womöglich den falschen Titel, Text oder ein falsches Bild.
- **Kein Favicon**: Kein kleines Website-Symbol für Browser-Tabs und Suchergebnisse.
- **Defekte Bilder, Skripte oder Styles**: Benötigte Dateien, die mit einem Fehler antworten. Läuft nur bei einem Audit, das mit dem Ressourcen-Scan gestartet wurde, sonst steht die Prüfung unter „Nicht geprüft“.
- **Bilder, die größer als nötig sind**: Bilder über 500 KB. Läuft wie die Prüfung darüber mit dem vollständigen Ressourcen-Scan.
- **Dateien, die Browser nicht speichern sollen**: Bilder, Skripte und Stylesheets mit Headern, die das Caching im Browser verhindern. Läuft mit dem vollständigen Ressourcen-Scan.

## Bilder, Skripte und Styles prüfen

Die letzten drei Prüfungen müssen jedes Bild, jedes Skript und jedes Stylesheet Ihrer Seiten laden. Dadurch wird der Crawl langsamer und verbraucht mehr von Ihrem Crawl-Budget, deshalb hat jedes Audit dafür eine eigene Option.

- **Bilder, Skripte und Styles prüfen** ist beim Start eines Audits standardmäßig angehakt. Entfernen Sie das Häkchen, um die Prüfung für diesen Lauf zu überspringen.
- Ein Audit mit dieser Prüfung lädt die Dateien für höchstens 1.000 Seiten. Weitere Seiten werden trotzdem gecrawlt, aber ohne ihre Dateien.
- Lässt sich das Ergebnis nicht auslesen, wird das Audit trotzdem fertig, und die drei Prüfungen stehen mit Grund unter „Nicht geprüft“.
- Ein Audit ohne diese Prüfung führt die drei Prüfungen unter „Nicht geprüft“ auf. Starten Sie ein neues Audit mit gesetztem Häkchen, um sie einzubeziehen.

[Zurück zum Doku-Index](./index.de.md)
