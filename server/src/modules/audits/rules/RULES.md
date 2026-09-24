# Audit Rule Catalogue

Developer-facing reference. Every rule listed here has stable id, deterministic bucket policy, and localized copy in all seven locales (`en, ar, fr, de, es, ru, zh`) under the `auditRules` namespace. Prompt 20 turns this file into user-facing docs.

| id | trigger | bucket policy |
|----|---------|---------------|
| `robots-blocked` | Pages non-indexable with a `robots.txt`-derived reason. | Any hit → `fix-now` (critical). Otherwise `passed`. |
| `sitemap-missing-or-weak` | `domainChecks.sitemapFound` false → `fix-now`. Found but `sitemapReferencedInRobots` false → `watch`. Signal undefined → `watch` (`insufficientData`). Otherwise `passed`. |
| `title-missing-or-weak` | Indexable page with missing / whitespace-only title → `fix-now`. Title < 10 or > 60 characters → `watch`. Otherwise `passed`. |
| `meta-description-missing` | Indexable page with missing description, or the same description on ≥2 pages → `watch`. Otherwise `passed`. |
| `headings-weak` | Indexable page with no H1 → `fix-now`. Page with ≥2 H1s → `watch`. Otherwise `passed`. |
| `canonical-missing-or-broken` | Indexable page with canonical pointing to a different origin (or an unparseable URL) → `fix-now`. Missing canonical → `watch`. Otherwise `passed`. |
| `structured-data-missing` | Indexable page with `structuredDataErrors.length > 0` → `fix-now`. Indexable page with no structured data → `watch`. Otherwise `passed`. |
| `broken-internal-links` | Any indexable page with a non-empty `brokenLinks[]` → `fix-now`. Otherwise `passed`. |
| `thin-content` | Indexable page with `wordCount < 200` → `watch`. No page has `wordCount` → `watch` (`insufficientData`). Otherwise `passed`. |
| `faq-content-missing` | Indexable page with `hasFaqSignals === false` → `watch`. No page has `hasFaqSignals` → `watch` (`insufficientData`). Otherwise `passed`. Never `fix-now`. |
| `llms-txt-missing` | `domainChecks.llmsTxtFound` false → `watch` (info). Signal undefined → `watch` (`insufficientData`, info). Otherwise `passed`. Copy explicitly advisory. |
| `https-canonicalization` | HTTPS not enforced OR `httpsRedirect === false` → `fix-now`. `canonicalizationOk === false` → `watch`. Otherwise `passed`. |
| `core-web-vitals-poor` | (PageSpeed) Any sampled URL with CrUX p75 category `poor` → `fix-now`. Any `needs-improvement` → `watch`. No field data on any sample → `watch` (`insufficientData: 'no-field-data'`) — "not enough visitor data yet". Provider unavailable → `watch` (`insufficientData: 'unavailable'`). Otherwise `passed`. |
| `page-speed-lab-low` | Any sampled URL with Lighthouse performance < 50 → `watch`. Copy MUST label this a "lab estimate" — a single Lighthouse run varies ~10 points between attempts. Otherwise `passed`. |
| `mobile-unfriendly` | Any sampled MOBILE URL with `mobileFriendly === false` (derived from the Lighthouse `viewport` + `tap-targets` audits) → `fix-now`. No mobile samples → `watch` (`no-mobile-samples`). Mobile samples without a signal → `watch` (`no-signal`). Otherwise `passed`. |
| `accessibility-low` | Any sampled URL with Lighthouse accessibility < 90 → `watch`; any sample < 70 escalates the finding to `fix-now` (critical). Copy MUST label this a "lab estimate", never a legal-compliance verdict. Provider unavailable / no samples → `watch` (`insufficientData`). Otherwise `passed`. |
| `not-indexed` | (GSC URL inspection) Any sampled URL with index verdict `FAIL` or `NEUTRAL` → `fix-now` (critical). No connection / needs-reconnect / quota exceeded / unavailable → `watch` (`insufficientData` with `reason`). Zero samples with `status: 'ok'` → `passed`. |
| `rich-results-issues` | Any sampled URL with richResults verdict `FAIL`, or verdict `PARTIAL` with any item carrying `issues > 0` → `watch` (warning). Never `fix-now` — rich-result issues cost the snippet, not the ranking. `status !== 'ok'` → `watch` (`insufficientData`). Otherwise `passed`. |
| `index-partial` | Any sampled URL with index verdict `PARTIAL` → `watch` (warning) — the page is indexed but Google flagged a signal (canonicalization, duplicate content). `status !== 'ok'` → `watch` (`insufficientData`). Otherwise `passed`. |
| `gsc-ctr-low` | (GSC Search Analytics) `status === 'ok'` AND any top query with `impressions >= 1000` AND `ctr < 0.01` → `watch` (warning). Copy: Google shows the page often but few people click — rewrite the title/meta description. `status !== 'ok'` (incl. `no-data`) or null input → `watch` (`insufficientData`). No qualifying query → `passed`. **Never `fix-now`** — CTR is opportunity, not breakage. |
| `sitemap-errors` | (GSC sitemaps) `status === 'ok'` AND any submitted sitemap with `errors > 0` → `fix-now` (critical) — errors block indexing. Else any sitemap with `warnings > 0` → `watch`. `status === 'no-sitemaps'` → `watch` (`insufficientData: 'no-sitemaps'` — "no sitemap submitted to Google"). Other non-`ok` status / null → `watch` (`insufficientData`). Otherwise `passed`. Distinct from the crawl-based `sitemap-missing-or-weak`: this is Google's own verdict on what was submitted. |
| `ai-visibility-low` | (AI Visibility) Passing fixture: tracked prompts have at least one Google AI Overview citation or AI chat mention, and competitors do not own all answers. Failing fixtures: no presence across checked Google AI Overview + AI chat answers; competitors are present and share of voice is 0%; negative brand wording is the plurality of checked AI chat answers. Non-`ok` / no tracked prompts / null → `watch` (`insufficientData`). | Always `watch` for opportunities, never `fix-now`; otherwise `passed`. |
| `nap-inconsistency` | (Local SEO) Any business-listing directory row with `consistent: false` (name/address/phone mismatch vs the canonical listing) → `fix-now` (critical) — mismatched NAP actively hurts local rank. `status !== 'ok'` / null → `watch` (`insufficientData`). Otherwise `passed`. | The one local-seo rule that can land in `fix-now`. |
| `low-review-count` | `reviews !== null && reviews.reviewCount < 10` → `watch`. Absent reviews data or `status !== 'ok'` / null → `watch` (`insufficientData`). Otherwise `passed`. | Always `watch`, never `fix-now` — an opportunity, not a defect. |
| `low-review-rating` | `reviews !== null && reviews.averageRating !== null && reviews.averageRating < 4.0` → `watch`. Missing rating data or `status !== 'ok'` / null → `watch` (`insufficientData`). Otherwise `passed`. | Always `watch`, never `fix-now`. |
| `local-pack-not-ranking` | `localPack !== null && localPack.position === null` → `watch` — mirrors the `not-indexed` pattern: a visibility gap, not a defect. `localPack === null` (no local-pack keyword tracked) → `watch` (`insufficientData`, copy explains how to enable the opt-in `trackLocalPack` flag on a tracked keyword). `status !== 'ok'` / null → `watch` (`insufficientData`). Otherwise `passed`. | Always `watch`, never `fix-now`. |

