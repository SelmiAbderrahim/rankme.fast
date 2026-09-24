/**
 * Schema markup generator composed-stack journey.
 *
 * Proof shape:
 *   - a real fake-provider audit produces the stored page facts the generator
 *     reads; the audited-page path never issues an outbound request;
 *   - the previewed unit is disclosed BEFORE the paid confirm, and the result
 *     carries the serialized payload, per-property evidence, omission reasons
 *     and the deterministic conformance verdict;
 *   - the payload copies and downloads as `application/ld+json`;
 *   - switching the type on the same page reports `datePublished` as a
 *     required gap, because the audited path holds no publication date;
 *   - a deterministic stored detector finding exposes the report's real
 *     structured-data CTA, whose deep link arrives with the page preselected;
 *   - a pasted URL completes through a deterministic browser API fake, while
 *     a pasted loopback address is refused by the real outbound-URL authority
 *     with nothing reserved;
 *   - the N+1 generation lands on the localized cap state, re-opening a stored
 *     generation is free, and with `SCHEMA_GENERATOR_ENABLED=false` the new
 *     generation entry point refuses while stored reads stay open (proved
 *     against an api ACTUALLY booted with the flag off, then restored);
 *   - Arabic RTL journey plus axe scans in light and dark.
 *
 * The `finally` block restores the inherited flag on api + worker and checks
 * their runtime parity, even when an assertion or health wait fails.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIResponse, type Page } from '@playwright/test';

import { serializeJsonLd } from '../src/shared/security';
import { freshAccount, signUp } from './helpers/account';
import {
  assertComposeRuntimeParity,
  captureInheritedComposeEnvironment,
  recreateComposeServices,
  runComposeCommand,
  runComposePsql,
  runComposePsqlOutput,
} from './helpers/compose';

test.describe.configure({ mode: 'serial' });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** Localized (en) `schemaGenerator.errors.productUnavailable`. */
const UNAVAILABLE_FRAGMENT = 'unavailable';

/** Starter base cap for `schema_generations`. */
const STARTER_CAP = 5;
const PASTED_FIXTURE_URL = 'https://schema-fixture.example/guide';
const PASTED_FIXTURE_ID = 'f'.repeat(24);
const PREVIEW_ROUTE = '**/api/schema-generator/preview';
const CREATE_ROUTE = '**/api/schema-generator/generations';

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
  recreateComposeServices(['api', 'worker'], { SCHEMA_GENERATOR_ENABLED: value });
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
  if (!body.user?.id) throw new Error('schema-generator spec: no session user id');
  return body.user.id;
}

/** Starter tier: `schema_generations` cap 5, so the N+1 lands quickly. */
function seedStarterTier(accountId: string): void {
  runComposePsql(
    `INSERT INTO subscriptions (account_id, tier, status)
     VALUES (:'accountId', 'starter', 'active')
     ON CONFLICT (account_id) DO UPDATE SET tier = 'starter', status = 'active';`,
    { variables: { accountId } },
  );
}

/** The audit that seeds the page facts must not be blocked by the audit cap. */
function seedAuditAllowance(accountId: string): void {
  runComposePsql(
    `INSERT INTO usage_counters (account_id, period, metric, used, "limit")
     VALUES (:'accountId', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM'), 'audits', 0, 1000000)
     ON CONFLICT (account_id, period, metric)
     DO UPDATE SET used = 0, "limit" = 1000000;`,
    { variables: { accountId } },
  );
}

function seedUsedGenerations(accountId: string, used: string): void {
  runComposePsql(
    `INSERT INTO usage_counters (account_id, period, metric, used, "limit")
     VALUES (:'accountId', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM'),
             'schema_generations', :'used'::bigint, 5)
     ON CONFLICT (account_id, period, metric)
     DO UPDATE SET used = :'used'::bigint;`,
    { variables: { accountId, used } },
  );
}

function usedGenerations(accountId: string): string {
  return runComposePsqlOutput(
    `SELECT coalesce(max(used), 0) FROM usage_counters
     WHERE account_id = :'accountId' AND metric = 'schema_generations';`,
    { variables: { accountId } },
  ).trim();
}

