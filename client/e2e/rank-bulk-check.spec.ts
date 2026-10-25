/** A site-wide check completes every item while the fake task queue is slow. */
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { freshAccount, signUp } from './helpers/account';
import { runComposePsql, runComposePsqlOutput } from './helpers/compose';
import { csrfHeaders } from './helpers/csrf';
import { collectDenials, denyNonLoopback } from './helpers/denyNonLoopback';

const KEYWORD_COUNT = 50;

test('a site-wide check settles every keyword after pending fake task polls', async ({ page, context }) => {
  test.setTimeout(300_000);
  const denials = collectDenials();
  await denyNonLoopback(context, denials);
  const account = freshAccount('rank-bulk');
  await signUp(page, account);
  const accountId = runComposePsqlOutput(
    `SELECT id FROM "user" WHERE email = :'email' LIMIT 1;`,
    { variables: { email: account.email } },
  );
  expect(accountId).toMatch(/^[0-9a-f]{24}$/u);

  const siteResponse = await page.request.post('/api/sites', {
    data: { url: 'https://rank-bulk.example', label: 'Bulk rank check' },
    headers: await csrfHeaders(page.request),
  });
  expect(siteResponse.status()).toBe(201);
  const siteId = ((await siteResponse.json()) as { site?: { id?: string } }).site?.id;
  expect(siteId).toMatch(/^[0-9a-f]{24}$/u);

  runComposePsql(
    `INSERT INTO keywords (account_id, site_id, phrase, location_code, language_code, device, engine)
     SELECT :'accountId', :'siteId', 'rankslow bulk ' || lpad(n::text, 2, '0'),
            2840, 'en', 'desktop', 'google'
       FROM generate_series(1, :'count'::integer) AS n;`,
    { variables: { accountId, siteId: siteId!, count: String(KEYWORD_COUNT) } },
  );

  await page.goto(`/sites/${siteId}?tab=keywords`);
  await expect(page.getByTestId('keyword-check-now')).toBeVisible();
  await page.getByTestId('keyword-check-now').click();
  const responsePromise = page.waitForResponse((response) =>
    response.request().method() === 'POST' &&
    new URL(response.url()).pathname === `/api/sites/${siteId}/keywords/check`,
  );
  await page.getByTestId('check-now-confirm').click();
  const response = await responsePromise;
  expect(response.status()).toBe(202);
  const jobId = ((await response.json()) as { job?: { id?: string } }).job?.id;
  expect(jobId).toMatch(/^[0-9a-f-]{36}$/u);

  await expect(page.locator('[data-testid^="keyword-queued-"], [data-testid^="keyword-checking-"]').first())
    .toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => {
    const result = await page.request.get(`/api/sites/${siteId}/rank-jobs/${jobId}`);
    if (!result.ok()) return 'unavailable';
    const body = (await result.json()) as { job?: { status?: string } };
    return body.job?.status ?? 'missing';
  }, { timeout: 240_000, intervals: [2_000] }).toBe('succeeded');

  const itemCount = runComposePsqlOutput(
    `SELECT count(*) FROM rank_check_job_items
       WHERE job_id = :'jobId'::uuid AND state = 'succeeded';`,
    { variables: { jobId: jobId! } },
  );
  expect(Number(itemCount)).toBe(KEYWORD_COUNT);
  const observedCount = runComposePsqlOutput(
    `SELECT count(*) FROM rankings AS r
       JOIN keywords AS k ON k.id = r.keyword_id
      WHERE k.account_id = :'accountId' AND k.site_id = :'siteId';`,
    { variables: { accountId, siteId: siteId! } },
  );
  expect(Number(observedCount)).toBe(KEYWORD_COUNT);
  const failedCount = runComposePsqlOutput(
    `SELECT count(*) FROM keywords
       WHERE account_id = :'accountId' AND site_id = :'siteId'
         AND last_failed_check_at IS NOT NULL;`,
    { variables: { accountId, siteId: siteId! } },
  );
  expect(Number(failedCount)).toBe(0);

  await page.reload();
  await expect(page.getByTestId('keywords-table')).toBeVisible();
  await expect(page.locator('[data-testid^="keyword-check-failed-"], [data-testid^="keyword-position-failed-"]'))
    .toHaveCount(0);
  const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  expect(axe.violations).toEqual([]);
  expect(denials.urls).toEqual([]);
});
