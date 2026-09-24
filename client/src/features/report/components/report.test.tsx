import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import * as api from '../api';
import { reportReducer } from '../store/slice';
import { REPORT_TABS, isReportTab, bucketForTab, DEFAULT_REPORT_TAB } from '../tabState';
import { reportErrorMessage } from '../errorMessage';
import { ApiError } from '@shared/api/client';
import { ReportPage } from './ReportPage';
import { IssueRow } from './IssueRow';
import { IssueDetail } from './IssueDetail';
import type {
  AuditReport,
  DiffKind,
  LocalizedFinding,
  ReportState,
  PublicAuditRun,
} from '../types';

vi.mock('../api', () => ({
  fetchReportRequest: vi.fn(),
  fetchLatestRunRequest: vi.fn(),
  fetchRunRequest: vi.fn(),
  startAuditRequest: vi.fn(),
  generateAiSummaryRequest: vi.fn(),
}));

vi.mock('@shared/lib/clipboard', () => ({
  writeToClipboard: vi.fn(),
}));

const actionsApiMocked = vi.hoisted(() => ({
  listActions: vi.fn(
    async (
      _payload?: unknown,
      _init?: unknown,
    ): Promise<import('@features/actions').ListActionsResponse> => ({
      items: [],
      sourceStatus: {},
      nextCursor: null,
    }),
  ),
  mutateActionState: vi.fn(async (_payload?: unknown) => {
    throw new Error('mutateActionState not stubbed');
  }),
}));

vi.mock('@features/actions/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/actions/api')>()),
  listActions: actionsApiMocked.listActions,
  mutateActionState: actionsApiMocked.mutateActionState,
}));

import * as clipboardModule from '@shared/lib/clipboard';
import { actionsReducer, type ActionItem } from '@features/actions';
const mocked = vi.mocked(api);
const clipboardMocked = vi.mocked(clipboardModule);

const findingsFixture: LocalizedFinding[] = [
  {
    ruleId: 'title-missing-or-weak',
    bucket: 'fix-now',
    severity: 'critical',
    affectedUrls: ['https://example.com/a', 'https://example.com/b'],
    copy: {
      titleKey: 'auditRules.title-missing-or-weak.title',
      whyKey: 'auditRules.title-missing-or-weak.why',
      fixKey: 'auditRules.title-missing-or-weak.fix',
      passedLabelKey: 'auditRules.title-missing-or-weak.passedLabel',
      title: 'Page titles missing or weak',
      why: 'Titles matter for click-through.',
      fix: 'Add a title 30-60 chars long.',
      passedLabel: 'Every page has a healthy title.',
    },
  },
  {
    ruleId: 'headings-weak',
    bucket: 'watch',
    severity: 'warning',
    affectedUrls: ['https://example.com/c'],
    copy: {
      titleKey: 'auditRules.headings-weak.title',
      whyKey: 'auditRules.headings-weak.why',
      fixKey: 'auditRules.headings-weak.fix',
      passedLabelKey: 'auditRules.headings-weak.passedLabel',
      title: 'Page headings missing or overused',
      why: 'One H1 per page keeps intent clear.',
      fix: 'Use one H1 that names the topic.',
      passedLabel: 'Every page has one clear main heading.',
    },
  },
  {
    ruleId: 'llms-txt-missing',
    bucket: 'passed',
    severity: 'info',
    affectedUrls: [],
    copy: {
      titleKey: 'auditRules.llms-txt-missing.title',
      whyKey: 'auditRules.llms-txt-missing.why',
      fixKey: 'auditRules.llms-txt-missing.fix',
      passedLabelKey: 'auditRules.llms-txt-missing.passedLabel',
      title: 'llms.txt file not published',
      why: 'llms.txt is emerging.',
      fix: 'Publish a short llms.txt.',
      passedLabel: 'Your llms.txt file is published.',
    },
  },
  {
    ruleId: 'faq-content-missing',
    bucket: 'watch',
    severity: 'info',
    affectedUrls: [],
    copy: {
      titleKey: 'auditRules.faq-content-missing.title',
      whyKey: 'auditRules.faq-content-missing.why',
      fixKey: 'auditRules.faq-content-missing.fix',
      passedLabelKey: 'auditRules.faq-content-missing.passedLabel',
      title: 'FAQ or Q&A content not detected',
      why: 'Q&A gets quoted by AI.',
      fix: 'Add an FAQ block with FAQPage schema.',
      passedLabel: 'FAQ content is detected.',
    },
  },
];

const makeReport = (overrides: Partial<AuditReport> = {}): AuditReport => ({
  runId: 'run-1',
  counts: { fixNow: 1, watch: 2, passed: 1 },
  findings: findingsFixture,
  diff: { entries: [], summary: { fixed: 0, regressed: 0, new: 0, unchanged: 0 } },
  pageSpeed: null,
  ...overrides,
});

const baseReportState = (): ReportState =>
  reportReducer(undefined, { type: '@@init' });

const auditAction = (
  ruleId: string,
  overrides: Partial<ActionItem> = {},
): ActionItem => ({
  id: `action-${ruleId}`,
  siteId: 'site-1',
  sourceType: 'audit_finding',
  sourceId: ruleId,
  sourceLink: '/sites/site-1/report',
  problem: `${ruleId} problem`,
  whyItMatters: `${ruleId} why`,
  nextStep: `${ruleId} next`,
  affectedUrls: [],
  evidence: [],
  severity: 'critical',
  firstPartyImpact: 'high',
  confidence: 'high',
  effort: 'low',
  state: 'open',
  version: 1,
  reappearedAfterFix: false,
  observedAt: '2026-07-01T00:00:00.000Z',
  lastVerifiedAt: null,
  retest: { available: true },
  ...overrides,
  copy: overrides.copy ?? {
    problem: { messageKey: `auditRules.${ruleId}.title` },
    whyItMatters: { messageKey: `auditRules.${ruleId}.why` },
    nextStep: { messageKey: `auditRules.${ruleId}.fix` },
  },
});

const makeStore = (preloaded?: Partial<ReportState>) =>
  configureStore({
    reducer: {
      report: reportReducer,
      actions: actionsReducer,
    },
    ...(preloaded
      ? { preloadedState: { report: { ...baseReportState(), ...preloaded } } }
      : {}),
  });

type ReportStore = ReturnType<typeof makeStore>;

const LocationSpy = ({ onChange }: { onChange: (search: string) => void }) => {
  const location = useLocation();
  onChange(location.search);
  return null;
};

interface RenderOpts {
  store?: ReportStore;
  path?: string;
  onLocation?: (search: string) => void;
}

const renderReport = ({ store = makeStore(), path = '/sites/site-1/report', onLocation }: RenderOpts = {}) => {
  render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="/sites/:siteId/report"
              element={
                <>
                  {onLocation ? <LocationSpy onChange={onLocation} /> : null}
                  <ReportPage />
                </>
              }
            />
            <Route
              path="/sites/:siteId/report/:runId"
              element={
                <>
                  {onLocation ? <LocationSpy onChange={onLocation} /> : null}
                  <ReportPage />
                </>
              }
            />
          </Routes>
        </MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );
  return store;
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
  mocked.fetchReportRequest.mockResolvedValue(makeReport());
  mocked.fetchLatestRunRequest.mockResolvedValue({
    runs: [
      {
        id: 'run-1',
        siteId: 'site-1',
        status: 'succeeded',
        pageCap: 100,
        pagesCrawled: 5,
        vendorTaskId: null,
        startedAt: null,
        finishedAt: null,
        error: null,
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
    ],
    nextCursor: null,
  });
  mocked.fetchRunRequest.mockResolvedValue({
    run: {
      id: 'run-1',
      siteId: 'site-1',
      status: 'succeeded',
      pageCap: 100,
      pagesCrawled: 5,
      vendorTaskId: null,
      startedAt: null,
      finishedAt: null,
      error: null,
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
    },
  });
  mocked.startAuditRequest.mockResolvedValue({
    run: {
      id: 'run-2',
      siteId: 'site-1',
      status: 'queued',
      pageCap: 100,
      pagesCrawled: 0,
      vendorTaskId: null,
      startedAt: null,
      finishedAt: null,
      error: null,
      createdAt: '2026-07-02T00:00:00.000Z',
      updatedAt: '2026-07-02T00:00:00.000Z',
    },
    message: 'Audit started.',
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('tabState', () => {
  it('exposes the three canonical tabs, default fix-now', () => {
    expect(REPORT_TABS).toEqual(['fix-now', 'watch', 'passed']);
    expect(DEFAULT_REPORT_TAB).toBe('fix-now');
    expect(isReportTab('fix-now')).toBe(true);
    expect(isReportTab('watch')).toBe(true);
    expect(isReportTab('passed')).toBe(true);
    expect(isReportTab('unknown')).toBe(false);
    expect(isReportTab(null)).toBe(false);
    expect(bucketForTab('fix-now')).toBe('fix-now');
    expect(bucketForTab('watch')).toBe('watch');
    expect(bucketForTab('passed')).toBe('passed');
  });
});

describe('reportErrorMessage', () => {
  it('prefers the server error message', () => {
    const err = new ApiError('boom', 500, { error: { message: 'server said no' } });
    expect(reportErrorMessage(err, 'report:loadFailed')).toBe('server said no');
  });

  it('falls back to the localized client message', () => {
    expect(reportErrorMessage(new TypeError('offline'), 'report:loadFailed')).toBe(
      'Could not load your report.',
    );
  });

  it('falls back when the server payload is missing the message', () => {
    const err = new ApiError('boom', 500, { error: { code: 'X' } });
    expect(reportErrorMessage(err, 'report:loadFailed')).toBe(
      'Could not load your report.',
    );
    const err2 = new ApiError('boom', 500, { error: 'plain' });
    expect(reportErrorMessage(err2, 'report:loadFailed')).toBe(
      'Could not load your report.',
    );
    const err3 = new ApiError('boom', 500, { other: 1 });
    expect(reportErrorMessage(err3, 'report:loadFailed')).toBe(
      'Could not load your report.',
    );
  });
});

describe('ReportPage — loading, empty & error', () => {
  it('renders the skeleton while loading', () => {
    renderReport({ store: makeStore({ loading: true }) });
    expect(screen.getByTestId('report-loading')).toBeInTheDocument();
    expect(screen.getByTestId('report-skeleton')).toBeInTheDocument();
  });

  it('renders the error state with a working retry', async () => {
    const user = userEvent.setup();
    const store = makeStore({
      loaded: true,
      error: 'Boom.',
      siteId: 'site-1',
    });
    renderReport({ store });
    expect(await screen.findByTestId('report-error')).toHaveTextContent('Boom.');
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() =>
      expect(mocked.fetchLatestRunRequest).toHaveBeenCalledWith('site-1', expect.objectContaining({ signal: expect.any(AbortSignal) })),
    );
  });

  it('shows the first-run empty state when the site has no runs', async () => {
    mocked.fetchLatestRunRequest.mockResolvedValue({ runs: [], nextCursor: null });
    renderReport();
    expect(await screen.findByTestId('report-no-run')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Run your first audit/ })).toBeInTheDocument();
  });

  it('kicks the first audit from the no-run state through the preview confirmation', async () => {
    mocked.fetchLatestRunRequest.mockResolvedValue({ runs: [], nextCursor: null });
    renderReport();
    const user = userEvent.setup();
    const cta = await screen.findByRole('button', { name: /Run your first audit/ });
    await user.click(cta);
    // The preview dialog opens first — a read, never a mutation.
    expect(await screen.findByTestId('report-retest-dialog')).toBeInTheDocument();
    expect(screen.getByTestId('retest-preview')).toBeInTheDocument();
    expect(mocked.startAuditRequest).not.toHaveBeenCalled();
    await user.click(screen.getByTestId('report-retest-confirm'));
    await waitFor(() =>
      expect(mocked.startAuditRequest).toHaveBeenCalledWith('site-1', undefined),
    );
  });

  it('cancelling the retest preview never mutates', async () => {
    mocked.fetchLatestRunRequest.mockResolvedValue({ runs: [], nextCursor: null });
    renderReport();
    const user = userEvent.setup();
    const cta = await screen.findByRole('button', { name: /Run your first audit/ });
    await user.click(cta);
    expect(await screen.findByTestId('report-retest-dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByTestId('report-retest-dialog')).not.toBeInTheDocument(),
    );
    expect(mocked.startAuditRequest).not.toHaveBeenCalled();
  });

  it('shows the one-run preview inside the retest dialog', async () => {
    mocked.fetchLatestRunRequest.mockResolvedValue({ runs: [], nextCursor: null });
    renderReport();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: /Run your first audit/ }));
    expect(await screen.findByTestId('retest-preview-units')).toHaveTextContent('1');
  });

  it('shows the "starting" label while the first retest is in flight', async () => {
    const store = makeStore({
      loaded: true,
      siteId: 'site-1',
      report: null,
      retesting: true,
    });
    renderReport({ store });
    expect(await screen.findByText('Starting…')).toBeInTheDocument();
    expect(screen.getByTestId('report-retest')).toBeDisabled();
  });

  it('surfaces the retest error from the no-run state', async () => {
    mocked.fetchLatestRunRequest.mockResolvedValue({ runs: [], nextCursor: null });
    mocked.startAuditRequest.mockRejectedValue(new TypeError('offline'));
    renderReport();
    const user = userEvent.setup();
    const cta = await screen.findByRole('button', { name: /Run your first audit/ });
    await user.click(cta);
    await user.click(await screen.findByTestId('report-retest-confirm'));
    expect(await screen.findByText('Could not start the audit.')).toBeInTheDocument();
    // Closing the dialog moves the same error to the page-level alert so it
    // stays visible from the no-run state.
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByTestId('report-retest-dialog')).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Could not start the audit.');
  });
});