/**
 * The generic fake audit deliberately reports structured data as present. For
 * the CTA leg, turn only that frozen detector row into a realistic missing
 * finding. This is an E2E data seam: production code still reads the persisted
 * report snapshot, and raw values travel through one JSON argument object.
 */
function seedStructuredDataFinding(input: {
  accountId: string;
  siteId: string;
  pageUrl: string;
}): void {
  const script = `
    const snapshot = db.reportsnapshots.findOne({
      accountId: ObjectId(__args.accountId),
      siteId: ObjectId(__args.siteId),
    });
    if (!snapshot) throw new Error('schema-generator e2e snapshot not found');
    const finding = snapshot.findings.find(
      (candidate) => candidate.ruleId === 'structured-data-missing',
    );
    if (!finding) throw new Error('schema-generator e2e detector finding not found');
    finding.bucket = 'watch';
    finding.severity = 'warning';
    finding.affectedUrls = [__args.pageUrl];
    finding.meta = {
      offenders: [{ url: __args.pageUrl, reason: 'missing' }],
    };
    const count = (bucket) =>
      snapshot.findings.filter((candidate) => candidate.bucket === bucket).length;
    const result = db.reportsnapshots.updateOne(
      { _id: snapshot._id },
      {
        $set: {
          findings: snapshot.findings,
          counts: {
            fixNow: count('fix-now'),
            watch: count('watch'),
            passed: count('passed'),
          },
        },
      },
    );
    if (result.modifiedCount !== 1) {
      throw new Error('schema-generator e2e detector finding was not updated');
    }
  `;
  runComposeCommand(
    [
      'exec',
      '-T',
      'mongo',
      'mongosh',
      '--quiet',
      'mongodb://mongo:27017/rankme',
      '--eval',
      `const __args = ${JSON.stringify(input)}; ${script}`,
    ],
  );
}

async function createSite(page: Page, url: string): Promise<string> {
  const response = await csrfPost(page, '/api/sites', { url, label: 'Schema Journey' });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { site: { id: string } };
  return body.site.id;
}

async function runAuditToCompletion(page: Page, siteId: string): Promise<void> {
  const start = await csrfPost(page, `/api/sites/${siteId}/audits`, {});
  expect([200, 201, 202]).toContain(start.status());
  await expect
    .poll(
      async () => {
        const response = await page.request.get(`/api/sites/${siteId}/audits?limit=1`);
        if (response.status() !== 200) return 'http-error';
        const body = (await response.json()) as { runs: Array<{ status: string }> };
        return body.runs[0]?.status ?? 'missing';
      },
      { timeout: 180_000, intervals: [2_000] },
    )
    .toBe('succeeded');
}

