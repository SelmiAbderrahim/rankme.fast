<div align="center">

<img src="client/public/og/logo.png" alt="RankMeFast logo" width="96" height="96" />

# RankMeFast

**The self-hosted SEO platform. Plain-language audits for search and AI answers.**

Site audits · rank tracking · keyword research · backlinks · Search Console · AI visibility,
in one `docker compose up`.

[![CI](https://github.com/SelmiAbderrahim/rankme.fast/actions/workflows/ci.yml/badge.svg)](https://github.com/SelmiAbderrahim/rankme.fast/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/license-AGPL--3.0-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-0.1.0-informational.svg)](docs/changelog.en.md)
[![Status](https://img.shields.io/badge/status-public%20beta-orange.svg)](docs/beta.en.md)
[![Docker Compose](https://img.shields.io/badge/deploy-docker%20compose-2496ED.svg?logo=docker&logoColor=white)](#quick-start)
[![Node 20+](https://img.shields.io/badge/node-%E2%89%A520-339933.svg?logo=node.js&logoColor=white)](#development)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6.svg?logo=typescript&logoColor=white)](#tech-stack)
[![Coverage 100%](https://img.shields.io/badge/coverage-100%25-brightgreen.svg)](#development)
[![i18n: 7 locales](https://img.shields.io/badge/i18n-7%20locales-8A2BE2.svg)](#features)

[Quick start](#quick-start) ·
[Try it without keys](#try-it-without-vendor-keys) ·
[Features](#features) ·
[Documentation](docs/index.en.md) ·
[Self-hosting guide](docs/self-hosting.en.md) ·
[Architecture](#architecture) ·
[Contributing](#contributing)

<img src="client/public/og/default.png" alt="RankMeFast: plain-language SEO audits for search and AI answers" width="800" />

</div>

---

## Why RankMeFast

Most SEO suites are closed SaaS with per-seat pricing, and your data stays on
their servers. RankMeFast works differently:

- **Bring your own keys.** RankMeFast doesn't crawl the web or scrape Google
  itself. It calls data vendors (DataForSEO, Google APIs, Firecrawl, and
  optionally an LLM provider) with your API keys, and there's no markup on top.
- **Your data stays with you.** Everything lands in your MongoDB and PostgreSQL. Users
  can export their data or schedule account deletion themselves.
- **Plain language.** Each finding names the page, says in one sentence why it
  matters, and tells you how to fix it.
- **Works without keys.** Every provider has a `fake` backend that returns
  fixed demo data, so you can try the whole product before paying any vendor.
- **Shared cache.** Vendor responses are cached across users, so you don't pay
  twice for the same keyword or URL while the cached copy is still fresh.

> [!NOTE]
> **Public beta.** Expect rough edges, and breaking changes between releases.
> Report bugs through [GitHub issues](https://github.com/SelmiAbderrahim/rankme.fast/issues).

## Features

| Area | What you get |
|---|---|
| **Site audits** | Crawl a site, run 26 automated checks, get a *Fix now / Watch / Passed* report with an optional AI summary. |
| **Rank tracking** | Google organic positions over time, plus Bing, YouTube, and Amazon. SERP features, confirmed-drop alerts, and a local geogrid. |
| **Keyword research** | Volume, difficulty, trends, SERP-overlap clustering, and cannibalization reports from Search Console data. |
| **Links & competitors** | Backlink profiles, link-gap analysis, toxic-link review, competitor discovery, and content comparison. |
| **Google integrations** | Search Console (performance, URL Inspection, sitemaps), GA4, PageSpeed Insights, and CrUX. |
| **AI visibility** | Track prompts in AI Overviews and LLM answers, measure share of voice, get a weekly digest. |
| **Content tools** | Content briefs, internal-linking suggestions, schema.org generation, and change monitoring for public pages. |
| **Local & app SEO** | Business listings and reviews, local-pack ranks, and App Store / Google Play optimization. |
| **Reporting** | PDF/CSV exports, scheduled white-label client reports, read-only share links, a Looker Studio connector, a read-only REST API, and an MCP server for AI assistants. |
| **Teams & alerts** | Seats and invites, plus alert rules delivered by email, Slack, or signed webhook. |
| **Seven languages** | English, Arabic (RTL), French, German, Spanish, Russian, and Chinese across the UI, emails, and docs. |

Each vendor-backed feature has its own feature flag and provider setting, so
you only turn on the ones you have keys for.

## Quick start

**Requirements:** Docker with the Compose plugin.

```bash
git clone https://github.com/SelmiAbderrahim/rankme.fast.git
cd rankme.fast
cp .env.example .env
```

Edit `.env`. The minimum for a local install:

| Variable | Value |
|---|---|
| `BETTER_AUTH_SECRET` | `openssl rand -hex 32` |
| `MASTER_ENCRYPTION_KEY` | `openssl rand -hex 32` (a *different* value) |
| `POSTGRES_PASSWORD` and `DATABASE_URL` | the same random password in both |
| `CLIENT_URL`, `APP_URL`, `VITE_SITE_URL` | `http://localhost:3000` |
| `SERVER_URL` | `http://localhost:8080` |

> [!IMPORTANT]
> Back up `MASTER_ENCRYPTION_KEY`. Losing it makes every stored secret
> (OAuth tokens, channel credentials) unreadable.

Start the stack:

```bash
make build-up            # or: docker compose up -d --build
make ps                  # every service should be healthy
```

Open http://localhost:3000 and create an account.

### Try it without vendor keys

Each provider has a `fake` backend, so you can explore the product without
spending anything. With `NODE_ENV=production` the fakes are refused unless you
opt in:

```dotenv
ALLOW_FAKE_PROVIDERS=true
EMAIL_TRANSPORT=fake
```

> [!WARNING]
> Never enable this on a public deployment.

<details>
<summary><b>Connecting real data</b></summary>

<br>

Set the `PROVIDER_*` selectors and credentials in `.env`. Every variable is
described in `.env.example`; these are the main ones:

| Capability | Setting | Vendor |
|---|---|---|
| Audits, ranks, keywords, backlinks, competitors, reviews, app data | `PROVIDER_*=dataforseo` + `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` | DataForSEO |
| PageSpeed / CrUX | `PROVIDER_PAGESPEED=google` + `GOOGLE_API_KEY` (or `dataforseo` for lab data only) | Google |
| Google sign-in, Search Console, GA4 | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |
| Page content, change monitoring | `PROVIDER_CONTENT_SOURCE=firecrawl` + `FIRECRAWL_API_KEY` | Firecrawl |
| AI summaries, chat, clustering labels | `PROVIDER_AI=ai-sdk` + one or more provider keys | Anthropic, OpenAI, Google, DeepSeek, GLM, Kimi |
| Email | `EMAIL_TRANSPORT=resend` + `RESEND_API_KEY` / `RESEND_FROM` | Resend |

If you select a provider but leave out its credentials, the app refuses to
start and tells you which variable is missing. It never quietly falls back to
the fake data.

Set `SUPERADMIN_EMAIL` and `SUPERADMIN_PASSWORD` to seed an operator account
on first boot.

</details>

<details>
<summary><b>Day-to-day operations (<code>make</code> targets)</b></summary>

<br>

| Command | What it does |
|---|---|
| `make build-up` | Build and start the stack, wait until healthy |
| `make up` / `make down` | Start / stop the stack (volumes are kept) |
| `make logs` | Follow logs from every service |
| `make health` | Print each service's health state |
| `make backup` | Dump Postgres, Mongo, and Redis into `backup/` |
| `make restore` | Restore from `backup/` (overwrites current data) |
| `make test` | Run server and client test suites |
| `make help` | List every target |

</details>

The full operator guide is in [`docs/self-hosting.en.md`](docs/self-hosting.en.md).

## Architecture

```
            ┌──────────┐   /api/*    ┌──────────┐   BullMQ   ┌──────────┐
 browser ──▶│   web    │────────────▶│   api    │───────────▶│  worker  │
            │ SSR + SPA│             │ Express  │   Redis    │  queues  │
            └──────────┘             └────┬─────┘            └────┬─────┘
                                          │                       │
                              MongoDB (documents)    PostgreSQL (time series,
                                                     usage, vendor cache)
                                          │                       │
                                          └──── vendor providers ─┘
                                     (DataForSEO, Google, Firecrawl, LLMs)
```

| Service | Role |
|---|---|
| `web` | Node server for the React app. Marketing and docs pages are server-rendered; the dashboard is a client-side SPA. Proxies `/api` to `api`. |
| `api` | Express 4 + TypeScript. Auth (Better Auth), REST routes, MCP endpoint. |
| `worker` | Same image as `api`. Runs the BullMQ consumers: audits, rank checks, scheduled jobs. |
| `mongo` | Sites, audit runs, reports, and other document-shaped data. |
| `postgres` | Rank history, keywords, usage counters, and the vendor cache (Drizzle ORM; migrations apply on boot). |
| `redis` | Job queues and rate limits. |

Vendor calls all go through typed interfaces in `server/src/shared/providers/`,
so switching vendors means changing config rather than feature code.

## Tech stack

| Layer | Tools |
|---|---|
| **Frontend** | React 18 · Redux Toolkit · React Router 6 · Vite 6 · Tailwind CSS v4 · shadcn/ui · i18next |
| **Backend** | Express 4 · TypeScript 5 · Mongoose 8 · Drizzle ORM · Better Auth · BullMQ · pino · zod |
| **Data** | MongoDB · PostgreSQL 17 · Redis 7 |
| **Quality** | Vitest (100% coverage) · Playwright · axe-core · ESLint |

## Documentation

User guides live in [`docs/`](docs/), one file per page per locale, and are
also served inside the app at `/docs`.

| Start here | Features | Integrations |
|---|---|---|
| [Getting started](docs/getting-started.en.md) | [Audit report](docs/audit-report.en.md) | [Google Search Console](docs/google-search-console.en.md) |
| [Self-hosting](docs/self-hosting.en.md) | [Rank tracking](docs/rank-tracking.en.md) | [Public API](docs/public-api.en.md) |
| [Troubleshooting](docs/troubleshooting.en.md) | [Keyword research](docs/keyword-research.en.md) | [MCP server](docs/rankmefast-mcp.en.md) |
| [Changelog](docs/changelog.en.md) | [AI visibility](docs/ai-visibility.en.md) | [Looker Studio](docs/looker-studio.en.md) |

## Development

The app runs through Docker Compose; the databases are only reachable on the
internal compose network. Typechecking, linting, and tests run on the host
with **Node.js 20+**:

```bash
npm --prefix server install
npm --prefix client install
```

Run the same checks as CI:

```bash
npm --prefix server run typecheck && npm --prefix client run typecheck
npm --prefix server run lint      && npm --prefix client run lint
npm --prefix server exec -- vitest run --coverage
npm --prefix client exec -- vitest run --coverage
```

Server tests use in-process MongoDB (`mongodb-memory-server`) and PGlite, so
they don't need Docker. Coverage is enforced at 100% for owned code.

After editing a Drizzle schema under `server/src/db/schema/`, run
`npm --prefix server run db:generate` and commit the generated SQL.

<details>
<summary><b>Repository layout</b></summary>

```
client/            React app + SSR server (client/server.js)
  src/features/    one folder per product area
  src/shared/      API client, UI primitives, i18n, theme
  e2e/             Playwright specs
server/
  src/modules/     one folder per API module (routes, service, model, tests)
  src/shared/      providers, queue, middleware, crypto, i18n
  src/worker.ts    worker entrypoint
  drizzle/         generated SQL migrations
docs/              user guides, one file per page per locale
ops/               operator runbooks
tools/             Looker Studio connector
```

</details>

## Contributing

Issues and pull requests are welcome. For anything bigger than a bug fix,
[open an issue](https://github.com/SelmiAbderrahim/rankme.fast/issues) first
so we can agree on the approach.

Before opening a PR, check that:

- [ ] Typecheck, lint, and tests pass with 100% coverage.
- [ ] Every new user-facing string exists in all seven locales (parity tests
      fail otherwise).
- [ ] Feature code talks to vendors only through the interfaces in
      `server/src/shared/providers/` (ESLint blocks direct SDK imports).
- [ ] A new environment variable is added to `server/src/config/env.ts`,
      `.env.example`, and `docker-compose.yml`.

The conventions are written down in [`CLAUDE.md`](CLAUDE.md) and
[`.claude/rules/`](.claude/rules/).

## Security

Please don't report vulnerabilities in public issues. Use GitHub's
[private vulnerability reporting](https://github.com/SelmiAbderrahim/rankme.fast/security/advisories/new)
on this repository instead.

## License

RankMeFast is licensed under the
[GNU Affero General Public License v3.0](LICENSE). If you run a modified
version as a network service, you must offer its source to the users of that
service.
