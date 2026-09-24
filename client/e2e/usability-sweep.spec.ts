/**
 * Cross-feature keyboard and URL-state usability sweep.
 *
 * The composed stack uses only shipped fake providers. Test-only setup is
 * limited to the established Postgres/Mongo account seam: tier/role rows are
 * updated for isolated accounts, while every preview, confirmation, stored
 * read, export, and navigation goes through the production UI and APIs.
 */
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
} from '@playwright/test';

import {
  freshAccount,
  logIn,
  signUp,
  type TestAccount,
} from './helpers/account';
import {
  runComposeApiScript,
  runComposePsql,
} from './helpers/compose';
import { csrfHeaders } from './helpers/csrf';
import {
  collectDenials,
  denyNonLoopback,
} from './helpers/denyNonLoopback';
import { waitForRunTerminal } from './helpers/waitForRunTerminal';

test.describe.configure({ mode: 'serial' });

type Tier = 'pro' | 'agency';

interface JsonResponse {
  status(): number;
  text(): Promise<string>;
  json(): Promise<unknown>;
}

interface SessionResponse {
  user?: { id?: string };
}

interface SiteResponse {
  site: { id: string };
}

interface StartedRun {
  runId: string;
}

interface CreatedScan {
  scanId: string;
}

interface ReviewRun {
  status: 'succeeded' | 'partial' | 'failed';
  aiTerminalState: string;
  retainedCount: number;
}

async function json<T>(
  response: JsonResponse,
  expectedStatus = 200,
): Promise<T> {
  expect(response.status(), await response.text()).toBe(expectedStatus);
  return (await response.json()) as T;
}

async function accountId(request: APIRequestContext): Promise<string> {
  const session = await json<SessionResponse>(
    await request.get('/api/auth/get-session'),
  );
  expect(session.user?.id).toBeTruthy();
  return session.user!.id!;
}

function setTier(id: string, tier: Tier): void {
  runComposePsql(
    `UPDATE "user"
        SET email_verified = true, updated_at = now()
      WHERE id = :'account_id';

     INSERT INTO subscriptions
       (account_id, tier, status, brand_radar)
       VALUES (
         :'account_id',
         :'tier',
         'active',
         :'brand_radar'::boolean
       )
       ON CONFLICT (account_id)
         DO UPDATE SET tier = EXCLUDED.tier,
                       status = 'active',
                       brand_radar = EXCLUDED.brand_radar,
                       updated_at = now();`,
    {
      variables: {
        account_id: id,
        tier,
        brand_radar: tier === 'agency' ? 'true' : 'false',
      },
    },
  );
}

async function signUpAtTier(
  page: Page,
  prefix: string,
  tier: Tier,
): Promise<{ account: TestAccount; id: string }> {
  const account = freshAccount(prefix);
  await signUp(page, account);
  const id = await accountId(page.request);
  await page.goto('/logout');
  await page.waitForURL('/login');
  setTier(id, tier);
  await logIn(page, account);
  return { account, id };
}

async function createSite(
  request: APIRequestContext,
  id: string,
): Promise<string> {
  const created = await json<SiteResponse>(
    await request.post('/api/sites', {
      data: {
        url: `https://usability-${id.slice(-10)}.example`,
        label: 'Usability sweep',
      },
      headers: await csrfHeaders(request),
    }),
    201,
  );
  return created.site.id;
}

function promoteToSuperadmin(id: string): void {
  runComposePsql(
    `UPDATE "user"
        SET role = 'SuperAdmin',
            two_factor_enabled = true,
            email_verified = true,
            updated_at = now()
      WHERE id = :'account_id';`,
    { variables: { account_id: id } },
  );
  runComposeApiScript(
    `
      const mongooseModule = await import('mongoose');
      const mongoose = mongooseModule.default;
      await mongoose.connect(process.env.MONGODB_URI);
      await mongoose.connection.db.collection('users').updateOne(
        { _id: new mongoose.Types.ObjectId(process.env.SWEEP_ACCOUNT_ID) },
        { $set: { role: 'SuperAdmin' } },
      );
      await mongoose.disconnect();
    `,
    { SWEEP_ACCOUNT_ID: id },
  );
}

