# CI release gates

RankMeFast accepts a release only after the same deterministic checks pass
locally and in CI. Coverage is 100 percent for lines, branches, functions, and
statements over owned executable source. Server coverage collects unimported
`server/src/**/*.ts` files; the frozen exclusions are limited to documented
type-only, generated/tooling, vendored, pure re-export, and composition roots.

The static test policy runs once over `server/src`, `client/src`, and
`client/e2e`. Skipped, todo, and focused tests are forbidden. An issue link or
expiry date is not an exception. Playwright also enforces `forbidOnly` in CI and
runs every configured project with exactly zero retries.

## Local release proof

Run the canonical gate from the repository root. The root compatibility files
delegate to the package-owned policy and Playwright configurations, so these
commands match CI collection without duplicating either implementation:

```bash
env -u NODE_ENV npm --prefix server exec -- tsx src/scripts/run-skip-policy.ts src ../client/src ../client/e2e
env -u NODE_ENV npm --prefix server run typecheck
env -u NODE_ENV npm --prefix client run typecheck
env -u NODE_ENV npm --prefix server run lint
env -u NODE_ENV npm --prefix client run lint
env -u NODE_ENV npm --prefix server exec -- vitest run --coverage
env -u NODE_ENV npm --prefix client exec -- vitest run --coverage
env -u NODE_ENV npm --prefix server run build
env -u NODE_ENV npm --prefix client run build
env -u NODE_ENV npm --prefix server audit --audit-level=high
env -u NODE_ENV npm --prefix client audit --audit-level=high
env -u NODE_ENV docker compose config --quiet
env -u NODE_ENV make build-up
env -u NODE_ENV make ps
env -u NODE_ENV CI=true npm --prefix client exec -- playwright test --retries=0
env -u NODE_ENV docker compose logs --no-color --tail=200 api worker web
```

`make build-up` is the bounded all-service authority. It fails if a container is
exited, dead, unhealthy, restarting, or does not become ready within the health
timeout. A passing run reports api, worker, web, mongo, postgres, and redis as
running and healthy.

## Deterministic provider policy

The E2E job explicitly selects `fake` for every provider family, including AI,
content source, GA4, GSC, PageSpeed, and DataForSEO-backed capabilities. It does
not receive live vendor credentials. Recorded provider contract fixtures are
redacted and fixture-linted; browser failure artifacts contain only synthetic
test accounts and deterministic fake results.

Traces, screenshots, videos, Compose logs, and the HTML report are retained only
when a run fails. A retry is never attempted, so a pass cannot hide an initial
failure. Routine teardown preserves developer and CI volumes.

## Failure triage

Read the complete failing command before changing code. Do not lower a threshold,
add an exclusion or ignore pragma, skip/focus a test, weaken an assertion, or add
a retry. Fix the shared root cause, then restart the full gate at its first step.
Review API, worker, and web logs for uncaught errors or sensitive payloads before
accepting an E2E pass.
