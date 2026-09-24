---
title: 'Generative-KI-Erscheinung in Search Console'
description: 'Wie oft Google Ihre Site in seinen generativen KI-Funktionen gezeigt hat, direkt aus der Search Console.'
locale: de
slug: gsc-generative-appearance
section: research
order: 4
---

# Generative-KI-Erscheinung in Search Console

Die Google Search Console meldet, wie oft Ihre Seiten in Googles generativen KI-Funktionen erschienen sind, etwa in AI Overviews. Diese Karte zeigt die Zahlen so, wie Google sie liefert. Wir ergänzen oder schätzen nichts.

## Was wir lesen

Wir fragen die Search-Console-API mit `dimensions=['searchAppearance']` für die letzten 28 Tage ab. Der Zeitraum endet vor drei Tagen, passend zu Googles Berichtsverzögerung. Jede Zeile, die Google liefert, ordnen wir anhand der Google-Dokumentation ein:

- Bekannte generative KI-Werte bekommen ein festes Label.
- Unbekannte Werte erscheinen als **Sonstige**, der Originalname bleibt für den Support erhalten. Wir nehmen nie an, dass ein unbekannter Wert generativ ist.

## Zustände

- **Verfügbar**: Google hat mindestens eine erkannte generative Zeile geliefert. Die Karte zeigt pro Zeile die Klicks, Impressionen, CTR und durchschnittliche Position, die Google gesendet hat.
- **Nicht verfügbar**: Google hat für diese Property und diesen Zeitraum keine erkannte generative Zeile geliefert. Das ist nicht dasselbe wie null. Google hat dazu schlicht nichts gemeldet, deshalb zeigen wir statt 0 ein leeres Feld.
- **Teilweise**: Google hat Zeilen geliefert, die Antwort aber als unvollständig markiert (Rate-Limit oder Kürzung). Die erhaltenen Zeilen werden trotzdem angezeigt.
- **Neu verbinden erforderlich**: Die Google-Verbindung muss erneuert werden. Öffnen Sie den Google-Workspace der Site und folgen Sie dem Hinweis zum Neuverbinden.

## Getrennt von Anbieter-Metriken

Das sind Googles eigene Daten zu Ihrer Site. Sie stehen im Google-Workspace neben Ihren anderen Search-Console-Karten. Mit den Mention- und Share-of-Voice-Diagrammen im AI-Visibility-Workspace werden sie nicht vermischt, denn diese stammen von einem anderen Anbieter und messen etwas anderes.

## Was diese Daten nicht verraten

Die Search Console zählt Impressionen und Klicks, also wie oft Google Ihre Seite in eine generative Funktion aufgenommen hat. Ob die KI-Antwort Sie genannt, verlinkt, zitiert oder einen Wettbewerber bevorzugt hat, erfahren Sie daraus nicht. Dafür gibt es [AI Visibility](./ai-visibility.de.md).

[Zurück zum Doku-Index](./index.de.md)
