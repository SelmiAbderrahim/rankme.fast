---
title: 'Pläne, Limits & Credits'
description: 'Limits für Starter, Pro und Agency sowie zusätzliche Credits.'
locale: de
slug: plans-limits-credits
section: account
order: 2
---

# Pläne, Limits & Credits

<!-- generated: finite-free-intro:start -->
RankMeFast bietet drei kostenpflichtige Abos: Starter, Pro und Agency.
<!-- generated: finite-free-intro:end -->

## Individuelle Pläne

Neben den festen Plänen und Kreditpaketen können Sie unter **Preise** oder **Abrechnung → Individueller Plan** einen eigenen Plan zusammenstellen. Sie wählen Monatskontingente, die Zahl der Websites und Plätze, die gewünschten Funktionen und wie oft Rankings geprüft werden. Jede Einstellung hat ein eigenes Minimum, Maximum und eine Schrittweite, und manche Optionen setzen andere voraus oder schließen sie aus. Der Preis im Browser ist nur eine Schätzung; das eigentliche Angebot erstellt der Server.

Die Monatskontingente eines individuellen Plans werden jeden Monat an Ihrem Abrechnungstag (UTC) zurückgesetzt. Ein Jahreskauf enthält zwölf solcher Monatskontingente. Websites, Keywords und Plätze werden nicht zurückgesetzt: Wenn Sie eines davon löschen, ist der Platz wieder frei. Limits je Lauf, etwa Seiten pro Audit, gelten für jeden einzelnen Lauf.

Bei jährlicher Zahlung sparen Sie bis zu 20% gegenüber zwölf Monatszahlungen. Die Vorschau zeigt den Rabatt, den Sie nach Mindestpreis, Aufrundung und unserer Kostengrenze tatsächlich bekommen. Würde der volle Rabatt den Preis unter diese Grenze drücken, sehen Sie einen kleineren Rabatt, keinen Rabatt oder keine Jahresoption. Wir zeigen nie einen Rabatt an, den Sie nicht bekommen.

Angemeldete Inhaber mit bestätigter E-Mail-Adresse können ein Angebot für 30 Minuten festhalten. Der Kauf-Button erscheint nur, wenn der Server bestätigt, dass Käufe möglich sind. Preise sind in USD, und Polar schlägt beim Bezahlen eventuelle Steuern auf. In der Sandbox, ohne eingerichtete Zahlung, bei veralteten Preisdaten oder wenn der Verkauf pausiert ist, können Sie einen Plan ansehen, aber nicht kaufen.

Ein individueller Plan beginnt, sobald die Zahlung bestätigt ist. Es gibt keine Testphase, keine Gutscheine, kein Guthaben und keine anteilige Abrechnung mitten in der Periode. Was Sie bezahlt haben, gilt bis zum Periodenende. Planänderungen, der Wechsel zwischen monatlich und jährlich oder zwischen festem und individuellem Plan erfordern am Ende der bezahlten Periode einen neuen Checkout. Braucht die Verlängerung einen neuen Preis, nehmen Sie ihn vor der angezeigten Frist an, sonst wird der Plan nicht verlängert. Eine Kündigung wirkt zum Periodenende. Noch gültige Paketguthaben bleiben erhalten, und wiederkehrende Zusatzoptionen werden nie stillschweigend in Ihre individuellen Limits eingerechnet. Erstattungen richten sich nach den beim Checkout angezeigten Bedingungen. Geht eine verspätete Abbuchung zu einem nicht sicheren Preis durch, erstatten wir sie automatisch vollständig.

## Die drei Pläne

<!-- generated: finite-plan-table:start -->
<!-- source: tiers.ts -->
| Plan     | Monthly (USD) | Yearly (USD) | Sites | Keywords | Audits/month | Audit pages | Backlink rows | AI summaries | Seats | Audience Research runs |
|----------|---------------|--------------|-------|----------|--------------|-------------|---------------|--------------|-------|------------------------|
| Starter  | $49           | $470.40      | 2     | 250      | 10           | 1,000       | 0             | 20           | 1     | 2                      |
| Pro      | $159          | $1,526.40    | 5     | 1,000    | 30           | 3,000       | 10,000        | 100          | 3     | 10                     |
| Agency   | $499          | $4,790.40    | 50    | 2,000 | 45           | 5,000       | 100,000       | 480          | 15    | 30                 |
<!-- generated: finite-plan-table:end -->

