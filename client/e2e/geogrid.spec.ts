/**
 * Geogrid local rank tracking composed-stack
 * journey.
 *
 * Proof shape:
 *   - a 3×3 grid is defined from typed coordinates (no map vendor anywhere);
 *   - the estimate discloses the unit and the cell count BEFORE the paid
 *     confirm, and cancelling spends nothing (meter reconciled);
 *   - a confirmed scan settles through the real `geogrid-scan` worker and the
 *     heat grid renders positioned cells, the distinct not-in-pack cell, and
 *     the always-present accessible table fallback;
 *   - a partial-failure scan (deterministic fake injection) marks failed cells
 *     and does NOT refund, because retained observations consumed the unit;
 *   - the N+1 scan lands on the localized cap state naming `geogrid_scans`;
 *   - reopening a stored scan is free;
 *   - with `GEOGRID_ENABLED=false` the new-scan entry point refuses while
 *     stored reads stay open (proved against an api ACTUALLY booted with the
 *     flag off, then restored);
 *   - Arabic RTL journey plus axe scans in light and dark.
 *
 * The `finally` block restores the inherited flag on api + worker and checks
 * their runtime parity, even when an assertion or health wait fails.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIResponse, type Page } from '@playwright/test';

import { freshAccount, signUp } from './helpers/account';
import {
  assertComposeRuntimeParity,
  captureInheritedComposeEnvironment,
  recreateComposeServices,
  runComposePsql,
  runComposePsqlOutput,
} from './helpers/compose';

test.describe.configure({ mode: 'serial' });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Agency base cap for `geogrid_scans`. */
const AGENCY_CAP = 6;

/** Fake-provider markers (server/src/shared/providers/fakes.ts). */
const PARTIAL_MARKER = 'gridfail';

async function scan(page: Page, label: string): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(result.violations, `${label}: axe violations`).toEqual([]);
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((t) => {
    document.documentElement.classList.toggle('dark', t === 'dark');
  }, theme);
}

function recreateApiWithFlag(value: string): void {
  recreateComposeServices(['api', 'worker'], { GEOGRID_ENABLED: value });
}

async function awaitApiHealthy(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        try {
          const res = await page.request.get('/api/health');
          return res.status();
        } catch {
          return 0;
        }
      },
      { timeout: 90_000, intervals: [2_000] },
    )
    .toBe(200);
}

async function csrfPost(
  page: Page,
  url: string,
  data: Record<string, unknown>,
): Promise<APIResponse> {
  const tokenResponse = await page.request.get('/api/security/csrf-token');
  expect(tokenResponse.status()).toBe(200);
  const { csrfToken } = (await tokenResponse.json()) as { csrfToken: string };
  return page.request.post(url, {
    data,
    headers: { 'x-csrf-token': csrfToken },
    failOnStatusCode: false,
  });
}

async function sessionUserId(page: Page): Promise<string> {
  const res = await page.request.get('/api/auth/get-session');
  const body = (await res.json()) as { user?: { id?: string } };
  if (!body.user?.id) throw new Error('geogrid spec: no session user id');
  return body.user.id;
}

function seedAgencyTier(accountId: string): void {
  runComposePsql(
    `INSERT INTO subscriptions (account_id, tier, status)
     VALUES (:'accountId', 'agency', 'active')
     ON CONFLICT (account_id) DO UPDATE SET tier = 'agency', status = 'active';`,
    { variables: { accountId } },
  );
}

function seedUsedScans(accountId: string, used: string): void {
  runComposePsql(
    `INSERT INTO usage_counters (account_id, period, metric, used, "limit")
     VALUES (:'accountId', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM'),
             'geogrid_scans', :'used'::bigint, ${AGENCY_CAP})
     ON CONFLICT (account_id, period, metric)
     DO UPDATE SET used = :'used'::bigint;`,
    { variables: { accountId, used } },
  );
}

function usedScans(accountId: string): string {
  return runComposePsqlOutput(
    `SELECT coalesce(max(used), 0) FROM usage_counters
     WHERE account_id = :'accountId' AND metric = 'geogrid_scans';`,
    { variables: { accountId } },
  ).trim();
}

async function createSite(page: Page, url: string): Promise<string> {
  const response = await csrfPost(page, '/api/sites', { url, label: 'Geogrid Journey' });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { site: { id: string } };
  return body.site.id;
}

async function addKeyword(page: Page, siteId: string, phrase: string): Promise<string> {
  const response = await csrfPost(page, `/api/sites/${siteId}/keywords`, {
    phrase,
    locationCode: 2840,
    languageCode: 'en',
    device: 'desktop',
  });
  expect([200, 201]).toContain(response.status());
  const body = (await response.json()) as { keyword: { id: string } };
  return body.keyword.id;
}

