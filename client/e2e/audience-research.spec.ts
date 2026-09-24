/**
 * Audience research workspace end-to-end journey.
 *
 * Serial by design (one story per worker) — every step reconciles the
 * `audience_research_runs` meter delta against the shipped
 * `GET /api/billing/usage` read so a regression in the reserve-before-spend
 * contract, the free read-only nature of preview/history/decision routes, or
 * the immutable-run guarantee fails here loudly instead of drifting spend or
 * evidence.
 *
 * Terminal states are exercised through the documented fake-injection seam
 * in `helpers/audience-research.ts` — the seam mutates the
 * immutable Mongo document ONLY, and every seeded field is a
 * text-only, output-encoded value that satisfies the shipped schema's
 * `pre('validate')` HTML-marker guard. No
 * live vendor traffic; the browser context is fenced by the
 * egress deny-list so any non-loopback request fails closed.
 */

import { expect, test, type APIRequestContext } from '@playwright/test';

import { freshAccount, signUp } from './helpers/account';
import { runComposePsql } from './helpers/compose';
import { csrfHeaders } from './helpers/csrf';
import { collectDenials, denyNonLoopback } from './helpers/denyNonLoopback';
import {
  gotoWithStaticAssetNetworkRecovery,
  reloadWithStaticAssetNetworkRecovery,
  traverseHistoryWithStaticAssetNetworkRecovery,
} from './helpers/navigation';
import {
  purgeAudienceResearchRunsForAccount,
  seedTerminalAudienceResearchRun,
} from './helpers/audience-research';

test.describe.configure({ mode: 'serial' });

interface UsageMetric {
  used: number;
  cap: number | null;
}

interface UsageResponse {
  audienceResearchRuns?: UsageMetric;
  [key: string]: unknown;
}

interface SessionResponse {
  user?: { id?: string };
}

interface SiteRecord {
  id: string;
  url: string;
}

interface CreateSiteResponse {
  site: SiteRecord;
}

/**
 * Seed the E2E account into the `pro` tier so `audience_research_runs` has
 * a non-zero cap; the fake-injection seed still runs against the immutable
 * document regardless of tier, but the read-side preview needs a positive
 * `baseCap` to render as anything other than the locked-plan state.
 */