Preise in USD. Jahresabo mit 20 % Rabatt. Tägliches Ranking-Tracking ist auf jedem Plan Zusatzoption.

<!-- generated: finite-limit-semantics:start -->
**So funktionieren Limits.** Websites, verfolgte Keywords und Plätze zählen den aktuellen Bestand; wenn Sie etwas entfernen, wird der Platz frei. Audits, Ranking-Prüfungen, Backlink-Zeilen, KI-Arbeit und andere gemessene Einheiten werden zu Beginn jedes Kalendermonats (UTC) zurückgesetzt. Jeder Audit hat außerdem eine eigene Seitengrenze. Gekaufte Pakete bleiben im Konto, bis Sie sie nutzen. Wiederkehrende Add-ons fügen nur die Menge hinzu, die unter Abrechnung steht.
<!-- generated: finite-limit-semantics:end -->

## Audience-Recherche-Läufe

<!-- source: tiers.ts -->
Ein Lauf ist ein ganzer Recherche-Job, egal wie viele Seiten er liest. Starter-Konten haben 2 Läufe; Pro 10, Agency 30 pro Monat. Für diese Metrik gibt es kein Credit-Paket. Am Limit warten Sie auf den Monatswechsel oder upgraden. Siehe [Audience-Recherche](./audience-research.de.md).

## Einheiten für Keyword-Intelligenz und Wöchentlichen Puls

<!-- source: tiers.ts -->
- Ein Keyword-Gap-Check verbraucht eine `keyword_lookups`-Einheit pro verglichenem Wettbewerber.
- Ein Keyword-Überblick oder Trends-Abruf verbraucht eine `keyword_lookups`-Einheit pro Keyword. Aus dem Cache servierte Ergebnisse zählen trotzdem.
- Das Clustern einer Keyword-Liste verbraucht eine `ai_summaries`-Einheit; der identische Wiederholungslauf ist kostenlos.
- Ein Wöchentlicher-Puls-Digest verbraucht eine `ai_mentions_checks`-Einheit pro Site und Woche, egal wie viele Teamkolleg:innen ihn erhalten.

Details in [Keyword-Intelligenz](./keyword-intelligence.de.md) und [Wöchentlicher Puls](./weekly-pulse.de.md).

### Limits der Wettbewerbsanalyse

Die Wettbewerbsanalyse beginnt mit Pro. Eine Pro-Landschaft kann bis zu drei bestätigte Wettbewerber enthalten, Agency bis zu zehn. Jeder ausgewählte Wettbewerber verbraucht eine Einheit `keyword_lookups`. Eine optionale neue Wettbewerbersuche verbraucht nach eigener Bestätigung eine weitere Einheit. Der Agency-Vergleich von Ranking-Seiten ist ein getrennter Ablauf und verbraucht pro bestätigtem Lauf eine Einheit `competitor_content_runs`. Das Lesen eines Berichts, die Prüfung eines Seitenpaars, die Annahme einer Empfehlung und der Export verbrauchen keine dieser Einheiten. Mehr dazu unter [Backlinks und Wettbewerbsanalyse](./backlinks-competitors.de.md).

## KI-Assistent-Nachrichten

<!-- source: tiers.ts ai-chat -->
Eine Einheit ist eine Nachricht, die Sie an den KI-Assistenten senden. Starter-Konten erhalten 100 Nachrichten; Pro 200, Agency 400 pro Monat. Cache-Treffer und gestoppte Antworten zählen ebenfalls. Ein Einmal-Paket fügt unter **Abrechnung → Guthaben** 100 Nachrichten für 19 $ hinzu.

## Intelligence-Kontingente und Einheiten

<!-- source: tiers.ts intelligence-caps -->
| Tarif | Trends-Explorationen | Traffic-Snapshots | Link-Checks | Bewertungs-Syncs | Brand-Radar-Scans |
|---|---:|---:|---:|---:|---:|
| Starter | 10 | 5 | 0 | 0 | 0 |
| Pro | 40 | 25 | 25 | 10 | 0 |
| Agency | 80 | 80 | 80 | 50 | 20 |

Eine Trends-Einheit umfasst bis zu fünf Begriffe. Eine Traffic-Einheit umfasst eine Ziel-Domain. Eine Link-Einheit umfasst einen Tiefenabruf oder einen Wettbewerberteil. Eine Bewertungs-Einheit umfasst einen vollständigen Lauf mit ein bis drei Quellen. Eine Brand-Radar-Einheit umfasst eine Markenanfrage und den belegten Digest.