async function tabTo(
  page: Page,
  target: Locator,
  maxTabs = 240,
): Promise<void> {
  await expect(target).toBeVisible();
  for (let index = 0; index <= maxTabs; index += 1) {
    const focused = await target
      .evaluate((node) => document.activeElement === node)
      .catch(() => false);
    if (focused) {
      await expect(target).toBeFocused();
      await expect
        .poll(() =>
          target
            .evaluate((node) => node.matches(':focus-visible'))
            .catch(() => false),
        )
        .toBe(true);
      return;
    }
    await page.keyboard.press('Tab');
  }
  throw new Error(`keyboard focus did not reach ${await target.evaluate((node) => node.outerHTML)}`);
}

async function activate(
  page: Page,
  target: Locator,
  key: 'Enter' | 'Space' = 'Enter',
): Promise<void> {
  await tabTo(page, target);
  await page.keyboard.press(key);
}

async function keyboardDownload(
  page: Page,
  trigger: Locator,
): Promise<string> {
  const download = page.waitForEvent('download');
  await activate(page, trigger);
  const stream = await (await download).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function reloadAndExpectVisible(page: Page, target: Locator): Promise<void> {
  await page.reload();
  try {
    await expect(target).toBeVisible();
  } catch (error) {
    const blankDocument = await page.evaluate(() => {
      const root = document.querySelector('#root');
      return (root?.childElementCount ?? 0) === 0 && (document.body.textContent ?? '').trim() === '';
    });
    if (!blankDocument) throw error;
    // A shared-host Docker network update can make Chromium lose JS chunks
    // after the HTML loads. Recover only that empty-document transport case;
    // product assertion failures are never retried.
    await page.reload();
    await expect(target).toBeVisible();
  }
}

async function assertHistoryPair(
  page: Page,
  first: { path: string; marker: Locator },
  second: { path: string; marker: Locator },
): Promise<void> {
  await page.goto(first.path);
  await expect(first.marker).toBeVisible();
  await reloadAndExpectVisible(page, first.marker);
  await page.goto(second.path);
  await expect(second.marker).toBeVisible();
  await page.goBack();
  await expect(first.marker).toBeVisible();
  await page.goForward();
  await expect(second.marker).toBeVisible();
}

test('keyboard-only paid flows, CSV exports, and superadmin panels', async ({
  page,
  context,
}) => {
  test.setTimeout(420_000);
  const denials = collectDenials();
  await denyNonLoopback(context, { onDeny: denials.onDeny });
  const account = await signUpAtTier(page, 'usability-paid', 'agency');
  const siteId = await createSite(page.request, account.id);
  const suffix = account.id.slice(-8);

  await test.step('Link Intelligence preview → confirm → result uses the keyboard', async () => {
    await page.goto(`/sites/${siteId}/backlinks?tab=domains&utm=sweep`);
    await expect(page.getByTestId('link-intel-view-domains')).toBeVisible();
    await activate(page, page.getByTestId('link-intel-preview-refDomains'));
    await expect(page.getByTestId('link-intel-preview')).toBeVisible();
    const started = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().includes('/api/backlinks/deep/') &&
        !response.url().endsWith('/preview'),
    );
    await activate(page, page.getByTestId('link-intel-confirm-refDomains'));
    const { runId } = await json<StartedRun>(await started, 202);
    const terminal = await waitForRunTerminal<{ status: string }>({
      request: page.request,
      url: `/api/backlinks/runs/${runId}`,
      terminal: ['succeeded', 'failed'],
      options: {
        deadlineMs: 45_000,
        intervalMs: 250,
        label: `keyboard link run ${runId}`,
      },
    });
    expect(terminal.body.status).toBe('succeeded');
    await reloadAndExpectVisible(page, page.getByTestId('referring-domains-table'));
  });

  await test.step('Traffic Insights preview → confirm → result uses the keyboard', async () => {
    await page.goto(`/sites/${siteId}?tab=traffic&utm=sweep`);
    const domain = page.locator('#traffic-domain');
    await tabTo(page, domain);
    await page.keyboard.type(`traffic-${suffix}.example`);
    await activate(page, page.getByRole('button', { name: 'Preview snapshot' }));
    await expect(page.getByTestId('traffic-preview')).toBeVisible();
    const started = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/api/competitors/traffic-snapshots'),
    );
    await activate(page, page.getByRole('button', { name: 'Confirm snapshot' }));
    const { runId } = await json<StartedRun>(await started, 202);
    const terminal = await waitForRunTerminal<{ status: string }>({
      request: page.request,
      url: `/api/competitors/traffic-snapshots/${runId}`,
      terminal: ['succeeded', 'partial', 'failed'],
      options: {
        deadlineMs: 45_000,
        intervalMs: 250,
        label: `keyboard traffic run ${runId}`,
      },
    });
    expect(terminal.body.status).toBe('succeeded');
    const openSnapshot = page.getByRole('button', { name: 'Open snapshot' }).first();
    await reloadAndExpectVisible(page, openSnapshot);
    await activate(
      page,
      openSnapshot,
    );
    await expect(page.getByTestId('traffic-stat-monthlyVisits')).toBeVisible();
  });

  await test.step('Keyword Trends preview → confirm → result uses the keyboard', async () => {
    await page.goto('/keyword-research/live-trends?utm=sweep');
    const input = page.getByTestId('live-trends-input');
    await tabTo(page, input);
    await page.keyboard.type(`usability trend ${suffix}`);
    await page.keyboard.press('Enter');
    await activate(page, page.getByTestId('live-trends-preview-cta'));
    await expect(page.getByTestId('live-trends-preview')).toBeVisible();
    const started = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/api/keyword-research/trends/explore'),
    );
    await activate(page, page.getByTestId('live-trends-confirm'));
    const result = await json<{ status: string }>(await started);
    expect(result.status).toBe('succeeded');
    await expect(page.getByTestId('live-trends-results')).toBeVisible();
  });

  await test.step('Review Intelligence preview → confirm → result and CSV use the keyboard', async () => {
    await page.goto(`/sites/${siteId}?tab=reviews&utm=sweep`);
    const sourceInput = page.getByTestId('reviews-source-input-google');
    await tabTo(page, sourceInput);
    await page.keyboard.type(`ChIJUsability${suffix}`);
    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/api/local-seo/reviews/sources'),
    );
    await activate(page, page.getByTestId('reviews-source-save-google'));
    expect((await saved).status()).toBe(201);
    await expect(page.getByTestId('reviews-source-configured-google')).toBeVisible();

    const checkbox = page.getByTestId('reviews-sync-source-google');
    await activate(page, checkbox, 'Space');
    await expect(checkbox).toBeChecked();
    const previewed = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/api/local-seo/reviews/preview'),
    );
    await activate(page, page.getByTestId('reviews-sync-estimate'));
    expect((await previewed).status()).toBe(200);
    await expect(page.getByTestId('reviews-preview')).toBeVisible();

    const started = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/api/local-seo/reviews/sync'),
    );
    await activate(page, page.getByTestId('reviews-sync-confirm'));
    const { runId } = await json<StartedRun>(await started, 202);
    const terminal = await waitForRunTerminal<ReviewRun>({
      request: page.request,
      url: `/api/local-seo/reviews/runs/${runId}`,
      terminal: ['succeeded', 'partial', 'failed'],
      extractStatus: (body) =>
        body.aiTerminalState === 'pending' ? 'running' : body.status,
      options: {
        deadlineMs: 60_000,
        intervalMs: 250,
        label: `keyboard review run ${runId}`,
      },
    });
    expect(terminal.body.status).toBe('succeeded');
    expect(terminal.body.retainedCount).toBeGreaterThan(0);
    await page.goto(`/sites/${siteId}?tab=reviews&utm=sweep`);
    await expect(page.getByTestId('reviews-inventory').locator('tbody tr').first()).toBeVisible();
    const csv = await keyboardDownload(page, page.getByTestId('reviews-export'));
    expect(csv).toContain('rating,reviewed_at,source,title,text,author');
  });

  await test.step('Brand Radar preview → confirm → result and CSV use the keyboard', async () => {
    const brandQuery = `RankMeFast usability ${suffix}`;
    await page.goto(`/sites/${siteId}?tab=brand-radar&view=new&utm=sweep`);
    const query = page.locator('#brand-radar-query');
    await tabTo(page, query);
    await page.keyboard.type(brandQuery);
    const expectedPreviewPath =
      `/api/sites/${encodeURIComponent(siteId)}/brand-radar/preview`;
    const previewed = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === expectedPreviewPath,
    );
    await activate(page, page.getByTestId('brand-radar-preview-submit'));
    expect((await previewed).status()).toBe(200);
    await expect(page.getByTestId('brand-radar-preview')).toBeVisible();

    const expectedCreatePath =
      `/api/sites/${encodeURIComponent(siteId)}/brand-radar/scans`;
    const started = page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === expectedCreatePath,
    );
    await activate(page, page.getByTestId('brand-radar-confirm'));
    const { scanId } = await json<CreatedScan>(await started, 202);
    const terminal = await waitForRunTerminal<{ status: string }>({
      request: page.request,
      url: `/api/brand-radar/scans/${scanId}`,
      terminal: ['completed', 'completed_empty', 'completed_partial', 'failed'],
      options: {
        deadlineMs: 90_000,
        intervalMs: 2_500,
        label: `keyboard brand scan ${scanId}`,
      },
    });
    expect(terminal.body.status).toBe('completed');
    await page.goto(`/sites/${siteId}?tab=brand-radar&scan=${scanId}&utm=sweep`);
    await expect(page.getByTestId('brand-radar-mention-row').first()).toBeVisible();
    const csv = await keyboardDownload(page, page.getByTestId('brand-radar-export'));
    expect(csv).toContain('scan_id,captured_at,brand_query');
  });

  await test.step('all six superadmin intelligence panels traverse with arrow keys', async () => {
    promoteToSuperadmin(account.id);
    await page.goto('/superadmin?tab=intelligence&intel=overview&utm=sweep');
    // The platform tabs live in the app sidebar on /superadmin.
    await expect(
      page.getByRole('link', { name: 'Intelligence', exact: true }),
    ).toHaveAttribute('aria-current', 'page');
    const sections = [
      'overview',
      'providers',
      'costs',
      'quality',
      'queues',
      'monitors',
    ] as const;
    const first = page.getByTestId(`intelligence-section-${sections[0]}`);
    await tabTo(page, first);
    for (let index = 0; index < sections.length; index += 1) {
      const section = sections[index]!;
      const trigger = page.getByTestId(`intelligence-section-${section}`);
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveAttribute('data-state', 'active');
      await expect(page).toHaveURL(new RegExp(`intel=${section}`));
      const panel = page.locator('[role="tabpanel"][data-state="active"]').last();
      await expect(panel).toBeVisible();
      await expect(panel).toHaveAttribute('aria-live', 'polite');
      if (index < sections.length - 1) {
        await page.keyboard.press('ArrowRight');
      }
    }
  });

  expect(denials.urls, `unexpected external egress: ${denials.urls.join(', ')}`).toEqual([]);
});

