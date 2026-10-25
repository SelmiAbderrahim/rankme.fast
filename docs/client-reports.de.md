---
title: 'Kundenberichte und Portal'
description: 'Wie White-Label-PDF-Berichte aus gespeicherten Momentaufnahmen entstehen, wie Zeitpläne zustellen und was ein widerrufbarer Portallink ist und was nicht.'
locale: de
slug: client-reports
section: product
order: 11
---

# Kundenberichte und Portal

Kundenberichte machen aus gespeicherten Audit-, Ranking- und Search-Console-Momentaufnahmen ein PDF in Ihrem Branding. Sie können es nach Zeitplan per E-Mail versenden oder über einen schreibgeschützten Link teilen.

<!-- docs-truth: metric=none; unit=none-composed-from-stored-snapshots; cache-hits=not-applicable; refund=not-applicable; cadence=weekly-or-monthly; estimates=first-party-snapshots -->

## Was ein Bericht enthält

Jeder Bericht vereint die neuesten Audit-Befunde mit Ranking- und Search-Console-Abschnitten, unter Firmenname, Akzentfarbe und Logo Ihres Kontos.

Firmenname, Akzentfarbe und Logo legen Sie auf der Seite **Arbeitsbereich** unter Einstellungen fest (`/settings/workspace`); nur der Eigentümer des Arbeitsbereichs kann sie ändern. Laden Sie das Logo als PNG-, JPEG- oder SVG-Datei mit bis zu 256 KB hoch. Es wird als PNG gespeichert, und eine SVG-Datei mit Skripten oder Verweisen auf andere Dateien wird abgelehnt.

Beim Versand wird nichts neu abgerufen; der Bericht entsteht aus gespeicherten Momentaufnahmen. Deshalb steht jede Zahl neben dem Datum ihrer Beobachtung.

Ein Abschnitt ohne gespeicherte Momentaufnahme wird als noch nicht beobachtet markiert. Mit einer Schätzung wird er nie gefüllt.

## Zeitpläne

Berichte gehen wöchentlich oder monatlich per E-Mail hinaus. Das Zustellprotokoll hat einen Eintrag je Empfänger: ausstehend, gesendet, fehlgeschlagen oder unterdrückt. Sie wählen die Zeitzone und die Uhrzeit in dieser Zone, und der Zeitplan behält diese Ortszeit bei, wenn die Uhren auf Sommer- oder Winterzeit umgestellt werden.

Erstellen und Versenden ruft keinen Anbieter auf und verbraucht keine abgerechnete Einheit. Die Kosten entstehen in unserer eigenen Infrastruktur, deshalb begrenzen strukturelle Limits sie stattdessen.

## Portallinks

Ein Portallink ist eine schreibgeschützte URL, die abläuft und widerrufen werden kann.

Es gibt kein Login, keine Kommentare und keine Kundenplätze. Wer den Link hat, sieht den Bericht so, wie er veröffentlicht wurde.

Ein Widerruf wirkt ab der nächsten Anfrage. Wer die Seite nicht schon geladen hat, ist sofort ausgesperrt.

## Grenzen

Content-Briefings sind in v1-Berichten nicht enthalten. Ein Bericht enthält nur, was bereits erfasst wurde: Ein Abschnitt erscheint, sobald die Schnappschüsse dahinter vorliegen.

[Zurück zum Doku-Index](./index.de.md)
