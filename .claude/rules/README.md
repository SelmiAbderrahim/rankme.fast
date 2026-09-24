# Rules Index

Governance rules for rankme.fast. Each rule is a focused `.md` file in this directory; every rule opens with a MANDATORY REQUIREMENT header, correct/forbidden examples, and a validation checklist.

## Kept + new rules

| Rule | Summary |
|------|---------|
| `design-system.md` | Look-and-feel authority: shadcn/ui + balanced-AA+ Aria editorial tokens (warm paper, ink `--primary`, signal-red `--highlight`), passive `--border` versus ≥3:1 control `--input`, contrast-safe five-color charts, and the conversion-led twelve-band self-host homepage with a theme-responsive signup hero and dark closing/footer |
| `ui-ux-patterns.md` | Accessibility, forms/feedback, loading/error states. Defers to `design-system.md` on all visual questions |
| `git-destructive-commands.md` | Never run destructive git commands without explicit per-turn user confirmation |
| `environment-variables.md` | Root `.env` only; env table synced with `.env.example`; bounded list-valued secrets stay blank in tracked templates |
| `site-url-env-pattern.md` | Never hardcode URLs; derive from `CLIENT_URL` / `SERVER_URL` / `VITE_*` |
| `url-tab-state.md` | Tab state persists in `?tab=` query param; never `useState` for tab state |
| `spec-driven-development.md` | Spec-first workflow for features of meaningful complexity |
| `mern-feature-modules.md` | `features/<name>` on client, `modules/<name>` on server; no cross-feature internal imports; vendor SDKs stay inside `shared/providers/` |
| `mern-no-default-exports.md` | Named exports only |
| `mern-mongoose-typed-schemas.md` | Every Mongoose schema uses `InferSchemaType`; type exported alongside the model |
| `provider-interfaces.md` | Every vendor signal behind a typed capability interface; same-vendor credential pools require explicit statuses, bounds, affinity, and contracts |
| `drizzle-postgres-scope.md` | Postgres is the scoped exception for relational time-series data; Mongo default; money in `bigint` cents; migration workflow |
| `better-auth-integration.md` | Better Auth mounted at `/api/auth/*` BEFORE `express.json()`; no hand-rolled auth; cross-account 404 not 403 |
| `i18n-seven-locales.md` | Every user-facing string in `en, ar, fr, de, es, ru, zh`; parity tests; RTL for Arabic; plain-language rule copy |
| `interaction-hygiene.md` | Pointer/disabled cursor semantics on the base primitive; one shared in-button loading affordance (`Button` `loading` + `Spinner`); every interactive element ships all states |
| `shared-layout-system.md` | Exactly one Header/Footer/shell system in `shared/`; marketing + app are variants composed from shared blocks, never inlined or forked; every label localized |
| `secrets-at-rest.md` | Persisted OAuth/user credentials use the AES envelope or one-way hash; operator keys remain only in root `.env` |
| `log-redaction.md` | pino redaction covers scalar and array credentials, sessions, cookies, derived affinity refs, and env secrets; tests enforce |
| `ssrf-url-safety.md` | One resolve-then-pin authority for every user/crawl/redirect/webhook/SERP-influenced outbound URL |
| `output-encoding.md` | Untrusted AI/crawl/user text stays inert in React, JSON-LD, links, PDF/email, and exports |

## Removed

The old MERN-starter README listed a set of "dropped" product-specific rules (dockstash, backups, restic, stalwart, dokploy). Those files were never ported into this repo. The current directory is the complete authoritative set.
