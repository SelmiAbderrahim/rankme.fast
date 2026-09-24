import { expect, test } from '@playwright/test';

/**
 * Core Web Vitals budget for the public docs entry page (the self-hosted
 * edition ships no landing page; `/` redirects to sign-in). Uses the browser's
 * own PerformanceObserver — no lighthouse (not installed): LCP < 2.5s and
 * CLS < 0.1.
 */
test('docs page stays within the LCP + CLS budget', async ({ page }) => {
  await page.goto('/docs', { waitUntil: 'load' });

  // Largest Contentful Paint — read the last LCP entry after the page settles.
  const lcp = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let last = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) last = entry.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
        // Give the observer a tick, then resolve with the latest value.
        setTimeout(() => resolve(last), 500);
      }),
  );

  // Cumulative Layout Shift — sum non-input layout-shift entries.
  const cls = await page.evaluate(
    () =>
      new Promise<number>((resolve) => {
        let total = 0;
        new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const shift = entry as PerformanceEntry & {
              value: number;
              hadRecentInput: boolean;
            };
            if (!shift.hadRecentInput) total += shift.value;
          }
        }).observe({ type: 'layout-shift', buffered: true });
        setTimeout(() => resolve(total), 500);
      }),
  );

  expect(lcp, `LCP ${Math.round(lcp)}ms should be < 2500ms`).toBeLessThan(2500);
  expect(cls, `CLS ${cls.toFixed(3)} should be < 0.1`).toBeLessThan(0.1);
});