Ergebnisse aus dem Cache zählen, ebenso erfolgreiche Suchen ohne Treffer. Sie bekommen eine Einheit nur (einmal) zurück, wenn die Datenquelle ausfällt, bevor die Funktion etwas Brauchbares gespeichert hat. Siehe [Link Intelligence](./link-intelligence.de.md), [Traffic Insights](./traffic-insights.de.md), [Keyword-Trends](./keyword-trends.de.md), [Bewertungsanalyse](./review-intelligence.de.md) und [Brand Radar](./brand-radar.de.md).

## Brand-Radar-Add-on und Pakete

<!-- source: tiers.ts intelligence-products -->
<!-- intelligence-products: brand-addon=60@1900; brand-scans-40=40@2900; link-intel-100=50@1900; review-syncs-100=50@1900; traffic-snapshots-100=100@1900; trend-explorations-200=200@1900 -->
Pro und Agency können für 19 $/Monat 60 Brand-Radar-Scans pro Monat hinzufügen. Die 20 Basis-Scans von Agency gelten ohne Add-on; Pro hat eine Basis von null.

Einmalige Pakete: 40 Brand-Radar-Scans für 29 $, 50 Link-Checks für 19 $, 50 Bewertungs-Syncs für 19 $, 100 Traffic-Snapshots für 19 $ und 200 Trends-Explorationen für 19 $. Das Guthaben bleibt bis zur Nutzung erhalten. Siehe [Preise](./pricing.de.md) oder **Abrechnung → Credits**.

## App-SEO-Limits, Add-on und Pakete

<!-- source: tiers.ts app-seo-caps -->
| Tarif | App-Keyword-Prüfungen | Listing-Audits | Chart-Prüfungen | Keyword-Recherche | Wettbewerberläufe | Bewertungsläufe | App-Profile | Verfolgte App-Keywords |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Starter | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Pro | 0 | 0 | 0 | 0 | 0 | 0 | 2 | 25 |
| Agency | 50 | 4 | 20 | 2 | 0 | 0 | 5 | 50 |

<!-- source: tiers.ts app-seo-products -->
<!-- app-seo-products: addon=app_keyword_checks:600,app_listing_audits:8,app_chart_checks:60,app_keyword_lookups:40,app_competitor_lookups:10,app_review_runs:10@2900; app-keyword-checks-500=500@1900; app-research-50=50@1900; app-competitors-20=20@1900; app-review-runs-10=10@1900 -->
Pro und Agency können monatlich 600 Keyword-Prüfungen, 8 Listing-Audits, 60 Chart-Prüfungen, 40 Rechercheseiten, 10 Wettbewerberläufe und 10 Bewertungsläufe für 29 $ pro Monat hinzufügen. Agency behält zusätzlich das Grundkontingent.

Für Pro und Agency gibt es vier einmalige Pakete: 500 Keyword-Prüfungen, 50 Rechercheseiten, 20 Wettbewerberläufe oder 10 Bewertungsläufe. Jedes Paket kostet 19 $. Guthaben bleibt bis zur Nutzung erhalten und wird erst nach dem Monatskontingent verbraucht.

## Verfügbarkeit von Testphasen
Testphasen sind optional und nicht in jedem Bezahlplan enthalten. Wenn ein Angebot eine Testphase umfasst, werden deren Dauer und das Datum der ersten Abbuchung vor der Zahlungsbestätigung angezeigt.

## Beim Limit
Die betroffene Aktion wird mit Vorschlag zum Upgrade oder Kauf eines **Überschreitungs-Credits** blockiert.

## Credit-Pakete
Kleine Aufladungen für die passende Metrik, die bis zur Nutzung auf dem Konto bleiben.

## Kündigung und Downgrade
Kündigung erhält den Zugriff bis Periodenende. Downgrade wirkt beim nächsten Renewal; Überzähliges wird schreibgeschützt.

## Enterprise-Tarife
<!-- generated: finite-enterprise-plan:start -->
Enterprise startet mit 100 aktiven Websites und 25 Plätzen. Die Vereinbarung hält jedes höhere Limit als feste Zahl fest; nicht genannte Limits behalten ihren Enterprise-Basiswert. Siehe [Enterprise-Tarife](./enterprise.de.md).
<!-- generated: finite-enterprise-plan:end -->

[Zurück zum Doku-Index](./index.de.md)
