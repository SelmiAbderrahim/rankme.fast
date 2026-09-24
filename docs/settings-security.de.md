---
title: 'Kontosicherheit'
description: 'Passwort ändern und Kontozugangsdaten verwalten.'
locale: de
slug: settings-security
section: account
order: 3
---

# Kontosicherheit

Verwalten Sie die Zugangsdaten, die Ihr RankMeFast-Konto schützen, unter **Einstellungen → Sicherheit** (URL: `/settings/security`).

## Passwort ändern

1. Melden Sie sich an und öffnen Sie **Einstellungen → Sicherheit**.
2. Geben Sie Ihr **aktuelles Passwort** ein, wählen Sie ein **neues Passwort** und bestätigen Sie es. Das neue Passwort muss mindestens acht Zeichen lang sein und sich vom aktuellen unterscheiden.
3. Klicken Sie auf **Passwort aktualisieren**.

Wir speichern Passwort-Hashes mit scrypt. Ihr Klartext-Passwort sehen wir nie. Nach einer erfolgreichen Änderung:

- Werden alle **anderen** aktiven Sitzungen Ihres Kontos abgemeldet. Das Gerät, mit dem Sie die Änderung vorgenommen haben, bleibt angemeldet.
- Senden wir eine Bestätigungs-E-Mail an die im Konto hinterlegte Adresse. Wenn Sie das Passwort nicht selbst geändert haben, ist diese Mail Ihr Signal, es sofort über [den „Passwort vergessen"-Flow](./getting-started.de.md) zurückzusetzen.

Wenn das aktuelle Passwort falsch ist, sagen wir es Ihnen direkt am Feld. Wir verraten aber nie, ob zu einer bestimmten Adresse ein Konto existiert.

## E-Mail-Adresse ändern

1. Melden Sie sich an und öffnen Sie **Einstellungen → Sicherheit**.
2. Geben Sie die **neue E-Mail-Adresse** in der Karte *E-Mail ändern* ein. Sie muss sich von Ihrer aktuellen Adresse unterscheiden.
3. Klicken Sie auf **Bestätigungslink senden**.

Wir senden einen Bestätigungslink an die **neue** Adresse. Ihre Konto-E-Mail ändert sich erst, nachdem Sie diesem Link gefolgt sind:

- Ihre **aktuelle E-Mail bleibt für die Anmeldung gültig**, bis Sie bestätigt haben.
- Ist die neue Adresse bereits einem anderen Konto zugeordnet, lehnen wir die Änderung mit einer generischen Meldung *E-Mail-Adresse nicht verfügbar* ab und verraten nicht, wem sie gehört.
- Der Link ist einmalig verwendbar und läuft nach kurzer Zeit ab; fordern Sie über dieselbe Seite eine neue Änderung an, falls das passiert.

## Aktuelles Passwort vergessen?

Wenn Sie Ihr aktuelles Passwort nicht mehr kennen, melden Sie sich ab und nutzen **Passwort vergessen?** auf dem Login-Bildschirm. Der Link führt Sie zu einer Seite, auf der Sie ohne Bestätigung des alten Passworts ein neues wählen können.


## Zwei-Faktor-Authentifizierung

Fügen Sie einen zweiten Schritt bei der Anmeldung hinzu, damit ein gestohlenes Passwort allein nicht ausreicht.

### Aktivieren

1. Melden Sie sich an und öffnen Sie **Einstellungen → Sicherheit**.
2. Geben Sie in der Karte **Zwei-Faktor-Authentifizierung** Ihr aktuelles Passwort ein und klicken Sie auf **Aktivieren**.
3. Scannen Sie den QR-Code mit einer App wie 1Password, Authy oder Google Authenticator oder fügen Sie den manuellen Code in die App ein.
4. Kopieren oder laden Sie die **Backup-Codes** herunter. Jeder Code funktioniert nur einmal. Sie sind der einzige Weg zurück, wenn Sie Ihr Gerät verlieren.
5. Geben Sie den sechsstelligen Code aus Ihrer App ein und klicken Sie auf **Prüfen und aktivieren**.

### Deaktivieren

Öffnen Sie dieselbe Karte, klicken Sie auf **Deaktivieren** und geben Sie Ihr aktuelles Passwort ein.

### Admin-Konten

Wenn Ihr Konto die **Admin**-Rolle hat, ist die Zwei-Faktor-Authentifizierung Pflicht. Sie können das Admin-Panel erst öffnen, wenn Sie sie aktivieren.

### Gerät verloren

Verwenden Sie einen Backup-Code auf dem Bestätigungsbildschirm. Dort finden Sie einen Link **Backup-Code verwenden**. Wenn Ihnen die Codes ausgehen, kann ein Admin den zweiten Faktor über das Admin-Panel zurücksetzen.

## Ihre Datenrechte

Sie können einen Export oder eine Löschung Ihrer Kontodaten anfordern. Der aktuelle Export ist auf die Datensätze in der erzeugten Datei beschränkt und enthält weder Seiten-Snapshots noch Zeitreihen aus GSC oder Ranking-Tracking. Die Löschung geht weiter: Nach der Karenzzeit entfernt sie gespeicherte Kontodaten auch dann, wenn diese nicht im Export enthalten sind. Während der Karenzzeit können Sie den Antrag zurückziehen. Der Leitfaden [Seitenleistung](./pages-performance.de.md) beschreibt die Aufbewahrung der Seitendaten.