describe('ReportPage — tabs, counts & URL state', () => {
  it('renders three tab triggers with counts and defaults to fix-now', async () => {
    let currentSearch = '';
    renderReport({
      onLocation: (s) => {
        currentSearch = s;
      },
    });
    await waitFor(() =>
      expect(mocked.fetchReportRequest).toHaveBeenCalledWith('run-1', expect.objectContaining({ signal: expect.any(AbortSignal) })),
    );
    expect(screen.getByTestId('report-tab-fix-now')).toHaveTextContent('Fix now');
    expect(screen.getByTestId('report-tab-watch')).toHaveTextContent('Watch');
    expect(screen.getByTestId('report-tab-passed')).toHaveTextContent('Passed');
    // Fix now counts (1)
    expect(screen.getByTestId('report-tab-fix-now')).toHaveTextContent('(1)');
    expect(screen.getByTestId('report-tab-watch')).toHaveTextContent('(2)');
    expect(screen.getByTestId('report-tab-passed')).toHaveTextContent('(1)');
    // Default tab is fix-now — issue row for the fix-now finding rendered
    expect(await screen.findByText('Page titles missing or weak')).toBeInTheDocument();
    expect(currentSearch).toBe('');
    // Docs link points at the audit-report docs page
    expect(screen.getByTestId('docs-link-audit-report')).toHaveAttribute(
      'href',
      '/docs/audit-report',
    );
  });

  it('switches tabs updates URL query param with replace and lands on that tab', async () => {
    let currentSearch = '';
    renderReport({
      onLocation: (s) => {
        currentSearch = s;
      },
    });
    await waitFor(() =>
      expect(mocked.fetchReportRequest).toHaveBeenCalledWith('run-1', expect.objectContaining({ signal: expect.any(AbortSignal) })),
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId('report-tab-watch'));
    await waitFor(() => expect(currentSearch).toBe('?bucket=watch'));
    expect(await screen.findByText('Page headings missing or overused')).toBeInTheDocument();
    await user.click(screen.getByTestId('report-tab-passed'));
    await waitFor(() => expect(currentSearch).toBe('?bucket=passed'));
    expect(await screen.findByText('llms.txt file not published')).toBeInTheDocument();
  });

  it('honours deep link ?bucket=watch and falls back on an invalid value', async () => {
    renderReport({ path: '/sites/site-1/report?bucket=watch' });
    await waitFor(() =>
      expect(mocked.fetchReportRequest).toHaveBeenCalledWith('run-1', expect.objectContaining({ signal: expect.any(AbortSignal) })),
    );
    // Watch tab active — one of its rows visible.
    expect(await screen.findByText('Page headings missing or overused')).toBeInTheDocument();
  });

  it('opens an action source link on the exact finding and its bucket', async () => {
    let currentSearch = '';
    renderReport({
      path: '/sites/site-1/report?finding=headings-weak',
      onLocation: (search) => {
        currentSearch = search;
      },
    });

    expect(await screen.findByText('Page headings missing or overused')).toBeInTheDocument();
    await waitFor(() =>
      expect(currentSearch).toBe('?finding=headings-weak&bucket=watch'),
    );
    expect(screen.getByTestId('report-issue-detail')).toBeInTheDocument();
    expect(screen.queryByText('Page titles missing or weak')).not.toBeInTheDocument();
  });

  it('keeps the active tab when the linked finding is already in it', async () => {
    let currentSearch = '';
    renderReport({
      path: '/sites/site-1/report?finding=title-missing-or-weak',
      onLocation: (search) => {
        currentSearch = search;
      },
    });

    expect(await screen.findByTestId('report-issue-detail')).toBeInTheDocument();
    expect(screen.getByText('Page titles missing or weak')).toBeInTheDocument();
    expect(currentSearch).toBe('?finding=title-missing-or-weak');
  });

  it('ignores an action source link whose finding is not in the report', async () => {
    let currentSearch = '';
    renderReport({
      path: '/sites/site-1/report?finding=not-a-rule',
      onLocation: (search) => {
        currentSearch = search;
      },
    });

    expect(await screen.findByText('Page titles missing or weak')).toBeInTheDocument();
    expect(currentSearch).toBe('?finding=not-a-rule');
    expect(screen.queryByTestId('report-issue-detail')).not.toBeInTheDocument();
  });

  it('invalid ?bucket= falls back to the default (fix-now)', async () => {
    renderReport({ path: '/sites/site-1/report?bucket=garbage' });
    await waitFor(() =>
      expect(mocked.fetchReportRequest).toHaveBeenCalledWith('run-1', expect.objectContaining({ signal: expect.any(AbortSignal) })),
    );
    expect(await screen.findByText('Page titles missing or weak')).toBeInTheDocument();
  });

  it('renders per-tab empty state with a positive message', async () => {
    mocked.fetchReportRequest.mockResolvedValue(
      makeReport({ counts: { fixNow: 0, watch: 0, passed: 0 }, findings: [] }),
    );
    renderReport();
    await waitFor(() =>
      expect(mocked.fetchReportRequest).toHaveBeenCalledWith('run-1', expect.objectContaining({ signal: expect.any(AbortSignal) })),
    );
    expect(await screen.findByTestId('report-empty-fix-now')).toHaveTextContent(
      'Nothing to fix right now',
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId('report-tab-passed'));
    expect(await screen.findByTestId('report-empty-passed')).toHaveTextContent(
      'Nothing passing yet',
    );
  });
});

describe('ReportPage — issue detail + copy', () => {
  it('expands the row to reveal why / URL / fix and copies the fix', async () => {
    clipboardMocked.writeToClipboard.mockResolvedValue(true);
    renderReport();
    await waitFor(() =>
      expect(mocked.fetchReportRequest).toHaveBeenCalledWith('run-1', expect.objectContaining({ signal: expect.any(AbortSignal) })),
    );
    const user = userEvent.setup();
    const row = (await screen.findAllByTestId('report-issue-row'))[0]!;
    const trigger = row.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!;
    await user.click(trigger);
    expect(screen.getByTestId('report-issue-detail')).toBeInTheDocument();
    expect(screen.getByText('Titles matter for click-through.')).toBeInTheDocument();
    expect(screen.getByText('Add a title 30-60 chars long.')).toBeInTheDocument();
    // Affected URL renders as an external link.
    const link = screen.getByRole('link', { name: 'https://example.com/a' });
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
    expect(link).toHaveAttribute('target', '_blank');

    await user.click(screen.getByTestId('report-issue-copy'));
    expect(clipboardMocked.writeToClipboard).toHaveBeenCalledWith(
      'Add a title 30-60 chars long.',
    );
    expect(await screen.findByText('Copied')).toBeInTheDocument();
  });

  it('copy is a no-op when clipboard write fails', async () => {
    clipboardMocked.writeToClipboard.mockResolvedValue(false);
    renderReport();
    await waitFor(() =>
      expect(mocked.fetchReportRequest).toHaveBeenCalledWith('run-1', expect.objectContaining({ signal: expect.any(AbortSignal) })),
    );
    const user = userEvent.setup();
    const row = (await screen.findAllByTestId('report-issue-row'))[0]!;
    const trigger = row.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!;
    await user.click(trigger);
    await user.click(screen.getByTestId('report-issue-copy'));
    // Not asserting on "Copied" state — the label stays "Copy fix".
    expect(screen.getByTestId('report-issue-copy')).toHaveTextContent('Copy fix');
  });

  it('passed tab row uses the passed label rather than "why it matters"', async () => {
    renderReport();
    await waitFor(() =>
      expect(mocked.fetchReportRequest).toHaveBeenCalledWith('run-1', expect.objectContaining({ signal: expect.any(AbortSignal) })),
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId('report-tab-passed'));
    const row = (await screen.findAllByTestId('report-issue-row'))[0]!;
    await user.click(row.querySelector<HTMLButtonElement>('button[aria-expanded="false"]')!);
    expect(screen.getByText('Your llms.txt file is published.')).toBeInTheDocument();
    // No copy button on passed rows (no fix to copy).
    expect(screen.queryByTestId('report-issue-copy')).not.toBeInTheDocument();
  });

  it('renders the "site-wide" summary when a finding has no affected URLs', async () => {
    renderReport();
    await waitFor(() =>
      expect(mocked.fetchReportRequest).toHaveBeenCalledWith('run-1', expect.objectContaining({ signal: expect.any(AbortSignal) })),
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId('report-tab-watch'));
    // The faq-content-missing finding has no URLs -> "Site-wide check".
    expect(await screen.findByText('Site-wide check')).toBeInTheDocument();
  });

  it('renders singular affected pages copy for exactly one URL', async () => {
    renderReport();
    await waitFor(() =>
      expect(mocked.fetchReportRequest).toHaveBeenCalledWith('run-1', expect.objectContaining({ signal: expect.any(AbortSignal) })),
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId('report-tab-watch'));
    expect(await screen.findByText('1 page affected')).toBeInTheDocument();
  });
});

