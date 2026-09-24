---
title: "RankMeFast selbst hosten"
description: "Betreiben Sie RankMeFast mit Docker Compose auf Ihrem Server."
locale: de
slug: self-hosting
section: start
order: 5
---

# RankMeFast selbst hosten

## Vorbereitung

Installieren Sie Docker mit Compose und laden Sie den Quellcode herunter. Führen Sie die Befehle im Projektverzeichnis aus. Die Software ist kostenlos; Server und Anbieter-APIs bezahlen Sie selbst. Halten Sie die Umgebungsdatei geheim.

## Installation konfigurieren

Kopieren Sie die Vorlage und bearbeiten Sie dann die `.env` im Projektverzeichnis:

```bash
cp .env.example .env
```

Legen Sie `CLIENT_URL` und `SERVER_URL` fest. `BETTER_AUTH_SECRET` und `MASTER_ENCRYPTION_KEY` brauchen jeweils einen eigenen Zufallswert; führen Sie `openssl rand -hex 32` für jeden einmal aus. Richten Sie danach die echten Anbieter, ihre Zugangsdaten und den E-Mail-Versand gemäß `.env.example` ein. Für Ihre eigene Installation kann `PAYMENT_PROVIDER=none` bleiben.

Setzen Sie bei einer Installation mit einer einzigen Origin `APP_URL` und `VITE_SITE_URL` auf denselben Wert wie `CLIENT_URL`.

Starten Sie nicht mit Platzhalter-Zugangsdaten. Die Produktion lehnt simulierte Anbieter standardmäßig ab, und Demo-Ausnahmen gehören nicht in eine öffentliche Installation.

## Starten und prüfen

Starten Sie nach der Konfiguration die Plattform und prüfen Sie, ob alle Dienste gesund sind:

```bash
docker compose up -d --build
docker compose ps
```

Öffnen Sie dann die unter `CLIENT_URL` angegebene Adresse, erstellen Sie ein Konto und fügen Sie Ihre erste Website hinzu.

## Betrieb

Serversicherheit, HTTPS, Updates und Backups der Datenbanken und der Umgebungsdatei liegen bei Ihnen. Sichern Sie vor jedem Update. Prüfen Sie bei Startproblemen die Dienstprotokolle und geben Sie keine Protokolle mit Zugangsdaten weiter.