## Design notes

- Rules are **pure functions over `AuditResult`** (`server/src/shared/providers/types.ts`). They never touch a vendor field name — that firewall keeps rule ids stable across vendor swaps.
- Every rule is registered in `ALL_RULES` (`engine.ts`). The rule suite (`rules.test.ts`) has a meta-test that fails if a new rule is registered without both a passing and a failing fixture.
- Bucketing lives in `bucket.ts` in ONE function: `bucketFor(severity, passed)`. Rules never invent buckets.
- Priority within a bucket = severity first, then affected-URL count (larger blast radius sinks lower id), stable tiebreak by `ruleId`.
- Reports are frozen at snapshot time in `report_snapshots` — copy and thresholds can change, but a report a user got yesterday must not silently retell its story tomorrow.
- Snapshot diff (`diffSnapshots`) groups per `(ruleId, url)` into `fixed | regressed | new | unchanged`. The report screen reads it.
- **GSC meta enrichment (no new rule ids).** `not-indexed` findings carry `meta.coverageState` + `meta.robotsTxtState` (when present); `index-partial` carries `meta.coverageState` + `meta.pageFetchState`. `resolveGscReasonKey` (`report.service.ts`) maps these onto localized reason copy (`auditRules.not-indexed.reasons.robotsBlocked` / `.pageNotFetchable` / `.coverageUnknown`, `auditRules.index-partial.reasons.pageFetchProblem` / `.coverageWarning`) so the report can say *"blocked by robots.txt"* vs *"Google couldn't fetch the page"*. Bucket policy unchanged.
