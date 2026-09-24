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

[Zurück zum Doku-Index](./index.de.md)
