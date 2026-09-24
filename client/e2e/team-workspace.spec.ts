/**
 * Team invitation journey against the real composed application.
 *
 * The gate starts with the production email adapter selected. This project
 * temporarily recreates only the API with the isolated fake mailbox enabled,
 * exercises the links and one-time credentials exactly as a recipient would,
 * then restores the inherited runtime values even when an assertion fails.
 */
import { randomUUID } from 'node:crypto';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { freshAccount, signUp, type TestAccount } from './helpers/account';
import {
  assertComposeRuntimeParity,
  captureInheritedComposeEnvironment,
  clearCapturedE2eEmails,
  readCapturedE2eEmails,
  readComposeServiceEnvironment,
  recreateComposeServices,
  runComposePsql,
  runComposePsqlOutput,
  type CapturedE2eEmail,
} from './helpers/compose';

test.describe.configure({ mode: 'serial' });

interface SessionResponse {
  user?: { id?: string };
}

interface PublicSite {
  id: string;
  domain: string;
}

interface CreateSiteResponse {
  site: PublicSite;
}

interface WorkspacesResponse {
  workspaces: Array<{
    accountId: string;
    role: 'owner' | 'admin' | 'member';
    siteAccess?: { mode: 'all' | 'selected'; siteIds: string[] };
  }>;
}

interface InviteMailDetails {
  message: CapturedE2eEmail;
  acceptUrl: string;
  rejectUrl: string;
  temporaryPassword: string | null;
}

interface CsrfResponse {
  csrfToken: string;
}

async function accountId(page: Page): Promise<string> {
  const response = await page.request.get('/api/auth/get-session');
  expect(response.status()).toBe(200);
  const id = ((await response.json()) as SessionResponse).user?.id;
  expect(id).toBeTruthy();
  return id as string;
}

/** Seats belong to the workspace. Agency leaves room for every invitation. */
function setAgencyTier(id: string): void {
  runComposePsql(
    `INSERT INTO subscriptions (account_id, tier, status)
       VALUES (:'account_id', 'agency', 'active')
       ON CONFLICT (account_id)
         DO UPDATE SET tier = 'agency', status = 'active', updated_at = now();`,
    { variables: { account_id: id } },
  );
}

async function newSignedUpContext(
  browser: Browser,
  account: TestAccount,
  contexts: BrowserContext[],
): Promise<Page> {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  await signUp(page, account);
  return page;
}

async function createSite(page: Page, url: string): Promise<PublicSite> {
  await page.goto('/sites');
  await expect(page.locator('#site-url')).toBeVisible();
  await page.locator('#site-url').fill(url);
  const responsePromise = page.waitForResponse(
    (response) => response.request().method() === 'POST' && response.url().endsWith('/api/sites'),
  );
  await page.getByRole('button', { name: /^add site$/i }).click();
  const response = await responsePromise;
  expect(response.status()).toBe(201);
  const body = (await response.json()) as CreateSiteResponse;
  await expect(page.getByRole('link', { name: body.site.domain }).first()).toBeVisible();
  return body.site;
}

async function inviteFromTeamPage(
  ownerPage: Page,
  input: {
    email: string;
    role: 'Admin' | 'Member';
    access: 'all' | 'selected';
    selectedDomains?: string[];
  },
): Promise<void> {
  await ownerPage.goto('/settings/team');
  await expect(ownerPage.locator('#team-invite-email')).toBeVisible();
  await ownerPage.locator('#team-invite-email').fill(input.email);

  await ownerPage.locator('#team-invite-role').click();
  await ownerPage.getByRole('option', { name: input.role, exact: true }).click();

  if (input.access === 'all') {
    await ownerPage.getByLabel('All sites', { exact: true }).click();
  } else {
    await ownerPage.getByLabel('Selected sites', { exact: true }).click();
    const selected = new Set(input.selectedDomains ?? []);
    for (const checkbox of await ownerPage.getByRole('checkbox').all()) {
      const label = (await checkbox.getAttribute('aria-label')) ?? '';
      // TeamSiteAccessFields uses an associated <label>, rather than an
      // aria-label. Resolve its accessible name through Playwright instead.
      const id = await checkbox.getAttribute('id');
      const text = id
        ? ((await ownerPage.locator(`label[for="${id}"]`).textContent())?.trim() ?? '')
        : label;
      if (selected.has(text)) await checkbox.check();
      else await checkbox.uncheck();
    }
  }

  const inviteResponse = ownerPage.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().endsWith('/api/team/invite'),
  );
  await ownerPage.getByRole('button', { name: /^send invite$/i }).click();
  expect((await inviteResponse).status()).toBe(201);
  await expect(ownerPage.getByRole('status')).toContainText(input.email);
}