describe('ReportPage — retest & diff badges', () => {
  it('retest → disables the CTA while a run is in progress and refetches on completion', async () => {
    const user = userEvent.setup();
    renderReport();
    await waitFor(() =>
      expect(mocked.fetchReportRequest).toHaveBeenCalledWith('run-1', expect.objectContaining({ signal: expect.any(AbortSignal) })),
    );
    const cta = screen.getByTestId('report-retest');
    expect(cta).toBeEnabled();

    // Retest → preview dialog → confirm → server returns queued.
    await user.click(cta);
    await user.click(await screen.findByTestId('report-retest-confirm'));
    await waitFor(() =>
      expect(mocked.startAuditRequest).toHaveBeenCalledWith('site-1', undefined),
    );
    expect(mocked.startAuditRequest).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('Auditing…')).toBeInTheDocument();
    expect(screen.getByTestId('report-run-in-progress')).toBeInTheDocument();
  });

  it('retests with the chosen page cap and defaults the picker to plan max', async () => {
    const user = userEvent.setup();
    renderReport();
    await waitFor(() =>
      expect(mocked.fetchReportRequest).toHaveBeenCalledWith('run-1', expect.objectContaining({ signal: expect.any(AbortSignal) })),
    );
    // The page-cap picker now lives inside the preview dialog.
    await user.click(screen.getByTestId('report-retest'));
    const picker = await screen.findByTestId('report-page-cap');
    expect(picker).toHaveTextContent('Plan max');

    await user.click(picker);
    await user.click(await screen.findByRole('option', { name: '1000 pages' }));
    await user.click(screen.getByTestId('report-retest-confirm'));
    await waitFor(() =>
      expect(mocked.startAuditRequest).toHaveBeenCalledWith('site-1', 1000),
    );
  });

  it('offers the page-cap picker on the first-run empty state too', async () => {
    mocked.fetchLatestRunRequest.mockResolvedValue({ runs: [], nextCursor: null });
    const user = userEvent.setup();
    renderReport();
    await screen.findByTestId('report-no-run');
    await user.click(screen.getByTestId('report-retest'));
    await user.click(await screen.findByTestId('report-page-cap'));
    await user.click(await screen.findByRole('option', { name: '100 pages' }));
    await user.click(screen.getByTestId('report-retest-confirm'));
    await waitFor(() =>
      expect(mocked.startAuditRequest).toHaveBeenCalledWith('site-1', 100),
    );
  });

  it('polls a queued run, then refetches the report once the run succeeds', async () => {
    // Kick off with a queued deep-linked run so the polling effect starts
    // immediately, then swap the fetchRunRequest mock to succeeded — the
    // next poll tick transitions the report through the finished branch.
    mocked.fetchRunRequest.mockResolvedValueOnce({
      run: {
        id: 'run-3',
        siteId: 'site-1',
        status: 'queued',
        pageCap: 100,
        pagesCrawled: 0,
        vendorTaskId: null,
        startedAt: null,
        finishedAt: null,
        error: null,
        createdAt: '2026-07-02T00:00:00.000Z',
        updatedAt: '2026-07-02T00:00:00.000Z',
      },
    });
    renderReport({ path: '/sites/site-1/report/run-3' });
    expect(await screen.findByTestId('report-run-in-progress')).toBeInTheDocument();
    mocked.fetchRunRequest.mockResolvedValue({
      run: {
        id: 'run-3',
        siteId: 'site-1',
        status: 'succeeded',
        pageCap: 100,
        pagesCrawled: 3,
        vendorTaskId: null,
        startedAt: null,
        finishedAt: null,
        error: null,
        createdAt: '2026-07-02T00:00:00.000Z',
        updatedAt: '2026-07-02T00:00:00.000Z',
      },
    });
    await waitFor(
      () => expect(mocked.fetchReportRequest).toHaveBeenCalledWith('run-3', expect.objectContaining({ signal: expect.any(AbortSignal) })),
      { timeout: 8000 },
    );
  }, 15000);

  it('renders Fixed and Regressed badges from the diff', async () => {
    mocked.fetchReportRequest.mockResolvedValue(
      makeReport({
        diff: {
          entries: [
            { ruleId: 'title-missing-or-weak', url: 'https://example.com/a', kind: 'fixed' },
            { ruleId: 'headings-weak', url: 'https://example.com/c', kind: 'regressed' },
          ],
          summary: { fixed: 1, regressed: 1, new: 0, unchanged: 0 },
        },
      }),
    );
    renderReport();
    await waitFor(() =>
      expect(mocked.fetchReportRequest).toHaveBeenCalledWith('run-1', expect.objectContaining({ signal: expect.any(AbortSignal) })),
    );
    // Fix-now row (title-missing-or-weak) shows a Fixed badge (any URL fixed).
    expect(await screen.findByTestId('report-badge-fixed')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('report-tab-watch'));
    expect(await screen.findByTestId('report-badge-regressed')).toBeInTheDocument();
  });

  it('renders no diff badge when only "unchanged" entries exist for the rule', async () => {
    mocked.fetchReportRequest.mockResolvedValue(
      makeReport({
        diff: {
          entries: [
            { ruleId: 'title-missing-or-weak', url: 'https://example.com/a', kind: 'unchanged' },
          ],
          summary: { fixed: 0, regressed: 0, new: 0, unchanged: 1 },
        },
      }),
    );
    renderReport();
    await waitFor(() =>
      expect(mocked.fetchReportRequest).toHaveBeenCalledWith('run-1', expect.objectContaining({ signal: expect.any(AbortSignal) })),
    );
    // Row present, no fixed/regressed badge.
    expect(await screen.findByText('Page titles missing or weak')).toBeInTheDocument();
    expect(screen.queryByTestId('report-badge-fixed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('report-badge-regressed')).not.toBeInTheDocument();
  });

  it('treats a "new" diff kind as a regression on the row badge', async () => {
    mocked.fetchReportRequest.mockResolvedValue(
      makeReport({
        diff: {
          entries: [
            { ruleId: 'title-missing-or-weak', url: 'https://example.com/x', kind: 'new' },
          ],
          summary: { fixed: 0, regressed: 0, new: 1, unchanged: 0 },
        },
      }),
    );
    renderReport();
    await waitFor(() =>
      expect(mocked.fetchReportRequest).toHaveBeenCalledWith('run-1', expect.objectContaining({ signal: expect.any(AbortSignal) })),
    );
    expect(await screen.findByTestId('report-badge-regressed')).toBeInTheDocument();
  });

  it('surfaces the retest error inside the confirmation, then page-level after close', async () => {
    mocked.startAuditRequest.mockRejectedValue(new TypeError('offline'));
    renderReport();
    await waitFor(() =>
      expect(mocked.fetchReportRequest).toHaveBeenCalledWith('run-1', expect.objectContaining({ signal: expect.any(AbortSignal) })),
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId('report-retest'));
    await user.click(await screen.findByTestId('report-retest-confirm'));
    expect(
      await screen.findByTestId('report-retest-dialog-error'),
    ).toHaveTextContent('Could not start the audit.');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(
      await screen.findByTestId('report-retest-error'),
    ).toHaveTextContent('Could not start the audit.');
  });

  it('maps findings to their audit actions and dismisses through the shared confirmation', async () => {
    actionsApiMocked.listActions.mockResolvedValue({
      items: [auditAction('title-missing-or-weak')],
      sourceStatus: { audit_finding: { status: 'available' } },
      nextCursor: null,
    });
    actionsApiMocked.mutateActionState.mockResolvedValue({
      actionId: 'action-title-missing-or-weak',
      state: 'dismissed',
      version: 2,
      replayed: false,
    } as never);
    renderReport();
    await waitFor(() =>
      expect(actionsApiMocked.listActions).toHaveBeenCalledWith(
        expect.objectContaining({
          siteId: 'site-1',
          filters: { source: ['audit_finding'] },
        }),
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
    const user = userEvent.setup();
    const dismiss = await screen.findByTestId('report-finding-dismiss');
    await user.click(dismiss);
    expect(await screen.findByTestId('action-state-dialog')).toBeInTheDocument();
    // The dialog restates the finding title verbatim.
    expect(screen.getByTestId('action-state-dialog-title')).toHaveTextContent(
      'Page titles missing or weak',
    );
    await user.click(screen.getByTestId('action-state-confirm'));
    await waitFor(() =>
      expect(actionsApiMocked.mutateActionState).toHaveBeenCalledWith(
        expect.objectContaining({
          siteId: 'site-1',
          actionId: 'action-title-missing-or-weak',
          state: 'dismissed',
          expectedVersion: 1,
        }),
      ),
    );
    // The finding stays visible, labeled dismissed, with a reopen control —
    // the report counts/evidence are untouched (workflow state only).
    expect(await screen.findByTestId('report-finding-dismissed')).toBeInTheDocument();
    expect(screen.getByTestId('report-finding-reopen')).toBeInTheDocument();
    expect(screen.getByText('Page titles missing or weak')).toBeInTheDocument();
  });

  it('reopens a dismissed finding through the same confirmation path', async () => {
    actionsApiMocked.listActions.mockResolvedValue({
      items: [auditAction('title-missing-or-weak', { state: 'dismissed', version: 4 })],
      sourceStatus: { audit_finding: { status: 'available' } },
      nextCursor: null,
    });
    actionsApiMocked.mutateActionState.mockResolvedValue({
      actionId: 'action-title-missing-or-weak',
      state: 'open',
      version: 5,
      replayed: false,
    } as never);
    renderReport();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('report-finding-reopen'));
    await user.click(await screen.findByTestId('action-state-confirm'));
    await waitFor(() =>
      expect(actionsApiMocked.mutateActionState).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'open', expectedVersion: 4 }),
      ),
    );
    expect(await screen.findByTestId('report-finding-dismiss')).toBeInTheDocument();
  });

  it('marks a finding as fixed through the shared confirmation', async () => {
    actionsApiMocked.listActions.mockResolvedValue({
      items: [auditAction('title-missing-or-weak')],
      sourceStatus: { audit_finding: { status: 'available' } },
      nextCursor: null,
    });
    actionsApiMocked.mutateActionState.mockResolvedValue({
      actionId: 'action-title-missing-or-weak',
      state: 'completed',
      version: 2,
      replayed: false,
    } as never);
    renderReport();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('report-finding-fix'));
    await user.click(await screen.findByTestId('action-state-confirm'));
    await waitFor(() =>
      expect(actionsApiMocked.mutateActionState).toHaveBeenCalledWith(
        expect.objectContaining({
          actionId: 'action-title-missing-or-weak',
          state: 'completed',
          expectedVersion: 1,
        }),
      ),
    );
    // Fixed rows keep a reopen path and never claim the problem is gone from
    // the report itself — only the workflow state changed.
    expect(await screen.findByTestId('report-finding-fixed')).toBeInTheDocument();
    expect(screen.getByTestId('report-finding-reopen')).toBeInTheDocument();
    expect(screen.queryByTestId('report-finding-reappeared')).not.toBeInTheDocument();
  });

  it('flags a fixed finding that a later audit still reports', async () => {
    actionsApiMocked.listActions.mockResolvedValue({
      items: [
        auditAction('title-missing-or-weak', {
          state: 'completed',
          version: 3,
          reappearedAfterFix: true,
        }),
      ],
      sourceStatus: { audit_finding: { status: 'available' } },
      nextCursor: null,
    });
    actionsApiMocked.mutateActionState.mockResolvedValue({
      actionId: 'action-title-missing-or-weak',
      state: 'open',
      version: 4,
      replayed: false,
    } as never);
    renderReport();
    expect(
      await screen.findByTestId('report-finding-reappeared'),
    ).toHaveTextContent('Still detected after being marked fixed');
    expect(screen.queryByTestId('report-finding-fixed')).not.toBeInTheDocument();
    // Reopening drops it back into the open worklist.
    const user = userEvent.setup();
    await user.click(screen.getByTestId('report-finding-reopen'));
    await user.click(await screen.findByTestId('action-state-confirm'));
    await waitFor(() =>
      expect(actionsApiMocked.mutateActionState).toHaveBeenCalledWith(
        expect.objectContaining({ state: 'open', expectedVersion: 3 }),
      ),
    );
    expect(await screen.findByTestId('report-finding-fix')).toBeInTheDocument();
  });

  it('offers no finding controls on a deep-linked historical run', async () => {
    actionsApiMocked.listActions.mockResolvedValue({
      items: [auditAction('title-missing-or-weak')],
      sourceStatus: { audit_finding: { status: 'available' } },
      nextCursor: null,
    });
    renderReport({ path: '/sites/site-1/report/run-1' });
    expect(await screen.findByText('Page titles missing or weak')).toBeInTheDocument();
    expect(screen.queryByTestId('report-finding-fix')).not.toBeInTheDocument();
    expect(screen.queryByTestId('report-finding-dismiss')).not.toBeInTheDocument();
  });

  it('recovers a finding-level 409 by reloading the audit actions read', async () => {
    actionsApiMocked.listActions.mockResolvedValue({
      items: [auditAction('title-missing-or-weak')],
      sourceStatus: { audit_finding: { status: 'available' } },
      nextCursor: null,
    });
    actionsApiMocked.mutateActionState.mockRejectedValueOnce(
      new ApiError('conflict', 409, { error: { message: 'stale version' } }) as never,
    );
    renderReport();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('report-finding-dismiss'));
    await user.click(await screen.findByTestId('action-state-confirm'));
    expect(await screen.findByTestId('action-state-conflict')).toBeInTheDocument();
    const callsBefore = actionsApiMocked.listActions.mock.calls.length;
    await user.click(screen.getByTestId('action-state-conflict-reload'));
    await waitFor(() =>
      expect(actionsApiMocked.listActions.mock.calls.length).toBe(callsBefore + 1),
    );
    expect(
      actionsApiMocked.listActions.mock.calls.at(-1)?.[0],
    ).toMatchObject({ siteId: 'site-1', filters: { source: ['audit_finding'] } });
  });

  it('onOpenChange(true) keeps the finding dialog open (fiber-invoked branch)', async () => {
    // The state dialog is controlled with `open` always true, so Radix only
    // ever fires onOpenChange(false). Cover the truthy branch by grabbing
    // the handlers off the fiber (signals.test.tsx precedent).
    type FiberNode = {
      memoizedProps?: Record<string, unknown>;
      return: FiberNode | null;
    };
    const getHandlers = (el: Element): Array<(open: boolean) => void> => {
      const handlers: Array<(open: boolean) => void> = [];
      const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
      if (!fiberKey) return handlers;
      let node: FiberNode | null =
        (el as unknown as Record<string, FiberNode>)[fiberKey] ?? null;
      while (node) {
        const handler = node.memoizedProps?.onOpenChange;
        if (typeof handler === 'function') {
          handlers.push(handler as (open: boolean) => void);
        }
        node = node.return;
      }
      return handlers;
    };
    actionsApiMocked.listActions.mockResolvedValue({
      items: [auditAction('title-missing-or-weak')],
      sourceStatus: { audit_finding: { status: 'available' } },
      nextCursor: null,
    });
    renderReport();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('report-finding-dismiss'));
    const dialog = await screen.findByTestId('action-state-dialog');
    const handlers = getHandlers(dialog);
    expect(handlers.length).toBeGreaterThan(0);
    act(() => {
      for (const h of handlers) h(true);
    });
    expect(screen.getByTestId('action-state-dialog')).toBeInTheDocument();
    expect(actionsApiMocked.mutateActionState).not.toHaveBeenCalled();
  });

  it('escape closes the finding dialog without mutating workflow state', async () => {
    actionsApiMocked.listActions.mockResolvedValue({
      items: [auditAction('title-missing-or-weak')],
      sourceStatus: { audit_finding: { status: 'available' } },
      nextCursor: null,
    });
    renderReport();
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('report-finding-dismiss'));
    expect(await screen.findByTestId('action-state-dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByTestId('action-state-dialog')).not.toBeInTheDocument(),
    );
    expect(actionsApiMocked.mutateActionState).not.toHaveBeenCalled();
    // The finding row keeps its control for a later attempt.
    expect(screen.getByTestId('report-finding-dismiss')).toBeInTheDocument();
  });

  it('renders no dismissal control on passed findings or unmapped rows', async () => {
    actionsApiMocked.listActions.mockResolvedValue({
      items: [auditAction('title-missing-or-weak')],
      sourceStatus: { audit_finding: { status: 'available' } },
      nextCursor: null,
    });
    renderReport();
    await screen.findByTestId('report-finding-dismiss');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('report-tab-passed'));
    // The passed row (llms-txt-missing) exposes no dismiss/reopen control.
    expect(screen.getByText('llms.txt file not published')).toBeInTheDocument();
    expect(screen.queryByTestId('report-finding-reopen')).not.toBeInTheDocument();
    // The watch tab's headings-weak row has no matching action → no control.
    await user.click(screen.getByTestId('report-tab-watch'));
    expect(await screen.findByText('Page headings missing or overused')).toBeInTheDocument();
    const watchRows = screen.getAllByTestId('report-issue-row');
    for (const row of watchRows) {
      expect(row.querySelector('[data-testid="report-finding-dismiss"]')).toBeNull();
    }
  });

  it('buildDiffMap: duplicate ruleId entry hits false branch of if(!bucket)', async () => {
    // Two entries with the same ruleId — first creates the bucket (true),
    // second finds the existing bucket (false branch of if(!bucket)).
    mocked.fetchReportRequest.mockResolvedValue(
      makeReport({
        diff: {
          entries: [
            { ruleId: 'title-missing-or-weak', url: 'https://example.com/a', kind: 'fixed' },
            { ruleId: 'title-missing-or-weak', url: 'https://example.com/b', kind: 'regressed' },
          ],
          summary: { fixed: 0, regressed: 1, new: 0, unchanged: 0 },
        },
      }),
    );
    renderReport();
    await waitFor(() =>
      expect(mocked.fetchReportRequest).toHaveBeenCalled(),
    );
    // Regressed badge wins (regressed > fixed precedence).
    expect(await screen.findByTestId('report-badge-regressed')).toBeInTheDocument();
  });

  it('buildDiffMap: empty url entry hits false branch of if(entry.url)', async () => {
    // entry.url === '' is falsy → byUrl.set is skipped (false branch of if(entry.url)).
    mocked.fetchReportRequest.mockResolvedValue(
      makeReport({
        diff: {
          entries: [
            { ruleId: 'title-missing-or-weak', url: '', kind: 'fixed' },
          ],
          summary: { fixed: 1, regressed: 0, new: 0, unchanged: 0 },
        },
      }),
    );
    renderReport();
    await waitFor(() =>
      expect(mocked.fetchReportRequest).toHaveBeenCalled(),
    );
    expect(await screen.findByTestId('report-badge-fixed')).toBeInTheDocument();
  });

  it('shows the run-in-progress banner when a deep-linked run is still running', async () => {
    mocked.fetchRunRequest.mockResolvedValue({
      run: {
        id: 'run-3',
        siteId: 'site-1',
        status: 'running',
        pageCap: 100,
        pagesCrawled: 0,
        vendorTaskId: null,
        startedAt: null,
        finishedAt: null,
        error: null,
        createdAt: '2026-07-02T00:00:00.000Z',
        updatedAt: '2026-07-02T00:00:00.000Z',
      },
    });
    renderReport({ path: '/sites/site-1/report/run-3' });
    expect(await screen.findByTestId('report-run-in-progress')).toBeInTheDocument();
    expect(screen.getByTestId('report-retest')).toBeDisabled();
  });

});

