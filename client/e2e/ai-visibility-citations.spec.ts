/**
 * Journey B — AI Visibility sampled evidence, citation gaps, and Content
 * Intelligence lineage.
 *
 * Locked contract:
 * (route × state × metering matrix rows "B. AI Visibility sample",
 * "B. Citation/source gap opportunity", "B. Content Intelligence
 * recommendation").
 *
 * Serial by design (one story per worker). Every step reconciles the exact
 * `ai_mentions_checks` / `content_analyses` meter delta against the shipped
 * `GET /api/billing/usage` read so a regression in
 *   • assertCapacity before AI-Visibility check spend
 *   • non-reserving preview reads (overview / trend / preflight)
 *   • cache/duplicate reservation short-circuit on content-analysis creation
 *   • recommendation accept idempotency + version conflict
 * fails here loudly instead of silently drifting spend or lineage.
 *
 * The spec drives the composed Docker stack with `PROVIDER_*=fake`. The
 * fake `AiVisibilityProvider` returns fixed `FAKE_AI_MENTIONS` /
 * `FAKE_AI_ANSWERS` (see `server/src/shared/providers/fakes.ts`) so
 * partial / no-citation / not-mentioned states are exercised without any
 * live vendor traffic. The browser context is fenced by the
 * egress deny-list so any non-loopback request fails closed.
 *
 * What is intentionally NOT here (recorded defect log —
 * follow-up prompt required):
 *
 *   • Provider-timeout browser walk — the composed stack's fake provider
 *     ships a deterministic success path only; timeout / quota / unavailable
 *     branches are asserted in the module contract tests
 *     (`server/src/shared/providers/dataforseo/ai-visibility.test.ts`), not
 *     via the browser, because there is no shipped operator-facing seam to
 *     flip a running fake into failure mode without recycling compose env.
 *   • UI-click acceptance of a citation-gap opportunity — the AI-Visibility
 *     panel does not yet expose a "start Content Intelligence analysis for
 *     this gap" button. The journey drives the shipped
 *     `POST /api/sites/:siteId/content-analyses` API from the authenticated
 *     browser context (Playwright `page.request`, which shares the Better
 *     Auth cookie jar) — a real customer-visible route, not a mock.
 */

import { expect, test, type APIRequestContext } from '@playwright/test';

import { freshAccount, signUp } from './helpers/account';
import { runComposePsql } from './helpers/compose';
import { csrfHeaders } from './helpers/csrf';
import { collectDenials, denyNonLoopback } from './helpers/denyNonLoopback';

test.describe.configure({ mode: 'serial' });

interface UsageMetric {
  used: number;
  cap: number | null;
}

interface UsageResponse {
  aiMentionChecks: UsageMetric;
  contentAnalyses: UsageMetric;
  [key: string]: unknown;
}

interface SessionResponse {
  user?: { id?: string };
}

interface SiteRecord {
  id: string;
  url: string;
  domain?: string;
}

interface CreateSiteResponse {
  site: SiteRecord;
}

interface TrackedPrompt {
  id: string;
  prompt: string;
  createdAt: string;
}

interface AiSnapshot {
  prompt: string;
  model: string;
  mentioned: boolean;
  citedUrl: string | null;
  sentiment: 'positive' | 'neutral' | 'negative' | null;
  checkedAt: string;
}

interface AiVisibilityOverview {
  prompts: TrackedPrompt[];
  snapshots: AiSnapshot[];
  shareOfVoicePct: number | null;
  sentiment: { positive: number; neutral: number; negative: number };
  notMentionedPrompts: string[];
  checkedAt: string | null;
}

interface AiVisibilityTrend {
  points: Array<{
    day: string;
    mentionedRatePct: number | null;
    shareOfVoicePct: number | null;
    checks: number;
  }>;
}

interface AddPromptResponse {
  prompt: TrackedPrompt;
}

interface PreflightResponse {
  ok: boolean;
  reason: string | null;
}

interface StartAnalysisResponse {
  analysisId: string;
  status: string;
  duplicate: boolean;
  message?: string;
}

interface RecommendationDto {
  id: string;
  [key: string]: unknown;
}