/** Pick the first audited page, choose a type, disclose the unit, confirm. */
async function generate(page: Page, siteId: string, type: string): Promise<void> {
  await page.goto(`/sites/${siteId}?tab=schema`);
  await expect(page.getByTestId('schema-page-picker')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('schema-audited-option-0').click();
  const typeOption = page.locator(`#schema-type-option-${type}`);
  await typeOption.check();
  await expect(typeOption).toBeChecked();
  await page.getByTestId('schema-preview-button').click();
  await expect(page.getByTestId('schema-preview')).toBeVisible({ timeout: 30_000 });
  await page.getByTestId('schema-generate-button').click();
}

/** Browser-level deterministic fake for the pasted-URL happy-path UI journey. */
async function installPastedUrlFake(page: Page, siteId: string): Promise<() => Promise<void>> {
  await page.route(PREVIEW_ROUTE, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const body = route.request().postDataJSON() as { source?: unknown; pageUrl?: unknown };
    if (body.source !== 'url' || body.pageUrl !== PASTED_FIXTURE_URL) {
      await route.continue();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: {
        'Content-Language': route.request().headers()['x-lang'] ?? 'en',
        Vary: 'Accept-Language, x-lang',
      },
      json: {
        metric: 'schema_generations',
        productUnits: 1,
        remainingBaseUnits: 3,
        remainingBaseUnlimited: false,
        remainingPackUnits: 0,
        canFit: true,
      },
    });
  });
  await page.route(CREATE_ROUTE, async (route) => {
    if (route.request().method() !== 'POST') {
      await route.continue();
      return;
    }
    const body = route.request().postDataJSON() as { source?: unknown; pageUrl?: unknown };
    if (body.source !== 'url' || body.pageUrl !== PASTED_FIXTURE_URL) {
      await route.continue();
      return;
    }
    const payload = serializeJsonLd({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: 'Safely fetched fixture',
      url: PASTED_FIXTURE_URL,
    });
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      headers: {
        'Content-Language': route.request().headers()['x-lang'] ?? 'en',
        Vary: 'Accept-Language, x-lang',
      },
      json: {
        id: PASTED_FIXTURE_ID,
        siteId,
        pageUrl: PASTED_FIXTURE_URL,
        source: 'url',
        schemaType: 'WebPage',
        registryVersion: '1',
        status: 'complete',
        conformanceStatus: 'conforms',
        failureReason: null,
        refunded: false,
        generatedAt: '2026-08-03T00:00:00.000Z',
        payload,
        mediaType: 'application/ld+json',
        evidence: [
          {
            property: 'name',
            factId: 'page.title',
            factLabel: 'Page title',
            value: 'Safely fetched fixture',
          },
          {
            property: 'url',
            factId: 'page.url',
            factLabel: 'Page URL',
            value: PASTED_FIXTURE_URL,
          },
        ],
        omissions: [
          { property: 'description', reasonCode: 'no_evidence', class: 'recommended' },
          { property: 'inLanguage', reasonCode: 'no_evidence', class: 'recommended' },
          { property: 'isPartOf', reasonCode: 'no_evidence', class: 'recommended' },
          {
            property: 'primaryImageOfPage',
            reasonCode: 'no_evidence',
            class: 'recommended',
          },
        ],
        conformance: {
          registryVersion: '1',
          status: 'conforms',
          requiredGaps: [],
          recommendedSuggestions: [
            { property: 'description', reasonCode: 'no_evidence' },
            { property: 'inLanguage', reasonCode: 'no_evidence' },
            { property: 'isPartOf', reasonCode: 'no_evidence' },
            { property: 'primaryImageOfPage', reasonCode: 'no_evidence' },
          ],
        },
      },
    });
  });
  return async () => {
    await page.unroute(PREVIEW_ROUTE);
    await page.unroute(CREATE_ROUTE);
  };
}