/** Fill the grid form and run the non-reserving estimate. */
async function estimate(
  page: Page,
  siteId: string,
  keywordPhrase: string,
  size: '3' | '5' | '7' = '3',
): Promise<void> {
  await page.goto(`/sites/${siteId}?tab=geogrid`);
  await expect(page.getByTestId('geogrid-form')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('geogrid-keyword').selectOption({ label: keywordPhrase });
  await page.getByTestId('geogrid-lat').fill('30.2672');
  await page.getByTestId('geogrid-lng').fill('-97.7431');
  await page.locator(`#geogrid-size-${size}`).check();
  await page.getByTestId('geogrid-preview-submit').click();
  await expect(page.getByTestId('geogrid-preview-card')).toBeVisible({ timeout: 30_000 });
}

async function waitForScanTerminal(page: Page, siteId: string): Promise<string> {
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/sites/${siteId}/geogrid/scans?limit=1`);
        if (response.status() !== 200) return 'http-error';
        const body = (await response.json()) as { scans: Array<{ status: string }> };
        return body.scans[0]?.status ?? 'missing';
      },
      { timeout: 180_000, intervals: [2_000] },
    )
    .toMatch(/^(completed|completed_partial|failed)$/);
  const response = await page.request.get(`/api/sites/${siteId}/geogrid/scans?limit=1`);
  const body = (await response.json()) as { scans: Array<{ id: string }> };
  return body.scans[0]!.id;
}

test('geogrid: typed-coordinate grid, preview/cancel, heat grid + table fallback, partial failure, cap, free reopen, flag-off, RTL, axe', async ({
  page,
}) => {
  // Multi-step composed-stack journey (signup, several metered scans through
  // the real worker, one api recreate pair) on a shared gate host. Retries 0.
  // Budget is sized for a COLD stack. Runtime here scales with the number of
  // stored `geogrid_scans` the workspace lists and axe-scans, so a reused e2e
  // volume that has accumulated prior runs' rows will outgrow any fixed
  // budget — reset the volume rather than raising this number.
  test.setTimeout(600_000);
  const inheritedRuntime = captureInheritedComposeEnvironment(['GEOGRID_ENABLED']);
  assertComposeRuntimeParity(inheritedRuntime);

  const account = freshAccount('geogrid');
  await signUp(page, account);
  const accountId = await sessionUserId(page);
  seedAgencyTier(accountId);

  const siteId = await createSite(page, 'https://example.com');
  const cleanPhrase = 'dentist austin';
  const partialPhrase = `dentist austin ${PARTIAL_MARKER}`;
  const cleanKeywordId = await addKeyword(page, siteId, cleanPhrase);
  await addKeyword(page, siteId, partialPhrase);
  seedUsedScans(accountId, '0');

  let firstScanId = '';

  try {
    await test.step('the coordinate form is typed, not picked from a map', async () => {
      await page.goto(`/sites/${siteId}?tab=geogrid`);
      await expect(page.getByTestId('geogrid-form')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('geogrid-lat')).toBeVisible();
      await expect(page.getByTestId('geogrid-lng')).toBeVisible();
      // No map tile vendor is ever contacted — the panel holds no map frame
      // and no map canvas, only numeric coordinate fields.
      await expect(page.getByTestId('geogrid-panel').locator('iframe')).toHaveCount(0);
      await expect(page.getByTestId('geogrid-panel').locator('canvas')).toHaveCount(0);
      await scan(page, 'geogrid-form(light)');
    });

    await test.step('cancelling the estimate spends nothing', async () => {
      await estimate(page, siteId, cleanPhrase);
      await expect(page.getByTestId('geogrid-preview-card')).toContainText('9');
      await page.getByTestId('geogrid-cancel').click();
      await expect(page.getByTestId('geogrid-preview-card')).toHaveCount(0);
      expect(usedScans(accountId)).toBe('0');
    });

    await test.step('a confirmed scan settles and renders the heat grid plus the table fallback', async () => {
      await estimate(page, siteId, cleanPhrase);
      await page.getByTestId('geogrid-confirm').click();
      firstScanId = await waitForScanTerminal(page, siteId);
      expect(usedScans(accountId)).toBe('1');

      await page.goto(`/sites/${siteId}?tab=geogrid&scan=${firstScanId}`);
      await expect(page.getByTestId('geogrid-heat')).toBeVisible({ timeout: 30_000 });
      // Nine settled cells, none pending.
      await expect(page.locator('[data-testid^="geogrid-cell-"][data-state]')).toHaveCount(9);
      await expect(page.locator('[data-state="pending"]')).toHaveCount(0);
      // The deterministic fake places both positioned and not-in-pack cells.
      await expect(page.locator('[data-state="observed"]').first()).toBeVisible();
      await expect(page.locator('[data-state="not_in_pack"]').first()).toBeVisible();
      // The accessible table fallback is always rendered, never hover-revealed.
      await expect(page.getByTestId('geogrid-cell-table')).toBeVisible();
      await expect(page.getByTestId('geogrid-cell-row-0')).toBeVisible();
      await scan(page, 'geogrid-grid(light)');
      await setTheme(page, 'dark');
      await scan(page, 'geogrid-grid(dark)');
      await setTheme(page, 'light');
    });

    await test.step('a cell is keyboard reachable and its readout is URL-backed', async () => {
      await page.getByTestId('geogrid-cell-0').focus();
      await expect(page.getByTestId('geogrid-cell-0')).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/cell=0/);
      await expect(page.getByTestId('geogrid-cell-detail')).toBeVisible();
    });

    await test.step('a partial-failure scan marks failed cells and keeps the unit', async () => {
      await estimate(page, siteId, partialPhrase);
      await page.getByTestId('geogrid-confirm').click();
      const partialScanId = await waitForScanTerminal(page, siteId);
      expect(usedScans(accountId)).toBe('2');

      const detail = await page.request.get(`/api/sites/${siteId}/geogrid/scans/${partialScanId}`);
      expect(detail.status()).toBe(200);
      const body = (await detail.json()) as {
        status: string;
        failedCells: number;
        refundIssued: boolean;
        cells: Array<{ state: string; position?: number; capturedAt?: string }>;
      };
      expect(body.status).toBe('completed_partial');
      expect(body.failedCells).toBeGreaterThan(0);
      expect(body.refundIssued).toBe(false);
      // Honesty invariant on the wire: a failed cell carries no rank and no
      // capture time, so it can never render as "not in the pack".
      for (const cell of body.cells) {
        if (cell.state === 'failed') {
          expect(cell.position).toBeUndefined();
          expect(cell.capturedAt).toBeUndefined();
        }
      }

      await page.goto(`/sites/${siteId}?tab=geogrid&scan=${partialScanId}`);
      await expect(page.getByTestId('geogrid-partial-banner')).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.locator('[data-state="failed"]').first()).toBeVisible();
      await scan(page, 'geogrid-partial(light)');
    });

    await test.step('reopening a stored scan is free', async () => {
      const before = usedScans(accountId);
      await page.goto(`/sites/${siteId}?tab=geogrid`);
      await expect(page.getByTestId('geogrid-history')).toBeVisible({ timeout: 30_000 });
      await page.getByTestId(`geogrid-history-row-${firstScanId}`).click();
      await expect(page.getByTestId('geogrid-heat')).toBeVisible({ timeout: 30_000 });
      expect(usedScans(accountId)).toBe(before);
    });

    await test.step('the N+1 scan lands on the localized cap state', async () => {
      await estimate(page, siteId, cleanPhrase);
      // Preview while affordable, then consume the final allowance through the
      // database seam so confirmation exercises the API's N+1 race boundary.
      seedUsedScans(accountId, String(AGENCY_CAP));
      await page.getByTestId('geogrid-confirm').click();
      await expect(page.getByTestId('geogrid-gate-cap')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('geogrid-pack-cta')).toHaveCount(0);
      expect(usedScans(accountId)).toBe(String(AGENCY_CAP));
      await scan(page, 'geogrid-cap(light)');
      seedUsedScans(accountId, '2');
    });

    await test.step('Arabic RTL renders the grid and its table fallback', async () => {
      await page.locator('#language-switcher').selectOption('ar');
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await page.goto(`/sites/${siteId}?tab=geogrid&scan=${firstScanId}&lang=ar`);
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
      await expect(page.getByTestId('geogrid-heat')).toBeVisible({ timeout: 30_000 });
      await expect(page.getByTestId('geogrid-cell-table')).toBeVisible();
      // pointIndex ordering is direction-independent.
      await expect(page.getByTestId('geogrid-cell-row-0')).toBeVisible();
      await scan(page, 'geogrid-rtl(light)');
      await page.locator('#language-switcher').selectOption('en');
      await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    });

    await test.step('with the flag off new scans refuse and stored scans stay readable', async () => {
      recreateApiWithFlag('false');
      await awaitApiHealthy(page);

      // A REAL owned keyword, so the refusal can only come from the flag.
      const refused = await csrfPost(page, `/api/sites/${siteId}/geogrid/scans`, {
        keywordId: cleanKeywordId,
        centerLat: 30.2672,
        centerLng: -97.7431,
        spacingMeters: 1000,
        gridSize: 3,
        zoom: 17,
      });
      expect(refused.status()).toBe(503);

      await page.goto(`/sites/${siteId}?tab=geogrid&scan=${firstScanId}`);
      await expect(page.getByTestId('geogrid-heat')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('geogrid-cell-table')).toBeVisible();

      // The estimate entry point refuses too, and says so in the UI. Asserted
      // directly (not in a catch) so a surface that WRONGLY succeeded would
      // fail this step instead of passing silently.
      await page.goto(`/sites/${siteId}?tab=geogrid`);
      await expect(page.getByTestId('geogrid-form')).toBeVisible({ timeout: 60_000 });
      await page.getByTestId('geogrid-keyword').selectOption({ label: cleanPhrase });
      await page.getByTestId('geogrid-lat').fill('30.2672');
      await page.getByTestId('geogrid-lng').fill('-97.7431');
      await page.getByTestId('geogrid-preview-submit').click();
      await expect(page.getByTestId('geogrid-gate-killSwitch')).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByTestId('geogrid-preview-card')).toHaveCount(0);
      expect(usedScans(accountId)).toBe('2');
    });
  } finally {
    recreateApiWithFlag(inheritedRuntime.GEOGRID_ENABLED!);
    await awaitApiHealthy(page);
    assertComposeRuntimeParity(inheritedRuntime);
  }
});
