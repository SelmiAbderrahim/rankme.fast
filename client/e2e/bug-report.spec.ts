import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { freshAccount, signUp } from './helpers/account';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

function reportFields(href: string): URLSearchParams {
  const url = new URL(href);
  if (url.protocol === 'mailto:') return new URLSearchParams(url.search).get('body')
    ? new URLSearchParams(
        (new URLSearchParams(url.search).get('body') ?? '')
          .split('\n')
          .map((line) => line.replace(': ', '='))
          .join('&'),
      )
    : new URLSearchParams();
  return url.searchParams;
}

test('the account-menu bug report contains only a declared route pattern and is axe clean', async ({
  page,
}) => {
  const account = freshAccount('bug-report');
  await signUp(page, account);
  await page.goto('/dashboard');

  await page.getByRole('button', { name: /account menu/i }).click();
  const report = page.getByRole('menuitem', { name: /report a bug/i });
  await expect(report).toBeVisible();
  await expect(report).toHaveAttribute('target', '_blank');
  await expect(report).toHaveAttribute('rel', /noopener/);

  const href = await report.getAttribute('href');
  expect(href).toBeTruthy();
  const fields = reportFields(href!);
  expect(fields.get('route')).toBe('/dashboard');
  expect(fields.get('edition')).toBe('cloud');
  expect(fields.get('stage')).toMatch(/^(beta|ga)$/u);
  expect(href).not.toContain(account.email);
  expect(href).not.toMatch(/[a-f0-9]{24}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/iu);

  const axe = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(axe.violations).toEqual([]);
});
