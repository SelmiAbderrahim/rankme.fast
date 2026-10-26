# DataForSEO OnPage fixtures

Recorded or documented OnPage responses consumed by
`shared/providers/dataforseo/onpage*.test.ts`.

## Deep crawl signals

Every response below was requested from the free DataForSEO sandbox
(`https://sandbox.dataforseo.com/v3/on_page/<endpoint>`, cost `0`) and run
through `src/scripts/run-redact-fixture.ts`.

| Folder | Endpoint | `sandbox-shape.json` | Other cases |
|---|---|---|---|
| `pages/` | `/on_page/pages` | recorded | `deep-signals.json` is `sandbox-values-replaced` |
| `duplicate-tags/` | `/on_page/duplicate_tags` | recorded | `sandbox-values-replaced` |
| `duplicate-content/` | `/on_page/duplicate_content` | recorded | `sandbox-values-replaced` |
| `redirect-chains/` | `/on_page/redirect_chains` | recorded | `sandbox-values-replaced` |
| `resources/` | `/on_page/resources` | recorded | `sandbox-values-replaced` |
| `pages-by-resource/` | `/on_page/pages_by_resource` | recorded | `sandbox-values-replaced` |
| `waterfall/` | `/on_page/waterfall` | recorded | `sandbox-values-replaced` |

- `sandbox-shape.json` is the sandbox answer, trimmed to its first item per
  result. The sandbox fills every field with a random placeholder (status codes
  such as `11422`, URLs such as `Url…`), so it proves that the zod schemas accept
  the recorded field set and types. It is not used for value assertions.
- `sandbox-values-replaced` means the file keeps the recorded field names and
  nesting and replaces the placeholder values with a small, consistent
  `example.com` crawl so the normalizers and rules have something meaningful to
  read. No field was invented; every key appears in the recording or in the
  endpoint documentation on docs.dataforseo.com.
- `quota.json` is the documented `40200` "Money limit is exceeded" envelope,
  `malformed.json` a status-code type drift, and `timeout.meta.json` the
  meta-only marker for a vendor that never answers.
- None of these fixtures is a `docs-example`: the sandbox served every endpoint.
