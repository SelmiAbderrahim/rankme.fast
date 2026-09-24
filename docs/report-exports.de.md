---
title: 'Berichte herunterladen und teilen'
description: 'Passendes Format wählen, Filter bewahren und private Freigabelinks verwalten.'
locale: de
slug: report-exports
section: product
order: 12
---

# Berichte herunterladen und teilen

RankMeFast exportiert eine unveränderliche Kopie des angezeigten Berichts. Datei und öffentliche Freigabe behalten Filter, Quelldaten, Kennzeichnungen, Sprache und Branding dieses Snapshots. Ein Export startet keinen neuen Anbieterabruf und verbraucht keine Credits.

## Bericht herunterladen

1. Öffnen Sie einen abgeschlossenen Bericht oder ein gespeichertes Ergebnis.
2. Stellen Sie Zeitraum, Zeilen, Suchmaschine, Gerät, Ort oder Abschnitte ein.
3. Wählen Sie **Herunterladen oder teilen** und ein angebotenes Format.
4. Erneut herunterladen können Sie unter **Exporte → Downloads**.

Das Menü zeigt nur geeignete Formate. Ist die Auswahl zu groß für eine vollständige Darstellung, lehnt RankMeFast den Export ab. Grenzen Sie Filter ein oder nutzen Sie CSV/JSON, wenn dies vorgeschlagen wird. Zeilen werden nie still entfernt.

## Formate nach Berichtstyp

Diese IDs bilden den vollständigen Exportkatalog und stehen auch in versionierten JSON-Dateien.

| Formate | Berichtstypen |
|---|---|
| PDF, CSV, JSON | `audit.run`; `ranks.current`; `ranks.history`; `ranks.serp_features`; `google.gsc_search`; `google.gsc_sitemaps`; `google.gsc_generative_appearance`; `google.ga4`; `keyword.research_result`; `keyword.trends_run`; `keyword.ai_cluster_run`; `keyword.serp_cluster_run`; `keyword.cannibalization`; `backlinks.deep_run`; `backlinks.gap_run`; `backlinks.toxicity_run`; `competitors.organic`; `competitors.tech_stack`; `competitors.traffic_snapshot`; `competitors.traffic_comparison`; `competitors.content_run`; `competitors.landscape_run`; `actions.plan`; `ai.visibility`; `audience.research_run`; `brand.radar_scan`; `content.inventory_run`; `internal_links.run`; `local.seo_snapshot`; `local.reviews`; `local.geogrid_scan`; `pages.performance`; `app.keyword_tracking`; `app.research_result` |
| PDF, JSON | `client.composite`; `backlinks.summary`; `content.recommendation_outcome`; `weekly_pulse.run` |
| PDF, JSON, Markdown | `content.analysis`; `content.brief` |
| CSV, JSON | `backlinks.inventory`; `content.monitor_feed` |
| JSON, JSON-LD | `schema.generation` |
| Klartext | `backlinks.disavow` |

PDF eignet sich zum Lesen und Präsentieren. CSV gibt es nur für echte Tabellen. JSON enthält das vollständige versionierte Berichtsdokument. Markdown, JSON-LD und Disavow-Text gibt es nur für Berichte, die solche Dateien von Natur aus erzeugen.

## Filter, Zeiträume und Quelldaten

Der Snapshot speichert die aktuelle Auswahl. Ein Ranking-Verlauf behält etwa Keyword-IDs und Zeitraum; ein Bewertungsbericht Quelle, Sterne, Suchbegriff und Datum. Jede Darstellung enthält Beobachtungsdatum oder Zeitraum und kennzeichnet Beobachtungen, Ableitungen, Schätzungen und generierten Text. Spätere Bildschirmänderungen verändern den Snapshot nicht.

## Branding und White Label

PDF und öffentliche Ansicht verwenden standardmäßig RankMeFast. Konten mit bereits vorhandenem White-Label-PDF-Recht können Firmenname, Farbe und unterstütztes Logo einsetzen. CSV, JSON, Markdown, JSON-LD und Text haben kein visuelles Branding; Metadaten halten den Modus fest. Ein Export erweitert den Tarif nicht.

## Freigabelinks

Wenn der Bericht teilbar ist, wählen Sie **Teilen**, erlaubte öffentliche Formate und eine Dauer von einem bis 90 Tagen. Standard sind 30 Tage; der Link endet spätestens mit dem Snapshot. Kopieren Sie ihn bei der Anzeige, denn RankMeFast speichert den lesbaren Link nicht für eine spätere Anzeige.

Jeder mit dem Link kann ihn ohne Anmeldung öffnen. Seiten sind noindex und no-store, trotzdem müssen Empfänger sorgfältig gewählt werden. Unter **Exporte → Freigaben** widerrufen Sie sofort. Abgelaufene, widerrufene oder quellenlose Links liefern dieselbe Nicht-gefunden-Antwort.

## Datenschutz und externe Nutzung

Exporte können URLs, Suchanfragen, Textauszüge, Rankings, Bewertungen, First-Party-Analysen und Kundenbranding enthalten. Geben Sie sie nur an Personen weiter, die den Quellbericht sehen dürfen. RankMeFast speichert den erlaubten Snapshot und dessen Inhalts-Hash, nicht Anbieterzugänge, Cookies, rohe Freigabetoken oder Abrechnungsdaten. Snapshots laufen nach 90 Tagen ab und werden bei Löschung von Site oder Konto sofort gesperrt; die physische Bereinigung folgt danach.

CSV ist UTF-8. Zellen mit Formelpräfix (`=`, `+`, `-`, `@`, Tab oder Wagenrücklauf, auch nach Leerzeichen) werden vor der CSV-Quotierung als Text markiert. Behalten Sie diesen Schutz in Excel oder Sheets.

JSON verwendet derzeit `schemaVersion: 1` und einen typbezogenen `kindVersion`. Prüfen Sie beide und lehnen Sie unbekannte Versionen ab. Verlassen Sie sich nicht auf interne IDs oder Dateinamen.

Lassen Sie Disavow-Dateien, Markdown und JSON-LD vor dem Einsatz von einer Person prüfen. RankMeFast reicht keine Disavow-Datei bei Google ein, veröffentlicht kein Markdown und deployt kein JSON-LD für Sie.

[Zurück zum Doku-Index](./index.de.md)