async function waitForInvitationEmail(email: string): Promise<InviteMailDetails> {
  await expect
    .poll(
      () =>
        readCapturedE2eEmails().filter(
          (record) => record.to === email && /invited/i.test(record.subject),
        ).length,
      { message: `invitation email was not captured for ${email}`, timeout: 15_000 },
    )
    .toBeGreaterThan(0);

  const message = readCapturedE2eEmails()
    .filter((record) => record.to === email && /invited/i.test(record.subject))
    .at(-1);
  if (!message) throw new Error(`Invitation email disappeared for ${email}`);

  const acceptUrl = /^Accept:\s*(https?:\/\/\S+)\s*$/mu.exec(message.text)?.[1];
  const rejectUrl = /^Reject:\s*(https?:\/\/\S+)\s*$/mu.exec(message.text)?.[1];
  const temporaryPassword = /^Temporary password:\s*(\S+)\s*$/mu.exec(message.text)?.[1] ?? null;
  if (!acceptUrl || !rejectUrl) {
    throw new Error(`Captured invitation email for ${email} is missing an action URL`);
  }
  return { message, acceptUrl, rejectUrl, temporaryPassword };
}

async function signInWithTemporaryPassword(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.locator('#login-email').fill(email);
  await page.locator('#login-password').fill(password);
  const responsePromise = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && response.url().endsWith('/api/auth/sign-in/email'),
  );
  await page.locator('form button[type="submit"]').click();
  expect((await responsePromise).status()).toBe(200);
  await page.waitForURL(/\/team\/change-password(?:\?|$)/u, { timeout: 30_000 });
}

async function switchToWorkspace(page: Page, ownerEmail: string): Promise<void> {
  const switcher = page.getByLabel('Workspace', { exact: true });
  await expect(switcher).toBeVisible();
  await switcher.click();
  await page.getByRole('menuitem').filter({ hasText: ownerEmail }).click({ force: true });
  await expect(switcher).toContainText(ownerEmail);
}

async function assertWorkspaceMembership(
  page: Page,
  teamId: string,
  role: 'admin' | 'member',
  access: { mode: 'all' | 'selected'; siteIds?: string[] },
): Promise<void> {
  const response = await page.request.get('/api/team/workspaces');
  expect(response.status()).toBe(200);
  const body = (await response.json()) as WorkspacesResponse;
  const workspace = body.workspaces.find((candidate) => candidate.accountId === teamId);
  expect(workspace?.role).toBe(role);
  expect(workspace?.siteAccess?.mode).toBe(access.mode);
  if (access.mode === 'selected') {
    expect([...(workspace?.siteAccess?.siteIds ?? [])].sort()).toEqual(
      [...(access.siteIds ?? [])].sort(),
    );
  }
}