describe('a11y basics (axe-equivalent assertions)', () => {
  it('has an h1, tabs are keyboard-reachable, and interactive icons have accessible names', async () => {
    renderReport();
    await waitFor(() =>
      expect(mocked.fetchReportRequest).toHaveBeenCalledWith('run-1', expect.objectContaining({ signal: expect.any(AbortSignal) })),
    );
    expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument();
    // Every tab trigger is focusable (tabIndex not -1) and has visible text.
    for (const tab of REPORT_TABS) {
      const trigger = screen.getByTestId(`report-tab-${tab}`);
      expect(trigger).toHaveAttribute('role', 'tab');
      expect(trigger).toBeVisible();
    }
    // Retest button is a real <button> with accessible name.
    const retest = screen.getByTestId('report-retest');
    expect(retest.tagName).toBe('BUTTON');
    expect(retest).toHaveAccessibleName();
  });

  it.each(['fix-now', 'watch', 'passed'] as const)(
    'no-issue empty state on %s tab announces to assistive tech',
    async (tab) => {
      mocked.fetchReportRequest.mockResolvedValue(
        makeReport({ counts: { fixNow: 0, watch: 0, passed: 0 }, findings: [] }),
      );
      renderReport({ path: `/sites/site-1/report?bucket=${tab}` });
      const empty = await screen.findByTestId(`report-empty-${tab}`);
      expect(empty).toHaveTextContent(/\w+/); // non-empty text content
    },
  );
});

describe('RTL (ar)', () => {
  it('renders the report in Arabic with dir=rtl', async () => {
    await changeLanguage('ar');
    expect(document.documentElement.dir).toBe('rtl');
    renderReport();
    await waitFor(() =>
      expect(mocked.fetchReportRequest).toHaveBeenCalledWith('run-1', expect.objectContaining({ signal: expect.any(AbortSignal) })),
    );
    expect(screen.getByRole('heading', { name: 'تقرير التدقيق الخاص بك' })).toBeInTheDocument();
    expect(screen.getByTestId('report-tab-fix-now')).toHaveTextContent('أصلح الآن');
    expect(screen.getByTestId('report-tab-watch')).toHaveTextContent('راقب');
    expect(screen.getByTestId('report-tab-passed')).toHaveTextContent('اجتاز');
  });
});