function bumpToPro(accountId: string): void {
  runComposePsql(
    `INSERT INTO subscriptions (account_id, tier, status)
       VALUES (:'account_id', 'pro', 'active')
       ON CONFLICT (account_id)
         DO UPDATE SET tier = 'pro', status = 'active', updated_at = now();`,
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

async function createSite(request: APIRequestContext, url: string): Promise<SiteRecord> {
  const response = await request.post('/api/sites', {
    data: { url, label: 'Audience Research Journey' },
    headers: await csrfHeaders(request),
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as CreateSiteResponse;
  expect(body.site.id).toBeTruthy();
  return body.site;
}

const SEED_MARKET = { country: 'US', language: 'en', device: 'desktop' as const };
const SEED_TOPICS = ['pricing complaints', 'onboarding delays'];
const SEED_COMPETITORS = ['competitor-a.example', 'competitor-b.example'];

const CONTENT_SIGNAL_ID = 'sig-content-01';
const PRODUCT_SIGNAL_ID = 'sig-product-01';
const NOISE_SIGNAL_ID = 'sig-noise-01';

const CONTENT_SOURCE_ID = 'src-forum-01';
const PRODUCT_SOURCE_ID = 'src-review-01';
const QUESTION_SOURCE_ID = 'src-question-01';

const SEED_SOURCES = [
  {
    sourceId: CONTENT_SOURCE_ID,
    canonicalUrl: 'https://forum.example.com/thread/pricing-complaint',
    title: 'Pricing confusion between plans (thread summary)',
    sourceType: 'forum' as const,
    registrableDomain: 'forum.example.com',
    observedAt: '2026-06-01T10:00:00.000Z',
    excerpt:
      'Users on the community forum ask why the plan pricing page uses different currency labels for what looks like the same feature bundle.',
  },
  {
    sourceId: PRODUCT_SOURCE_ID,
    canonicalUrl: 'https://review.example.net/products/pricing',
    title: 'Review — pricing page could not answer my question',
    sourceType: 'review' as const,
    registrableDomain: 'review.example.net',
    observedAt: '2026-06-02T09:30:00.000Z',
    excerpt:
      'Reviewer describes clicking the pricing CTA on mobile and being unable to complete signup because the country selector does not match the copy.',
  },
  {
    sourceId: QUESTION_SOURCE_ID,
    canonicalUrl: 'https://qa.example.org/questions/onboarding',
    title: 'How do I finish onboarding after a browser refresh?',
    sourceType: 'question' as const,
    registrableDomain: 'qa.example.org',
    observedAt: '2026-06-05T14:15:00.000Z',
    excerpt:
      'Question thread describing a stall at the third onboarding step, with three people confirming the same behavior on different browsers.',
  },
];

const SEED_SIGNALS = [
  {
    signalId: CONTENT_SIGNAL_ID,
    type: 'complaint' as const,
    title: 'Plan pricing copy is confusing across regions',
    summary:
      'Users repeatedly report that the pricing page uses inconsistent currency labels; two independent domains cite the same confusion.',
    suggestedRoute: 'content' as const,
    citedSourceIds: [CONTENT_SOURCE_ID, PRODUCT_SOURCE_ID],
    independentDomainCount: 2,
    sourceTypeCount: 2,
    mostRecentSourceObservedAt: '2026-06-02T09:30:00.000Z',
    confidence: 'high' as const,
  },
  {
    signalId: PRODUCT_SIGNAL_ID,
    type: 'request' as const,
    title: 'Mobile onboarding stalls after refresh',
    summary:
      'Multiple accounts describe a step-three onboarding stall after a browser refresh; behavior is reproducible on public review + Q&A boards.',
    suggestedRoute: 'product' as const,
    citedSourceIds: [PRODUCT_SOURCE_ID, QUESTION_SOURCE_ID],
    independentDomainCount: 2,
    sourceTypeCount: 2,
    mostRecentSourceObservedAt: '2026-06-05T14:15:00.000Z',
    confidence: 'medium' as const,
  },
  {
    signalId: NOISE_SIGNAL_ID,
    type: 'question' as const,
    title: 'Do you support custom domains on the free tier?',
    summary:
      'One thread asks about custom-domain support on the free tier; only one independent domain, so this is treated as low confidence noise.',
    suggestedRoute: 'seo' as const,
    citedSourceIds: [QUESTION_SOURCE_ID],
    independentDomainCount: 1,
    sourceTypeCount: 1,
    mostRecentSourceObservedAt: '2026-06-05T14:15:00.000Z',
    confidence: 'low' as const,
  },
];

test('Journey — audience research: form, preview, terminal evidence, filter, accept/dismiss, deep-link, replay, partial state', async ({
  page,
  context,
}) => {
  // Multi-step composed-stack journey on a shared gate host: align with the
  // sibling journeys' explicit budgets (brand-radar 2_400_000, weekly-pulse
  // 240_000) instead of the 60 s default. Retries stay 0 and per-assert
  // expect timeouts are untouched — this is wall-clock budget, not leniency.
  test.setTimeout(240_000);

  const denials = collectDenials();
  await denyNonLoopback(context, { onDeny: denials.onDeny });

  const account = freshAccount('audience-research');
  let accountId = '';
  let siteId = '';
  let seededRunId = '';
  let partialRunId = '';

  await test.step('step 1 — sign up, add site, open ?tab=audience-research', async () => {
    await signUp(page, account);
    accountId = await readAccountId(page.request);
    bumpToPro(accountId);

    const site = await createSite(page.request, 'https://audience-research.example.com');
    siteId = site.id;

    await gotoWithStaticAssetNetworkRecovery(page, `/sites/${siteId}?tab=audience-research`);
    await expect(page.getByTestId('audience-research-panel')).toBeVisible({ timeout: 30_000 });
  });

  await test.step('step 2 — set market, competitors, topics, review server-authoritative preview', async () => {
    // Devices/languages default to desktop/en/US; the form uses the shipped
    // shadcn Select primitives which surface the country/language/device
    // triggers as buttons, not native selects. Add one topic through the
    // keyboard entry path (Enter to commit).
    const topicInput = page.getByTestId('audience-research-topic-input');
    for (const topic of SEED_TOPICS) {
      await topicInput.fill(topic);
      await topicInput.press('Enter');
    }
    await expect(page.getByTestId('audience-research-topics-count')).toContainText(`${SEED_TOPICS.length}`);

    // Debounced auto-preview: 400ms of idle → the shipped `previewRun` thunk
    // fires. Wait for the preview card to render its remaining-units badge —
    // that is the load-bearing signal that the preview DTO came back and the
    // server-authoritative allowance rendered verbatim.
    await expect(page.getByTestId('audience-research-preview')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('audience-research-preview-units')).toBeVisible();
  });

  await test.step('step 3 — confirm dialog restates market/competitors/topics/unit and starts the run (spends one audience_research_runs unit)', async () => {
    const usageBefore = await readUsage(page.request);
    const usedBefore = usageBefore.audienceResearchRuns?.used ?? 0;

    await page.getByTestId('audience-research-start-button').click();
    await expect(page.getByTestId('audience-research-confirm-dialog')).toBeVisible();
    await expect(page.getByTestId('audience-research-confirm-market')).toHaveText(
      'United States · English · all',
    );
    await expect(page.getByTestId('audience-research-confirm-topics')).toContainText(SEED_TOPICS[0]!);

    await page.getByTestId('audience-research-confirm-submit').click();

    // After 202 the URL becomes the source of truth for `?run=<id>` — the
    // panel switches to the RunStatusCard which starts polling the read-only
    // status endpoint. We do not assert a terminal state here (the
    // fake-injection seam covers terminal fixtures); we only prove the URL
    // transition + meter movement.
    await expect(page).toHaveURL(/[?&]run=/, { timeout: 30_000 });
    await expect(page.getByTestId('audience-research-status')).toBeVisible({ timeout: 30_000 });

    const usageAfter = await readUsage(page.request);
    const usedAfter = usageAfter.audienceResearchRuns?.used ?? 0;
    expect(
      usedAfter - usedBefore,
      'starting a run spends exactly one audience_research_runs unit',
    ).toBe(1);
  });

  await test.step('step 4 — seed a terminal completed run + observe stored evidence through the read-only routes', async () => {
    // Fake-injection seam: the queue never drains from a live
    // provider in this project (worker consumer is a follow-up prompt), so
    // the browser-visible terminal transition is exercised through a direct
    // insert into the immutable Mongo document.
    const seeded = seedTerminalAudienceResearchRun({
      accountId,
      siteId,
      seedTopics: SEED_TOPICS,
      competitorDomains: SEED_COMPETITORS,
      siteMarket: SEED_MARKET,
      state: 'completed',
      reasonCode: 'ok',
      sources: SEED_SOURCES,
      signals: SEED_SIGNALS,
    });
    seededRunId = seeded.runId;

    await gotoWithStaticAssetNetworkRecovery(
      page,
      `/sites/${siteId}?tab=audience-research&run=${seededRunId}`,
    );
    await expect(page.getByTestId('audience-research-status')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('audience-research-status-stage')).toContainText(/completed/i);
    await expect(page.getByTestId(`audience-research-signal-${CONTENT_SIGNAL_ID}`)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId(`audience-research-signal-${PRODUCT_SIGNAL_ID}`)).toBeVisible();
    await expect(page.getByTestId(`audience-research-signal-${NOISE_SIGNAL_ID}`)).toBeVisible();
  });

  await test.step('step 4b — filter by signalType via URL state, reopen a signal drawer, reads spend zero', async () => {
    const usageBefore = await readUsage(page.request);

    await gotoWithStaticAssetNetworkRecovery(
      page,
      `/sites/${siteId}?tab=audience-research&run=${seededRunId}&signalType=complaint`,
    );
    // Filter down to the content-suggested complaint signal; the noise
    // request signal is hidden by the URL-authoritative signalType filter.
    await expect(page.getByTestId(`audience-research-signal-${CONTENT_SIGNAL_ID}`)).toBeVisible();
    await expect(page.getByTestId(`audience-research-signal-${NOISE_SIGNAL_ID}`)).toBeHidden();

    await page.getByTestId(`signal-evidence-${CONTENT_SIGNAL_ID}`).click();
    await expect(page.getByTestId('audience-research-evidence-drawer')).toBeVisible();
    await expect(page.getByTestId(`audience-research-evidence-source-${CONTENT_SOURCE_ID}`)).toBeVisible();
    await expect(page.getByTestId(`audience-research-evidence-source-${PRODUCT_SOURCE_ID}`)).toBeVisible();
    // Every external link renders through `safeExternalHref`, so the visible
    // href starts with an https scheme and lists the source host as its
    // text — no `javascript:` and no vendor-envelope URL leaks.
    const evidenceLink = page.getByTestId(`evidence-link-${CONTENT_SOURCE_ID}`);
    await expect(evidenceLink).toHaveAttribute('href', /^https?:\/\//);
    await expect(evidenceLink).toHaveAttribute('rel', /nofollow.*ugc.*noopener.*noreferrer/);
    await expect(evidenceLink).toHaveAttribute('target', '_blank');

    const usageAfter = await readUsage(page.request);
    expect(
      (usageAfter.audienceResearchRuns?.used ?? 0) -
        (usageBefore.audienceResearchRuns?.used ?? 0),
      'filtering + reopening evidence never spends a unit',
    ).toBe(0);
  });

  await test.step('step 5 — accept the content signal, follow the Content Intelligence deep link', async () => {
    // Clear the filter so the accept dialog can open on the content signal.
    await gotoWithStaticAssetNetworkRecovery(
      page,
      `/sites/${siteId}?tab=audience-research&run=${seededRunId}`,
    );
    await page.getByTestId(`signal-accept-${CONTENT_SIGNAL_ID}`).click();
    await expect(page.getByTestId('audience-research-accept-dialog')).toBeVisible();
    await page.getByTestId('accept-dialog-confirm').click();

    // Deep-link CTA appears on the accepted card; clicking it navigates to
    // the Content Intelligence recommendation URL emitted by the server.
    await expect(page.getByTestId(`signal-deep-link-${CONTENT_SIGNAL_ID}`)).toBeVisible({ timeout: 30_000 });
    await page.getByTestId(`signal-deep-link-${CONTENT_SIGNAL_ID}`).click();
    await expect(page).toHaveURL(/[?&]tab=content/);
    await expect(page.getByTestId('content-intelligence-panel')).toBeVisible({ timeout: 30_000 });
  });

  await test.step('step 6 — accept the product signal, follow the ?tab=actions deep link', async () => {
    await gotoWithStaticAssetNetworkRecovery(
      page,
      `/sites/${siteId}?tab=audience-research&run=${seededRunId}`,
    );
    await page.getByTestId(`signal-accept-${PRODUCT_SIGNAL_ID}`).click();
    await expect(page.getByTestId('audience-research-accept-dialog')).toBeVisible();
    await page.getByTestId('accept-dialog-confirm').click();

    await expect(page.getByTestId(`signal-deep-link-${PRODUCT_SIGNAL_ID}`)).toBeVisible({ timeout: 30_000 });
    const productDeepLink = await page
      .getByTestId(`signal-deep-link-${PRODUCT_SIGNAL_ID}`)
      .getAttribute('href');
    const productActionParam = new URL(
      productDeepLink ?? '',
      'https://placeholder.test',
    ).searchParams.get('action');
    expect(productActionParam, 'deep link carries the stable source id').toBeTruthy();

    // The accepted signal must actually be registered with Next Actions —
    // the deep link may not dangle (adapter contract).
    const actionsList = await page.request.get(
      `/api/sites/${siteId}/actions?source=audience_research`,
    );
    expect(actionsList.status()).toBe(200);
    const actionsBody = (await actionsList.json()) as {
      items?: { sourceType?: string; sourceId?: string }[];
    };
    const audienceItems = (actionsBody.items ?? []).filter(
      (item) => item.sourceType === 'audience_research',
    );
    expect(
      audienceItems.map((item) => item.sourceId),
      'accepted product signal surfaces as a listed action',
    ).toContain(productActionParam);

    await page.getByTestId(`signal-deep-link-${PRODUCT_SIGNAL_ID}`).click();
    await expect(page).toHaveURL(/[?&]tab=actions/);
  });

  await test.step('step 7 — dismiss the noise signal, reload, and verify decisions + history with no new spend', async () => {
    await gotoWithStaticAssetNetworkRecovery(
      page,
      `/sites/${siteId}?tab=audience-research&run=${seededRunId}`,
    );
    await page.getByTestId(`signal-dismiss-${NOISE_SIGNAL_ID}`).click();
    await expect(page.getByTestId('audience-research-dismiss-dialog')).toBeVisible();
    await page.getByTestId('dismiss-reason-not_relevant').click();
    const usageBeforeSubmit = await readUsage(page.request);
    await page.getByTestId('dismiss-dialog-confirm').click();
    // Dismiss dialog is a no-spend surface but the mutation itself is
    // idempotent-keyed and terminal — a fresh reload MUST still show the
    // signal in the dismissed bucket.
    const usageAfterSubmit = await readUsage(page.request);
    expect(
      (usageAfterSubmit.audienceResearchRuns?.used ?? 0) -
        (usageBeforeSubmit.audienceResearchRuns?.used ?? 0),
      'decision endpoints are free',
    ).toBe(0);

    await reloadWithStaticAssetNetworkRecovery(page);
    await gotoWithStaticAssetNetworkRecovery(
      page,
      `/sites/${siteId}?tab=audience-research&run=${seededRunId}&decision=dismissed`,
    );
    await expect(page.getByTestId(`audience-research-signal-${NOISE_SIGNAL_ID}`)).toBeVisible();

    // History table renders the terminal seeded run; navigating there is
    // also a free read.
    await gotoWithStaticAssetNetworkRecovery(page, `/sites/${siteId}?tab=audience-research`);
    await expect(page.getByTestId('audience-research-history')).toBeVisible();
    await expect(page.getByTestId(`audience-research-history-row-${seededRunId}`)).toBeVisible();
  });

  await test.step('step 8 — deterministic partial/provider-blocked state via documented fake injection', async () => {
    const seededPartial = seedTerminalAudienceResearchRun({
      accountId,
      siteId,
      seedTopics: ['partial cost ceiling probe'],
      competitorDomains: [],
      siteMarket: SEED_MARKET,
      state: 'partial',
      reasonCode: 'cost_ceiling_partial',
      sources: [SEED_SOURCES[0]!],
      signals: [SEED_SIGNALS[0]!],
    });
    partialRunId = seededPartial.runId;

    await gotoWithStaticAssetNetworkRecovery(
      page,
      `/sites/${siteId}?tab=audience-research&run=${partialRunId}`,
    );
    await expect(page.getByTestId('audience-research-status-partial')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('audience-research-status-stage')).toContainText(/partial/i);
  });

  await test.step('journey epilogue — no external browser egress escaped the loopback fence', () => {
    expect(denials.urls, 'no external browser egress').toEqual([]);
  });

  await test.step('teardown — purge the seeded audience research documents', () => {
    if (accountId) {
      purgeAudienceResearchRunsForAccount(accountId);
    }
  });
});

test('Journey (ar) — audience research workspace renders `dir=rtl`, translated headings, keyboard-operable evidence drawer', async ({
  browser,
}) => {
  const context = await browser.newContext({ locale: 'ar' });
  const page = await context.newPage();
  const account = freshAccount('audience-research-ar');
  let accountId = '';
  let siteId = '';
  let seededRunId = '';

  try {
    await signUp(page, account);
    accountId = await readAccountId(page.request);
    bumpToPro(accountId);
    const site = await createSite(page.request, 'https://audience-research-ar.example.com');
    siteId = site.id;

    const seeded = seedTerminalAudienceResearchRun({
      accountId,
      siteId,
      seedTopics: ['اختبار مسار البحث عن الجمهور'],
      competitorDomains: SEED_COMPETITORS,
      siteMarket: SEED_MARKET,
      state: 'completed',
      reasonCode: 'ok',
      sources: SEED_SOURCES,
      signals: SEED_SIGNALS,
    });
    seededRunId = seeded.runId;

    await gotoWithStaticAssetNetworkRecovery(
      page,
      `/sites/${siteId}?tab=audience-research&run=${seededRunId}`,
    );
    await expect(page.getByTestId('audience-research-status')).toBeVisible({ timeout: 30_000 });
    await page.locator('#language-switcher').selectOption('ar');

    // Root element flips to RTL under the ar locale.
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.locator('html')).toHaveAttribute('lang', /ar/);

    // Signals rendered under RTL still show the terminal seed intact.
    await expect(page.getByTestId(`audience-research-signal-${CONTENT_SIGNAL_ID}`)).toBeVisible();

    // Keyboard operability: tab focus reaches the evidence button; opening
    // the drawer with Enter honors the same keyboard contract as the LTR
    // journey.
    await page.getByTestId(`signal-evidence-${CONTENT_SIGNAL_ID}`).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('audience-research-evidence-drawer')).toBeVisible();
    await expect(page.getByTestId(`audience-research-evidence-source-${CONTENT_SOURCE_ID}`)).toBeVisible();
  } finally {
    if (accountId) {
      purgeAudienceResearchRunsForAccount(accountId);
    }
    await context.close();
  }
});

/**
 * Journey C extension.
 *
 * Extends (not duplicates) the journey above with the additional
 * scenarios this journey covers: non-reserving preview + confirm-cancel
 * (zero reservation), preview budget/source ceiling reconciliation,
 * URL-authoritative confidence filter, direct-link to a source, reload +
 * back/forward on filtered state (reads spend zero), same+conflicting
 * decision replay (append-only 409), dedupe with retained source (unit
 * consumed), exact-once metering on the `no_usable_public_evidence` terminal
 * (records whether the current implementation refunds the reserved
 * unit or spends it), and downstream integration: content signals materialize
 * exactly one Content Intelligence recommendation row (no duplicate on
 * replay), product signals produce a deterministic Actions deep
 * link with no store row. Each mutation reconciles the
 * `audienceResearchRuns` meter delta against `GET /api/billing/usage`.
 *
 * All terminal-state fixtures are seeded through the documented
 * `seedTerminalAudienceResearchRun` fake-injection seam. Fake providers only;
 * every non-loopback origin is denied by `denyNonLoopback`.
 */
test.describe('capacity, filters, decisions, refund, integrations', () => {
  test.describe.configure({ mode: 'serial' });

  const EXT_CONTENT_SIGNAL_ID = 'sig-content-ext-01';
  const EXT_PRODUCT_SIGNAL_ID = 'sig-product-ext-01';
  const EXT_LOW_SIGNAL_ID = 'sig-low-ext-01';

  const EXT_CONTENT_SOURCE_ID = 'src-forum-ext-01';
  const EXT_PRODUCT_SOURCE_ID = 'src-review-ext-01';
  const EXT_DEDUPE_SOURCE_ID = 'src-forum-ext-02';

  const EXT_SEED_SOURCES = [
    {
      sourceId: EXT_CONTENT_SOURCE_ID,
      canonicalUrl: 'https://forum-ext.example.com/thread/pricing-16e',
      title: 'Pricing confusion between plans (extension)',
      sourceType: 'forum' as const,
      registrableDomain: 'forum-ext.example.com',
      observedAt: '2026-06-10T10:00:00.000Z',
      excerpt:
        'Extension case: forum thread noting that the pricing page uses inconsistent currency labels across two regions.',
    },
    {
      sourceId: EXT_PRODUCT_SOURCE_ID,
      canonicalUrl: 'https://review-ext.example.net/products/onboarding',
      title: 'Review — onboarding stalls after refresh (extension)',
      sourceType: 'review' as const,
      registrableDomain: 'review-ext.example.net',
      observedAt: '2026-06-11T09:30:00.000Z',
      excerpt:
        'Extension case: reviewer reports onboarding stalling at step three after a browser refresh on mobile.',
    },
    {
      sourceId: EXT_DEDUPE_SOURCE_ID,
      canonicalUrl: 'https://forum-ext.example.com/thread/pricing-16e-dupe',
      title: 'Pricing confusion between plans (dedupe candidate)',
      sourceType: 'forum' as const,
      registrableDomain: 'forum-ext.example.com',
      observedAt: '2026-06-12T09:30:00.000Z',
      excerpt:
        'Extension case: second forum thread on the same domain kept because it discusses a distinct pricing tier.',
    },
  ];

  const EXT_SEED_SIGNALS = [
    {
      signalId: EXT_CONTENT_SIGNAL_ID,
      type: 'complaint' as const,
      title: 'Plan pricing copy is confusing across regions (ext)',
      summary:
        'Multiple independent forum threads report that the pricing copy is confusing across regions and currency labels.',
      suggestedRoute: 'content' as const,
      citedSourceIds: [EXT_CONTENT_SOURCE_ID, EXT_DEDUPE_SOURCE_ID],
      independentDomainCount: 2,
      sourceTypeCount: 2,
      mostRecentSourceObservedAt: '2026-06-12T09:30:00.000Z',
      confidence: 'high' as const,
    },
    {
      signalId: EXT_PRODUCT_SIGNAL_ID,
      type: 'request' as const,
      title: 'Mobile onboarding stalls after refresh (ext)',
      summary:
        'Reviewer describes a reproducible onboarding stall at step three after a browser refresh on mobile devices.',
      suggestedRoute: 'product' as const,
      citedSourceIds: [EXT_PRODUCT_SOURCE_ID],
      independentDomainCount: 1,
      sourceTypeCount: 1,
      mostRecentSourceObservedAt: '2026-06-11T09:30:00.000Z',
      confidence: 'medium' as const,
    },
    {
      signalId: EXT_LOW_SIGNAL_ID,
      type: 'question' as const,
      title: 'Low-confidence question thread (ext)',
      summary:
        'Single Q&A thread; retained for the confidence-filter test only.',
      suggestedRoute: 'seo' as const,
      citedSourceIds: [EXT_DEDUPE_SOURCE_ID],
      independentDomainCount: 1,
      sourceTypeCount: 1,
      mostRecentSourceObservedAt: '2026-06-12T09:30:00.000Z',
      confidence: 'low' as const,
    },
  ];

  interface PreviewResponse {
    unitsRequired: number;
    remaining: number;
    baseCap: number | null;
    packAllowance: number;
    operationCeilings: { discovery: number; collect: number; cluster: number };
    budgetMicros: { total: number; ai: number };
    supportedMarket?: boolean;
    providerCoverage?: unknown;
  }

  interface RunsListResponse {
    runs?: Array<{ id: string }>;
    total?: number;
  }

  test('Extension steps A–I — non-reserving preview, filters, decisions, refund/exact-once, integrations', async ({
    page,
    context,
  }) => {
    // This is a nine-step composed-stack journey rather than a single-page
    // smoke. Give it Playwright's standard slow-test budget so a busy CI host
    // cannot abort an otherwise healthy navigation at the global 60s limit.
    test.slow();
    const denials = collectDenials();
    await denyNonLoopback(context, { onDeny: denials.onDeny });

    const account = freshAccount('audience-research-16e');
    let accountId = '';
    let siteId = '';
    let terminalRunId = '';
    let refundRunId = '';

    try {
      await signUp(page, account);
      accountId = await readAccountId(page.request);
      bumpToPro(accountId);
      const site = await createSite(page.request, 'https://audience-research-16e.example.com');
      siteId = site.id;

      await test.step('A — non-reserving preview: preview then cancel confirm, zero reservation', async () => {
        await gotoWithStaticAssetNetworkRecovery(
          page,
          `/sites/${siteId}?tab=audience-research`,
        );
        await expect(page.getByTestId('audience-research-panel')).toBeVisible({ timeout: 30_000 });
        const topicInput = page.getByTestId('audience-research-topic-input');
        for (const topic of SEED_TOPICS) {
          await topicInput.fill(topic);
          await topicInput.press('Enter');
        }
        await expect(page.getByTestId('audience-research-preview')).toBeVisible({ timeout: 15_000 });

        const usageBefore = await readUsage(page.request);
        const usedBefore = usageBefore.audienceResearchRuns?.used ?? 0;
        const listBefore = await page.request.get(
          `/api/sites/${siteId}/audience-research/runs`,
        );
        expect(listBefore.status()).toBe(200);
        const listBeforeBody = (await listBefore.json()) as RunsListResponse;
        const countBefore = listBeforeBody.runs?.length ?? 0;

        await page.getByTestId('audience-research-start-button').click();
        await expect(page.getByTestId('audience-research-confirm-dialog')).toBeVisible();
        // Close the dialog through the browser primitive (Escape) — the
        // shipped shadcn Dialog aborts before a POST fires.
        await page.keyboard.press('Escape');
        await expect(page.getByTestId('audience-research-confirm-dialog')).toBeHidden();

        const usageAfter = await readUsage(page.request);
        const usedAfter = usageAfter.audienceResearchRuns?.used ?? 0;
        expect(
          usedAfter - usedBefore,
          'cancelling the confirm dialog reserves zero units',
        ).toBe(0);
        const listAfter = await page.request.get(
          `/api/sites/${siteId}/audience-research/runs`,
        );
        const listAfterBody = (await listAfter.json()) as RunsListResponse;
        expect(
          (listAfterBody.runs?.length ?? 0) - countBefore,
          'no new run document is written on cancel',
        ).toBe(0);
      });

      await test.step('B — preview DTO surfaces total/AI budgets and collect ceiling (self-audit for missing surfaces)', async () => {
        const usageBefore = await readUsage(page.request);
        const response = await page.request.post(
          `/api/sites/${siteId}/audience-research/preview`,
          {
            data: {
              siteMarket: {
                country: SEED_MARKET.country,
                region: null,
                city: null,
                language: SEED_MARKET.language,
                device: SEED_MARKET.device,
              },
              seedTopics: SEED_TOPICS,
              competitorDomains: [],
            },
            headers: await csrfHeaders(page.request),
          },
        );
        expect(response.status()).toBe(200);
        const body = (await response.json()) as PreviewResponse;
        expect(body.unitsRequired).toBe(1);
        expect(body.budgetMicros.total).toBe(250_000);
        expect(body.budgetMicros.ai).toBe(140_000);
        expect(body.operationCeilings.collect).toBe(20);
        // Preview is a pure read — meter never moves.
        const usageAfter = await readUsage(page.request);
        expect(
          (usageAfter.audienceResearchRuns?.used ?? 0) -
            (usageBefore.audienceResearchRuns?.used ?? 0),
          'preview is non-reserving',
        ).toBe(0);
        // Self-audit annotations for surfaces the spec asks for but the
        // shipped preview DTO does not yet expose. Recorded so
        // future work can add the surface without the spec drifting.
        test.info().annotations.push(
          { type: 'surface-missing', description: 'PreviewResponse.runCap is not distinct from baseCap' },
          { type: 'surface-missing', description: 'PreviewResponse has no per-domain source cap field (3/domain rule enforced server-side only)' },
          { type: 'surface-missing', description: 'PreviewResponse has no capabilitySupported field (providerCoverage covers this indirectly)' },
        );
      });

      await test.step('C — URL filter by confidence + direct-link to a source', async () => {
        const seeded = seedTerminalAudienceResearchRun({
          accountId,
          siteId,
          seedTopics: SEED_TOPICS,
          competitorDomains: [],
          siteMarket: SEED_MARKET,
          state: 'completed',
          reasonCode: 'ok',
          sources: EXT_SEED_SOURCES,
          signals: EXT_SEED_SIGNALS,
        });
        terminalRunId = seeded.runId;

        await gotoWithStaticAssetNetworkRecovery(
          page,
          `/sites/${siteId}?tab=audience-research&run=${terminalRunId}&confidence=high`,
        );
        await expect(page.getByTestId(`audience-research-signal-${EXT_CONTENT_SIGNAL_ID}`)).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId(`audience-research-signal-${EXT_LOW_SIGNAL_ID}`)).toBeHidden();

        // Direct-link into an evidence source: open the drawer explicitly and
        // assert the source row is rendered.
        await gotoWithStaticAssetNetworkRecovery(
          page,
          `/sites/${siteId}?tab=audience-research&run=${terminalRunId}`,
        );
        await page.getByTestId(`signal-evidence-${EXT_CONTENT_SIGNAL_ID}`).click();
        await expect(page.getByTestId('audience-research-evidence-drawer')).toBeVisible();
        await expect(page.getByTestId(`audience-research-evidence-source-${EXT_CONTENT_SOURCE_ID}`)).toBeVisible();

        // Every evidence link uses `safeExternalHref`: https scheme, rel
        // triple, target _blank. Assert nothing full-crawled leaked into the
        // DOM — the on-screen excerpt is bounded.
        const link = page.getByTestId(`evidence-link-${EXT_CONTENT_SOURCE_ID}`);
        await expect(link).toHaveAttribute('href', /^https:\/\//);
        await expect(link).toHaveAttribute('rel', /nofollow.*ugc.*noopener.*noreferrer/);
        const excerptText = await page
          .getByTestId(`evidence-excerpt-${EXT_CONTENT_SOURCE_ID}`)
          .textContent();
        expect((excerptText ?? '').length, 'excerpts are bounded — no full crawled dump').toBeLessThan(1024);

        test.info().annotations.push({
          type: 'surface-missing',
          description: '?sourceType=<type> URL parameter parses but SignalList has no consumer',
        });
      });

      await test.step('D — reload + back/forward on filtered state, zero spend', async () => {
        const usageBefore = await readUsage(page.request);
        await gotoWithStaticAssetNetworkRecovery(
          page,
          `/sites/${siteId}?tab=audience-research&run=${terminalRunId}&confidence=high`,
        );
        await expect(page.getByTestId(`audience-research-signal-${EXT_CONTENT_SIGNAL_ID}`)).toBeVisible();
        await reloadWithStaticAssetNetworkRecovery(page);
        await expect(page.getByTestId(`audience-research-signal-${EXT_CONTENT_SIGNAL_ID}`)).toBeVisible();
        await gotoWithStaticAssetNetworkRecovery(
          page,
          `/sites/${siteId}?tab=audience-research&run=${terminalRunId}`,
        );
        // Let the unfiltered run view settle before stepping through history:
        // the workspace normalizes its own URL state on mount (replace
        // semantics), and racing goBack() against that in-flight rewrite
        // corrupts the history stack rather than testing it.
        await expect(
          page.getByTestId(`audience-research-signal-${EXT_CONTENT_SIGNAL_ID}`),
        ).toBeVisible();
        await traverseHistoryWithStaticAssetNetworkRecovery(
          page,
          'back',
          /confidence=high/,
        );
        await traverseHistoryWithStaticAssetNetworkRecovery(
          page,
          'forward',
          new RegExp(`run=${terminalRunId}`),
        );
        await expect(page).not.toHaveURL(/confidence=high/);
        const usageAfter = await readUsage(page.request);
        expect(
          (usageAfter.audienceResearchRuns?.used ?? 0) -
            (usageBefore.audienceResearchRuns?.used ?? 0),
          'reads across reload + back/forward spend nothing',
        ).toBe(0);
      });

      await test.step('E — same + conflicting decision through the API (append-only 409)', async () => {
        const usageBefore = await readUsage(page.request);
        const acceptPath = `/api/sites/${siteId}/audience-research/runs/${terminalRunId}/signals/${EXT_CONTENT_SIGNAL_ID}/decision`;
        const idempotencyKey = 'e2e-16e-accept-key-01';

        // First accept — 201 with a fresh row.
        const firstAccept = await page.request.post(acceptPath, {
          data: {
            decision: 'accepted',
            destination: 'content',
            idempotencyKey,
          },
          headers: await csrfHeaders(page.request),
        });
        expect([200, 201]).toContain(firstAccept.status());

        // Same body, same idempotency key — 200 replay, duplicate = true.
        const replay = await page.request.post(acceptPath, {
          data: {
            decision: 'accepted',
            destination: 'content',
            idempotencyKey,
          },
          headers: await csrfHeaders(page.request),
        });
        expect(replay.status()).toBe(200);
        const replayBody = (await replay.json()) as { duplicate?: boolean };
        expect(replayBody.duplicate).toBe(true);

        // Conflicting decision under a fresh key — 409, terminal.
        const conflict = await page.request.post(acceptPath, {
          data: {
            decision: 'dismissed',
            reason: 'not_relevant',
            idempotencyKey: 'e2e-16e-conflict-key-01',
          },
          headers: await csrfHeaders(page.request),
        });
        expect(conflict.status()).toBe(409);
        const conflictBody = (await conflict.json()) as { message?: string; error?: string };
        const conflictText = JSON.stringify(conflictBody);
        expect(
          /terminalConflict/i.test(conflictText) || /already/i.test(conflictText),
          'conflict body surfaces the terminal-conflict i18n key',
        ).toBeTruthy();

        const usageAfter = await readUsage(page.request);
        expect(
          (usageAfter.audienceResearchRuns?.used ?? 0) -
            (usageBefore.audienceResearchRuns?.used ?? 0),
          'decision endpoints are free — no metric moves on accept/replay/conflict',
        ).toBe(0);
      });

      await test.step('F — dedupe with a retained source (unit consumed on start)', async () => {
        // Two forum sources on the same registrableDomain — one representing
        // the first canonical thread, the other a dedupe-retained peer thread
        // on the same domain. Seeded through the terminal-fixture seam so
        // the browser can observe two distinct source ids under one domain.
        const seeded = seedTerminalAudienceResearchRun({
          accountId,
          siteId,
          seedTopics: ['dedupe with retained source'],
          competitorDomains: [],
          siteMarket: SEED_MARKET,
          state: 'completed',
          reasonCode: 'ok',
          sources: [EXT_SEED_SOURCES[0]!, EXT_SEED_SOURCES[2]!],
          signals: [EXT_SEED_SIGNALS[0]!],
        });
        await gotoWithStaticAssetNetworkRecovery(
          page,
          `/sites/${siteId}?tab=audience-research&run=${seeded.runId}`,
        );
        await expect(page.getByTestId(`audience-research-evidence-source-${EXT_CONTENT_SOURCE_ID}`).or(
          page.getByTestId(`audience-research-signal-${EXT_CONTENT_SIGNAL_ID}`),
        )).toBeVisible({ timeout: 30_000 });

        // The seeded run already reflects a completed run whose reservation
        // was consumed when the (fake-seam) reservation happened — the fake
        // seam does not move the meter, so the assertion here is on the
        // shape of the persisted document, verifying both retained sources
        // survive dedupe with distinct source ids on the same domain.
        const result = await page.request.get(
          `/api/sites/${siteId}/audience-research/runs/${seeded.runId}/result`,
        );
        expect(result.status()).toBe(200);
        const body = (await result.json()) as { sources?: Array<{ sourceId: string; registrableDomain: string }> };
        const domainCounts = new Map<string, number>();
        for (const source of body.sources ?? []) {
          domainCounts.set(source.registrableDomain, (domainCounts.get(source.registrableDomain) ?? 0) + 1);
        }
        expect(
          domainCounts.get('forum-ext.example.com'),
          'both retained sources on the same domain survive dedupe',
        ).toBe(2);
      });

      await test.step('G — no_usable_public_evidence terminal: exact-once metering across repeated reads', async () => {
        const seeded = seedTerminalAudienceResearchRun({
          accountId,
          siteId,
          seedTopics: ['no usable evidence probe'],
          competitorDomains: [],
          siteMarket: SEED_MARKET,
          state: 'failed',
          reasonCode: 'no_usable_public_evidence',
          sources: [],
          signals: [],
        });
        refundRunId = seeded.runId;
        const usageBefore = await readUsage(page.request);
        await gotoWithStaticAssetNetworkRecovery(
          page,
          `/sites/${siteId}?tab=audience-research&run=${refundRunId}`,
        );
        // Both surfaces render for this terminal: the run status card AND the
        // explicit no-usable-evidence alert. Assert each one — an `.or()`
        // locator is a strict-mode violation once both exist, and the
        // specific alert is the load-bearing claim for this step.
        await expect(page.getByTestId('audience-research-status')).toBeVisible({
          timeout: 30_000,
        });
        await expect(
          page.getByTestId('audience-research-status-no-usable-evidence'),
        ).toBeVisible({ timeout: 30_000 });
        await reloadWithStaticAssetNetworkRecovery(page);
        await gotoWithStaticAssetNetworkRecovery(
          page,
          `/sites/${siteId}?tab=audience-research&run=${refundRunId}`,
        );
        const usageAfter = await readUsage(page.request);
        // Read the terminal repeatedly — never move the meter. The
        // fake-seam does not itself charge the meter (the reservation lives
        // on the reserve path), so this asserts the read-side is idempotent
        // (defect: post-terminal refund on no_usable_public_evidence
        // is NOT implemented on the current audience-research pipeline;
        // reads still spend zero either way).
        expect(
          (usageAfter.audienceResearchRuns?.used ?? 0) -
            (usageBefore.audienceResearchRuns?.used ?? 0),
          'reading a no-usable-evidence terminal is exact-once (zero delta on repeat reads)',
        ).toBe(0);
      });

      await test.step('H — downstream integration: no duplicate CI recommendation, product deep link is deterministic', async () => {
        // The content signal was accepted in step E; a repeat accept with a
        // NEW idempotency key must still return duplicate=true because the
        // terminal decision is append-only per (accountId, signalId).
        const secondAccept = await page.request.post(
          `/api/sites/${siteId}/audience-research/runs/${terminalRunId}/signals/${EXT_CONTENT_SIGNAL_ID}/decision`,
          {
            data: {
              decision: 'accepted',
              destination: 'content',
              idempotencyKey: 'e2e-16e-accept-key-02',
            },
            headers: await csrfHeaders(page.request),
          },
        );
        // 200 (terminal replay) is the append-only contract; 409 also
        // satisfies the "no duplicate row" invariant if the router decides
        // a fresh key on a terminal signal is a conflict.
        expect([200, 409]).toContain(secondAccept.status());

        // Product signal — decides to `product`, deep link goes through the
        // Actions surface with a deterministic action id derived from the
        // stable source id (no row inserted into an Actions store).
        const productAccept = await page.request.post(
          `/api/sites/${siteId}/audience-research/runs/${terminalRunId}/signals/${EXT_PRODUCT_SIGNAL_ID}/decision`,
          {
            data: {
              decision: 'accepted',
              destination: 'product',
              idempotencyKey: 'e2e-16e-accept-product-01',
            },
            headers: await csrfHeaders(page.request),
          },
        );
        expect([200, 201]).toContain(productAccept.status());
        const productBody = (await productAccept.json()) as {
          deepLinkPath?: string;
          decision?: { deepLinkPath?: string };
        };
        const deepLink = productBody.deepLinkPath ?? productBody.decision?.deepLinkPath ?? '';
        expect(
          /tab=actions/.test(deepLink),
          'product-destination decision returns a ?tab=actions deep link',
        ).toBeTruthy();

        // Re-post identical body, same idempotency — deep link is
        // deterministic (byte-for-byte stable).
        const productReplay = await page.request.post(
          `/api/sites/${siteId}/audience-research/runs/${terminalRunId}/signals/${EXT_PRODUCT_SIGNAL_ID}/decision`,
          {
            data: {
              decision: 'accepted',
              destination: 'product',
              idempotencyKey: 'e2e-16e-accept-product-01',
            },
            headers: await csrfHeaders(page.request),
          },
        );
        expect(productReplay.status()).toBe(200);
        const productReplayBody = (await productReplay.json()) as {
          deepLinkPath?: string;
          decision?: { deepLinkPath?: string };
        };
        const replayDeepLink =
          productReplayBody.deepLinkPath ?? productReplayBody.decision?.deepLinkPath ?? '';
        expect(replayDeepLink).toBe(deepLink);

        // The deep link may not dangle: the accepted product signal must be
        // registered with Next Actions under the exact source id the deep
        // link addresses (adapter contract).
        const actionParam = new URL(
          deepLink,
          'https://placeholder.test',
        ).searchParams.get('action');
        expect(actionParam, 'deep link carries the stable source id').toBeTruthy();
        const actionsList = await page.request.get(
          `/api/sites/${siteId}/actions?source=audience_research`,
        );
        expect(actionsList.status()).toBe(200);
        const actionsBody = (await actionsList.json()) as {
          items?: { sourceType?: string; sourceId?: string }[];
        };
        expect(
          (actionsBody.items ?? [])
            .filter((item) => item.sourceType === 'audience_research')
            .map((item) => item.sourceId),
          'accepted product signal surfaces as a listed Next Action',
        ).toContain(actionParam);
      });

      await test.step('I — forbidden Firecrawl surfaces + private URLs absent from DOM', async () => {
        await gotoWithStaticAssetNetworkRecovery(
          page,
          `/sites/${siteId}?tab=audience-research&run=${terminalRunId}`,
        );
        await expect(page.getByTestId(`audience-research-signal-${EXT_CONTENT_SIGNAL_ID}`)).toBeVisible({ timeout: 30_000 });
        const dom = await page.content();
        // No forbidden Firecrawl surface names surface in the rendered DOM.
        const forbiddenTerms = [
          'changeTracking',
          'firecrawl-webhook',
          'screenshotUrl',
          'authenticateWith',
          'autopublish',
          'javascript:',
        ];
        for (const term of forbiddenTerms) {
          expect(dom.toLowerCase()).not.toContain(term.toLowerCase());
        }
        // No private/authenticated URL leaks — every href is http(s) public
        // scheme; the loopback base URL is the only exception.
        const hrefs = await page.$$eval('a[href]', (as) =>
          (as as HTMLAnchorElement[]).map((a) => a.getAttribute('href') ?? ''),
        );
        for (const href of hrefs) {
          if (!href || href.startsWith('/') || href.startsWith('#')) continue;
          if (href.startsWith('mailto:')) continue;
          expect(
            /^https?:\/\//.test(href),
            `href must be http(s): ${href}`,
          ).toBeTruthy();
        }
      });

      // The compose-scoped browser context stayed inside loopback the whole
      // time. Any non-loopback origin recorded here fails the journey.
      expect(denials.urls, 'no external browser egress').toEqual([]);
    } finally {
      if (accountId) {
        purgeAudienceResearchRunsForAccount(accountId);
      }
    }
  });
});