async function createSiteViaApi(page: Page, url: string): Promise<PublicSite> {
  const csrfResponse = await page.request.get('/api/security/csrf-token');
  expect(csrfResponse.status()).toBe(200);
  const { csrfToken } = (await csrfResponse.json()) as CsrfResponse;
  const response = await page.request.post('/api/sites', {
    headers: { 'x-csrf-token': csrfToken },
    data: { url },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as CreateSiteResponse).site;
}

async function resetToOwnWorkspace(page: Page): Promise<void> {
  await page.evaluate(() => localStorage.removeItem('rankme.activeWorkspaceId'));
  await page.reload();
}

async function openInvitationInbox(page: Page, expectedCount = 1): Promise<void> {
  await page.goto('/dashboard');
  const trigger = page.getByRole('button', {
    name: new RegExp(`team invitations, ${expectedCount} pending`, 'i'),
  });
  await expect(trigger).toBeVisible();
  await trigger.click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
}

function accountRows(email: string): number {
  return Number(
    runComposePsqlOutput(`SELECT count(*) FROM "user" WHERE lower(email) = lower(:'email');`, {
      variables: { email },
    }),
  );
}

test('role- and site-scoped invitations support provisioned and existing recipients', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const inheritedEmailRuntime = captureInheritedComposeEnvironment([
    'EMAIL_TRANSPORT',
    'E2E_EMAIL_CAPTURE',
  ]);
  const contexts: BrowserContext[] = [];

  try {
    recreateComposeServices(['api'], {
      EMAIL_TRANSPORT: 'fake',
      E2E_EMAIL_CAPTURE: 'true',
    });
    expect(readComposeServiceEnvironment('api', ['EMAIL_TRANSPORT', 'E2E_EMAIL_CAPTURE'])).toEqual({
      EMAIL_TRANSPORT: 'fake',
      E2E_EMAIL_CAPTURE: 'true',
    });
    clearCapturedE2eEmails();

    const owner = freshAccount('team-owner');
    const existingAccept = freshAccount('team-existing-accept');
    const existingReject = freshAccount('team-existing-reject');
    const provisionedAccept = freshAccount('team-provisioned-accept').email;
    const provisionedReject = freshAccount('team-provisioned-reject').email;

    const ownerPage = await newSignedUpContext(browser, owner, contexts);
    const ownerId = await accountId(ownerPage);
    setAgencyTier(ownerId);

    const allowedSite = await createSite(ownerPage, 'https://team-allowed.example');
    const hiddenSite = await createSite(ownerPage, 'https://team-hidden.example');

    // Unknown recipient: the owner chooses Member + one site. The response
    // never exposes tokens; the real captured email carries both action
    // buttons and the temporary credentials.
    await inviteFromTeamPage(ownerPage, {
      email: provisionedAccept,
      role: 'Member',
      access: 'selected',
      selectedDomains: [allowedSite.domain],
    });
    const provisionedMail = await waitForInvitationEmail(provisionedAccept);
    expect(provisionedMail.temporaryPassword).not.toBeNull();
    expect(provisionedMail.message.text).toContain(`Sites: ${allowedSite.domain}`);
    expect(provisionedMail.message.text).not.toContain(hiddenSite.domain);
    expect(provisionedMail.message.html).toContain(provisionedMail.acceptUrl);
    expect(provisionedMail.message.html).toContain(provisionedMail.rejectUrl);
    expect(provisionedMail.message.html).toContain('Accept invitation');
    expect(provisionedMail.message.html).toContain('Reject invitation');

    const provisionedContext = await browser.newContext();
    contexts.push(provisionedContext);
    const provisionedPage = await provisionedContext.newPage();
    await provisionedPage.goto(new URL(provisionedMail.acceptUrl).pathname);
    await expect(
      provisionedPage.getByRole('heading', { level: 1, name: /accept team invitation/i }),
    ).toBeVisible();
    await provisionedPage.getByRole('link', { name: /sign in to accept/i }).click();
    await signInWithTemporaryPassword(
      provisionedPage,
      provisionedAccept,
      provisionedMail.temporaryPassword as string,
    );

    const replacementPassword = `NewPassw0rd!${randomUUID().slice(0, 8)}`;
    await provisionedPage
      .locator('#change-current')
      .fill(provisionedMail.temporaryPassword as string);
    await provisionedPage.locator('#change-new').fill(replacementPassword);
    await provisionedPage.locator('#change-confirm').fill(replacementPassword);
    const passwordResponse = provisionedPage.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        response.url().endsWith('/api/auth/change-password'),
    );
    await provisionedPage.getByRole('button', { name: /^update password$/i }).click();
    expect((await passwordResponse).status()).toBe(200);
    // Once the temporary credential is replaced, the account remains
    // provisional until it accepts one invitation. The provisional-account
    // guard deliberately recovers into the authenticated inbox instead of
    // retaining the bearer token in the browser URL.
    await provisionedPage.waitForURL('/team/invitations', { timeout: 30_000 });
    await expect(
      provisionedPage.getByRole('heading', { level: 1, name: /^team invitations$/i }),
    ).toBeVisible();
    await expect(provisionedPage.getByText(owner.email)).toBeVisible();
    await expect(provisionedPage.getByText(allowedSite.domain)).toBeVisible();
    const acceptResponse = provisionedPage.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/api\/team\/invitations\/[^/]+\/accept$/u.test(response.url()),
    );
    await provisionedPage.getByRole('button', { name: /^accept$/i }).click();
    expect((await acceptResponse).status()).toBe(200);
    await provisionedPage.waitForURL('/dashboard', { timeout: 30_000 });
    await assertWorkspaceMembership(provisionedPage, ownerId, 'member', {
      mode: 'selected',
      siteIds: [allowedSite.id],
    });

    await switchToWorkspace(provisionedPage, owner.email);
    await provisionedPage.goto('/sites');
    await expect(
      provisionedPage.getByRole('link', { name: allowedSite.domain }).first(),
    ).toBeVisible();
    await expect(provisionedPage.getByRole('link', { name: hiddenSite.domain })).toHaveCount(0);
    const allowedRead = await provisionedPage.request.get(`/api/sites/${allowedSite.id}`, {
      headers: { 'x-workspace-id': ownerId },
    });
    const deniedRead = await provisionedPage.request.get(`/api/sites/${hiddenSite.id}`, {
      headers: { 'x-workspace-id': ownerId },
    });
    expect(allowedRead.status()).toBe(200);
    expect(deniedRead.status()).toBe(404);

    // Rejecting the last invitation through the public email button deletes
    // only a still-unclaimed, system-provisioned account.
    await resetToOwnWorkspace(ownerPage);
    await inviteFromTeamPage(ownerPage, {
      email: provisionedReject,
      role: 'Member',
      access: 'selected',
      selectedDomains: [hiddenSite.domain],
    });
    const rejectedProvisionedMail = await waitForInvitationEmail(provisionedReject);
    expect(rejectedProvisionedMail.temporaryPassword).not.toBeNull();
    expect(accountRows(provisionedReject)).toBe(1);

    const anonymousContext = await browser.newContext();
    contexts.push(anonymousContext);
    const anonymousPage = await anonymousContext.newPage();
    await anonymousPage.goto(new URL(rejectedProvisionedMail.rejectUrl).pathname);
    await expect(
      anonymousPage.getByRole('heading', { level: 1, name: /reject team invitation/i }),
    ).toBeVisible();
    await anonymousPage.getByRole('button', { name: /^reject invitation$/i }).click();
    const rejectDialog = anonymousPage.getByRole('alertdialog');
    await expect(rejectDialog).toBeVisible();
    const rejectResponse = anonymousPage.waitForResponse(
      (response) =>
        response.request().method() === 'POST' && response.url().includes('/api/team/reject/'),
    );
    await rejectDialog.getByRole('button', { name: /^reject invitation$/i }).click();
    expect((await rejectResponse).status()).toBe(200);
    await expect(anonymousPage.getByText(/invitation has been rejected/i)).toBeVisible();
    await expect.poll(() => accountRows(provisionedReject)).toBe(0);

    // Existing recipients get no temporary password. Their signed-in app
    // inbox is actionable: one accepts an Admin/All-sites invite and another
    // rejects a Member/selected-sites invite without deleting their account.
    const existingAcceptPage = await newSignedUpContext(browser, existingAccept, contexts);
    await resetToOwnWorkspace(ownerPage);
    await inviteFromTeamPage(ownerPage, {
      email: existingAccept.email,
      role: 'Admin',
      access: 'all',
    });
    const existingAcceptMail = await waitForInvitationEmail(existingAccept.email);
    expect(existingAcceptMail.temporaryPassword).toBeNull();
    expect(existingAcceptMail.message.html).toContain(existingAcceptMail.acceptUrl);
    expect(existingAcceptMail.message.html).toContain(existingAcceptMail.rejectUrl);
    expect(existingAcceptMail.message.text).toContain('Role: Admin');
    expect(existingAcceptMail.message.text).toContain('Sites: All sites');

    await openInvitationInbox(existingAcceptPage);
    const acceptSheet = existingAcceptPage.getByRole('dialog');
    await expect(acceptSheet).toContainText(owner.email);
    const inboxAcceptResponse = existingAcceptPage.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/api\/team\/invitations\/[^/]+\/accept$/u.test(response.url()),
    );
    await acceptSheet.getByRole('button', { name: /^accept$/i }).click();
    expect((await inboxAcceptResponse).status()).toBe(200);
    await assertWorkspaceMembership(existingAcceptPage, ownerId, 'admin', { mode: 'all' });

    // An All-sites grant is dynamic. Create the third site after acceptance:
    // the selected Member still cannot discover it, while the accepted Admin
    // sees it both in the list UI and through the direct resource endpoint.
    const futureSite = await createSiteViaApi(ownerPage, 'https://team-future.example');
    const deniedFutureRead = await provisionedPage.request.get(`/api/sites/${futureSite.id}`, {
      headers: { 'x-workspace-id': ownerId },
    });
    expect(deniedFutureRead.status()).toBe(404);
    const allSitesFutureRead = await existingAcceptPage.request.get(`/api/sites/${futureSite.id}`, {
      headers: { 'x-workspace-id': ownerId },
    });
    expect(allSitesFutureRead.status()).toBe(200);
    await switchToWorkspace(existingAcceptPage, owner.email);
    await existingAcceptPage.goto('/sites');
    await expect(
      existingAcceptPage.getByRole('link', { name: futureSite.domain }).first(),
    ).toBeVisible();

    // Admin delegation is deliberately narrower than ownership: the role
    // picker cannot offer Admin, but a Member invitation remains available.
    await existingAcceptPage.goto('/settings/team');
    await expect(existingAcceptPage.locator('#team-invite-role')).toBeDisabled();
    await expect(existingAcceptPage.locator('#team-invite-role')).toContainText('Member');
    await expect(existingAcceptPage.getByText(/admins can invite members only/i)).toBeVisible();

    const existingRejectPage = await newSignedUpContext(browser, existingReject, contexts);
    await resetToOwnWorkspace(ownerPage);
    await inviteFromTeamPage(ownerPage, {
      email: existingReject.email,
      role: 'Member',
      access: 'selected',
      selectedDomains: [allowedSite.domain],
    });
    const existingRejectMail = await waitForInvitationEmail(existingReject.email);
    expect(existingRejectMail.temporaryPassword).toBeNull();

    await openInvitationInbox(existingRejectPage);
    const rejectSheet = existingRejectPage.getByRole('dialog');
    await expect(rejectSheet).toContainText(owner.email);
    await rejectSheet.getByRole('button', { name: /^reject$/i }).click();
    const inboxRejectDialog = existingRejectPage.getByRole('alertdialog');
    await expect(inboxRejectDialog).toBeVisible();
    const inboxRejectResponse = existingRejectPage.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        /\/api\/team\/invitations\/[^/]+\/reject$/u.test(response.url()),
    );
    await inboxRejectDialog.getByRole('button', { name: /^reject$/i }).click();
    expect((await inboxRejectResponse).status()).toBe(200);
    await expect(inboxRejectDialog).toBeHidden();
    expect(accountRows(existingReject.email)).toBe(1);
    expect((await existingRejectPage.request.get('/api/auth/get-session')).status()).toBe(200);
    const rejectedWorkspaces = (await (
      await existingRejectPage.request.get('/api/team/workspaces')
    ).json()) as WorkspacesResponse;
    expect(rejectedWorkspaces.workspaces.some((workspace) => workspace.accountId === ownerId)).toBe(
      false,
    );
  } finally {
    await Promise.allSettled(contexts.map((context) => context.close()));
    recreateComposeServices(['api'], inheritedEmailRuntime);
    assertComposeRuntimeParity(inheritedEmailRuntime, ['api']);
  }
});
