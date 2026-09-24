/**
 * Canonical Assistant + MCP browser journey.
 *
 * The spec talks only to the composed product stack. AI runs through the
 * shipped deterministic fake provider, while account tier setup uses the
 * established Postgres fixture seam. The primary account proves real SSE
 * paints, tool execution, persistence, account-default permissions, the chat
 * permission boundary, and axe; a separate no-plan account proves there is no plan lock.
 */
import AxeBuilder from '@axe-core/playwright';
import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
  type Page,
} from '@playwright/test';

import { freshAccount, logIn, signUp } from './helpers/account';
import { runComposePsql } from './helpers/compose';
import { collectDenials, denyNonLoopback } from './helpers/denyNonLoopback';
import {
  gotoWithStaticAssetNetworkRecovery,
  reloadWithStaticAssetNetworkRecovery,
} from './helpers/navigation';

test.describe.configure({ mode: 'serial' });

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const FAKE_REPLY =
  'Here is what I found in your RankMeFast data. Rankings look stable this week and the latest audit has a short fix-now list worth clearing first.';

interface SessionResponse {
  user?: { id?: string };
}

interface ConversationSummary {
  id: string;
  title: string;
}

interface ConversationsResponse {
  conversations: ConversationSummary[];
}

interface ConversationDetailResponse {
  messages: Array<{
    role: 'user' | 'assistant';
    parts: Array<{ type: string }>;
  }>;
}

interface AssistantSnapshotWindow extends Window {
  __assistantSnapshots?: string[];
  __assistantObserver?: MutationObserver;
}

async function json<T>(response: APIResponse, expectedStatus = 200): Promise<T> {
  expect(response.status()).toBe(expectedStatus);
  return response.json() as Promise<T>;
}

async function accountId(request: APIRequestContext): Promise<string> {
  const session = await json<SessionResponse>(await request.get('/api/auth/get-session'));
  expect(session.user?.id).toBeTruthy();
  return session.user!.id!;
}

function setTier(id: string, tier: 'starter'): void {
  runComposePsql(
    `UPDATE "user"
        SET email_verified = true, updated_at = now()
      WHERE id = :'account_id';

     INSERT INTO subscriptions (account_id, tier, status)
       VALUES (:'account_id', :'tier', 'active')
       ON CONFLICT (account_id)
         DO UPDATE SET tier = EXCLUDED.tier, status = 'active', updated_at = now();`,
    { variables: { account_id: id, tier } },
  );
}

async function logout(page: Page): Promise<void> {
  await gotoWithStaticAssetNetworkRecovery(page, '/logout');
  await page.waitForURL('/login');
  await expect(page.locator('#login-email')).toBeVisible();
}

async function signUpAtStarter(page: Page): Promise<void> {
  const account = freshAccount('assistant-starter');
  await gotoWithStaticAssetNetworkRecovery(page, '/register');
  await expect(page.locator('#register-first-name')).toBeVisible();
  await signUp(page, account);
  const id = await accountId(page.request);
  await logout(page);
  // Apply the tier only after Better Auth's signup hooks settle, then use the
  // real login screen so the journey explicitly covers login → /assistant.
  setTier(id, 'starter');
  await logIn(page, account);
}

async function observeAssistantText(page: Page): Promise<void> {
  await page.evaluate(() => {
    const log = document.querySelector('[role="log"]');
    if (!log) throw new Error('assistant message log not found');

    const state = window as AssistantSnapshotWindow;
    state.__assistantObserver?.disconnect();
    state.__assistantSnapshots = [];
    const observer = new MutationObserver(() => {
      const articles = log.querySelectorAll('article[aria-label="Assistant response"]');
      const latest = articles.item(articles.length - 1);
      const text = latest?.querySelector('p')?.textContent?.trim() ?? '';
      const snapshots = state.__assistantSnapshots!;
      if (text.length > 0 && snapshots.at(-1) !== text) snapshots.push(text);
    });
    observer.observe(log, { childList: true, characterData: true, subtree: true });
    state.__assistantObserver = observer;
  });
}

async function assistantSnapshots(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const state = window as AssistantSnapshotWindow;
    state.__assistantObserver?.disconnect();
    return state.__assistantSnapshots ?? [];
  });
}

async function sendMessage(page: Page, text: string): Promise<void> {
  const replies = page.getByRole('article', { name: 'Assistant response' });
  const replyCount = await replies.count();
  const streamed = page.waitForResponse((response) => {
    const path = new URL(response.url()).pathname;
    return (
      response.request().method() === 'POST' &&
      /^\/api\/chat\/conversations\/[^/]+\/messages$/.test(path)
    );
  });

  await page.getByRole('textbox', { name: 'Message' }).fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
  const response = await streamed;
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/event-stream');

  await expect(replies).toHaveCount(replyCount + 1, { timeout: 30_000 });
  await expect(replies.last()).toContainText(FAKE_REPLY, { timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Stop' })).toHaveCount(0);
}

async function setTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  await page.evaluate((next) => {
    localStorage.setItem('theme', next);
    document.documentElement.classList.toggle('dark', next === 'dark');
  }, theme);
}

async function axe(page: Page, label: string): Promise<void> {
  const result = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  expect(result.violations, `${label}: axe violations`).toEqual([]);
}

async function scanBothThemes(page: Page, label: string): Promise<void> {
  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    await axe(page, `${label}(${theme})`);
  }
  await setTheme(page, 'light');
}

