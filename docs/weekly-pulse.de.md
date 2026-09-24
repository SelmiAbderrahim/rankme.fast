---
title: 'Wöchentlicher Puls'
description: 'Ein Wochen-Digest pro Site, erstellt aus bereits bezahlten Signalen.'
locale: de
slug: weekly-pulse
section: audits
order: 7
---

# Wöchentlicher Puls

Der Wöchentliche Puls ist eine optionale E-Mail-Zusammenfassung, die zeigt, was sich in der letzten ISO-Woche für Ihre Site geändert hat. Standardmäßig ist er aus. Jedes verifizierte Teammitglied aktiviert ihn für sich selbst. Niemand kann ihn für Sie einschalten.

## Was ein Puls kostet

Ein Digest für eine Site verbraucht **eine `ai_mentions_checks`-Einheit**, egal wie viele Teamkolleg:innen ihn abonniert haben. Verlauf lesen, alten Digest erneut öffnen oder gespeicherte Daten exportieren kostet nichts und ruft keinen Anbieter auf.

## Was er enthält

Der Digest entsteht ausschließlich aus bereits gespeicherten Signalen:

- Neue und verlorene Zitierungen über die von Ihrem Plan abgedeckten KI-Engines.
- Bestätigte Ranking-Verluste aus verfolgten Keywords.
- Aktionen, die seit dem vorherigen kompatiblen Puls abgeschlossen oder zurückgefallen sind.
- Ihre nächsten drei offenen Aktionen.
- Generative-KI-Erscheinung aus der Google Search Console, wenn Google Zeilen liefert.

Der Puls fragt KI-Engines nicht neu ab und startet keine neuen SERP-Abfragen.

## Wann er läuft

Jede Site hat einen festen Wochen-Slot, der sich aus der Site-ID ergibt und über Montag bis Samstag, 09:00–14:00 UTC, verteilt. Sonntag ist Ops reserviert. Den nächsten Slot sehen Sie im AI-Visibility-Workspace der Site.

## Mögliche Status

- **Abgeschlossen**: Jede unterstützte Engine hat Daten geliefert, der Digest ist bereit.
- **Teilweise**: Einige Engines lieferten nur Teildaten. Der Digest geht trotzdem mit dem raus, was angekommen ist.
- **Nicht unterstützt**: Keine Engine Ihres Plans deckt Markt und Kohorte dieser Site ab; keine Einheit verbraucht.
- **Blockiert**: Ihr `ai_mentions_checks`-Kontingent ist für den Monat aufgebraucht; kein Anbieter-Aufruf.
- **Fehlgeschlagen**: Alle unterstützten Engines sind für diesen Lauf gescheitert. Die Einheit ist verbraucht und wird nicht erstattet.

## Aktivieren und deaktivieren

Öffnen Sie den AI-Visibility-Workspace der Site, prüfen Sie die Ausgabenvorschau und schalten Sie **Wöchentlicher Puls** um. Wenn Sie ihn ausschalten, kommen ab sofort keine E-Mails mehr. Nach dem Wiedereinschalten gilt der nächste Wochen-Slot.

## Datenschutz

E-Mails enthalten nur kurze Zusammenfassungen: Host, Zähler, Keyword-Text, Positionsnummer, Aktions-Verb, Erscheinungsname. Rohe KI-Antworten, Quellauszüge, Konkurrenztext, Prompts und Anbieter-Task-IDs erscheinen nie im Digest.

[Zurück zum Doku-Index](./index.de.md)
