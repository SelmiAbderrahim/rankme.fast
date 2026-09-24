---
title: 'Looker Studio verbinden'
description: 'Kopiere den schreibgeschützten RankMeFast-Connector nach Apps Script und nutze gespeicherte SEO-Daten in Looker Studio. Agency-Funktion.'
locale: de
slug: looker-studio
section: developers
order: 4
---

# Looker Studio verbinden

Der Community-Connector lässt ein **Agency**-Konto bereits gespeicherte Daten der eigenen RankMeFast-Instanz lesen. Er startet keinen Check, ruft keinen Anbieter auf und verbraucht keine Nutzungsmetrik. Die vorhandenen Limits pro IP und API-Schlüssel gelten weiter. Der zugrunde liegende Vertrag steht in der [öffentlichen API](./public-api.de.md).

## Vorbereitung

Der Betreiber muss `PUBLIC_EXPORTS_ENABLED` aktivieren. Erstelle unter **Konto → API-Schlüssel** einen Schlüssel und kopiere ihn bei der einmaligen Anzeige; danach speichert RankMeFast nur den SHA-256-Hash. Außerdem brauchst du den HTTPS-Ursprung der Instanz ohne `/api/v1`.

## Installation und Verbindung

1. Erstelle ein Google-Apps-Script-Projekt.
2. Kopiere `tools/looker-connector/Code.gs` in den Editor und `appsscript.json` in den Manifest-Editor.
3. Erstelle eine Community-Connector-Testbereitstellung und öffne sie in Looker Studio.
4. Trage den API-Schlüssel in Googles separater **Key**-Authentifizierung ein, niemals in Konfiguration oder Quelltext.
5. Trage Instanz-URL und Datensatz ein. Rangverlauf, SERP-Funktionen und Backlink-Zeilen benötigen die 24-stellige Site-ID. Der Engine-Filter bietet Alle, Google, Bing, YouTube und Amazon.

Die Instanz wird beim Einrichten angegeben; der Connector enthält keinen festen API-Ursprung. Der Rangverlauf folgt `X-Next-Cursor`-Seiten mit 10 Keyword-Gruppen; Keywords, SERP-Funktionen und Backlink-Zeilen nutzen Seiten mit 1.000 Zeilen. Alle enden bei 10.000 Zeilen pro Aktualisierung, und ein wiederholter Cursor führt zu einem Fehler statt zu einer Schleife. Liefert Looker einen Datumsbereich, werden seine inklusiven Grenzen auf jeder Rangverlaufsseite weitergegeben.

## Feldzuordnung

| Datensatz | API-Route | Looker-Feld-IDs |
|---|---|---|
| Sites | `/api/v1/sites` | `id`, `domain`, `url`, `paused`, `created_at` |
| Rangverlauf | `/api/v1/sites/:siteId/rank-history` | `keyword_id`, `phrase`, `engine`, `checked_at`, `position`, `rank_absolute`, `source`, `found_url`, `ai_overview_present`, `ai_cited`, `ai_cited_url` |
| Keywords | `/api/v1/keywords` | `id`, `site_id`, `phrase`, `location_code`, `language_code`, `device`, `active`, `created_at`, `updated_at`, `latest_position`, `previous_position`, `delta`, `last_checked_at`, `ai_overview_present`, `ai_cited`, `ai_cited_url`, `track_local_pack`, `last_failed_check_at`, `engine`, `engine_target` |
| SERP-Funktionen | `/api/v1/serp-features?siteId=…` | `id`, `site_id`, `keyword_id`, `engine`, `checked_at`, `source`, `features_json`, `top_results_json`, `created_at`, `source_kind` |
| Backlink-Zeilen | `/api/v1/backlink-rows?siteId=…` | `id`, `review_id`, `site_id`, `url`, `domain`, `spam_score`, `rubric_band`, `rubric_version`, `first_seen`, `last_seen`, `dofollow`, `is_broken`, `rationale`, `rationale_status`, `captured_at`, `source_kind` |

`source_kind=provider_observation` kennzeichnet eine gespeicherte Anbieterbeobachtung und keine Schätzung. JSON-Felder bleiben Text; formelähnliche Werte bleiben neutralisiert.

## Fehler und Sicherheit

`401` bedeutet fehlender oder widerrufener Schlüssel, `402` kein Agency-Plan, `404` fremde Site, `429` ausgeschöpftes API-Limit und `503` deaktivierte Exporte. Nutze HTTPS, widerrufe offengelegte Schlüssel sofort und erstelle getrennte Looker-Datenquellen je Site oder Datensatz.

Das Artefakt folgt Googles [Build-Anleitung](https://developers.google.com/looker-studio/connector/build), [Authentifizierung](https://developers.google.com/looker-studio/connector/auth), [API-Referenz](https://developers.google.com/looker-studio/connector/reference) und [Manifest-Referenz](https://developers.google.com/looker-studio/connector/manifest), abgerufen am 2026-08-04. Eine Galerie-Veröffentlichung ist nicht enthalten.

[Zurück zum Dokumentationsindex](./index.de.md)