test('schema generator: evidence-backed markup, conformance, copy/download, cap, free reopen, flag-off, RTL, axe', async ({
  page,
}) => {
  // Multi-step composed-stack journey (signup, audit run, several metered
  // generations, one api recreate pair) on a shared gate host. Retries stay 0.
  test.setTimeout(600_000);
  const inheritedRuntime = captureInheritedComposeEnvironment([
    'SCHEMA_GENERATOR_ENABLED',
  ]);
  assertComposeRuntimeParity(inheritedRuntime);

  const account = freshAccount('schema-generator');
  await signUp(page, account);
  const accountId = await sessionUserId(page);
  seedStarterTier(accountId);
  seedAuditAllowance(accountId);

  const siteId = await createSite(page, 'https://example.com');
  await runAuditToCompletion(page, siteId);
  seedUsedGenerations(accountId, '0');

  let firstGenerationId = '';
  let auditedPageUrl = '';

  try {
    await test.step('the audited work list carries the crawl context', async () => {
      await page.goto(`/sites/${siteId}?tab=schema`);
      await expect(page.getByTestId('schema-page-picker')).toBeVisible({
        timeout: 30_000,
      });
      const first = page.getByTestId('schema-audited-option-0');
      await expect(first).toBeVisible();
      const firstRadio = page.locator('#schema-audited-0');
      auditedPageUrl = (await firstRadio.getAttribute('value')) ?? '';
      expect(auditedPageUrl.startsWith('http')).toBe(true);
      await scan(page, 'schema-picker(light)');
    });

    await test.step('the previewed unit precedes the paid confirm and yields evidence-backed markup', async () => {
      await generate(page, siteId, 'WebPage');

      await expect(page.getByTestId('schema-payload')).toBeVisible({ timeout: 60_000 });
      await expect(page.getByTestId('schema-payload')).toContainText('schema.org');
      await expect(page.getByTestId('schema-evidence')).toBeVisible();
      await expect(page.getByTestId('schema-omissions')).toBeVisible();
      // The verdict speaks only about schema.org requirements.
      await expect(page.getByTestId('schema-conformance-status')).toContainText('schema.org');
      expect(usedGenerations(accountId)).toBe('1');

      const url = new URL(page.url());
      firstGenerationId = url.searchParams.get('generation') ?? '';
      expect(firstGenerationId).not.toBe('');
      await setTheme(page, 'dark');
      await scan(page, 'schema-result(dark)');
      await setTheme(page, 'light');
    });

    await test.step('the payload copies and downloads as JSON-LD', async () => {
      await page.getByTestId('schema-copy').click();
      await expect(page.getByTestId('schema-copy')).toContainText('Copied');

      const download = page.waitForEvent('download');
      await page.getByTestId('schema-download').click();
      expect((await download).suggestedFilename()).toContain('.jsonld');

      // The stored payload is served verbatim under the JSON-LD media type.
      const raw = await page.request.get(
        `/api/schema-generator/generations/${firstGenerationId}/download`,
      );
      expect(raw.status()).toBe(200);
      expect(raw.headers()['content-type']).toContain('application/ld+json');
    });

    await test.step('switching the type on the same page reports the honest required gap', async () => {
      await generate(page, siteId, 'Article');
      await expect(page.getByTestId('schema-required-gap-datePublished')).toBeVisible({
        timeout: 60_000,
      });
      expect(usedGenerations(accountId)).toBe('2');
    });

    await test.step("the report's structured-data deep link preselects the page", async () => {
      seedStructuredDataFinding({ accountId, siteId, pageUrl: auditedPageUrl });
      await page.goto(`/sites/${siteId}?tab=report&bucket=watch`);
      const finding = page.locator(
        '[data-testid="report-issue-row"][data-rule-id="structured-data-missing"]',
      );
      await expect(finding).toBeVisible({ timeout: 30_000 });
      await finding.locator('button[aria-expanded]').click();
      await finding.getByTestId('report-schema-cta').click();
      await expect(page).toHaveURL(
        new RegExp(
          `[?&]tab=schema(?:&|$).*page=${encodeURIComponent(auditedPageUrl).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
        ),
      );
      await expect(page.getByTestId('schema-page-picker')).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.locator('#schema-audited-0')).toBeChecked();
    });

    await test.step('a pasted URL generates through deterministic fakes', async () => {
      const before = usedGenerations(accountId);
      const uninstall = await installPastedUrlFake(page, siteId);
      try {
        await page.goto(`/sites/${siteId}?tab=schema`);
        await expect(page.getByTestId('schema-page-picker')).toBeVisible({ timeout: 30_000 });
        await page.getByLabel('Paste a URL').click();
        await page.locator('#schema-page-url').fill(PASTED_FIXTURE_URL);
        await page.getByTestId('schema-preview-button').click();
        await expect(page.getByTestId('schema-preview')).toBeVisible();
        await page.getByTestId('schema-generate-button').click();
        await expect(page.getByTestId('schema-payload')).toContainText('Safely fetched fixture');
        await expect(page.getByTestId('schema-evidence-name')).toBeVisible();
        expect(usedGenerations(accountId)).toBe(before);
      } finally {
        await uninstall();
      }
    });

    await test.step('a pasted loopback address is refused and reserves nothing', async () => {
      const before = usedGenerations(accountId);
      const refused = await csrfPost(page, '/api/schema-generator/generations', {
        siteId,
        source: 'url',
        pageUrl: 'https://127.0.0.1/page',
        schemaType: 'WebPage',
      });
      expect(refused.status()).toBe(400);
      expect(usedGenerations(accountId)).toBe(before);

      await page.goto(`/sites/${siteId}?tab=schema`);
      await page.getByLabel('Paste a URL').click();
      await page.locator('#schema-page-url').fill('http://example.com/page');
      await expect(page.getByTestId('schema-url-error')).toBeVisible();
      await expect(page.getByTestId('schema-preview-button')).toBeDisabled();
    });

    await test.step('the N+1 generation is blocked before spend', async () => {
      seedUsedGenerations(accountId, String(STARTER_CAP - 1));
      await generate(page, siteId, 'WebPage');
      await expect(page.getByTestId('schema-payload')).toBeVisible({ timeout: 60_000 });
      expect(usedGenerations(accountId)).toBe(String(STARTER_CAP));

      // The preview is the pre-spend boundary. Once the allowance is empty it
      // truthfully disables confirmation, so the browser must never force a
      // click merely to manufacture a server error state.
      await page.goto(`/sites/${siteId}?tab=schema`);
      await expect(page.getByTestId('schema-page-picker')).toBeVisible({
        timeout: 30_000,
      });
      await page.getByTestId('schema-audited-option-0').click();
      await page.locator('#schema-type-option-WebPage').check();
      await page.getByTestId('schema-preview-button').click();
      await expect(page.getByTestId('schema-preview-nofit')).toBeVisible({
        timeout: 30_000,
      });
      await expect(page.getByTestId('schema-generate-button')).toBeDisabled();

      // The API independently enforces the same N+1 boundary if a client
      // bypasses the disabled control.
      const refused = await csrfPost(page, '/api/schema-generator/generations', {
        siteId,
        source: 'audited-page',
        pageUrl: auditedPageUrl,
        schemaType: 'WebPage',
      });
      expect(refused.status()).toBe(402);
      expect(usedGenerations(accountId)).toBe(String(STARTER_CAP));
    });

    await test.step('re-opening a stored generation is free', async () => {
      const before = usedGenerations(accountId);
      await page.goto(`/sites/${siteId}?tab=schema`);
      await page.getByTestId(`schema-open-${firstGenerationId}`).click();
      await expect(page.getByTestId('schema-payload')).toBeVisible({ timeout: 30_000 });
      expect(usedGenerations(accountId)).toBe(before);
    });

    await test.step('Arabic RTL renders the generator under logical layout', async () => {
      await page.goto(`/sites/${siteId}?tab=schema`);
      await page.locator('#language-switcher').selectOption('ar');
      await expect(page.locator('html')).toHaveAttribute('lang', 'ar', {
        timeout: 30_000,
      });
      await expect(page.locator('html')).toHaveAttribute('dir', 'rtl', {
        timeout: 30_000,
      });
      await expect(page.getByRole('heading', { name: 'مولّد ترميز schema' })).toBeVisible();
      await scan(page, 'schema-ar(light)');
      await page.locator('#language-switcher').selectOption('en');
      await expect(page.locator('html')).toHaveAttribute('dir', 'ltr', {
        timeout: 30_000,
      });
    });

    await test.step('the kill switch closes new generations and leaves stored reads open', async () => {
      recreateApiWithFlag('false');
      await awaitApiHealthy(page);

      const refused = await csrfPost(page, '/api/schema-generator/generations', {
        siteId,
        source: 'audited-page',
        pageUrl: auditedPageUrl,
        schemaType: 'WebPage',
      });
      expect(refused.status()).toBe(403);
      expect(JSON.stringify(await refused.json())).toContain(UNAVAILABLE_FRAGMENT);

      const stored = await page.request.get(
        `/api/schema-generator/generations/${firstGenerationId}`,
      );
      expect(stored.status()).toBe(200);

      await page.goto(`/sites/${siteId}?tab=schema&view=detail&generation=${firstGenerationId}`);
      await expect(page.getByTestId('schema-payload')).toBeVisible({ timeout: 30_000 });
    });
  } finally {
    recreateApiWithFlag(inheritedRuntime.SCHEMA_GENERATOR_ENABLED!);
    await awaitApiHealthy(page);
    assertComposeRuntimeParity(inheritedRuntime);
  }
});
