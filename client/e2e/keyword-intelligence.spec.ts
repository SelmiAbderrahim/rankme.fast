/**
 * Journey A — keyword-intelligence workspace, driven through the REAL
 * shipped workspace UI.
 *
 * The `?tab=research|gap|trends|clusters` workspace ships on
 * `/keyword-research`, so this spec now binds `data-testid` selectors and
 * drives every product mutation through the rendered forms/dialogs — no
 * `page.request` product POSTs remain (note the `?tab=` — not `?view=` —
 * naming). Reads used purely for reconciliation (billing usage, cross-account
 * isolation probes) stay `page.request` GETs.
 *
 * KNOWN SERVER DEFECT (out of scope for the client prompt):
 * `runClustering` derives 32-hex clusterIds
 * (`keyword-research.clustering.ts:457` — sha256 slice(0, 32)) while the
 * decision route validates 64-hex
 * (`keyword-research.schema.ts` `runIdClusterIdParamSchema`), so accepting or
 * dismissing a REAL cluster currently 400s. The accept/dismiss steps below
 * are written to the intended contract and will stay red until the one-line
 * schema fix ships — see defect J6a in the 16-sweep.
 *
 * Serial by design (one story per worker): every step reconciles the exact
 * `keyword_lookups` / `ai_summaries` meter delta so a regression in
 * reserve-before-cache-read, the identity-first free clustering rerun, or the
 * free preview/history/decision reads fails loudly.
 */

import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { freshAccount, signUp } from './helpers/account';
import { runComposePsql } from './helpers/compose';
import { collectDenials, denyNonLoopback } from './helpers/denyNonLoopback';

test.describe.configure({ mode: 'serial' });

interface UsageMetric {
  used: number;
  cap: number | null;
}

interface UsageResponse {
  keywordLookups: UsageMetric;
  aiSummaries: UsageMetric;
  [key: string]: unknown;
}

interface SessionResponse {
  user?: { id?: string };
}

