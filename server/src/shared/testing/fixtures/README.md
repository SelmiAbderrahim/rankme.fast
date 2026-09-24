# Recorded vendor fixtures

Convention: `fixtures/<provider>/<operation>/<case>.json`.

- `case` ∈ `success`, `timeout`, `malformed`, `quota`, plus operation-specific
  extras (`in-queue`, `unavailable`, `malformed-result`, …).
- `<case>.json` is the **recorded** vendor response (sandbox or docs example),
  stored verbatim AFTER running it through the redaction script:

  ```bash
  npx tsx src/scripts/run-redact-fixture.ts path/to/case.json
  ```

  Redaction strips credential-shaped keys, replaces email addresses, and
  normalizes vendor task ids to `TASK_ID`.
- `<case>.meta.json` is an optional sidecar: `{ "status": 503 }` for non-200
  HTTP cases; `{ "timeout": true }` is the meta-only marker for a vendor that
  never answers (no body file).
- `fixture-lint.test.ts` fails the suite if any fixture still contains an
  `Authorization` header, an email address, or a real API-key pattern.

Serve a fixture in a test with `mockVendor(provider, operation, case)`
(`mock-vendor.ts`, msw-based); assert the four mandatory provider paths with
`providerContractTests(...)` (`contract.ts`).
