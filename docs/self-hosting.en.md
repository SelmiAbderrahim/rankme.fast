---
title: "Self-hosting RankMeFast"
description: "Run RankMeFast on your own server with Docker Compose."
locale: en
slug: self-hosting
section: start
order: 5
---

# Self-hosting RankMeFast

## Before you start

Install Docker with Compose and get the project source. Run the commands below from the project directory. The software is free; you pay for the server and for any vendor API usage. Keep your environment file private.

## Configure your installation

Copy the template, then edit the root `.env`:

```bash
cp .env.example .env
```

Set `CLIENT_URL` and `SERVER_URL` for your deployment. `BETTER_AUTH_SECRET` and `MASTER_ENCRYPTION_KEY` each need their own random value; run `openssl rand -hex 32` once for each. Then set the live provider selectors, the provider credentials and the email transport, as described in `.env.example`. On your own installation, billing can stay at `PAYMENT_PROVIDER=none`.

For a single-origin installation, set `APP_URL` and `VITE_SITE_URL` to the same value as `CLIENT_URL`.

Don't start with placeholder credentials. Production refuses fake providers by default, and demo overrides should never be turned on for a public deployment.

## Start and check

Once everything is configured, start the stack and check that every service reports healthy:

```bash
docker compose up -d --build
docker compose ps
```

Then open the address you set as `CLIENT_URL`, create an account and add your first site.

## Keep it running

You're responsible for server security, HTTPS, updates, and backups of the databases and the root environment file. Back up before every update. If startup fails, check the service logs, and don't share logs that contain credentials.