/**
 * Bump an isolated account to Pro (active). The `keyword_research` router
 * gates every route behind `requireTier('pro')`; without this seed every
 * request 402s and no meter-delta assertion is possible. Test-only seam —
 * production never inserts subscription rows outside the Polar webhook path.
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

// Ten deterministic phrases → stored metrics rows the clustering pass reads.
// Lowercase from the start so UI chips, history, and cluster candidates agree.
const CLUSTER_PHRASES = Array.from(
  { length: 10 },
  (_, i) => `cluster seed ${String(i).padStart(2, '0')}`,
);
const slug = (phrase: string): string =>
  phrase.replace(/[^a-z0-9]+/gi, '-').toLowerCase();

async function addPhraseChips(
  page: Page,
  inputTestId: string,
  phrases: readonly string[],
): Promise<void> {
  const input = page.getByTestId(inputTestId);
  for (const phrase of phrases) {
    await input.fill(phrase);
    await input.press('Enter');
  }
}

test('Journey A — keyword-intelligence workspace UI: tabs, previews, runs, clustering identity, decisions', async ({
  page,
  context,
  request,
  baseURL,
}) => {
  // Multi-step composed-stack journey on a shared gate host: align with the
  // sibling journeys' explicit budgets (brand-radar 2_400_000, weekly-pulse
  // 240_000) instead of the 60 s default. This journey also creates two
  // isolated accounts near the end, so composed-stack contention can take it
  // past four minutes. Retries stay 0 and per-assert expect timeouts are
  // untouched — this is wall-clock budget, not assertion leniency.
  test.setTimeout(360_000);

  const denials = collectDenials();
  await denyNonLoopback(context, { onDeny: denials.onDeny });

  const account = freshAccount('keyword-intel');

  await test.step('sign up, verify, bump the account to pro', async () => {
    await signUp(page, account);
    const accountId = await readAccountId(page.request);
    bumpToPro(accountId);
  });

  const baseline = await readUsage(page.request);
  let expectedKeywordLookups = baseline.keywordLookups.used;
  let expectedAiSummaries = baseline.aiSummaries.used;
  const expectDelta = async (
    lookupsDelta: number,
    summariesDelta: number,
    label: string,
  ): Promise<void> => {
    expectedKeywordLookups += lookupsDelta;
    expectedAiSummaries += summariesDelta;
    const after = await readUsage(page.request);
    expect(after.keywordLookups.used, `${label} — keyword_lookups.used`).toBe(
      expectedKeywordLookups,
    );
    expect(after.aiSummaries.used, `${label} — ai_summaries.used`).toBe(
      expectedAiSummaries,
    );
  };

  // The `live-trends` tab is covered by its own dedicated
  // journey — this Labs journey stays scoped to the four tabs it owns.
  await test.step('workspace: the four Labs tabs are URL-backed with reload survival', async () => {
    await page.goto('/keyword-research');
    await expect(page.getByTestId('keyword-intel-workspace')).toBeVisible();
    await expect(page.getByTestId('keyword-research-panel')).toBeVisible();
    for (const tab of ['gap', 'trends', 'clusters', 'research'] as const) {
      await page.getByTestId(`keyword-intel-tab-${tab}`).click();
      await expect(page).toHaveURL(new RegExp(`tab=${tab}`));
      await expect(page.getByTestId(`keyword-intel-tab-${tab}`)).toHaveAttribute(
        'data-state',
        'active',
      );
    }
    // Reload survival + unknown-value normalization.
    await page.goto('/keyword-research?tab=trends');
    await expect(page.getByTestId('keyword-intel-tab-trends')).toHaveAttribute(
      'data-state',
      'active',
    );
    await expect(page.getByTestId('kw-trends-view')).toBeVisible();
    await page.goto('/keyword-research?tab=not-a-tab');
    await expect(page.getByTestId('keyword-intel-tab-research')).toHaveAttribute(
      'data-state',
      'active',
    );
  });

  await test.step('research tab: a ten-phrase lookup spends 10 metrics + 10 intent keyword_lookups', async () => {
    await page.goto('/keyword-research?tab=research');
    await addPhraseChips(page, 'keyword-research-input', CLUSTER_PHRASES);
    await page.getByTestId('keyword-research-submit').click();
    await expect(page.getByTestId('keyword-research-table')).toBeVisible();
    // The shipped panel fires /metrics AND /intent for the same set — both
    // ride the same keyword_lookups meter (one unit per deduped phrase each).
    await expectDelta(CLUSTER_PHRASES.length * 2, 0, 'research metrics+intent');
  });

  await test.step('gap: preview → cancel spends nothing', async () => {
    await page.getByTestId('keyword-intel-tab-gap').click();
    await expect(page.getByTestId('kw-gap-view')).toBeVisible();
    await page.getByTestId('kw-gap-own-domain').fill('evidence-kw.example');
    await addPhraseChips(page, 'kw-gap-competitor-input', [
      'competitor-one.example',
      'competitor-two.example',
    ]);
    await page.getByTestId('kw-gap-preview-cta').click();
    // Server-authoritative preview renders verbatim: 2 units, cached/fresh split.
    await expect(page.getByTestId('kw-preview')).toBeVisible();
    await expect(page.getByTestId('kw-preview-units')).toContainText('2');
    await page.getByTestId('kw-gap-cancel').click();
    await expect(page.getByTestId('kw-preview')).toHaveCount(0);
    await expectDelta(0, 0, 'gap preview + cancel (free)');
  });

  await test.step('gap: confirm spends one unit per deduped competitor and renders per-pair tables with URL filters', async () => {
    await page.getByTestId('kw-gap-preview-cta').click();
    await expect(page.getByTestId('kw-preview')).toBeVisible();
    await page.getByTestId('kw-gap-confirm').click();
    await expect(page.getByTestId('kw-gap-results')).toBeVisible();
    await expectDelta(2, 0, 'gap fresh (two competitors)');
    // Two pair pickers; provenance labels on the pair card.
    await expect(page.getByTestId('kw-gap-pair-competitor-one-example')).toBeVisible();
    await expect(page.getByTestId('kw-gap-pair-competitor-two-example')).toBeVisible();
    await expect(page.getByTestId('kw-provenance-provider_observation')).toBeVisible();
    // URL-backed pair + row filters (the fake comparison fixture includes
    // shared rows plus two competitor-only opportunities).
    await page.getByTestId('kw-gap-pair-competitor-two-example').click();
    await expect(page).toHaveURL(/pair=competitor-two\.example/);
    await page.getByTestId('kw-gap-filter-missing').click();
    await expect(page).toHaveURL(/gapFilter=missing/);
    await expect(page.getByTestId('kw-gap-row-missing-keyword')).toBeVisible();
    await expect(page.getByTestId('kw-gap-row-seo-audit-tool')).toHaveCount(0);
    // Text filter narrows further and survives reload (URL-authoritative).
    await page.getByTestId('kw-gap-q').fill('rank');
    await expect(page).toHaveURL(/q=rank/);
    await page.reload();
    await expect(page.getByTestId('keyword-intel-tab-gap')).toHaveAttribute(
      'data-state',
      'active',
    );
    await expect(page).toHaveURL(/gapFilter=missing/);
    // Filtering a stored result never spends.
    await expectDelta(0, 0, 'gap filters + reload (free)');
  });

  await test.step('trends: preview → confirm spends one unit per phrase; readouts stay labelled Estimate', async () => {
    await page.getByTestId('keyword-intel-tab-trends').click();
    await expect(page.getByTestId('kw-trends-view')).toBeVisible();
    await addPhraseChips(page, 'kw-trends-input', ['seo audit tool', 'rank tracker']);
    await page.getByTestId('kw-trends-preview-cta').click();
    await expect(page.getByTestId('kw-preview')).toBeVisible();
    await page.getByTestId('kw-trends-confirm').click();
    await expect(page.getByTestId('kw-trends-card-seo-audit-tool')).toBeVisible();
    await expect(page.getByTestId('kw-provenance-estimate').first()).toBeVisible();
    // Accessible table fallback accompanies every chart.
    await expect(page.getByTestId('kw-trends-table-seo-audit-tool')).toBeAttached();
    await expectDelta(2, 0, 'trends fresh (two phrases)');
  });

  await test.step('overview: preview → confirm on the research tab; SERP chips + index-freshness copy', async () => {
    await page.getByTestId('keyword-intel-tab-research').click();
    await addPhraseChips(page, 'kw-overview-input', ['seo audit tool', 'rank tracker']);
    await page.getByTestId('kw-overview-preview-cta').click();
    await expect(page.getByTestId('kw-preview')).toBeVisible();
    await page.getByTestId('kw-overview-confirm').click();
    await expect(page.getByTestId('kw-overview-table')).toBeVisible();
    await expect(page.getByTestId('kw-overview-index-note')).toContainText(
      /provider's index/i,
    );
    await expectDelta(2, 0, 'overview fresh (two phrases)');
  });

  await test.step('history reads are free', async () => {
    const response = await page.request.get('/api/keyword-research/history?limit=25');
    expect(response.status()).toBe(200);
    await expectDelta(0, 0, 'history read (free)');
  });

  let runId: string | null = null;
  let acceptedClusterId = '';

  await test.step('clusters: select ten stored phrases, read the one-unit disclosure, run one AI pass', async () => {
    await page.getByTestId('keyword-intel-tab-clusters').click();
    await expect(page.getByTestId('kw-clusters-view')).toBeVisible();
    const disclosure = page.getByTestId('kw-clusters-disclosure');
    await expect(disclosure).toContainText(/one AI summary unit/i);
    await expect(disclosure).toContainText(/free/i);
    for (const phrase of CLUSTER_PHRASES) {
      await page.getByTestId(`kw-clusters-candidate-${slug(phrase)}`).click();
    }
    await expect(page.getByTestId('kw-clusters-count')).toContainText('10 selected');
    await page.getByTestId('kw-clusters-run').click();
    await expect(page.getByTestId('kw-clusters-result')).toBeVisible();
    await expectDelta(0, 1, 'clusters fresh pass');
    // The run id lands in the URL for reload survival.
    await expect(page).toHaveURL(/run=[a-f0-9]{64}/);
    const url = new URL(page.url());
    runId = url.searchParams.get('run');
    expect(runId).toMatch(/^[a-f0-9]{64}$/);
  });

  await test.step('clusters: identical rerun is a free read of the stored run', async () => {
    await page.reload();
    await expect(page.getByTestId('kw-clusters-result')).toBeVisible();
    // Candidates resurface from research history after the reload.
    for (const phrase of CLUSTER_PHRASES) {
      await page.getByTestId(`kw-clusters-candidate-${slug(phrase)}`).click();
    }
    await page.getByTestId('kw-clusters-run').click();
    // Identity-first: stored-run disclosure, same run id, zero spend.
    await expect(page.getByTestId('kw-clusters-cached')).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`run=${runId}`));
    await expectDelta(0, 0, 'clusters identical rerun (free)');
  });

  await test.step('add an owned site through the UI for the acceptance step', async () => {
    // The shipped add-site surface is the /sites page form (`#site-url` in
    // AddSiteForm) — there is no standalone /add-site route in
    // features/sites/routes.tsx.
    await page.goto('/sites');
    await page.locator('#site-url').fill('https://keyword-cluster-target.example');
    await page.getByRole('button', { name: /add|create|save/i }).click();
    await expect(
      page.getByText('keyword-cluster-target.example').first(),
    ).toBeVisible({ timeout: 15_000 });
    await expectDelta(0, 0, 'site creation (free)');
  });

  await test.step('accept one cluster into the owned site and follow the CI deep link (?tab=content&recommendation=)', async () => {
    // KNOWN-RED until the clusterId schema defect (J6a) is fixed:
    // the UI sends the server's own 32-hex clusterId verbatim and the route
    // currently rejects it. Everything up to the server call is real UI.
    await page.goto(`/keyword-research?tab=clusters&run=${runId}`);
    await expect(page.getByTestId('kw-clusters-result')).toBeVisible();
    const firstAccept = page.locator('[data-testid^="kw-cluster-accept-"]').first();
    acceptedClusterId = (await firstAccept.getAttribute('data-testid'))!.replace(
      'kw-cluster-accept-',
      '',
    );
    expect(acceptedClusterId).toMatch(/^[a-f0-9]{32}$/);
    await firstAccept.click();
    await expect(page.getByTestId('kw-accept-dialog')).toBeVisible();
    await page.locator('[data-testid^="kw-accept-site-"]').first().click();
    await page.getByTestId('kw-accept-confirm').click();
    await expect(page.getByTestId('kw-accept-open-recommendation')).toBeVisible();
    await page.getByTestId('kw-accept-open-recommendation').click();
    await expect(page).toHaveURL(/\/sites\/[a-f0-9]{24}\?tab=content&recommendation=keyword-cluster%3A[a-f0-9]{32}/);
    // Decisions are free.
    await expectDelta(0, 0, 'cluster accept + deep link (free)');
    // The generic Next Actions cross-link is reachable from the replayed dialog.
    await page.goto(`/keyword-research?tab=clusters&run=${runId}`);
    await expect(page.getByTestId('kw-clusters-result')).toBeVisible();
    await page.locator('[data-testid^="kw-cluster-card-"]').first().waitFor();
  });

  await test.step('dismiss another cluster; the decision is terminal after reload (409 conflict surface)', async () => {
    await page.goto(`/keyword-research?tab=clusters&run=${runId}`);
    await expect(page.getByTestId('kw-clusters-result')).toBeVisible();
    const dismissButtons = page.locator('[data-testid^="kw-cluster-dismiss-"]');
    const dismissCount = await dismissButtons.count();
    expect(dismissCount, 'at least one undecided cluster to dismiss').toBeGreaterThan(0);
    // Shipped contract (ClustersView header): decision state is SESSION-LOCAL
    // — there is no decision read endpoint, so this fresh page load renders
    // accept/dismiss buttons on every cluster again, including the one the
    // previous step accepted server-side. Dismissing THAT one would 409
    // (append-only terminal decision). Target an undecided cluster; the 409
    // conflict surface is proven deliberately at the end of this step.
    let targetTestId: string | null = null;
    for (let i = 0; i < dismissCount; i += 1) {
      const candidate = await dismissButtons.nth(i).getAttribute('data-testid');
      if (candidate && candidate !== `kw-cluster-dismiss-${acceptedClusterId}`) {
        targetTestId = candidate;
        break;
      }
    }
    expect(targetTestId, 'an undecided cluster to dismiss').not.toBeNull();
    const clusterId = targetTestId!.replace('kw-cluster-dismiss-', '');
    await page.getByTestId(targetTestId!).click();
    await expect(page.getByTestId('kw-dismiss-dialog')).toBeVisible();
    await page.getByTestId('kw-dismiss-confirm').click();
    await expect(page.getByTestId(`kw-cluster-decision-${clusterId}`)).toContainText(
      /dismissed/i,
    );
    await expectDelta(0, 0, 'cluster dismissal (free)');
    // Reload drops session decision state; the append-only log is the
    // authority. A conflicting accept on the SAME cluster must surface the
    // localized 409 conflict banner — that is the terminality proof.
    await page.reload();
    await expect(page.getByTestId('kw-clusters-result')).toBeVisible();
    await page.getByTestId(`kw-cluster-accept-${clusterId}`).click();
    await expect(page.getByTestId('kw-accept-dialog')).toBeVisible();
    await page.locator('[data-testid^="kw-accept-site-"]').first().click();
    await page.getByTestId('kw-accept-confirm').click();
    await expect(page.getByTestId(`kw-cluster-conflict-${clusterId}`)).toBeVisible();
    await expectDelta(0, 0, 'conflicting decision replay (free)');
  });

  await test.step('cross-account read of the stored run returns 404', async () => {
    const secondContext = await context.browser()!.newContext({ baseURL });
    await denyNonLoopback(secondContext, { onDeny: denials.onDeny });
    const secondPage = await secondContext.newPage();
    const secondAccount = freshAccount('keyword-intel-b');
    await signUp(secondPage, secondAccount);
    const secondAccountId = await readAccountId(secondPage.request);
    bumpToPro(secondAccountId);
    const isolation = await secondPage.request.get(
      `/api/keyword-research/clusters/${encodeURIComponent(runId!)}`,
    );
    expect(isolation.status()).toBe(404);
    await secondContext.close();
  });

  await test.step('below-Pro accounts see the honest locked workspace (UI-driven tier state)', async () => {
    const freeContext = await context.browser()!.newContext({ baseURL });
    await denyNonLoopback(freeContext, { onDeny: denials.onDeny });
    const freePage = await freeContext.newPage();
    const freeAccount2 = freshAccount('keyword-intel-free');
    await signUp(freePage, freeAccount2);
    await freePage.goto('/keyword-research');
    await expect(freePage.getByTestId('keyword-research-locked')).toBeVisible();
    await freeContext.close();
  });

  await test.step('Arabic RTL pass over the workspace via the shared locale switcher', async () => {
    await page.goto('/keyword-research?tab=gap');
    await expect(page.getByTestId('kw-gap-view')).toBeVisible();
    await page
      .getByRole('combobox', { name: /language|اللغة/i })
      .first()
      .selectOption('ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('keyword-intel-tab-gap')).toContainText(
      'فجوة الكلمات المفتاحية',
    );
    // Restore English for any later spec sharing the storage state.
    await page
      .getByRole('combobox', { name: /language|اللغة/i })
      .first()
      .selectOption('en');
    await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
  });

  await test.step('zero non-loopback egress across the whole journey', async () => {
    expect(
      denials.urls,
      `unexpected external egress: ${denials.urls.join(', ')}`,
    ).toEqual([]);
  });
});