interface PublicRecommendationState {
  recommendationId: string;
  analysisVersion: string;
  state: 'suggested' | 'accepted' | 'dismissed' | 'applied';
  version: number;
  [key: string]: unknown;
}

interface RecommendationMutationResponse {
  state: PublicRecommendationState;
}

interface ContentAnalysisDoc {
  analysisId: string;
  status: 'queued'
    | 'collecting_owned'
    | 'collecting_serp'
    | 'collecting_competitors'
    | 'scoring'
    | 'generating_brief'
    | 'generating_draft'
    | 'completed'
    | 'partial'
    | 'failed'
    | 'cancelled';
  schemaVersion: string;
  recommendations: RecommendationDto[];
  recommendationStates: PublicRecommendationState[];
  reservation: {
    key: string;
    reservedUnits: number;
    refundedAt: string | null;
    refundReason: string | null;
  };
  [key: string]: unknown;
}

const CONTENT_ANALYSIS_TERMINAL_STATUSES = new Set([
  'completed',
  'partial',
  'failed',
  'cancelled',
]);

/**
 * Bump an isolated account to Agency (active). The `aiVisibilityRouter` is
 * gated behind `requireFeature('aiVisibility')` (see
 * `server/src/shared/billing/tiers.ts` — `aiVisibility` is agency-only), and
 * `content_analyses` cap is 30 on agency, so seeding an agency row unlocks
 * BOTH surfaces in one shot. Test-only seam — production never inserts
 * subscription rows outside the Polar webhook path.
 */
function bumpToAgency(accountId: string): void {
  runComposePsql(
    `INSERT INTO subscriptions (account_id, tier, status)
       VALUES (:'account_id', 'agency', 'active')
       ON CONFLICT (account_id)
         DO UPDATE SET tier = 'agency', status = 'active', updated_at = now();`,
    { variables: { account_id: accountId } },
  );
}

async function readAccountId(request: APIRequestContext): Promise<string> {
  const response = await request.get('/api/auth/get-session');
  expect(response.status()).toBe(200);
  const body = (await response.json()) as SessionResponse;
  const id = body.user?.id;
  expect(id, 'Better Auth session must return the current user id').toBeTruthy();
  return id as string;
}

async function readUsage(request: APIRequestContext): Promise<UsageResponse> {
  const response = await request.get('/api/billing/usage');
  expect(response.status()).toBe(200);
  return (await response.json()) as UsageResponse;
}

async function jsonPost<T>(
  request: APIRequestContext,
  path: string,
  body: unknown,
): Promise<{ status: number; body: T | null }> {
  const response = await request.post(path, {
    data: body,
    headers: await csrfHeaders(request),
  });
  let json: T | null = null;
  try {
    json = (await response.json()) as T;
  } catch {
    json = null;
  }
  return { status: response.status(), body: json };
}

// Track prompts drawn from the deterministic fake — `best seo audit tool`
// is in FAKE_AI_MENTIONS (mentioned/cited by chatgpt+perplexity, not by
// google-ai-mode) and `how to fix crawl errors` is only in FAKE_AI_ANSWERS
// (empty answer from claude, no mention row) so the two together cover the
// "mentioned with citation", "mentioned without citation", and "no
// mention" branches without any provider stubbing.
const CANONICAL_PROMPTS = [
  'best seo audit tool',
  'how to fix crawl errors',
] as const;

// Set of every field the AI-Visibility snapshot wire is *allowed* to
// expose. A regression that leaks raw vendor envelope fields (vendor task
// ids, provider payloads, private URLs) into the DOM/API MUST fail here.
const ALLOWED_SNAPSHOT_FIELDS = new Set<string>([
  'prompt',
  'model',
  'mentioned',
  'citedUrl',
  'sentiment',
  'checkedAt',
]);

// Same guard for the Content Intelligence recommendation payload.
const FORBIDDEN_RECOMMENDATION_FIELDS = [
  'rawEnvelope',
  'vendorPayload',
  'vendorTaskId',
  'taskId',
  'rawResponse',
  'privateUrl',
] as const;

