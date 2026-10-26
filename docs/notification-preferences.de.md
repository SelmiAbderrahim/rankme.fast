---
title: 'Benachrichtigungseinstellungen'
description: 'Wählen Sie, welche nicht-sicherheitsrelevanten E-Mails Sie erhalten möchten.'
locale: de
slug: notification-preferences
section: account
order: 4
---

# Benachrichtigungseinstellungen

Sie legen fest, welche nicht-sicherheitsrelevanten E-Mails RankMeFast Ihnen sendet. Öffnen Sie **Einstellungen → Benachrichtigungen** (`/settings/notifications`) und schalten Sie die gewünschten Schalter um.

Die Schalter für Audit, Ranking und Warnregeln sind standardmäßig **aktiviert**; **Produktupdates** ist standardmäßig **deaktiviert** und wird erst gesendet, wenn Sie den Schalter einschalten. Eine Änderung gilt sofort: Die nächste passende E-Mail wird übersprungen (oder gesendet, wenn Sie einen Schalter eingeschaltet haben).

## Was jeder Schalter steuert

- **Audit abgeschlossen**: Wird gesendet, wenn ein Audit für eine Ihrer Websites fertig ist.
- **Ranking-Verlust**: Wird gesendet, wenn ein verfolgtes Keyword abgefallen ist und eine zweite Prüfung das bestätigt hat.
- **Warnregeln**: Wird gesendet, wenn eine Ihrer eigenen [Warnregeln](./alerts.de.md) auslöst. Dieser Schalter betrifft nur den E-Mail-Kanal. Slack- und Webhook-Zustellungen laufen weiter.
- **Abrechnung**: Zahlungsbelege, Erinnerungen bei fehlgeschlagenen Zahlungen und Mahn-Benachrichtigungen. Deaktivieren stoppt alle Abrechnungs-E-Mails; Belege und vergangene Rechnungen sehen Sie weiterhin unter **Abrechnung → Rechnungen**.
- **Produktupdates**: Gelegentliche Willkommensnachrichten, Produktneuigkeiten und Tipps.

## Ranking-Verlust und Warnregeln sind getrennt

Die E-Mail **Ranking-Verlust** ist eingebaut. RankMeFast sendet sie, wenn ein verfolgtes Keyword abfällt und eine zweite Prüfung den Abfall bestätigt; einen Schwellenwert legen Sie nicht fest. Warnregeln bauen Sie selbst unter **Warnungen → Regeln** (`/dashboard/alerts?tab=rules`). Sie wählen den Schwellenwert und das Ziel der Warnung, auch Slack oder einen signierten Webhook. Keines ersetzt das andere. Wenn Sie **Ranking-Verlust** ausschalten, laufen Ihre Warnregeln weiter, und wenn Sie alle Regeln löschen, bleibt die eingebaute E-Mail aktiv.

## Der Wöchentliche Puls ist ein eigenes Opt-in

Der [Wöchentliche Puls](./weekly-pulse.de.md)-Digest wird nicht von den obigen Schaltern gesteuert. Jedes Teammitglied aktiviert ihn pro Site selbst im AI-Visibility-Workspace der Site. Bis dahin bleibt er aus.

Wird eine Zustellung wiederholt, erhalten Sie jeden Digest trotzdem nur einmal. Kann Ihre Adresse die E-Mail nicht empfangen, erhalten andere abonnierte Teamkolleg:innen ihre trotzdem.

## Sicherheits-E-Mails können nicht deaktiviert werden

Die folgenden E-Mails werden immer gesendet, unabhängig von den obigen Schaltern:

- Link zum Zurücksetzen des Passworts.
- Bestätigung der E-Mail-Adresse.
- Bestätigung einer Passwortänderung.

Diese E-Mails schützen Ihr Konto. Wenn Sie eine unerwartet erhalten, prüfen Sie Ihre aktiven Sitzungen und setzen Sie Ihr Passwort unter **Einstellungen → Sicherheit** zurück.
