import { expect, type Page, type Request, type Response } from '@playwright/test';

type GotoOptions = Parameters<Page['goto']>[1];
type ReloadOptions = Parameters<Page['reload']>[0];

const NETWORK_CHANGED = 'net::ERR_NETWORK_CHANGED';

function recordsFailedStaticAsset(request: Request): boolean {
  return (
    request.resourceType() === 'script' &&
    request.url().includes('/assets/') &&
    request.failure()?.errorText === NETWORK_CHANGED
  );
}

function isExactNetworkChanged(error: unknown): boolean {
  return error instanceof Error && error.message.includes(NETWORK_CHANGED);
}

async function isBlankDocument(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const root = document.querySelector('#root');
    return (
      (root?.childElementCount ?? 0) === 0 &&
      (document.body.textContent ?? '').trim() === ''
    );
  });
}

/**
 * Docker network recreation can make Chromium lose one already-resolved Vite
 * chunk while the HTML navigation itself still succeeds. Recover once only
 * for that exact empty-document transport state; product assertions and API
 * responses are never retried here.
 */
export async function gotoWithStaticAssetNetworkRecovery(
  page: Page,
  url: string,
  options?: GotoOptions,
): Promise<Response | null> {
  let failedStaticAsset = false;
  const recordFailure = (request: Request): void => {
    if (recordsFailedStaticAsset(request)) failedStaticAsset = true;
  };

  page.on('requestfailed', recordFailure);
  try {
    let response: Response | null;
    try {
      response = await page.goto(url, options);
    } catch (error) {
      if (!isExactNetworkChanged(error)) throw error;
      response = page.url() === 'about:blank'
        ? await page.goto(url, options)
        : await page.reload(options);
    }

    if (failedStaticAsset && (await isBlankDocument(page))) {
      response = await page.reload(options);
    }
    return response;
  } finally {
    page.off('requestfailed', recordFailure);
  }
}

export async function reloadWithStaticAssetNetworkRecovery(
  page: Page,
  options?: ReloadOptions,
): Promise<Response | null> {
  let failedStaticAsset = false;
  const recordFailure = (request: Request): void => {
    if (recordsFailedStaticAsset(request)) failedStaticAsset = true;
  };

  page.on('requestfailed', recordFailure);
  try {
    let response: Response | null;
    try {
      response = await page.reload(options);
    } catch (error) {
      if (!isExactNetworkChanged(error)) throw error;
      response = await page.reload(options);
    }

    if (failedStaticAsset && (await isBlankDocument(page))) {
      response = await page.reload(options);
    }
    return response;
  } finally {
    page.off('requestfailed', recordFailure);
  }
}

export async function traverseHistoryWithStaticAssetNetworkRecovery(
  page: Page,
  direction: 'back' | 'forward',
  expectedUrl: RegExp,
): Promise<void> {
  let failedStaticAsset = false;
  const recordFailure = (request: Request): void => {
    if (recordsFailedStaticAsset(request)) failedStaticAsset = true;
  };
  const traverse = (): Promise<Response | null> =>
    direction === 'back' ? page.goBack() : page.goForward();

  page.on('requestfailed', recordFailure);
  try {
    try {
      await traverse();
    } catch (error) {
      if (!isExactNetworkChanged(error)) throw error;
      if (expectedUrl.test(page.url())) {
        await page.reload();
      } else {
        await traverse();
      }
    }

    if (failedStaticAsset && (await isBlankDocument(page))) {
      await page.reload();
    }
  } finally {
    page.off('requestfailed', recordFailure);
  }

  await expect(page).toHaveURL(expectedUrl);
}

/**
 * Open a site workspace tab from the shared site navigation. Collapsed groups
 * are expanded first, so the helper does not depend on which group is open.
 */
export async function openSiteTab(page: Page, tab: string): Promise<void> {
  const link = page.locator(`[data-site-nav-link][href*="tab=${tab}"]`).first();
  if (!(await link.isVisible())) {
    const collapsed = page.locator('[data-testid="site-navigation"] button[aria-expanded="false"]');
    for (let index = (await collapsed.count()) - 1; index >= 0; index -= 1) {
      await collapsed.nth(index).click();
    }
  }
  await link.click();
}