test('all batch tab/filter URLs deep-link, reload, traverse history, normalize, and preserve unrelated params', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const account = await signUpAtTier(page, 'usability-url', 'agency');
  const siteId = await createSite(page.request, account.id);

  await assertHistoryPair(
    page,
    {
      path: `/sites/${siteId}/backlinks?tab=domains&utm=sweep`,
      marker: page.getByTestId('link-intel-tab-domains'),
    },
    {
      path: `/sites/${siteId}/backlinks?tab=history&utm=sweep`,
      marker: page.getByTestId('link-intel-tab-history'),
    },
  );

  await page.goto(`/sites/${siteId}/backlinks?tab=wrong&utm=sweep`);
  await expect(page).toHaveURL(/tab=overview/);
  await expect(page).toHaveURL(/utm=sweep/);
  await expect(page.getByTestId('link-intel-tab-overview')).toHaveAttribute(
    'data-state',
    'active',
  );

  await assertHistoryPair(
    page,
    {
      path: `/sites/${siteId}?tab=traffic&domain=first.example&from=2026-01-01&to=2026-02-01&utm=sweep`,
      marker: page.locator('#traffic-filter-domain'),
    },
    {
      path: `/sites/${siteId}?tab=traffic&domain=second.example&from=2026-02-01&to=2026-03-01&utm=sweep`,
      marker: page.locator('#traffic-filter-domain'),
    },
  );
  await expect(page.locator('#traffic-filter-domain')).toHaveValue('second.example');
  await page.goto(
    `/sites/${siteId}?tab=traffic&domain=https%3A%2F%2Fbad.example&from=2026-03-01&to=2026-02-01&cursor=${'x'.repeat(501)}&utm=sweep`,
  );
  await expect(page).not.toHaveURL(/domain=|from=|to=|cursor=/);
  await expect(page).toHaveURL(/tab=traffic/);
  await expect(page).toHaveURL(/utm=sweep/);

  await assertHistoryPair(
    page,
    {
      path: '/keyword-research/live-trends?keywords=first&geo=gb&language=en&history=failed&utm=sweep',
      marker: page.getByTestId('live-trends-view'),
    },
    {
      path: '/keyword-research/live-trends?keywords=second&geo=us&language=en&history=refunded&utm=sweep',
      marker: page.getByTestId('live-trends-view'),
    },
  );
  await page.goto(
    '/keyword-research/live-trends?tab=bad&keywords=Solar%2CSOLAR%2Cpanels&geo=%40bad&language=%24%24&history=wrong&utm=sweep',
  );
  await expect(page).toHaveURL(/tab=live-trends/);
  await expect(page).toHaveURL(/keywords=solar%2Cpanels/);
  await expect(page).not.toHaveURL(/geo=|language=|history=/);
  await expect(page).toHaveURL(/utm=sweep/);
  await page.goto('/keyword-research?tab=live-trends&utm=sweep');
  await reloadAndExpectVisible(page, page.getByTestId('keyword-intel-panel-live-trends'));
  await expect(page).toHaveURL(/utm=sweep/);

  await assertHistoryPair(
    page,
    {
      path: `/sites/${siteId}?tab=reviews&src=google&rating=5&sort=source&page=2&utm=sweep`,
      marker: page.getByTestId('reviews-panel'),
    },
    {
      path: `/sites/${siteId}?tab=reviews&src=trustpilot&rating=4&sort=rating-high&page=3&utm=sweep`,
      marker: page.getByTestId('reviews-panel'),
    },
  );
  await page.goto(
    `/sites/${siteId}?tab=reviews&src=yelp&rating=9&sort=wrong&page=0&run=BAD&q=%20%20&utm=sweep`,
  );
  await expect(page).not.toHaveURL(/src=|rating=|sort=|page=|run=|q=/);
  await expect(page).toHaveURL(/tab=reviews/);
  await expect(page).toHaveURL(/utm=sweep/);

  await assertHistoryPair(
    page,
    {
      path: `/sites/${siteId}?tab=brand-radar&view=scans&status=completed&utm=sweep`,
      marker: page.getByTestId('brand-radar-tab-scans'),
    },
    {
      path: `/sites/${siteId}?tab=brand-radar&view=new&utm=sweep`,
      marker: page.getByTestId('brand-radar-tab-new'),
    },
  );
  await page.goto(
    `/sites/${siteId}?tab=brand-radar&view=wrong&status=wrong&scan=BAD&sentiment=all&domain=%20BAD.EXAMPLE%20&from=2026-03-01&to=2026-02-01&utm=sweep`,
  );
  await expect(page).not.toHaveURL(/view=wrong|status=|scan=|sentiment=|from=|to=/);
  await expect(page).toHaveURL(/domain=bad.example/);
  await expect(page).toHaveURL(/utm=sweep/);

  promoteToSuperadmin(account.id);
  await assertHistoryPair(
    page,
    {
      path: '/superadmin?tab=intelligence&intel=providers&utm=sweep',
      marker: page.getByTestId('intelligence-section-providers'),
    },
    {
      path: '/superadmin?tab=intelligence&intel=costs&utm=sweep',
      marker: page.getByTestId('intelligence-section-costs'),
    },
  );
  await page.goto('/superadmin?tab=intelligence&intel=wrong&utm=sweep');
  await expect(page).toHaveURL(/intel=overview/);
  await expect(page).toHaveURL(/tab=intelligence/);
  await expect(page).toHaveURL(/utm=sweep/);
  await expect(page.getByTestId('intelligence-section-overview')).toHaveAttribute(
    'data-state',
    'active',
  );
});