test('Assistant streams, runs tools, persists, enforces MCP defaults, and passes axe', async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  const denials = collectDenials();
  await denyNonLoopback(context, { onDeny: denials.onDeny });
  await signUpAtStarter(page);

  await test.step('new conversation renders multiple SSE deltas and persists after reload', async () => {
    await gotoWithStaticAssetNetworkRecovery(page, '/assistant');
    await expect(page.getByRole('heading', { name: 'AI Assistant' })).toBeVisible();
    await expect(page.getByText('What would you like to improve?')).toBeVisible();
    await page.getByRole('button', { name: 'New conversation' }).click();

    await observeAssistantText(page);
    const firstPrompt = 'Explain what changed in my rankings this week.';
    await sendMessage(page, firstPrompt);
    const snapshots = await assistantSnapshots(page);
    expect(new Set(snapshots).size, `rendered snapshots: ${snapshots.join(' | ')}`).toBeGreaterThan(
      1,
    );
    expect(snapshots.some((value) => value.length < FAKE_REPLY.length)).toBe(true);
    expect(snapshots.at(-1)).toBe(FAKE_REPLY);

    const directive = '[tool:list_sites]';
    await sendMessage(page, directive);
    const toolCard = page
      .getByRole('article', { name: 'Assistant response' })
      .last()
      .getByRole('button', { name: /List sites.*Complete/ });
    await expect(toolCard).toBeVisible();
    await toolCard.click();
    await expect(page.getByText('The tool returned no rows.')).toBeVisible();

    await reloadWithStaticAssetNetworkRecovery(page);
    await expect(page.getByRole('heading', { name: 'AI Assistant' })).toBeVisible();
    await expect(
      page.getByRole('article', { name: 'Your message' }).filter({ hasText: directive }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: /List sites.*Complete/ })).toBeVisible();
  });

  await test.step('account permission survives reload and cannot be bypassed by chat', async () => {
    await gotoWithStaticAssetNetworkRecovery(page, '/profile?tab=mcp');
    await expect(page).toHaveURL(/\/profile\?tab=mcp/);
    const listSites = page.getByRole('switch', { name: 'List sites' });
    await expect(listSites).toBeChecked();
    await listSites.click();
    await expect(listSites).not.toBeChecked();

    const saved = page.waitForResponse(
      (response) =>
        response.request().method() === 'PUT' &&
        new URL(response.url()).pathname === '/api/mcp-permissions',
    );
    await page.getByRole('button', { name: 'Save permissions' }).click();
    expect((await saved).status()).toBe(200);
    await expect(page.getByRole('status')).toContainText('MCP permissions saved.');

    await reloadWithStaticAssetNetworkRecovery(page);
    await expect(page.getByRole('switch', { name: 'List sites' })).not.toBeChecked();

    await gotoWithStaticAssetNetworkRecovery(page, '/assistant');
    await expect(page.getByRole('heading', { name: 'AI Assistant' })).toBeVisible();
    await page.getByRole('button', { name: 'New conversation' }).click();
    await expect(page.getByText('What would you like to improve?')).toBeVisible();
    const deniedDirective = '[tool:list_sites {"locale":"en"}]';
    await sendMessage(page, deniedDirective);
    await expect(page.getByRole('button', { name: /List sites.*Complete/ })).toHaveCount(0);

    const conversations = await json<ConversationsResponse>(
      await page.request.get('/api/chat/conversations'),
    );
    const deniedConversation = conversations.conversations.find(
      (conversation) => conversation.title === deniedDirective,
    );
    expect(deniedConversation?.id).toBeTruthy();
    const detail = await json<ConversationDetailResponse>(
      await page.request.get(`/api/chat/conversations/${deniedConversation!.id}`),
    );
    const assistantParts = detail.messages
      .filter((message) => message.role === 'assistant')
      .flatMap((message) => message.parts);
    expect(assistantParts.map((part) => part.type)).toEqual(['text']);
  });

  await test.step('Assistant and MCP permission surfaces have no axe violations', async () => {
    await scanBothThemes(page, 'assistant');
    await gotoWithStaticAssetNetworkRecovery(page, '/profile?tab=mcp');
    await expect(page.getByRole('switch', { name: 'List sites' })).toBeVisible();
    await scanBothThemes(page, 'mcp-permissions');
  });

  expect(denials.urls, 'browser made no non-loopback requests').toEqual([]);
});

test('A no-plan account gets the Assistant without a plan lock or pricing link', async ({
  page,
  context,
}) => {
  const denials = collectDenials();
  await denyNonLoopback(context, { onDeny: denials.onDeny });
  await signUp(page, freshAccount('assistant-free'));

  // The self-hosted client ships no billing UI: there is no upgrade lock and
  // no plan-comparison link; the composer is available to every account.
  await gotoWithStaticAssetNetworkRecovery(page, '/assistant');
  await expect(page.getByRole('heading', { name: 'AI Assistant' })).toBeVisible();
  await expect(page.getByTestId('assistant-state-locked')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Compare plans' })).toHaveCount(0);
  await expect(page.locator('a[href="/pricing"], a[href^="/billing"]')).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
  expect(denials.urls, 'browser made no non-loopback requests').toEqual([]);
});