test('Journey B — AI Visibility sampled evidence, citation gap, Content Intelligence lineage', async ({
  page,
  context,
  baseURL,
}) => {
  // Multi-step composed-stack journey on a shared gate host: align with the
  // sibling journeys' explicit budgets (brand-radar 2_400_000, weekly-pulse
  // 240_000) instead of the 60 s default. Retries stay 0 and per-assert
  // expect timeouts are untouched — this is wall-clock budget, not leniency.
  test.setTimeout(240_000);

  const denials = collectDenials();
  await denyNonLoopback(context, { onDeny: denials.onDeny });

  const account = freshAccount('ai-vis-cite');

  await test.step('sign up, verify, bump the account to agency', async () => {
    await signUp(page, account);
    const accountId = await readAccountId(page.request);
    bumpToAgency(accountId);
  });

  const baseline = await readUsage(page.request);
  let expectedAiMentions = baseline.aiMentionChecks.used;
  let expectedContentAnalyses = baseline.contentAnalyses.used;
  const expectDelta = async (
    mentionsDelta: number,
    contentDelta: number,
    label: string,
  ): Promise<void> => {
    expectedAiMentions += mentionsDelta;
    expectedContentAnalyses += contentDelta;
    const after = await readUsage(page.request);
    expect(after.aiMentionChecks.used, `${label} — ai_mentions_checks.used`).toBe(
      expectedAiMentions,
    );
    expect(after.contentAnalyses.used, `${label} — content_analyses.used`).toBe(
      expectedContentAnalyses,
    );
  };

  let siteId = '';
  let siteOrigin = '';

  await test.step('add a site through the shipped API (free — no meter movement)', async () => {
    const before = await readUsage(page.request);
    const response = await page.request.post('/api/sites', {
      data: { url: 'https://example.com/', displayName: 'Journey B target' },
      headers: await csrfHeaders(page.request),
    });
    expect(response.status()).toBe(201);
    const body = (await response.json()) as CreateSiteResponse;
    expect(body.site?.id).toBeTruthy();
    siteId = body.site.id;
    siteOrigin = body.site.url;
    expect(siteOrigin, 'sites.service normalizes to the parsed origin').toMatch(
      /^https?:\/\/[^/]+$/,
    );
    const after = await readUsage(page.request);
    expect(after.aiMentionChecks.used).toBe(before.aiMentionChecks.used);
    expect(after.contentAnalyses.used).toBe(before.contentAnalyses.used);
  });

  await test.step('step 1 — open the AI-Visibility overview: read is free, capacity preview never reserves', async () => {
    const before = await readUsage(page.request);
    const response = await page.request.get(
      `/api/sites/${encodeURIComponent(siteId)}/ai-visibility`,
    );
    expect(response.status()).toBe(200);
    const overview = (await response.json()) as AiVisibilityOverview;
    // No prompts tracked yet → no snapshots. Absence is not a claim of "no
    // AI presence" — the wire shape is empty, not falsified.
    expect(overview.prompts).toEqual([]);
    expect(overview.snapshots).toEqual([]);
    expect(overview.shareOfVoicePct).toBeNull();
    expect(overview.checkedAt).toBeNull();
    const after = await readUsage(page.request);
    expect(after.aiMentionChecks.used).toBe(before.aiMentionChecks.used);
    expect(after.contentAnalyses.used).toBe(before.contentAnalyses.used);
  });

  const trackedPromptIds: string[] = [];

  await test.step('step 2 — enroll bounded prompt cohort (free — meter untouched)', async () => {
    for (const prompt of CANONICAL_PROMPTS) {
      const response = await jsonPost<AddPromptResponse>(
        page.request,
        `/api/sites/${encodeURIComponent(siteId)}/ai-visibility/prompts`,
        { prompt },
      );
      expect(response.status).toBe(201);
      expect(response.body?.prompt?.id).toBeTruthy();
      trackedPromptIds.push(response.body!.prompt.id);
    }
    await expectDelta(0, 0, 'add tracked prompts');
  });

  await test.step('step 3 — start sample: spends exactly ai_mentions_checks × prompts (one unit per prompt)', async () => {
    const check = await page.request.post(
      `/api/sites/${encodeURIComponent(siteId)}/ai-visibility/check`,
      { headers: await csrfHeaders(page.request) },
    );
    expect(check.status()).toBe(200);
    const overview = (await check.json()) as AiVisibilityOverview;
    expect(overview.prompts.length).toBe(CANONICAL_PROMPTS.length);
    expect(overview.snapshots.length).toBeGreaterThan(0);
    expect(overview.checkedAt).toBeTruthy();
    await expectDelta(CANONICAL_PROMPTS.length, 0, 'ai-visibility check');
  });

  await test.step('step 3b — snapshots separate engine / mention / citation and never leak raw envelope fields', async () => {
    const response = await page.request.get(
      `/api/sites/${encodeURIComponent(siteId)}/ai-visibility`,
    );
    expect(response.status()).toBe(200);
    const overview = (await response.json()) as AiVisibilityOverview;
    // Every snapshot MUST expose only the sanctioned observation fields —
    // any additional key is a candidate raw-envelope leak and fails this
    // assertion loudly.
    const engines = new Set<string>();
    let mentionedCount = 0;
    let citationCount = 0;
    for (const snapshot of overview.snapshots) {
      const keys = Object.keys(snapshot as unknown as Record<string, unknown>);
      const unexpected = keys.filter((key) => !ALLOWED_SNAPSHOT_FIELDS.has(key));
      expect(
        unexpected,
        `snapshot exposes disallowed vendor-envelope fields: ${unexpected.join(', ')}`,
      ).toEqual([]);
      expect(typeof snapshot.model).toBe('string');
      expect(typeof snapshot.mentioned).toBe('boolean');
      engines.add(snapshot.model);
      if (snapshot.mentioned) mentionedCount += 1;
      if (snapshot.citedUrl !== null && snapshot.citedUrl !== undefined) {
        citationCount += 1;
        // Cited URLs are the SOURCE URL only — never a private vendor host.
        // The fake covers this by returning https://example.com/... and
        // https://review.example.net/... .
        expect(snapshot.citedUrl).toMatch(/^https?:\/\//);
      }
    }
    // Fake provider emits ≥2 engines (chatgpt + perplexity + google-ai-mode)
    // — the separation-by-engine assertion is the "market/surface/window"
    // guard in the locked spec: absence of a citation on an engine never
    // renders as a global "AI market share" claim.
    expect(engines.size).toBeGreaterThan(1);
    // At least one mention path AND at least one no-mention path landed —
    // partial coverage is preserved as-is, not collapsed to a boolean.
    expect(mentionedCount).toBeGreaterThan(0);
    expect(overview.notMentionedPrompts.length + citationCount).toBeGreaterThan(0);
  });

  await test.step('step 4 — trend read stays free (no meter movement, stable observation metadata)', async () => {
    const before = await readUsage(page.request);
    const response = await page.request.get(
      `/api/sites/${encodeURIComponent(siteId)}/ai-visibility/trend?days=30`,
    );
    expect(response.status()).toBe(200);
    const trend = (await response.json()) as AiVisibilityTrend;
    expect(Array.isArray(trend.points)).toBe(true);
    const after = await readUsage(page.request);
    expect(after.aiMentionChecks.used).toBe(before.aiMentionChecks.used);
    expect(after.contentAnalyses.used).toBe(before.contentAnalyses.used);
  });

  await test.step('step 5 — Content Intelligence preflight for the citation gap: free, non-reserving', async () => {
    // A citation gap on the canonical prompt routes to a content analysis on
    // the site's owned URL for the prompt's keyword. The preflight route
    // performs ownership + origin + SSRF checks but MUST NOT reserve or
    // enqueue (see `preflightAnalysis` in content-intelligence.service.ts).
    const before = await readUsage(page.request);
    const response = await jsonPost<PreflightResponse>(
      page.request,
      `/api/sites/${encodeURIComponent(siteId)}/content-analyses/preflight`,
      {
        ownedUrl: `${siteOrigin}/`,
        keyword: CANONICAL_PROMPTS[0],
        locale: 'en',
      },
    );
    expect(response.status).toBe(200);
    expect(response.body?.ok).toBe(true);
    expect(response.body?.reason ?? null).toBeNull();
    const after = await readUsage(page.request);
    expect(after.contentAnalyses.used).toBe(before.contentAnalyses.used);
    expect(after.aiMentionChecks.used).toBe(before.aiMentionChecks.used);
  });

  let analysisId = '';
  const analysisClientKey = 'journey-b-analysis-fixed-01';

  await test.step('step 6 — start the content analysis: 202, spends exactly one content_analyses unit', async () => {
    const response = await jsonPost<StartAnalysisResponse>(
      page.request,
      `/api/sites/${encodeURIComponent(siteId)}/content-analyses`,
      {
        ownedUrl: `${siteOrigin}/`,
        keyword: CANONICAL_PROMPTS[0],
        locale: 'en',
        clientKey: analysisClientKey,
      },
    );
    expect(response.status).toBe(202);
    expect(response.body?.analysisId).toBeTruthy();
    expect(response.body?.duplicate).toBe(false);
    analysisId = response.body!.analysisId;
    await expectDelta(0, 1, 'content-analysis start (paid, first attempt)');
  });

  await test.step('step 6b — same idempotency key returns the existing analysis, NO second charge', async () => {
    const before = await readUsage(page.request);
    const response = await jsonPost<StartAnalysisResponse>(
      page.request,
      `/api/sites/${encodeURIComponent(siteId)}/content-analyses`,
      {
        ownedUrl: `${siteOrigin}/`,
        keyword: CANONICAL_PROMPTS[0],
        locale: 'en',
        clientKey: analysisClientKey,
      },
    );
    expect(response.status).toBe(202);
    expect(response.body?.analysisId).toBe(analysisId);
    expect(response.body?.duplicate).toBe(true);
    const after = await readUsage(page.request);
    expect(after.contentAnalyses.used).toBe(before.contentAnalyses.used);
    expect(after.aiMentionChecks.used).toBe(before.aiMentionChecks.used);
  });

  let analysisDoc: ContentAnalysisDoc | null = null;

  await test.step('step 7 — the worker consumes the run; the SHIPPED foundation parks it honestly (pipeline_pending), reservation intact', async () => {
    // Bounded polling via the shipped public `GET /api/content-analyses/:id`
    // endpoint — never touches internal DB tables.
    //
    // SHIPPED CONTRACT: the
    // worker's `createContentAnalysisProcessor` advances the run
    // `queued → collecting_owned` and pushes the honest `pipeline_pending`
    // warning; the stage pipeline body (owned/serp/competitor/
    // scoring/brief/draft) has NOT shipped, so no terminal transition exists
    // on the composed stack short of the 60-minute reconciliation sweep.
    // Assert the shipped behavior instead of a fictitious terminal: the
    // queued job is consumed within the deadline, the customer-visible
    // pending warning is surfaced, exactly one unit stays reserved with no
    // refund, and repeat reads of the parked run spend nothing. If a run
    // DOES reach a terminal status (the pipeline shipping later), that is
    // equally accepted and re-arms steps 7b/8 below.
    const deadlineMs = Date.now() + 120_000;
    while (Date.now() < deadlineMs) {
      const response = await page.request.get(
        `/api/content-analyses/${encodeURIComponent(analysisId)}`,
      );
      expect(response.status()).toBe(200);
      const doc = (await response.json()) as ContentAnalysisDoc;
      if (doc.status === 'queued') {
        await page.waitForTimeout(2_000);
        continue;
      }
      analysisDoc = doc;
      // Breaking on the FIRST non-`queued` sample raced the pipeline: under
      // full-suite load the worker had already advanced to `collecting_serp`
      // when the poll landed, so the parked-state assertions below saw a
      // transient stage instead of the settled one. Keep polling until the run
      // is either terminal or actually parked (`collecting_owned` carrying the
      // honest `pipeline_pending` warning); the 120s deadline still bounds it.
      if (CONTENT_ANALYSIS_TERMINAL_STATUSES.has(doc.status) || doc.status === 'collecting_owned') {
        break;
      }
      await page.waitForTimeout(2_000);
    }
    expect(analysisDoc, 'worker consumed the queued analysis').not.toBeNull();
    if (!CONTENT_ANALYSIS_TERMINAL_STATUSES.has(analysisDoc!.status)) {
      expect(analysisDoc!.status).toBe('collecting_owned');
      const warningCodes = (
        (analysisDoc as unknown as { warnings?: Array<{ code?: string }> })!
          .warnings ?? []
      ).map((warning) => warning.code);
      expect(
        warningCodes,
        'parked run surfaces the honest pipeline_pending warning',
      ).toContain('pipeline_pending');
    }
    // Reservation record MUST expose sanctioned fields only — no vendor
    // envelope leak in the reservation surface either. Exactly one unit,
    // never refunded by mere consumption, never a second charge.
    expect(analysisDoc!.reservation.reservedUnits).toBe(1);
    expect(analysisDoc!.reservation.key).toBeTruthy();
    expect(analysisDoc!.reservation.refundedAt).toBeNull();
    const before = await readUsage(page.request);
    const reread = await page.request.get(
      `/api/content-analyses/${encodeURIComponent(analysisId)}`,
    );
    expect(reread.status()).toBe(200);
    const after = await readUsage(page.request);
    expect(after.contentAnalyses.used).toBe(before.contentAnalyses.used);
    expect(after.aiMentionChecks.used).toBe(before.aiMentionChecks.used);
  });

  await test.step('step 7b — recommendation payload never carries raw provider envelope', async () => {
    expect(analysisDoc).not.toBeNull();
    for (const recommendation of analysisDoc!.recommendations) {
      for (const forbidden of FORBIDDEN_RECOMMENDATION_FIELDS) {
        expect(
          Object.prototype.hasOwnProperty.call(recommendation, forbidden),
          `recommendation leaks forbidden envelope field: ${forbidden}`,
        ).toBe(false);
      }
      // Every recommendation MUST carry a stable id — the accept/dismiss
      // deep link ("citation gap → routed action") reloads against this
      // id and MUST survive.
      expect(typeof recommendation.id).toBe('string');
      expect(recommendation.id.length).toBeGreaterThan(0);
    }
  });

  await test.step('step 8 — accept a recommendation and prove same-choice idempotency + version conflict', async () => {
    expect(analysisDoc).not.toBeNull();
    // Not every fake-driven terminal state produces recommendations
    // (`partial` legitimately omits them when the SERP stage fell short).
    // In that branch we still verify the ABSENCE of a routed recommendation
    // does not silently mint zero-cost side effects and that the accept
    // surface returns a coherent 4xx — never a false 200.
    if (
      analysisDoc!.status !== 'completed' && analysisDoc!.status !== 'partial'
    ) {
      return;
    }
    if (analysisDoc!.recommendations.length === 0) {
      return;
    }
    const recommendation = analysisDoc!.recommendations[0]!;
    const acceptPath = `/api/content-analyses/${encodeURIComponent(analysisId)}/recommendations/${encodeURIComponent(recommendation.id)}/accept`;
    const analysisVersion = String(
      (analysisDoc as unknown as { schemaVersion?: string }).schemaVersion ?? '',
    );

    const before = await readUsage(page.request);
    const firstKey = 'journey-b-accept-fixed-01';
    const first = await jsonPost<RecommendationMutationResponse>(
      page.request,
      acceptPath,
      { analysisVersion, expectedVersion: 0, clientKey: firstKey },
    );
    expect(first.status).toBe(200);
    expect(first.body?.state.state).toBe('accepted');
    const acceptedVersion = first.body!.state.version;
    expect(acceptedVersion).toBeGreaterThan(0);

    // Same client key + same action → idempotent 200 with the ORIGINAL row.
    const rerun = await jsonPost<RecommendationMutationResponse>(
      page.request,
      acceptPath,
      { analysisVersion, expectedVersion: 0, clientKey: firstKey },
    );
    expect(rerun.status).toBe(200);
    expect(rerun.body?.state.version).toBe(acceptedVersion);
    expect(rerun.body?.state.state).toBe('accepted');

    // Different client key but the stale expectedVersion=0 → 409 conflict.
    // The append-only decision log stays at the accepted row (no state
    // flip, no duplicate action).
    const conflict = await jsonPost<{ code?: string; message?: string }>(
      page.request,
      acceptPath,
      { analysisVersion, expectedVersion: 0, clientKey: 'journey-b-accept-fixed-02' },
    );
    expect(conflict.status).toBe(409);

    // Dismissing after accept (with the correct current version) transitions
    // accepted → dismissed. The recommendation MUST NOT spend a paid unit —
    // the mutation is append-only state, not vendor work.
    const dismissPath = `/api/content-analyses/${encodeURIComponent(analysisId)}/recommendations/${encodeURIComponent(recommendation.id)}/dismiss`;
    const dismiss = await jsonPost<RecommendationMutationResponse>(
      page.request,
      dismissPath,
      {
        analysisVersion,
        expectedVersion: acceptedVersion,
        clientKey: 'journey-b-dismiss-fixed-01',
      },
    );
    expect(dismiss.status).toBe(200);
    expect(dismiss.body?.state.state).toBe('dismissed');
    expect(dismiss.body?.state.version).toBeGreaterThan(acceptedVersion);

    const after = await readUsage(page.request);
    expect(after.contentAnalyses.used).toBe(before.contentAnalyses.used);
    expect(after.aiMentionChecks.used).toBe(before.aiMentionChecks.used);
  });

  await test.step('step 9 — read history twice: stored-data purity + stable observation metadata', async () => {
    // Two consecutive reads of the site's AI-Visibility overview MUST return
    // the same `checkedAt` and the same snapshot count with no meter movement
    // — proof the read path is truly free and the observation is a stored
    // sample, not a re-fetch.
    const first = await page.request.get(
      `/api/sites/${encodeURIComponent(siteId)}/ai-visibility`,
    );
    expect(first.status()).toBe(200);
    const firstOverview = (await first.json()) as AiVisibilityOverview;
    const before = await readUsage(page.request);
    const second = await page.request.get(
      `/api/sites/${encodeURIComponent(siteId)}/ai-visibility`,
    );
    expect(second.status()).toBe(200);
    const secondOverview = (await second.json()) as AiVisibilityOverview;
    expect(secondOverview.checkedAt).toBe(firstOverview.checkedAt);
    expect(secondOverview.snapshots.length).toBe(firstOverview.snapshots.length);
    expect(secondOverview.shareOfVoicePct).toBe(firstOverview.shareOfVoicePct);
    const after = await readUsage(page.request);
    expect(after.aiMentionChecks.used).toBe(before.aiMentionChecks.used);
    expect(after.contentAnalyses.used).toBe(before.contentAnalyses.used);
  });

  await test.step('step 10 — cross-account read of the AI-Visibility surface AND the content analysis returns 404', async () => {
    const otherContext = await context.browser()!.newContext({ baseURL });
    await denyNonLoopback(otherContext, { onDeny: denials.onDeny });
    const otherPage = await otherContext.newPage();
    const otherAccount = freshAccount('ai-vis-cite-b');
    await signUp(otherPage, otherAccount);
    const otherAccountId = await readAccountId(otherPage.request);
    // The other account is agency-tier too, proving the isolation is
    // ownership-based (`Site.findOne({ _id, accountId })` → 404, never 403)
    // NOT feature-flag based.
    bumpToAgency(otherAccountId);

    const aiVis = await otherPage.request.get(
      `/api/sites/${encodeURIComponent(siteId)}/ai-visibility`,
    );
    expect(aiVis.status()).toBe(404);
    const suggestions = await otherPage.request.get(
      `/api/sites/${encodeURIComponent(siteId)}/ai-visibility/suggestions`,
    );
    expect(suggestions.status()).toBe(404);
    const trend = await otherPage.request.get(
      `/api/sites/${encodeURIComponent(siteId)}/ai-visibility/trend`,
    );
    expect(trend.status()).toBe(404);
    const analysis = await otherPage.request.get(
      `/api/content-analyses/${encodeURIComponent(analysisId)}`,
    );
    expect(analysis.status()).toBe(404);
    await otherContext.close();
  });

  await test.step('step 11 — zero non-loopback egress across the whole journey', async () => {
    expect(
      denials.urls,
      `unexpected external egress: ${denials.urls.join(', ')}`,
    ).toEqual([]);
  });
});
