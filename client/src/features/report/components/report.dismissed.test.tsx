/**
 * The Dismissed section of a report: who dismissed what, when and why, whether
 * the newest audit still detects it, a targeted re-check, and Restore.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { ApiError } from '@shared/api/client';
import * as api from '../api';
import { reportReducer } from '../store/slice';
import { actionsReducer, type ActionItem } from '@features/actions';
import { ReportPage } from './ReportPage';
import type { AuditReport, FindingDecision, LocalizedFinding, PublicAuditRun } from '../types';

vi.mock('../api', () => ({
  fetchAuditRunsRequest: vi.fn(),
  fetchReportRequest: vi.fn(),
  fetchLatestRunRequest: vi.fn(),
  fetchRunRequest: vi.fn(),
  startAuditRequest: vi.fn(),
  generateAiSummaryRequest: vi.fn(),
  markLocalBusinessRequest: vi.fn(),
  fetchFindingRecheckPreviewRequest: vi.fn(),
  runFindingRecheckRequest: vi.fn(),
}));

const actionsApi = vi.hoisted(() => ({
  listActions: vi.fn(async (): Promise<import('@features/actions').ListActionsResponse> => ({
    items: [],
    sourceStatus: {},
    nextCursor: null,
  })),
  mutateActionState: vi.fn(),
}));
vi.mock('@features/actions/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/actions/api')>()),
  listActions: actionsApi.listActions,
  mutateActionState: actionsApi.mutateActionState,
}));

const mocked = vi.mocked(api);

const finding = (ruleId: string, bucket: LocalizedFinding['bucket'], urls: number, decision?: FindingDecision): LocalizedFinding => ({
  ruleId,
  bucket,
  severity: bucket === 'fix-now' ? 'critical' : 'warning',
  affectedUrls: Array.from({ length: urls }, (_, i) => `https://episodebrief.example/${ruleId}/${i}`),
  copy: { title: `Title ${ruleId}`, why: 'Why.', fix: 'Fix.', passedLabel: 'Passed.' },
  ...(decision ? { decision } : {}),
});

const decision = (over: Partial<FindingDecision> = {}): FindingDecision => ({
  state: 'dismissed',
  regressed: false,
  decidedAt: '2026-10-16T09:00:00.000Z',
  decidedBy: 'Sam Owner',
  reason: 'false_positive',
  affectedCountAtDismissal: 65,
  latest: { runId: 'run-new', detected: true, affectedCount: 65 },
  resurfaced: null,
  recheckable: true,
  recheck: null,
  ...over,
});

const newRun: PublicAuditRun = {
  id: 'run-new',
  siteId: 'site-1',
  status: 'succeeded',
  pageCap: 100,
  pagesCrawled: 5,
  startedAt: '2026-10-16T23:48:43.000Z',
  finishedAt: '2026-10-16T23:55:48.000Z',
  error: null,
  createdAt: '2026-10-16T23:48:43.000Z',
  updatedAt: '2026-10-16T23:55:48.000Z',
} as PublicAuditRun;

const newReport: AuditReport = {
  runId: 'run-new',
  latestRunId: 'run-new',
  counts: { fixNow: 1, watch: 5, passed: 13 },
  findings: [finding('not-indexed', 'fix-now', 3)],
  diff: { entries: [], summary: { fixed: 0, regressed: 0, new: 0, unchanged: 0 } },
  pageSpeed: null,
} as AuditReport;

const makeStore = () =>
  configureStore({ reducer: { report: reportReducer, actions: actionsReducer } });

const renderReport = (path = '/sites/site-1/report') => {
  render(
    <Provider store={makeStore()}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/sites/:siteId/report" element={<ReportPage />} />
            <Route path="/sites/:siteId/report/:runId" element={<ReportPage />} />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );
};

const fixNowCount = () => screen.getByTestId('report-tab-fix-now').textContent;

function auditAction(ruleId: string, over: Partial<ActionItem> = {}): ActionItem {
  return {
    id: `action-${ruleId}`,
    siteId: 'site-1',
    sourceType: 'audit_finding',
    sourceId: ruleId,
    sourceLink: '/sites/site-1/report',
    problem: 'p',
    whyItMatters: 'w',
    nextStep: 'n',
    affectedUrls: [],
    evidence: [],
    severity: 'critical',
    firstPartyImpact: 'high',
    confidence: 'high',
    effort: 'low',
    state: 'open',
    version: 1,
    reappearedAfterFix: false,
    observedAt: '2026-10-16T00:00:00.000Z',
    lastVerifiedAt: null,
    retest: { available: true },
    copy: {
      problem: { messageKey: `auditRules.${ruleId}.title` },
      whyItMatters: { messageKey: `auditRules.${ruleId}.why` },
      nextStep: { messageKey: `auditRules.${ruleId}.fix` },
    },
    ...over,
  } as ActionItem;
}

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
  mocked.fetchAuditRunsRequest.mockResolvedValue({ runs: [newRun], nextCursor: null });
  mocked.fetchLatestRunRequest.mockResolvedValue({ runs: [newRun], nextCursor: null });
  mocked.fetchRunRequest.mockResolvedValue({ run: newRun });
  mocked.fetchReportRequest.mockResolvedValue(newReport);
  actionsApi.listActions.mockResolvedValue({ items: [], sourceStatus: {}, nextCursor: null });
});

describe('the Dismissed section', () => {
  const withFindings = (findings: LocalizedFinding[], counts = { fixNow: 1, watch: 1, passed: 0 }) =>
    mocked.fetchReportRequest.mockResolvedValue({ ...newReport, counts, findings });

  it('lists who dismissed what, when and why, whether the newest audit still detects it, and offers Restore', async () => {
    withFindings([
      finding('broken-internal-links', 'fix-now', 65, decision()),
      finding('thin-content', 'watch', 2, decision({ decidedBy: null, reason: null, latest: { runId: 'run-new', detected: false, affectedCount: 0 }, recheckable: false })),
    ]);
    actionsApi.listActions.mockResolvedValue({
      items: [auditAction('broken-internal-links', { state: 'dismissed', version: 2 })],
      sourceStatus: {},
      nextCursor: null,
    });
    renderReport();
    const section = await screen.findByTestId('report-dismissed');
    expect(within(section).getByRole('heading', { level: 3 })).toHaveTextContent('Dismissed (2)');
    const [first, second] = within(section).getAllByTestId('report-dismissed-row');
    expect(within(first!).getByTestId('report-dismissed-by')).toHaveTextContent('Dismissed by Sam Owner on Oct 16, 2026');
    expect(within(first!).getByTestId('report-dismissed-reason')).toHaveTextContent('Reason: False positive');
    expect(within(first!).getByTestId('report-dismissed-latest')).toHaveTextContent('Still detected in the latest audit: 65 pages affected.');
    expect(within(first!).getByTestId('report-dismissed-restore')).toBeInTheDocument();
    expect(within(second!).getByTestId('report-dismissed-by')).toHaveTextContent('Dismissed on Oct 16, 2026');
    expect(within(second!).queryByTestId('report-dismissed-reason')).toBeNull();
    expect(within(second!).getByTestId('report-dismissed-latest')).toHaveTextContent('Not detected in the latest audit.');
    expect(within(second!).getByTestId('report-dismissed-recheck-by-audit')).toBeInTheDocument();
    expect(within(second!).queryByTestId('report-dismissed-restore')).toBeNull();
    expect(screen.getByTestId('report-not-counted')).toHaveTextContent('Not in these counts: 2 dismissed, 0 marked fixed.');
    expect(fixNowCount()).toContain('(0)');
  });

  it('previews a re-check, runs it, and shows the result', async () => {
    withFindings([finding('broken-internal-links', 'fix-now', 65, decision())]);
    mocked.fetchFindingRecheckPreviewRequest.mockResolvedValue({
      ruleId: 'broken-internal-links',
      totalUrls: 63,
      urlCount: 25,
      lastRecheck: null,
    });
    mocked.runFindingRecheckRequest.mockResolvedValue({
      recheck: {
        checkedAt: '2026-10-17T10:00:00.000Z',
        totalUrls: 63,
        checked: 25,
        stillFailing: 20,
        cleared: 4,
        unverified: 1,
        results: [],
      },
    });
    renderReport();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('report-dismissed-recheck'));
    const dialog = await screen.findByTestId('report-recheck-dialog');
    expect(await within(dialog).findByTestId('report-recheck-preview')).toHaveTextContent('We will request 25 of 63 URLs again');
    expect(within(dialog).getByTestId('report-recheck-preview')).toHaveTextContent('does not start a new audit');
    expect(mocked.runFindingRecheckRequest).not.toHaveBeenCalled();
    await user.click(within(dialog).getByTestId('report-recheck-confirm'));
    expect(mocked.runFindingRecheckRequest).toHaveBeenCalledWith('run-new', 'broken-internal-links');
    expect(await screen.findByTestId('report-dismissed-recheck-result')).toHaveTextContent(
      'Re-checked Oct 17, 2026: of 25 URLs, 20 still fail, 4 now work and 1 could not be checked.',
    );
    expect(screen.queryByTestId('report-recheck-dialog')).toBeNull();
  });

  it('shows preview and re-check failures inside the dialog, and closes on cancel', async () => {
    withFindings([finding('broken-internal-links', 'fix-now', 2, decision({ recheck: { checkedAt: '2026-10-15T00:00:00.000Z', totalUrls: 1, checked: 1, stillFailing: 1, cleared: 0, unverified: 0, results: [] } }))]);
    mocked.fetchFindingRecheckPreviewRequest.mockRejectedValueOnce(new ApiError('x', 409, { message: 'This finding cannot be re-checked here.' }));
    renderReport();
    expect(await screen.findByTestId('report-dismissed-recheck-result')).toHaveTextContent('Re-checked Oct 15, 2026');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('report-dismissed-recheck'));
    expect(await screen.findByTestId('report-recheck-error')).toBeInTheDocument();
    expect(screen.getByTestId('report-recheck-confirm')).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('report-recheck-dialog')).toBeNull());

    mocked.fetchFindingRecheckPreviewRequest.mockResolvedValue({ ruleId: 'broken-internal-links', totalUrls: 1, urlCount: 1, lastRecheck: null });
    mocked.runFindingRecheckRequest.mockRejectedValueOnce(new TypeError('offline'));
    await user.click(screen.getByTestId('report-dismissed-recheck'));
    await user.click(await screen.findByTestId('report-recheck-confirm').then(async (b) => {
      await waitFor(() => expect(b).not.toBeDisabled());
      return b;
    }));
    expect(await screen.findByTestId('report-recheck-error')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId('report-recheck-dialog')).toBeNull());
  });

  it('ignores a preview that settles after the dialog closed', async () => {
    withFindings([finding('broken-internal-links', 'fix-now', 2, decision())]);
    let settle: (value: Awaited<ReturnType<typeof api.fetchFindingRecheckPreviewRequest>>) => void = () => {};
    let fail: (err: unknown) => void = () => {};
    mocked.fetchFindingRecheckPreviewRequest
      .mockImplementationOnce(() => new Promise((resolve) => { settle = resolve; }))
      .mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    renderReport();
    const user = userEvent.setup();
    for (const finish of [() => settle({ ruleId: 'broken-internal-links', totalUrls: 1, urlCount: 1, lastRecheck: null }), () => fail(new Error('late'))]) {
      await user.click(await screen.findByTestId('report-dismissed-recheck'));
      await screen.findByTestId('report-recheck-preview-loading');
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByTestId('report-recheck-dialog')).toBeNull());
      await act(async () => finish());
    }
    expect(screen.queryByTestId('report-recheck-error')).toBeNull();
  });

  it('restores through the shared confirmation, which closes on cancel', async () => {
    withFindings([finding('broken-internal-links', 'fix-now', 2, decision())]);
    actionsApi.listActions.mockResolvedValue({
      items: [auditAction('broken-internal-links', { state: 'dismissed', version: 3 })],
      sourceStatus: {},
      nextCursor: null,
    });
    actionsApi.mutateActionState.mockRejectedValueOnce(new ApiError('conflict', 409, { error: { message: 'stale' } }));
    renderReport();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('report-dismissed-restore'));
    expect(await screen.findByTestId('action-state-dialog')).toBeInTheDocument();
    await user.click(screen.getByTestId('action-state-confirm'));
    const reads = actionsApi.listActions.mock.calls.length;
    await user.click(await screen.findByTestId('action-state-conflict-reload'));
    await waitFor(() => expect(actionsApi.listActions.mock.calls.length).toBe(reads + 1));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByTestId('action-state-dialog')).toBeNull());
  });

  it('counts a resurfaced dismissal as open and says how many more pages it affects', async () => {
    withFindings([finding('broken-internal-links', 'fix-now', 77, decision({ resurfaced: { addedCount: 12 } }))]);
    actionsApi.listActions.mockResolvedValue({
      items: [auditAction('broken-internal-links', { state: 'dismissed', version: 2 })],
      sourceStatus: {},
      nextCursor: null,
    });
    renderReport();
    expect(await screen.findByTestId('report-finding-resurfaced')).toHaveTextContent(
      'Dismissed, but 12 more pages are now affected.',
    );
    expect(fixNowCount()).toContain('(1)');
    expect(screen.queryByTestId('report-dismissed')).toBeNull();
    expect(screen.queryByTestId('report-not-counted')).toBeNull();
    // Still dismissed: the row offers the way back to the open list.
    await userEvent.setup().click(await screen.findByTestId('report-finding-reopen'));
    expect(await screen.findByTestId('action-state-dialog')).toBeInTheDocument();
  });

  it('a restore taken on this page wins over the decision the report loaded with', async () => {
    withFindings([finding('broken-internal-links', 'fix-now', 2, decision())]);
    actionsApi.listActions.mockResolvedValue({
      items: [auditAction('broken-internal-links', { state: 'open', version: 4 })],
      sourceStatus: {},
      nextCursor: null,
    });
    renderReport();
    await waitFor(() => expect(fixNowCount()).toContain('(1)'));
    expect(screen.queryByTestId('report-dismissed')).toBeNull();
  });
});

describe('fixed findings and crawl coverage', () => {
  it('moves a fixed finding to a group inside its tab and out of the tab count', async () => {
    mocked.fetchReportRequest.mockResolvedValue({
      ...newReport,
      counts: { fixNow: 2, watch: 0, passed: 0 },
      findings: [
        finding('broken-internal-links', 'fix-now', 2, decision({ state: 'completed', reason: null })),
        finding('not-indexed', 'fix-now', 3),
      ],
    });
    renderReport();
    const group = await screen.findByTestId('report-resolved-fix-now');
    expect(within(group).getByRole('heading', { level: 3 })).toHaveTextContent('Marked fixed in Fix now (1)');
    expect(within(group).getByText('Title broken-internal-links')).toBeInTheDocument();
    expect(screen.getAllByTestId('report-issue-row')).toHaveLength(2);
    expect(fixNowCount()).toContain('(1)');
    expect(screen.getByTestId('report-not-counted')).toHaveTextContent('Not in these counts: 0 dismissed, 1 marked fixed.');
  });

  it('says the tab is empty, not that a category filter hides things, when only resolved findings remain', async () => {
    mocked.fetchReportRequest.mockResolvedValue({
      ...newReport,
      counts: { fixNow: 1, watch: 0, passed: 0 },
      findings: [{ ...finding('broken-internal-links', 'fix-now', 2, decision({ state: 'completed', reason: null })), category: 'links-redirects' }],
    });
    renderReport('/sites/site-1/report?category=links-redirects');
    expect(await screen.findByTestId('report-empty-fix-now')).toBeInTheDocument();
    expect(screen.queryByTestId('report-empty-category')).toBeNull();
    expect(screen.getByTestId('report-resolved-fix-now')).toBeInTheDocument();
  });

  it('shows what the crawl recorded about itself under the tabs', async () => {
    mocked.fetchReportRequest.mockResolvedValue({
      ...newReport,
      crawl: {
        finishedAt: null,
        pageCap: 100,
        pagesStored: 12,
        vendorPagesCrawled: 12,
        stopReason: 'no_more_links',
        sitemapFound: false,
      },
    });
    renderReport();
    expect(await screen.findByTestId('report-crawl-coverage')).toHaveTextContent('12');
    expect(screen.getByTestId('report-crawl-no-sitemap')).toBeInTheDocument();
  });
});
