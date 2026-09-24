---
title: 'Öffentliche API'
description: 'Lesen Sie Ihre Sites, Berichte, Rankings und Keywords über eine einfache, schlüssel-authentifizierte API. Agency-Funktion.'
locale: de
slug: public-api
section: developers
order: 1
---

# Öffentliche API

Die öffentliche API bietet Lesezugriff auf die Daten, die RankMeFast bereits für Ihr Konto hält: Sites, den letzten Audit-Bericht, den Ranking-Verlauf und die verfolgten Keywords. Sie ist eine **Agency**-Funktion (siehe [Pläne, Limits & Guthaben](./plans-limits-credits.de.md)). Die API löst keine neue Anbieter-Arbeit aus und liest nur, was Ihre Audits und Ranking-Checks bereits erzeugt haben.

Content Intelligence gehört nicht zu `/api/v1`: Analysen starten und Empfehlungen ändern geht nur in der angemeldeten App. MCP kann gespeicherte Analysen lesen, aber keine starten und keine Empfehlung ändern.

## Authentifizierung

Erstellen Sie einen Schlüssel unter **Konto → API-Schlüssel** (`/profile?tab=api-keys`). Der vollständige Schlüssel wird **genau einmal** angezeigt. Kopieren Sie ihn sofort; danach ist nur noch sein Präfix sichtbar. Sie können bis zu zehn aktive Schlüssel halten und jeden jederzeit widerrufen. Ein widerrufener Schlüssel funktioniert sofort nicht mehr.

Senden Sie den Schlüssel als Bearer-Token mit jeder Anfrage:

```
Authorization: Bearer rmf_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

Ersetzen Sie `https://your-rankme-host` in den Beispielen unten durch Ihren api-Ursprung (die `SERVER_URL` Ihrer Installation).

## Antwortsprache und Datenvertrag

Die Antwortsprache wählen Sie mit `x-lang`, danach mit `Accept-Language`; sonst gilt `en`. Regionale Werte wie `fr-CA` werden zu `fr`. `/api/v1` ignoriert Browser-Cookies, Kontosprache und Workspace-Einstellungen. Jede Antwort nennt die verwendete Sprache in `Content-Language` und ergänzt `Vary` um `x-lang, Accept-Language`, wobei vorhandene Werte erhalten bleiben.

Übersetzt werden nur Texte, die RankMeFast selbst verfasst (Berichts-, Befund- und Aktionstexte sowie sichere Fehlermeldungen). JSON-Eigenschaftsnamen, HTTP-Status, stabile Fehlercodes, Enum- und Statuswerte, IDs, Domains, URLs, Keywords, Zeitstempel, Messwerte, Beobachtungen, Cursor sowie gespeicherte Benutzer- oder Anbietertexte bleiben gleich. Die Sprache ändert nie Sortierung oder Zahlen- und Datumsformat.

CSV ist in jeder Sprache byte-identisch: UTF-8-BOM, Spaltennamen und -reihenfolge, Zeilenreihenfolge, RFC-4180-Escaping, Werte, Zeilenenden, Dateiname, Paginierungsheader und Cursorverhalten. `Content-Language` nennt die gewählte Sprache, übersetzt oder benennt im CSV aber nichts um.

## Endpunkte

### Ihre Sites auflisten

```bash
curl -H "Authorization: Bearer rmf_..." \
  https://your-rankme-host/api/v1/sites
```

Liefert `{ "sites": [{ "id", "domain", "url", "createdAt" }] }`.

### Letzter Audit-Bericht einer Site

```bash
curl -H "Authorization: Bearer rmf_..." \
  https://your-rankme-host/api/v1/sites/<siteId>/report/latest
```

Liefert den jüngsten **erfolgreichen** Audit als `{ "runId", "report" }` mit denselben Befunden, Kategorien und lokalisierten Texten wie im Dashboard. Antwortet mit `404`, wenn die Site noch keinen abgeschlossenen Audit hat.

### Ranking-Verlauf einer Site

```bash
curl -H "Authorization: Bearer rmf_..." \
  "https://your-rankme-host/api/v1/sites/<siteId>/rank-history?from=2026-06-01&to=2026-07-01"
```

