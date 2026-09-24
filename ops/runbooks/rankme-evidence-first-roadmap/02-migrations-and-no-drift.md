# 02 — Migrations and no-drift proof

## Forward-only

All roadmap migrations are forward-only. Rollback NEVER un-applies a
migration or restores deleted rows. If a migration misbehaves, fix forward.

Roadmap-relevant migrations (under `server/drizzle/`):

- `0041`/`0042` — weekly-pulse tables (settings, subscriptions, runs,
  citation/change rows, digest + delivery events).
- `0043`/`0044` — audience-research append-only usage events.
- `0045`/`0046` — GSC generative-AI search-appearance snapshots.
- `0047` — audience-research signal decision events (append-only, partial
  unique index enforcing one terminal decision per signal).

## Journal quirk (known)

`drizzle-kit generate` emits synthetic `when` timestamps. If a freshly
generated migration's `when` is not strictly greater than the previous entry,
the boot migrator skips it. After every `npm --prefix server run db:generate`,
verify `server/drizzle/meta/_journal.json` is strictly increasing and
hand-bump the new entry above the synthetic `1785xxx` values when needed.

## No-drift proof (release gate)

In a disposable copy of the repo:

```
npm --prefix server run db:generate
git status --short server/drizzle
```

Expected: no new files, no modified SQL — byte-for-byte identical. Any diff
means schema files and committed SQL disagree; fix before release. Tests
already run every generated migration against PGlite
(`server/src/shared/testing/postgres.ts`), so schema drift also fails the
Vitest suite.

## Empty-datastore boot

A cold stack (empty Mongo, empty Postgres, empty Redis) must boot to healthy:
migrations create every table; Mongoose creates collections/indexes lazily;
BullMQ schedulers (`upsertJobScheduler`) are idempotent. If a service needs a
manual seed to become healthy, that is a release blocker, not an operations
step.