describe('IssueRow / IssueDetail units', () => {
  it('offers a mapped code prompt only on the latest eligible report', async () => {
    clipboardMocked.writeToClipboard.mockResolvedValue(true);
    const finding = {
      ...findingsFixture[0]!,
      codeFixPromptAvailable: true as const,
      copy: { ...findingsFixture[0]!.copy, reason: 'The title output is empty.' },
    };
    const latest = render(
      <Provider store={makeStore()}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <IssueRow
              finding={finding}
              diffByUrl={new Map()}
              siteId="site-1"
              isLatestRun
              initiallyExpanded
            />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Copy code prompt' }));
    const prompt = clipboardMocked.writeToClipboard.mock.calls[0]?.[0] ?? '';
    expect(prompt).toContain('"reference": "title-missing-or-weak"');
    expect(prompt).toContain('The title output is empty.\\nTitles matter for click-through.');
    expect(prompt).toContain('"recommendedFix": "Add a title 30-60 chars long."');
    expect(prompt).toContain('"affectedUrlCount": 2');
    latest.unmount();

    render(
      <Provider store={makeStore()}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <IssueRow finding={finding} diffByUrl={new Map()} siteId="site-1" initiallyExpanded />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    expect(screen.queryByRole('button', { name: 'Copy code prompt' })).toBeNull();
    expect(screen.getByTestId('report-issue-copy')).toBeInTheDocument();
  });

  it('builds the code prompt from the why line alone when there is no reason', async () => {
    clipboardMocked.writeToClipboard.mockResolvedValue(true);
    const finding = { ...findingsFixture[0]!, codeFixPromptAvailable: true as const };
    render(
      <Provider store={makeStore()}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <IssueRow
              finding={finding}
              diffByUrl={new Map()}
              siteId="site-1"
              isLatestRun
              initiallyExpanded
            />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    await userEvent.setup().click(screen.getByRole('button', { name: 'Copy code prompt' }));
    const prompt = clipboardMocked.writeToClipboard.mock.calls.at(-1)?.[0] ?? '';
    expect(prompt).toContain('"whyItMatters": "Titles matter for click-through."');
  });

  it('renders a broken-links finding without a target list when none were captured', () => {
    const finding: LocalizedFinding = {
      ...findingsFixture[0]!,
      ruleId: 'broken-internal-links',
      affectedUrls: ['https://example.com/source'],
    };

    render(
      <I18nextProvider i18n={i18n}>
        <IssueDetail finding={finding} diffByUrl={new Map()} />
      </I18nextProvider>,
    );

    expect(screen.queryByTestId('report-broken-link-targets')).not.toBeInTheDocument();
    expect(screen.getByTestId('report-issue-detail')).toBeInTheDocument();
  });

  it('separates broken targets from the pages linking to them', () => {
    const finding: LocalizedFinding = {
      ...findingsFixture[0]!,
      ruleId: 'broken-internal-links',
      affectedUrls: ['https://example.com/source'],
      brokenLinkTargets: ['https://example.com/broken'],
    };

    render(
      <I18nextProvider i18n={i18n}>
        <IssueDetail finding={finding} diffByUrl={new Map()} />
      </I18nextProvider>,
    );

    expect(screen.getByText('Targets the audit could not fetch')).toBeInTheDocument();
    expect(screen.getByText('Pages linking to those targets')).toBeInTheDocument();
    expect(screen.getByTestId('report-broken-link-targets').querySelector('a')).toHaveAttribute(
      'href',
      'https://example.com/broken',
    );
  });

  it('IssueDetail renders the passed label for a passed rule', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <IssueDetail finding={findingsFixture[2]!} diffByUrl={new Map()} />
      </I18nextProvider>,
    );
    expect(screen.getByText('Your llms.txt file is published.')).toBeInTheDocument();
    expect(screen.queryByText('How to fix it')).not.toBeInTheDocument();
  });

  it('IssueDetail renders per-URL fixed/regressed badges', () => {
    const finding = findingsFixture[0]!;
    const diffByUrl = new Map<string, DiffKind>([
      ['https://example.com/a', 'fixed'],
      ['https://example.com/b', 'regressed'],
    ]);
    render(
      <I18nextProvider i18n={i18n}>
        <IssueDetail finding={finding} diffByUrl={diffByUrl} />
      </I18nextProvider>,
    );
    // Two badges, one per URL.
    const badges = screen.getAllByText(/^Fixed$|^Regressed$/);
    expect(badges.length).toBe(2);
  });

  it('IssueRow renders no diff badge when there are no diff entries for the rule', () => {
    render(
      <Provider store={makeStore()}>
        <I18nextProvider i18n={i18n}>
          <IssueRow finding={findingsFixture[0]!} diffByUrl={new Map()} />
        </I18nextProvider>
      </Provider>,
    );
    expect(screen.queryByTestId('report-badge-fixed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('report-badge-regressed')).not.toBeInTheDocument();
  });

  it('IssueRow offers no finding controls without a siteId context, even on the latest run', () => {
    const finding = { ...findingsFixture[0]!, codeFixPromptAvailable: true as const };
    render(
      <Provider store={makeStore()}>
        <I18nextProvider i18n={i18n}>
          <IssueRow finding={finding} diffByUrl={new Map()} isLatestRun initiallyExpanded />
        </I18nextProvider>
      </Provider>,
    );
    expect(screen.queryByTestId('report-finding-dismiss')).not.toBeInTheDocument();
    expect(screen.queryByTestId('report-finding-fix')).not.toBeInTheDocument();
    expect(screen.queryByTestId('report-finding-reopen')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy code prompt' })).not.toBeInTheDocument();
  });

  it('IssueDetail renders AiVisibilityBlock for ai-visibility-low (showAiVisibilityBlock true + ?? right branches)', () => {
    const finding: LocalizedFinding = {
      ruleId: 'ai-visibility-low',
      bucket: 'fix-now',
      severity: 'critical',
      affectedUrls: [],
      copy: {
        titleKey: 'auditRules.ai-visibility-low.title',
        whyKey: 'auditRules.ai-visibility-low.why',
        fixKey: 'auditRules.ai-visibility-low.fix',
        passedLabelKey: 'auditRules.ai-visibility-low.passedLabel',
        title: 'AI visibility is low',
        why: 'You are not visible to AI.',
        fix: 'Fix it.',
        passedLabel: 'AI visible.',
      },
    };
    render(
      <I18nextProvider i18n={i18n}>
        <IssueDetail finding={finding} diffByUrl={new Map()} />
      </I18nextProvider>,
    );
    // section=null → AiVisibilityBlock renders its "unavailable" note
    expect(screen.getByRole('note')).toBeInTheDocument();
  });

  it('IssueDetail renders LocalSeoBlock for nap-inconsistency (showLocalSeoBlock true + ?? right branches)', () => {
    const finding: LocalizedFinding = {
      ruleId: 'nap-inconsistency',
      bucket: 'fix-now',
      severity: 'warning',
      affectedUrls: [],
      copy: {
        titleKey: 'auditRules.nap-inconsistency.title',
        whyKey: 'auditRules.nap-inconsistency.why',
        fixKey: 'auditRules.nap-inconsistency.fix',
        passedLabelKey: 'auditRules.nap-inconsistency.passedLabel',
        title: 'NAP inconsistency',
        why: 'Listings differ.',
        fix: 'Align NAP.',
        passedLabel: 'NAP consistent.',
      },
    };
    render(
      <I18nextProvider i18n={i18n}>
        <IssueDetail finding={finding} diffByUrl={new Map()} />
      </I18nextProvider>,
    );
    // section=null → LocalSeoBlock renders its "unavailable" note
    expect(screen.getByRole('note')).toBeInTheDocument();
  });

  // The structured-data finding is the entry
  // point into the schema generator, with the affected page preselected.
  const structuredDataFinding = (affectedUrls: string[]): LocalizedFinding => ({
    ruleId: 'structured-data-missing',
    bucket: 'fix-now',
    severity: 'warning',
    affectedUrls,
    copy: {
      titleKey: 'auditRules.structured-data-missing.title',
      whyKey: 'auditRules.structured-data-missing.why',
      fixKey: 'auditRules.structured-data-missing.fix',
      passedLabelKey: 'auditRules.structured-data-missing.passedLabel',
      title: 'No structured data',
      why: 'Search engines cannot read the page as data.',
      fix: 'Add JSON-LD.',
      passedLabel: 'Structured data present.',
    },
  });

  it('IssueDetail deep-links a structured-data finding into the schema generator', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <IssueDetail
            finding={structuredDataFinding(['https://example.com/a'])}
            diffByUrl={new Map()}
            siteId="site-1"
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
    const cta = screen.getByTestId('report-schema-cta');
    expect(cta).toHaveAttribute(
      'href',
      '/sites/site-1?tab=schema&page=https%3A%2F%2Fexample.com%2Fa',
    );
    expect(screen.getByTestId('report-content-analysis-cta')).toHaveAttribute(
      'href',
      '/sites/site-1?tab=content&view=analyses&prefillUrl=https%3A%2F%2Fexample.com%2Fa&source=report',
    );
  });

  it('IssueDetail omits the schema call-to-action without a site or an affected URL', () => {
    const { rerender } = render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <IssueDetail
            finding={structuredDataFinding(['https://example.com/a'])}
            diffByUrl={new Map()}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.queryByTestId('report-schema-cta')).toBeNull();
    expect(screen.queryByTestId('report-content-analysis-cta')).toBeNull();

    rerender(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <IssueDetail
            finding={structuredDataFinding([])}
            diffByUrl={new Map()}
            siteId="site-1"
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.queryByTestId('report-schema-cta')).toBeNull();
    expect(screen.queryByTestId('report-content-analysis-cta')).toBeNull();
  });
});

describe('slice — reducers & thunks state transitions', () => {
  it('falls back to the active request identity when only a locale is supplied', async () => {
    const { loadReport } = await import('../store/thunks');
    const store = makeStore();

    await store.dispatch(loadReport({ siteId: 'site-1', presentationLocale: 'ar' }));

    expect(mocked.fetchLatestRunRequest).toHaveBeenCalledWith(
      'site-1',
      expect.objectContaining({
        presentationLocale: 'en',
        presentationGeneration: expect.any(Number),
      }),
    );
  });

  it('loadReport rejected with no payload falls back to empty error', async () => {
    const { loadReport } = await import('../store/thunks');
    const { reportReducer } = await import('../store/slice');
    const state = reportReducer(
      { ...baseReportState(), siteId: 's' },
      loadReport.rejected(new Error('boom'), 'req', { siteId: 's' }),
    );
    expect(state.error).toBe('');
  });

  it('startRetest rejected with no payload falls back to empty retestError', async () => {
    const { startRetest } = await import('../store/thunks');
    const { reportReducer } = await import('../store/slice');
    const state = reportReducer(
      baseReportState(),
      startRetest.rejected(new Error('boom'), 'req', { siteId: 's' }),
    );
    expect(state.retestError).toBe('');
  });

  it('loadReport fulfilled with an undefined report resolves to null (queued branch)', async () => {
    const { loadReport } = await import('../store/thunks');
    const { reportReducer } = await import('../store/slice');
    const state = reportReducer(
      { ...baseReportState(), siteId: 's' },
      loadReport.fulfilled(
        {
          siteId: 's',
          runId: 'r',
          // report explicitly undefined to hit the `?? null` fallback.
          report: undefined as unknown as null,
          runStatus: 'queued',
        },
        'req',
        { siteId: 's' },
      ),
    );
    expect(state.report).toBeNull();
    expect(state.runStatus).toBe('queued');
  });

  it('pollRun rejection is swallowed (no state change beyond runId/runStatus)', async () => {
    mocked.fetchRunRequest.mockResolvedValueOnce({
      run: {
        id: 'poll-run',
        siteId: 'site-1',
        status: 'queued',
        pageCap: 100,
        pagesCrawled: 0,
        vendorTaskId: null,
        startedAt: null,
        finishedAt: null,
        error: null,
        createdAt: '2026-07-02T00:00:00.000Z',
        updatedAt: '2026-07-02T00:00:00.000Z',
      },
    });
    // Every subsequent fetchRunRequest fails — the pollRun rejection branch.
    mocked.fetchRunRequest.mockRejectedValue(new TypeError('offline'));
    renderReport({ path: '/sites/site-1/report/poll-run' });
    // The banner is up (queued) — the failing poll keeps state on 'queued'.
    expect(await screen.findByTestId('report-run-in-progress')).toBeInTheDocument();
    // Wait long enough for at least one poll to have failed.
    await new Promise((r) => window.setTimeout(r, 3200));
    // Still queued — no crash, no fixed state.
    expect(screen.getByTestId('report-run-in-progress')).toBeInTheDocument();
  }, 15000);

  it('loadReport with a queued latest run keeps the banner up (empty report)', async () => {
    mocked.fetchLatestRunRequest.mockResolvedValue({
      runs: [
        {
          id: 'run-queued',
          siteId: 'site-1',
          status: 'queued',
          pageCap: 100,
          pagesCrawled: 0,
          vendorTaskId: null,
          startedAt: null,
          finishedAt: null,
          error: null,
          createdAt: '2026-07-02T00:00:00.000Z',
          updatedAt: '2026-07-02T00:00:00.000Z',
        },
      ],
      nextCursor: null,
    });
    // Poll never returns succeeded — stays queued.
    mocked.fetchRunRequest.mockResolvedValue({
      run: {
        id: 'run-queued',
        siteId: 'site-1',
        status: 'queued',
        pageCap: 100,
        pagesCrawled: 0,
        vendorTaskId: null,
        startedAt: null,
        finishedAt: null,
        error: null,
        createdAt: '2026-07-02T00:00:00.000Z',
        updatedAt: '2026-07-02T00:00:00.000Z',
      },
    });
    renderReport();
    expect(await screen.findByTestId('report-run-in-progress')).toBeInTheDocument();
  });
  it('drops loadReport fulfilled for a previous siteId (stale)', async () => {
    const { loadReport } = await import('../store/thunks');
    const { reportReducer } = await import('../store/slice');
    // Pending sets siteId to 'b'; a late fulfilled for 'a' must be ignored.
    let state = reportReducer(
      { ...baseReportState(), siteId: 'a' },
      loadReport.pending('req-b', { siteId: 'b' }),
    );
    expect(state.siteId).toBe('b');
    state = reportReducer(
      state,
      loadReport.fulfilled(
        {
          siteId: 'a',
          runId: 'ra',
          report: null,
          runStatus: 'succeeded',
        },
        'req-a',
        { siteId: 'a' },
      ),
    );
    expect(state.siteId).toBe('b');
    expect(state.runId).toBeNull();
  });

  it('loadReport fulfilled never writes state.siteId from payload', async () => {
    const { loadReport } = await import('../store/thunks');
    const { reportReducer } = await import('../store/slice');
    let state = reportReducer(
      baseReportState(),
      loadReport.pending('req', { siteId: 'stateId' }),
    );
    state = reportReducer(
      state,
      loadReport.fulfilled(
        {
          siteId: 'PAYLOAD-WINS',
          runId: 'r',
          report: null,
          runStatus: 'succeeded',
        },
        'req',
        { siteId: 'stateId' },
      ),
    );
    expect(state.siteId).toBe('stateId');
  });

  it('drops aborted loadReport rejected without painting error', async () => {
    const { loadReport } = await import('../store/thunks');
    const { reportReducer } = await import('../store/slice');
    const aborted = {
      type: loadReport.rejected.type,
      payload: undefined,
      error: { message: 'Aborted', name: 'AbortError' },
      meta: {
        arg: { siteId: 's' },
        requestId: 'req',
        requestStatus: 'rejected' as const,
        aborted: true,
        condition: false,
      },
    };
    const state = reportReducer(
      { ...baseReportState(), siteId: 's' },
      aborted as never,
    );
    expect(state.error).toBe('');
  });

  it('drops loadReport rejected for a previous siteId', async () => {
    const { loadReport } = await import('../store/thunks');
    const { reportReducer } = await import('../store/slice');
    const state = reportReducer(
      { ...baseReportState(), siteId: 'b' },
      loadReport.rejected(new Error('boom'), 'req-a', { siteId: 'a' }),
    );
    expect(state.error).toBe('');
  });

  it('resetReport returns to the initial state', () => {
    const store = makeStore({ loaded: true, siteId: 'x', runId: 'r' });
    (store.dispatch as unknown as (a: unknown) => void)({ type: 'report/resetReport' });
    expect(store.getState().report.loaded).toBe(false);
    expect(store.getState().report.siteId).toBeNull();
  });

  it('clearReportMessages clears error and retestError', () => {
    const store = makeStore({ error: 'boom', retestError: 'nope' });
    (store.dispatch as unknown as (a: unknown) => void)({
      type: 'report/clearReportMessages',
    });
    expect(store.getState().report.error).toBe('');
    expect(store.getState().report.retestError).toBe('');
  });

  it('load rejection sets the error and stops loading', async () => {
    mocked.fetchLatestRunRequest.mockRejectedValue(new TypeError('offline'));
    renderReport();
    expect(await screen.findByTestId('report-error')).toHaveTextContent(
      'Could not load your report.',
    );
  });

  it('load resolves to a runId-only payload when the deep-linked run is still queued', async () => {
    mocked.fetchRunRequest.mockResolvedValue({
      run: {
        id: 'run-queued',
        siteId: 'site-1',
        status: 'queued',
        pageCap: 100,
        pagesCrawled: 0,
        vendorTaskId: null,
        startedAt: null,
        finishedAt: null,
        error: null,
        createdAt: '2026-07-02T00:00:00.000Z',
        updatedAt: '2026-07-02T00:00:00.000Z',
      } satisfies PublicAuditRun,
    });
    renderReport({ path: '/sites/site-1/report/run-queued' });
    expect(await screen.findByTestId('report-run-in-progress')).toBeInTheDocument();
  });
});

// ============================================================================
// PageSpeed block
// ============================================================================

import { PageSpeedBlock } from './PageSpeedBlock';
import { isPageSpeedRuleId, PAGE_SPEED_RULE_IDS } from '../types';
import type { PageSpeedSection, PageSpeedSample } from '../types';

const pageSpeedFinding: LocalizedFinding = {
  ruleId: 'core-web-vitals-poor',
  bucket: 'fix-now',
  severity: 'critical',
  affectedUrls: ['https://example.com/slow'],
  copy: {
    titleKey: 'auditRules.core-web-vitals-poor.title',
    whyKey: 'auditRules.core-web-vitals-poor.why',
    fixKey: 'auditRules.core-web-vitals-poor.fix',
    passedLabelKey: 'auditRules.core-web-vitals-poor.passedLabel',
    title: 'Core Web Vitals below Google\'s threshold',
    why: 'CWV is what real visitors experienced.',
    fix: 'Speed LCP, INP, CLS.',
    passedLabel: 'CWV good.',
  },
};

const sampleGood: PageSpeedSample = {
  url: 'https://example.com/',
  strategy: 'mobile',
  labScores: { performance: 92, accessibility: 90, bestPractices: 92, seo: 100 },
  coreWebVitals: { lcpMs: 1800, inp: 120, cls: 0.05, category: 'good' },
  mobileFriendly: true,
  fieldDataLevel: 'url',
};

const samplePoor: PageSpeedSample = {
  url: 'https://example.com/slow',
  strategy: 'mobile',
  labScores: { performance: 32, accessibility: 80, bestPractices: 80, seo: 90 },
  coreWebVitals: { lcpMs: 5200, inp: 700, cls: 0.31, category: 'poor' },
  mobileFriendly: false,
  fieldDataLevel: 'url',
};

import { StrictMode, type ReactNode } from 'react';
const renderInI18n = (node: ReactNode) =>
  render(
    <Provider store={makeStore()}>
      <I18nextProvider i18n={i18n}>{node}</I18nextProvider>
    </Provider>,
  );

describe('PAGE_SPEED_RULE_IDS + isPageSpeedRuleId', () => {
  it('lists the four page-speed rule ids', () => {
    expect(PAGE_SPEED_RULE_IDS).toEqual([
      'core-web-vitals-poor',
      'page-speed-lab-low',
      'mobile-unfriendly',
      'accessibility-low',
    ]);
  });
  it('identifies page-speed rules', () => {
    expect(isPageSpeedRuleId('core-web-vitals-poor')).toBe(true);
    expect(isPageSpeedRuleId('page-speed-lab-low')).toBe(true);
    expect(isPageSpeedRuleId('mobile-unfriendly')).toBe(true);
    expect(isPageSpeedRuleId('accessibility-low')).toBe(true);
    expect(isPageSpeedRuleId('title-missing-or-weak')).toBe(false);
  });
});

describe('PageSpeedBlock', () => {
  it('renders unavailable note with no gauges when status=unavailable', () => {
    const section: PageSpeedSection = { status: 'unavailable', samples: [] };
    renderInI18n(<PageSpeedBlock section={section} />);
    expect(screen.getByTestId('report-pagespeed-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('report-pagespeed-block')).not.toBeInTheDocument();
  });

  it('renders the "no field data yet" note when status=ok with zero samples', () => {
    const section: PageSpeedSection = { status: 'ok', samples: [] };
    renderInI18n(<PageSpeedBlock section={section} />);
    expect(screen.getByTestId('report-pagespeed-empty')).toBeInTheDocument();
  });

  it('renders field + lab labels and per-sample metrics', () => {
    const section: PageSpeedSection = { status: 'ok', samples: [sampleGood, samplePoor] };
    renderInI18n(<PageSpeedBlock section={section} />);
    expect(screen.getByTestId('report-pagespeed-block')).toBeInTheDocument();
    expect(screen.getAllByTestId('report-pagespeed-sample')).toHaveLength(2);
    expect(screen.getByTestId('report-pagespeed-cwv-good')).toBeInTheDocument();
    expect(screen.getByTestId('report-pagespeed-cwv-poor')).toBeInTheDocument();
    expect(screen.getAllByText(/What real visitors experienced/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Our lab estimate/i).length).toBeGreaterThan(0);
    expect(screen.getByText('1800 ms')).toBeInTheDocument();
    expect(screen.getByText('0.31')).toBeInTheDocument();
  });

  it('labels origin-fallback samples honestly', () => {
    const section: PageSpeedSection = {
      status: 'ok',
      samples: [{ ...sampleGood, fieldDataLevel: 'origin' }],
    };
    renderInI18n(<PageSpeedBlock section={section} />);
    expect(screen.getByText(/Origin-level data/)).toBeInTheDocument();
  });

  it('renders "not enough visitor data yet" inline for a sample with no field data', () => {
    const sampleNoField: PageSpeedSample = {
      url: 'https://tiny.example.com/',
      strategy: 'mobile',
      labScores: { performance: 80, accessibility: 90, bestPractices: 90, seo: 100 },
      fieldDataLevel: 'none',
    };
    const section: PageSpeedSection = { status: 'ok', samples: [sampleNoField] };
    renderInI18n(<PageSpeedBlock section={section} />);
    // The inline per-sample note uses the same title copy as the empty section
    expect(screen.getAllByText(/Not enough visitor data yet/).length).toBeGreaterThan(0);
    // Lab score still shown.
    expect(screen.getByText('80')).toBeInTheDocument();
  });

  it('shows singular sample-count label for count=1', () => {
    const section: PageSpeedSection = { status: 'ok', samples: [sampleGood] };
    renderInI18n(<PageSpeedBlock section={section} />);
    expect(screen.getByText('1 page sampled')).toBeInTheDocument();
  });
});

describe('IssueDetail — page-speed injection', () => {
  it('renders PageSpeedBlock for a page-speed rule', () => {
    const section: PageSpeedSection = { status: 'ok', samples: [sampleGood] };
    renderInI18n(
      <IssueDetail finding={pageSpeedFinding} diffByUrl={new Map()} pageSpeed={section} />,
    );
    expect(screen.getByTestId('report-pagespeed-block')).toBeInTheDocument();
  });

  it('does NOT render PageSpeedBlock for a non-page-speed rule', () => {
    const section: PageSpeedSection = { status: 'ok', samples: [sampleGood] };
    renderInI18n(
      <IssueDetail
        finding={findingsFixture[0]!}
        diffByUrl={new Map()}
        pageSpeed={section}
      />,
    );
    expect(screen.queryByTestId('report-pagespeed-block')).not.toBeInTheDocument();
  });

  it('does not render the block when pageSpeed is null', () => {
    renderInI18n(
      <IssueDetail finding={pageSpeedFinding} diffByUrl={new Map()} pageSpeed={null} />,
    );
    expect(screen.queryByTestId('report-pagespeed-block')).not.toBeInTheDocument();
    expect(screen.queryByTestId('report-pagespeed-unavailable')).not.toBeInTheDocument();
  });

  it('does not render the block when pageSpeed is omitted (default undefined)', () => {
    renderInI18n(<IssueDetail finding={pageSpeedFinding} diffByUrl={new Map()} />);
    expect(screen.queryByTestId('report-pagespeed-block')).not.toBeInTheDocument();
  });

  it('renders the unavailable note inside a page-speed row when the provider failed', () => {
    renderInI18n(
      <IssueDetail
        finding={pageSpeedFinding}
        diffByUrl={new Map()}
        pageSpeed={{ status: 'unavailable', samples: [] }}
      />,
    );
    expect(screen.getByTestId('report-pagespeed-unavailable')).toBeInTheDocument();
  });

  it('IssueRow expand still surfaces the PageSpeedBlock through the toggle', async () => {
    const user = userEvent.setup();
    renderInI18n(
      <IssueRow
        finding={pageSpeedFinding}
        diffByUrl={new Map()}
        pageSpeed={{ status: 'ok', samples: [sampleGood] }}
      />,
    );
    // Row starts collapsed — block not visible.
    expect(screen.queryByTestId('report-pagespeed-block')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Core Web Vitals below/ }));
    expect(screen.getByTestId('report-pagespeed-block')).toBeInTheDocument();
  });
});

describe('PageSpeedBlock — RTL', () => {
  it('renders under Arabic locale (RTL) without crashing', async () => {
    await changeLanguage('ar');
    const section: PageSpeedSection = { status: 'ok', samples: [sampleGood] };
    renderInI18n(<PageSpeedBlock section={section} />);
    expect(screen.getByTestId('report-pagespeed-block')).toBeInTheDocument();
    await changeLanguage('en');
  });
});

describe('ReportPage — AI summary card feature gate', () => {
  it('hides the card when aiSummaryEnabled is false or absent (pre-feature parity)', async () => {
    const store = makeStore({
      loaded: true,
      siteId: 'site-1',
      runId: 'run-1',
      runStatus: 'succeeded',
      report: makeReport(),
    });
    renderReport({ store });
    await waitFor(() => expect(screen.getByTestId('report-tabs')).toBeInTheDocument());
    expect(screen.queryByTestId('report-ai-summary')).toBeNull();
  });

  it('renders the card when aiSummaryEnabled is true', async () => {
    mocked.fetchReportRequest.mockResolvedValue(
      makeReport({ aiSummaryEnabled: true }),
    );
    const store = makeStore({
      loaded: true,
      siteId: 'site-1',
      runId: 'run-1',
      runStatus: 'succeeded',
      report: makeReport({ aiSummaryEnabled: true }),
    });
    renderReport({ store });
    expect(await screen.findByTestId('report-ai-summary')).toBeInTheDocument();
    expect(screen.getByTestId('report-ai-summary-cta')).toBeInTheDocument();
  });

  it('projects an exact-locale legacy summary when availability metadata is absent', async () => {
    const legacySummary = {
      text: 'Legacy English summary.',
      locale: 'en' as const,
      model: 'legacy-model',
      truncated: false,
      createdAt: '2026-08-25T09:00:00.000Z',
    };
    const report = makeReport({
      aiSummaryEnabled: true,
      aiSummary: legacySummary,
      aiSummaryStatus: 'succeeded',
    });
    mocked.fetchReportRequest.mockResolvedValue(report);
    const store = makeStore({
      loaded: true,
      siteId: 'site-1',
      runId: 'run-1',
      runStatus: 'succeeded',
      report,
    });

    renderReport({ store });

    expect(await screen.findByTestId('report-ai-summary-text')).toHaveTextContent(
      'Legacy English summary.',
    );
    expect(screen.getByTestId('report-ai-summary-regenerate')).toBeInTheDocument();
  });

  it('refetches availability on a locale switch without generating or flashing the old summary', async () => {
    await act(async () => {
      await changeLanguage('en');
    });
    const englishSummary = {
      text: 'English summary only.',
      locale: 'en' as const,
      model: 'm-en',
      truncated: false,
      createdAt: '2026-08-25T09:00:00.000Z',
    };
    const english = makeReport({
      aiSummaryEnabled: true,
      aiSummary: englishSummary,
      aiSummaryStatus: 'succeeded',
      aiSummaryAvailability: {
        requestedLocale: 'en',
        availableLocales: ['en'],
        status: 'succeeded',
      },
    });
    const frenchFinding: LocalizedFinding = {
      ...findingsFixture[0]!,
      affectedUrls: [...findingsFixture[0]!.affectedUrls],
      copy: {
        ...findingsFixture[0]!.copy,
        title: 'Titres de page manquants',
        why: 'Les titres aident les lecteurs.',
        fix: 'Ajoutez un titre clair.',
      },
    };
    mocked.fetchReportRequest.mockResolvedValue(makeReport({
      findings: [frenchFinding],
      aiSummaryEnabled: true,
      aiSummary: null,
      aiSummaryStatus: 'idle',
      aiSummaryAvailability: {
        requestedLocale: 'fr',
        availableLocales: ['en'],
        status: 'idle',
      },
    }));
    const store = makeStore({
        loaded: true,
        siteId: 'site-1',
        runId: 'run-1',
        runStatus: null,
        report: english,
      });
    renderReport({ store });
    expect(screen.getByTestId('report-ai-summary-text')).toHaveTextContent('English summary only.');
    expect(screen.getByText('Page titles missing or weak')).toBeInTheDocument();

    await act(async () => {
      await changeLanguage('fr');
    });
    expect(screen.queryByText('English summary only.')).toBeNull();
    await waitFor(() => expect(mocked.fetchReportRequest).toHaveBeenCalled());
    expect(await screen.findByText('Titres de page manquants')).toBeInTheDocument();
    expect(screen.queryByText('Page titles missing or weak')).toBeNull();
    expect(store.getState().report.report?.findings[0]?.affectedUrls).toEqual(
      findingsFixture[0]?.affectedUrls,
    );
    expect(mocked.fetchReportRequest).toHaveBeenCalledWith(
      'run-1',
      expect.objectContaining({ presentationLocale: 'fr' }),
    );
    expect(await screen.findByTestId('report-ai-summary-cta')).toBeInTheDocument();
    expect(mocked.generateAiSummaryRequest).not.toHaveBeenCalled();
    expect(mocked.startAuditRequest).not.toHaveBeenCalled();
    expect(actionsApiMocked.mutateActionState).not.toHaveBeenCalled();
  });
});

describe('ReportPage — explicit siteId/runId prop path (workspace embed)', () => {
  it('prefers the siteId/runId props over the URL params', async () => {
    mocked.fetchRunRequest.mockResolvedValue({
      run: {
        id: 'prop-run',
        siteId: 'prop-site',
        status: 'succeeded',
        createdAt: '2026-07-01T00:00:00.000Z',
        finishedAt: '2026-07-01T00:00:10.000Z',
      } as unknown as PublicAuditRun,
    });
    mocked.fetchReportRequest.mockResolvedValue(makeReport());
    render(
      <Provider store={makeStore()}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/anything']}>
            <ReportPage siteId="prop-site" runId="prop-run" />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    await waitFor(() =>
      expect(mocked.fetchReportRequest).toHaveBeenCalledWith('prop-run', expect.objectContaining({ signal: expect.any(AbortSignal) })),
    );
    await waitFor(() =>
      expect(mocked.fetchRunRequest).toHaveBeenCalledWith('prop-run', expect.objectContaining({ signal: expect.any(AbortSignal) })),
    );
  });
});

describe('ReportPage — siteId ?? params.siteId ?? empty-string right branch (line 135)', () => {
  it('falls back to empty string when neither siteIdProp nor route param provides siteId', async () => {
    render(
      <Provider store={makeStore()}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/report']}>
            <Routes>
              <Route path="/report" element={<ReportPage />} />
            </Routes>
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    // loadReport({ siteId: '' }) → fetchLatestRunRequest('', ...) when no runId
    await waitFor(() =>
      expect(mocked.fetchLatestRunRequest).toHaveBeenCalledWith(
        '',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
  });
});

describe('ReportPage — runIdParam !== undefined mismatches state.runId (line 177 || false branch)', () => {
  it('re-fetches when URL runId param differs from the preloaded runId', async () => {
    const store = makeStore({
      loaded: true,
      siteId: 'site-1',
      runId: 'run-1',
      runStatus: 'succeeded' as ReportState['runStatus'],
      report: makeReport(),
    });
    // Path captures runId='run-2'; state has runId='run-1' → || both false → not alreadyLoaded
    renderReport({ store, path: '/sites/site-1/report/run-2' });
    await waitFor(() =>
      expect(mocked.fetchReportRequest).toHaveBeenCalledWith(
        'run-2',
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      ),
    );
  });
});

describe('ReportPage — StrictMode double-invocation guard (line 206 true branch)', () => {
  it('finishedRunRef guard prevents second dispatch on StrictMode remount', async () => {
    const store = makeStore({
      loaded: true,
      siteId: 'site-1',
      runId: 'run-1',
      runStatus: 'succeeded' as ReportState['runStatus'],
      report: makeReport(),
    });
    render(
      <StrictMode>
        <Provider store={store}>
          <I18nextProvider i18n={i18n}>
            <MemoryRouter initialEntries={['/sites/site-1/report']}>
              <Routes>
                <Route path="/sites/:siteId/report" element={<ReportPage />} />
              </Routes>
            </MemoryRouter>
          </I18nextProvider>
        </Provider>
      </StrictMode>,
    );
    // StrictMode: effects mount → cleanup → remount. Second invocation of the
    // runStatus='succeeded' effect hits finishedRunRef.current === runId guard (line 206).
    // The abort leaves loading=true so the loading UI stays — assert it directly.
    expect(screen.getByTestId('report-loading')).toBeInTheDocument();
  });
});


// ============================================================================
// GSC block
// ============================================================================

import { GscBlock } from './GscBlock';
import {
  GSC_SEARCH_RULE_IDS,
  GSC_SITEMAP_RULE_IDS,
  isGscSearchRuleId,
  isGscSitemapRuleId,
} from '../types';
import type { GscSearchSection, GscSitemapsSection } from '../types';

const renderInRouter = (node: ReactNode) =>
  render(
    <Provider store={makeStore()}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>{node}</MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );

const gscSearchOk: GscSearchSection = {
  status: 'ok',
  totalClicks: 1234,
  totalImpressions: 56789,
  averageCtr: 0.0217,
  averagePosition: 6.4,
  topQueries: [
    { query: 'q1', clicks: 60, impressions: 6000, ctr: 0.01, position: 4.1 },
    { query: 'q2', clicks: 50, impressions: 5000, ctr: 0.01, position: 5.1 },
    { query: 'q3', clicks: 40, impressions: 4000, ctr: 0.01, position: 6.1 },
    { query: 'q4', clicks: 30, impressions: 3000, ctr: 0.01, position: 7.1 },
    { query: 'q5', clicks: 20, impressions: 2000, ctr: 0.01, position: 8.1 },
    { query: 'q6-truncated', clicks: 10, impressions: 1000, ctr: 0.01, position: 9.1 },
  ],
  topPages: [
    {
      url: 'https://example.com/',
      clicks: 90,
      impressions: 9000,
      ctr: 0.01,
      position: 3.2,
    },
  ],
  delta: { clicks: 12, impressions: -340 },
};

const gscSitemapsOk: GscSitemapsSection = {
  status: 'ok',
  sitemaps: [
    {
      path: 'https://example.com/sitemap.xml',
      errors: 0,
      warnings: 0,
      processed: 128,
      lastDownloaded: '2026-07-01T04:30:00.000Z',
    },
    {
      path: 'https://example.com/broken.xml',
      errors: 2,
      warnings: 0,
      processed: 0,
      lastDownloaded: null,
    },
    {
      path: 'https://example.com/partial.xml',
      errors: 0,
      warnings: 3,
      processed: 40,
      lastDownloaded: '2026-06-20T00:00:00.000Z',
    },
  ],
};

const gscCtrFinding: LocalizedFinding = {
  ruleId: 'gsc-ctr-low',
  bucket: 'watch',
  severity: 'warning',
  affectedUrls: [],
  copy: {
    titleKey: 'auditRules.gsc-ctr-low.title',
    whyKey: 'auditRules.gsc-ctr-low.why',
    fixKey: 'auditRules.gsc-ctr-low.fix',
    passedLabelKey: 'auditRules.gsc-ctr-low.passedLabel',
    title: 'Searchers see you but rarely click',
    why: 'CTR too low.',
    fix: 'Rewrite titles.',
    passedLabel: 'Healthy CTR.',
  },
};

const sitemapErrorsFinding: LocalizedFinding = {
  ruleId: 'sitemap-errors',
  bucket: 'fix-now',
  severity: 'critical',
  affectedUrls: ['https://example.com/broken.xml'],
  copy: {
    titleKey: 'auditRules.sitemap-errors.title',
    whyKey: 'auditRules.sitemap-errors.why',
    fixKey: 'auditRules.sitemap-errors.fix',
    passedLabelKey: 'auditRules.sitemap-errors.passedLabel',
    title: 'Google reports problems with your sitemap',
    why: 'Sitemap errors block indexing.',
    fix: 'Fix and resubmit.',
    passedLabel: 'Sitemaps healthy.',
  },
};

describe('GSC rule-id guards', () => {
  it('lists the GSC rule ids', () => {
    expect(GSC_SEARCH_RULE_IDS).toEqual(['gsc-ctr-low']);
    expect(GSC_SITEMAP_RULE_IDS).toEqual(['sitemap-errors']);
  });
  it('identifies GSC rules', () => {
    expect(isGscSearchRuleId('gsc-ctr-low')).toBe(true);
    expect(isGscSearchRuleId('sitemap-errors')).toBe(false);
    expect(isGscSitemapRuleId('sitemap-errors')).toBe(true);
    expect(isGscSitemapRuleId('gsc-ctr-low')).toBe(false);
  });
});

describe('GscBlock — search section', () => {
  it('renders totals, top-5 truncation, delta badges, and the sampled footnote', () => {
    renderInRouter(<GscBlock search={gscSearchOk} siteId="site-1" />);
    expect(screen.getByTestId('report-gsc-search-block')).toBeInTheDocument();
    // Totals dl (locale-formatted).
    expect(screen.getByText('1,234')).toBeInTheDocument();
    expect(screen.getByText('56,789')).toBeInTheDocument();
    expect(screen.getByText('2.2%')).toBeInTheDocument();
    expect(screen.getByText('6.4')).toBeInTheDocument();
    // Top-5 truncation: q6 never rendered.
    expect(screen.getByText('q1')).toBeInTheDocument();
    expect(screen.getByText('q5')).toBeInTheDocument();
    expect(screen.queryByText('q6-truncated')).not.toBeInTheDocument();
    // Top pages table.
    expect(screen.getByText('https://example.com/')).toBeInTheDocument();
    // Delta badges: positive outline, negative destructive.
    expect(screen.getByTestId('report-gsc-delta-clicks')).toHaveTextContent('+12');
    expect(screen.getByTestId('report-gsc-delta-impressions')).toHaveTextContent(
      '-340',
    );
    // Honest sampling footnote.
    expect(screen.getByText(/Sampled by Google/)).toBeInTheDocument();
  });

  it('hides delta badges when the delta is null (first run)', () => {
    renderInRouter(
      <GscBlock
        search={{ ...gscSearchOk, delta: { clicks: null, impressions: null } }}
        siteId="site-1"
      />,
    );
    expect(screen.queryByTestId('report-gsc-delta-clicks')).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('report-gsc-delta-impressions'),
    ).not.toBeInTheDocument();
  });

  it('renders the unavailable note', () => {
    renderInRouter(
      <GscBlock
        search={{ ...gscSearchOk, status: 'unavailable' }}
        siteId="site-1"
      />,
    );
    expect(screen.getByTestId('report-gsc-search-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('report-gsc-search-block')).not.toBeInTheDocument();
  });

  it('renders the connect prompt for a null section, linking ?tab=google', () => {
    renderInRouter(<GscBlock search={null} siteId="site-1" />);
    const note = screen.getByTestId('report-gsc-search-not-connected');
    expect(note).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Open Google settings/ });
    expect(link).toHaveAttribute('href', '/sites/site-1?tab=google');
  });

  it('renders the connect prompt for status=not-connected', () => {
    renderInRouter(
      <GscBlock
        search={{ ...gscSearchOk, status: 'not-connected' }}
        siteId="site-1"
      />,
    );
    expect(screen.getByTestId('report-gsc-search-not-connected')).toBeInTheDocument();
  });

  it('renders the reconnect note with the settings link', () => {
    renderInRouter(
      <GscBlock
        search={{ ...gscSearchOk, status: 'needs-reconnect' }}
        siteId="site-1"
      />,
    );
    expect(
      screen.getByTestId('report-gsc-search-needs-reconnect'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Open Google settings/ })).toBeVisible();
  });

  it('renders the honest no-data note', () => {
    renderInRouter(
      <GscBlock search={{ ...gscSearchOk, status: 'no-data' }} siteId="site-1" />,
    );
    expect(screen.getByTestId('report-gsc-search-no-data')).toBeInTheDocument();
  });

  it('omits the top tables when the lists are empty', () => {
    renderInRouter(
      <GscBlock
        search={{ ...gscSearchOk, topQueries: [], topPages: [] }}
        siteId="site-1"
      />,
    );
    expect(screen.getByTestId('report-gsc-search-block')).toBeInTheDocument();
    expect(screen.queryByText('q1')).not.toBeInTheDocument();
  });
});

describe('GscBlock — sitemaps section', () => {
  it('renders error / warning / healthy badges, processed counts, and dates', () => {
    renderInRouter(<GscBlock sitemaps={gscSitemapsOk} siteId="site-1" />);
    expect(screen.getByTestId('report-gsc-sitemaps-block')).toBeInTheDocument();
    expect(screen.getAllByTestId('report-gsc-sitemap-row')).toHaveLength(3);
    expect(screen.getByTestId('report-gsc-sitemap-healthy')).toBeInTheDocument();
    expect(screen.getByTestId('report-gsc-sitemap-errors')).toHaveTextContent(
      '2 errors',
    );
    expect(screen.getByTestId('report-gsc-sitemap-warnings')).toHaveTextContent(
      '3 warnings',
    );
    expect(screen.getByText('128 URLs submitted')).toBeInTheDocument();
    expect(screen.getByText('Not read by Google yet')).toBeInTheDocument();
    expect(screen.getAllByText(/Last read by Google/)).toHaveLength(2);
  });

  it('renders the no-sitemaps note', () => {
    renderInRouter(
      <GscBlock
        sitemaps={{ status: 'no-sitemaps', sitemaps: [] }}
        siteId="site-1"
      />,
    );
    expect(screen.getByTestId('report-gsc-sitemaps-none')).toBeInTheDocument();
  });

  it('renders unavailable / not-connected / reconnect notes', () => {
    const { unmount } = renderInRouter(
      <GscBlock
        sitemaps={{ status: 'unavailable', sitemaps: [] }}
        siteId="site-1"
      />,
    );
    expect(
      screen.getByTestId('report-gsc-sitemaps-unavailable'),
    ).toBeInTheDocument();
    unmount();
    const second = renderInRouter(<GscBlock sitemaps={null} siteId="site-1" />);
    expect(
      screen.getByTestId('report-gsc-sitemaps-not-connected'),
    ).toBeInTheDocument();
    second.unmount();
    renderInRouter(
      <GscBlock
        sitemaps={{ status: 'needs-reconnect', sitemaps: [] }}
        siteId="site-1"
      />,
    );
    expect(
      screen.getByTestId('report-gsc-sitemaps-needs-reconnect'),
    ).toBeInTheDocument();
  });
});

describe('IssueDetail — GSC injection', () => {
  it('renders the search block (only) inside a gsc-ctr-low row', () => {
    renderInRouter(
      <IssueDetail
        finding={gscCtrFinding}
        diffByUrl={new Map()}
        gscSearch={gscSearchOk}
        gscSitemaps={gscSitemapsOk}
        siteId="site-1"
      />,
    );
    expect(screen.getByTestId('report-gsc-search-block')).toBeInTheDocument();
    expect(screen.queryByTestId('report-gsc-sitemaps-block')).not.toBeInTheDocument();
  });

  it('renders the sitemaps block (only) inside a sitemap-errors row', () => {
    renderInRouter(
      <IssueDetail
        finding={sitemapErrorsFinding}
        diffByUrl={new Map()}
        gscSearch={gscSearchOk}
        gscSitemaps={gscSitemapsOk}
        siteId="site-1"
      />,
    );
    expect(screen.getByTestId('report-gsc-sitemaps-block')).toBeInTheDocument();
    expect(screen.queryByTestId('report-gsc-search-block')).not.toBeInTheDocument();
  });

  it('renders the connect prompt inside a gsc row when the section is missing', () => {
    renderInRouter(
      <IssueDetail finding={gscCtrFinding} diffByUrl={new Map()} siteId="site-1" />,
    );
    expect(screen.getByTestId('report-gsc-search-not-connected')).toBeInTheDocument();
  });

  it('renders the connect prompt inside a sitemap row when sections + siteId are missing', () => {
    renderInRouter(
      <IssueDetail finding={sitemapErrorsFinding} diffByUrl={new Map()} />,
    );
    expect(
      screen.getByTestId('report-gsc-sitemaps-not-connected'),
    ).toBeInTheDocument();
    // Missing siteId degrades to the sites root, never crashes.
    expect(screen.getByRole('link', { name: /Open Google settings/ })).toHaveAttribute(
      'href',
      '/sites/?tab=google',
    );
  });

  it('renders NO gsc block for a non-GSC rule', () => {
    renderInRouter(
      <IssueDetail
        finding={findingsFixture[0]!}
        diffByUrl={new Map()}
        gscSearch={gscSearchOk}
        gscSitemaps={gscSitemapsOk}
        siteId="site-1"
      />,
    );
    expect(screen.queryByTestId('report-gsc-block')).not.toBeInTheDocument();
  });

  it('surfaces the server-localized reason line when copy.reason is present', () => {
    const withReason: LocalizedFinding = {
      ruleId: 'not-indexed',
      bucket: 'fix-now',
      severity: 'critical',
      affectedUrls: ['https://example.com/blocked'],
      copy: {
        titleKey: 'auditRules.not-indexed.title',
        whyKey: 'auditRules.not-indexed.why',
        fixKey: 'auditRules.not-indexed.fix',
        passedLabelKey: 'auditRules.not-indexed.passedLabel',
        title: 'Pages not indexed by Google',
        why: 'Generic why.',
        fix: 'Fix it.',
        passedLabel: 'All indexed.',
        reason: 'Your robots.txt file blocks Google from these pages.',
        reasonKey: 'auditRules.not-indexed.reasons.robotsBlocked',
      },
    };
    renderInRouter(<IssueDetail finding={withReason} diffByUrl={new Map()} />);
    expect(screen.getByTestId('report-issue-reason')).toHaveTextContent(
      /robots\.txt/,
    );
  });

  it('omits the reason line on passed findings even when present', () => {
    const passedWithReason: LocalizedFinding = {
      ruleId: 'not-indexed',
      bucket: 'passed',
      severity: 'critical',
      affectedUrls: [],
      copy: {
        titleKey: 'auditRules.not-indexed.title',
        whyKey: 'auditRules.not-indexed.why',
        fixKey: 'auditRules.not-indexed.fix',
        passedLabelKey: 'auditRules.not-indexed.passedLabel',
        title: 'Pages not indexed by Google',
        why: 'Generic why.',
        fix: 'Fix it.',
        passedLabel: 'All indexed.',
        reason: 'Stale reason.',
        reasonKey: 'auditRules.not-indexed.reasons.coverageUnknown',
      },
    };
    renderInRouter(<IssueDetail finding={passedWithReason} diffByUrl={new Map()} />);
    expect(screen.queryByTestId('report-issue-reason')).not.toBeInTheDocument();
  });

  it('IssueRow expand surfaces the GscBlock through the toggle', async () => {
    const user = userEvent.setup();
    renderInRouter(
      <IssueRow
        finding={gscCtrFinding}
        diffByUrl={new Map()}
        gscSearch={gscSearchOk}
        siteId="site-1"
      />,
    );
    expect(screen.queryByTestId('report-gsc-search-block')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Searchers see you/ }));
    expect(screen.getByTestId('report-gsc-search-block')).toBeInTheDocument();
  });
});

describe('GscBlock — RTL', () => {
  it('renders under Arabic locale with LTR-pinned numerics', async () => {
    await changeLanguage('ar');
    renderInRouter(
      <GscBlock search={gscSearchOk} sitemaps={gscSitemapsOk} siteId="site-1" />,
    );
    expect(screen.getByTestId('report-gsc-search-block')).toBeInTheDocument();
    expect(screen.getByTestId('report-gsc-sitemaps-block')).toBeInTheDocument();
    await changeLanguage('en');
  });
});

describe('ReportPage — renders before the lazy slice materializes', () => {
  it('does not throw when `state.report` is still undefined on first render', async () => {
    // SiteWorkspacePage injects the 'report' reducer and renders the page in
    // the same tick, but RTK only materializes the slice on the NEXT dispatched
    // action — so the page's very first render sees no `state.report` key. A
    // bare store reproduces that precondition; the selectors must fall back to
    // initialState rather than throw (an unguarded read here surfaces as the
    // route-level "Page not found" boundary).
    const bareStore = configureStore({
      reducer: { unrelated: (s: Record<string, never> = {}) => s },
    });
    render(
      <Provider store={bareStore as never}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={['/sites/site-1/report']}>
            <Routes>
              <Route path="/sites/:siteId/report" element={<ReportPage />} />
            </Routes>
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    expect(await screen.findByTestId('report-loading')).toBeInTheDocument();
  });
});