Liefert `{ "keywords": [{ "id", "phrase", "series": [...] }] }`. Jeder Punkt enthält die Position, die rankende URL und die Google-AI-Overview-Signale (`aiOverviewPresent`, `aiCited`, `aiCitedUrl`). `from` und `to` sind optionale ISO-Daten.

### Alle verfolgten Keywords

```bash
curl -H "Authorization: Bearer rmf_..." \
  https://your-rankme-host/api/v1/keywords
```

Liefert jedes verfolgte Keyword über alle Ihre Sites mit letzter Position, Delta und den AI-Overview-Feldern.

## CSV-Exporte und gespeicherte Zeilen

Bei aktivem `PUBLIC_EXPORTS_ENABLED` liefert jede Listenroute CSV über `?format=csv` oder `Accept: text/csv`. Die Dateien haben stabile Spalten, UTF-8-BOM, RFC-4180-Quoting und formelsicheren Text. Das JSON der vier ursprünglichen Routen bleibt unverändert. Der Rangverlauf akzeptiert `engine=google|bing|youtube|amazon`; ohne Filter enthält die Spalte `engine` alle Engines.

Rangverlaufs- und Keyword-CSV behalten ihre bisherige unpaginierte Ausgabe, solange weder `limit` noch ein undurchsichtiger `cursor` angegeben wird. Eine Rangverlaufsseite akzeptiert 1 bis 25 Keyword-Gruppen (höchstens 730 Punkte je Gruppe), eine Keyword-Seite 1 bis 1.000 Zeilen. Der Wert aus `X-Next-Cursor` wird an die nächste Anfrage übergeben; fehlt der Header, ist der Export vollständig. JSON ignoriert diese CSV-Paginierungsparameter und behält seinen ursprünglichen Vertrag.

Hinzu kommen `GET /api/v1/serp-features?siteId=<siteId>` und `GET /api/v1/backlink-rows?siteId=<siteId>` für gespeicherte Daten. Beide akzeptieren `limit` von 1 bis 1.000 und einen undurchsichtigen `cursor`, liefern nur kontoeigene Zeilen und kennzeichnen sie mit `sourceKind=provider_observation` (`source_kind` in CSV). Bei deaktiviertem Flag antworten neue Routen und CSV mit `503`, ursprüngliches JSON bleibt aktiv. Der [Looker-Studio-Leitfaden](./looker-studio.de.md) erklärt Connector und Felder.

## Ratenlimits

Standardmäßig darf jeder Schlüssel **120 Anfragen pro Minute** stellen. Darüber antwortet die API mit `429`, bis das Fenster zurückgesetzt wird.

## Fehler

Fehler haben die Form `{ "error": { "message": "...", "details": ... } }`. Die lesbare Meldung folgt `x-lang`, dann `Accept-Language`, dann `en`; Status, Felder, stabile Codes und Details ändern sich mit der Sprache nicht:

- `401`: der Schlüssel fehlt, ist fehlerhaft, widerrufen oder unbekannt.
- `402`: Ihr Plan enthält die API nicht.
- `404`: die Site oder der Bericht existiert in Ihrem Konto nicht.
- `429`: Ratenlimit überschritten (Body: `{ "error": "..." }`).

## Kompatibilität

Dieses Release stellt genau sechs schreibgeschützte Routen bereit:

- `GET /api/v1/sites`
- `GET /api/v1/sites/:siteId/report/latest`
- `GET /api/v1/sites/:siteId/rank-history`
- `GET /api/v1/keywords`
- `GET /api/v1/serp-features`
- `GET /api/v1/backlink-rows`

Markenradar, Bewertungsanalyse, Link-Intelligenz, Traffic-Analyse und Keyword-Trends haben keine Routen unter `/api/v1`. Sie sind Dashboard-Funktionen mit Anmeldung. Vorhandene Antwortfelder behalten ihre Bedeutung, und Clients sollten neue, unbekannte Felder ignorieren.

<!-- public-api-routes: GET /api/v1/sites; GET /api/v1/sites/:siteId/report/latest; GET /api/v1/sites/:siteId/rank-history; GET /api/v1/keywords; GET /api/v1/serp-features; GET /api/v1/backlink-rows -->

[Zurück zum Dokumentationsindex](./index.de.md)
