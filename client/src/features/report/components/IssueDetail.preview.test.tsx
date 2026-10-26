import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { i18n, initI18n } from '@shared/i18n';
import type { FindingUrls, LocalizedFinding } from '../types';
import { IssueDetail } from './IssueDetail';
import { affectedUrlTotal, brokenLinkTargetTotal, hasFindingListPreview, readFindingMeasurements } from '../findingLists';
import { fetchFindingUrlsRequest } from '../api';

vi.mock('../api', () => ({ fetchFindingUrlsRequest: vi.fn() }));

const saved = vi.hoisted(() => [] as Array<{ blob: Blob; name: string }>);
vi.mock('@features/report-export', () => ({
  saveBlobAs: (blob: Blob, name: string) => saved.push({ blob, name }),
}));

const fetchLists = vi.mocked(fetchFindingUrlsRequest);

const urls = (count: number) => Array.from({ length: count }, (_, index) => `https://example.com/p${index}`);

const previewFinding = (overrides: Partial<LocalizedFinding> = {}): LocalizedFinding => ({
  ruleId: 'meta-description-missing',
  bucket: 'fix-now',
  severity: 'medium',
  affectedUrls: urls(5),
  affectedUrlCount: 12,
  copy: { title: 'Add meta descriptions', why: 'Search results show them.', fix: 'Write one per page.' },
  ...overrides,
} as LocalizedFinding);

const fullLists = (overrides: Partial<FindingUrls> = {}): FindingUrls => ({
  ruleId: 'meta-description-missing',
  affectedUrls: urls(12),
  brokenLinkTargets: [],
  brokenLinkEvidence: [],
  diff: [{ url: 'https://example.com/p9', kind: 'regressed' }],
  ...overrides,
});

const renderDetail = (finding: LocalizedFinding, props: { siteId?: string; runId?: string } = { siteId: 'site-1', runId: 'run-1' }) =>
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <IssueDetail finding={finding} diffByUrl={new Map()} {...props} />
      </MemoryRouter>
    </I18nextProvider>,
  );

const readBlob = (blob: Blob) =>
  new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });

beforeEach(() => {
  initI18n({ initialLocale: 'en' });
  fetchLists.mockReset();
  saved.length = 0;
});

afterEach(() => vi.clearAllMocks());

describe('finding list helpers', () => {
  it('report totals, falling back to the list itself on older payloads', () => {
    expect(affectedUrlTotal({ affectedUrls: urls(2) })).toBe(2);
    expect(affectedUrlTotal({ affectedUrls: urls(2), affectedUrlCount: 9 })).toBe(9);
    expect(brokenLinkTargetTotal({})).toBe(0);
    expect(brokenLinkTargetTotal({ brokenLinkTargets: urls(3), brokenLinkTargetCount: 7 })).toBe(7);
    expect(hasFindingListPreview(previewFinding({ affectedUrlCount: 5 }))).toBe(false);
    expect(hasFindingListPreview(previewFinding())).toBe(true);
    expect(hasFindingListPreview(previewFinding({ affectedUrlCount: 5, brokenLinkTargets: ['x'], brokenLinkTargetCount: 2 }))).toBe(true);
    expect(
      hasFindingListPreview(
        previewFinding({ affectedUrlCount: 5, brokenLinkEvidence: [], brokenLinkEvidenceTotal: 3 }),
      ),
    ).toBe(true);
  });
});

describe('IssueDetail — previewed lists', () => {
  it('says how much of the list is shown and loads the full list on request', async () => {
    let resolve: (lists: FindingUrls) => void = () => undefined;
    fetchLists.mockReturnValue(new Promise((done) => { resolve = done; }));
    renderDetail(previewFinding());
    expect(screen.getByTestId('report-issue-preview')).toHaveTextContent('Showing 5 of 12.');
    expect(screen.getAllByRole('link').filter((link) => link.textContent?.startsWith('https://'))).toHaveLength(5);
    const button = screen.getByTestId('report-issue-load-all');
    await userEvent.click(button);
    expect(fetchLists).toHaveBeenCalledWith('run-1', 'meta-description-missing');
    expect(button).toHaveAttribute('aria-busy', 'true');
    resolve(fullLists());
    await waitFor(() => expect(screen.queryByTestId('report-issue-preview')).not.toBeInTheDocument());
    expect(screen.getAllByRole('link').filter((link) => link.textContent?.startsWith('https://'))).toHaveLength(12);
    // The per-URL diff of a URL beyond the preview arrives with the full list.
    expect(screen.getByText('https://example.com/p9').closest('li')).toHaveTextContent('Regressed');
  });

  it('shows an inline error and lets the reader try again', async () => {
    fetchLists.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(fullLists());
    renderDetail(previewFinding());
    await userEvent.click(screen.getByTestId('report-issue-load-all'));
    expect(await screen.findByTestId('report-issue-load-all-error')).toHaveTextContent(
      'Could not load the full list. Try again.',
    );
    await userEvent.click(screen.getByTestId('report-issue-load-all'));
    await waitFor(() => expect(screen.queryByTestId('report-issue-preview')).not.toBeInTheDocument());
  });

  it('downloads every URL, not the preview, loading the list once', async () => {
    fetchLists.mockResolvedValue(fullLists());
    renderDetail(previewFinding());
    await userEvent.click(screen.getByTestId('report-issue-download-urls'));
    await waitFor(() => expect(saved).toHaveLength(1));
    const text = await readBlob(saved[0]!.blob);
    for (const url of urls(12)) expect(text).toContain(url);
    expect(saved[0]!.name).toBe('meta-description-missing-urls.csv');
    await userEvent.click(screen.getByTestId('report-issue-download-urls'));
    await waitFor(() => expect(saved).toHaveLength(2));
    expect(fetchLists).toHaveBeenCalledTimes(1);
  });

  it('downloads nothing when the full list cannot load', async () => {
    fetchLists.mockRejectedValue(new Error('offline'));
    renderDetail(previewFinding());
    await userEvent.click(screen.getByTestId('report-issue-download-urls'));
    expect(await screen.findByTestId('report-issue-load-all-error')).toBeInTheDocument();
    expect(saved).toHaveLength(0);
  });

  it('keeps the download busy while the list loads, then reuses the loaded list', async () => {
    let resolve: (lists: FindingUrls) => void = () => undefined;
    fetchLists.mockReturnValue(new Promise((done) => { resolve = done; }));
    renderDetail(previewFinding());
    await userEvent.click(screen.getByTestId('report-issue-load-all'));
    expect(screen.getByTestId('report-issue-download-urls')).toBeDisabled();
    resolve(fullLists());
    await waitFor(() => expect(screen.getByTestId('report-issue-download-urls')).toBeEnabled());
    await userEvent.click(screen.getByTestId('report-issue-download-urls'));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(fetchLists).toHaveBeenCalledTimes(1);
  });

  it('keeps a complete list as is: no preview note, no request', async () => {
    renderDetail(previewFinding({ affectedUrls: urls(3), affectedUrlCount: 3 }));
    expect(screen.queryByTestId('report-issue-preview')).not.toBeInTheDocument();
    await userEvent.click(screen.getByTestId('report-issue-download-urls'));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(fetchLists).not.toHaveBeenCalled();
  });

  it('offers no full-list load without a site and run', () => {
    renderDetail(previewFinding(), {});
    expect(screen.queryByTestId('report-issue-preview')).not.toBeInTheDocument();
  });

  it('swaps broken-link previews for the full targets and evidence', async () => {
    fetchLists.mockResolvedValue(
      fullLists({
        ruleId: 'broken-internal-links',
        affectedUrls: urls(2),
        brokenLinkTargets: ['https://example.com/gone-1', 'https://example.com/gone-2'],
        brokenLinkEvidence: [],
      }),
    );
    renderDetail(
      previewFinding({
        ruleId: 'broken-internal-links',
        affectedUrls: urls(2),
        affectedUrlCount: 2,
        brokenLinkTargets: ['https://example.com/gone-1'],
        brokenLinkTargetCount: 2,
      }),
    );
    expect(within(screen.getByTestId('report-broken-link-targets')).getAllByRole('link')).toHaveLength(1);
    await userEvent.click(screen.getByTestId('report-issue-load-all'));
    await waitFor(() =>
      expect(within(screen.getByTestId('report-broken-link-targets')).getAllByRole('link')).toHaveLength(2),
    );
  });

  it('replaces previewed broken-link evidence with every pair once loaded', async () => {
    const row = (index: number) => ({
      source: `https://example.com/s${index}`,
      target: `https://example.com/t${index}`,
      outcome: 'confirmed' as const,
      status: 404,
    });
    fetchLists.mockResolvedValue(
      fullLists({ ruleId: 'broken-internal-links', affectedUrls: urls(1), brokenLinkEvidence: [row(1), row(2), row(3)] }),
    );
    renderDetail(
      previewFinding({
        ruleId: 'broken-internal-links',
        affectedUrls: urls(1),
        affectedUrlCount: 1,
        brokenLinkEvidence: [row(1)],
        brokenLinkEvidenceTotal: 3,
      }),
    );
    expect(screen.getByTestId('report-broken-link-evidence')).toHaveTextContent('https://example.com/t1');
    expect(screen.getByTestId('report-broken-link-evidence')).not.toHaveTextContent('https://example.com/t3');
    await userEvent.click(screen.getByTestId('report-issue-load-all'));
    await waitFor(() =>
      expect(screen.getByTestId('report-broken-link-evidence')).toHaveTextContent('https://example.com/t3'),
    );
  });
});

describe('deep crawl evidence across the preview and the full lists', () => {
  it('shows the previewed rows first, then every row once the full lists load; the cut note waits for them', async () => {
    const all = urls(12);
    fetchLists.mockResolvedValue(
      fullLists({
        ruleId: 'deep-pages',
        affectedUrls: all,
        diff: [],
        evidence: { pages: all.map((url, index) => ({ url, clickDepth: 4 + index })) },
      }),
    );
    renderDetail(
      previewFinding({
        ruleId: 'deep-pages',
        affectedUrls: all.slice(0, 5),
        meta: { pages: all.slice(0, 5).map((url, index) => ({ url, clickDepth: 4 + index })), evidenceTruncated: 260 },
      }),
    );
    expect(screen.getAllByTestId('report-evidence-facts')).toHaveLength(5);
    expect(screen.queryByTestId('report-evidence-cut')).toBeNull();
    await userEvent.setup().click(screen.getByTestId('report-issue-load-all'));
    await waitFor(() => expect(screen.getAllByTestId('report-evidence-facts')).toHaveLength(12));
    expect(screen.getByText('Clicks from home: 15')).toBeInTheDocument();
    expect(screen.getByTestId('report-evidence-cut')).toHaveTextContent('Details shown for the first 12 of 260.');
  });

  it('a response without evidence keeps the preview rows', async () => {
    const all = urls(12);
    fetchLists.mockResolvedValue(fullLists({ ruleId: 'deep-pages', affectedUrls: all, diff: [] }));
    renderDetail(
      previewFinding({
        ruleId: 'deep-pages',
        affectedUrls: all.slice(0, 5),
        meta: { pages: [{ url: all[0], clickDepth: 7 }] },
      }),
    );
    await userEvent.setup().click(screen.getByTestId('report-issue-load-all'));
    await waitFor(() => expect(screen.getAllByRole('listitem').length).toBeGreaterThan(5));
    expect(screen.getAllByTestId('report-evidence-facts')).toHaveLength(1);
  });
});

describe('measured page lengths', () => {
  it('reads only well-formed measurements from a finding', () => {
    expect(readFindingMeasurements(undefined)).toEqual([]);
    expect(readFindingMeasurements({ measurements: 'nope' })).toEqual([]);
    expect(
      readFindingMeasurements({
        measurements: [
          { url: 'https://example.com/a', value: 40, unit: 'words' },
          { url: 'https://example.com/b', value: '1', unit: 'words' },
          { url: 'https://example.com/c', value: 1, unit: 'lines' },
          null,
        ],
      }),
    ).toEqual([{ url: 'https://example.com/a', value: 40, unit: 'words' }]);
  });

  it('shows the measured length next to each URL, and the full list brings the rest', async () => {
    const all = urls(7);
    fetchLists.mockResolvedValue(
      fullLists({
        ruleId: 'thin-content',
        affectedUrls: all,
        diff: [],
        measurements: all.map((url, index) => ({ url, value: 10 + index, unit: 'words' as const })),
      }),
    );
    renderDetail(
      previewFinding({
        ruleId: 'thin-content',
        affectedUrls: all.slice(0, 5),
        affectedUrlCount: 7,
        meta: { measurements: [{ url: all[0], value: 1, unit: 'words' }] },
      }),
    );
    expect(screen.getAllByTestId('report-issue-measurement')).toHaveLength(1);
    expect(screen.getByTestId('report-issue-measurement')).toHaveTextContent('1 word');
    await userEvent.click(screen.getByTestId('report-issue-load-all'));
    await waitFor(() => expect(screen.getAllByTestId('report-issue-measurement')).toHaveLength(7));
    expect(screen.getAllByTestId('report-issue-measurement')[6]).toHaveTextContent('16 words');
  });
});

describe('broken-link evidence download from a previewed finding', () => {
  const row = (index: number) => ({
    source: `https://example.com/s${index}`,
    target: `https://example.com/t${index}`,
    outcome: 'confirmed' as const,
    status: 404,
  });
  const cutFinding = () =>
    previewFinding({
      ruleId: 'broken-internal-links',
      affectedUrls: urls(1),
      affectedUrlCount: 1,
      brokenLinkEvidence: [row(1)],
      brokenLinkEvidenceTotal: 3,
    });

  it('loads every pair before it saves the file', async () => {
    fetchLists.mockResolvedValue(
      fullLists({ ruleId: 'broken-internal-links', affectedUrls: urls(1), brokenLinkEvidence: [row(1), row(2), row(3)] }),
    );
    renderDetail(cutFinding());
    await userEvent.click(within(screen.getByTestId('report-broken-link-evidence')).getByTestId('report-issue-download-urls'));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(await readBlob(saved[0]!.blob)).toContain('https://example.com/t3');
    expect(fetchLists).toHaveBeenCalledTimes(1);
  });

  it('saves nothing when the rest of the pairs cannot load', async () => {
    fetchLists.mockRejectedValue(new Error('offline'));
    renderDetail(cutFinding());
    await userEvent.click(within(screen.getByTestId('report-broken-link-evidence')).getByTestId('report-issue-download-urls'));
    expect(await screen.findByTestId('report-issue-load-all-error')).toBeInTheDocument();
    expect(saved).toHaveLength(0);
  });

  it('saves the pairs it holds when there is no run to load more from', async () => {
    renderDetail(cutFinding(), {});
    await userEvent.click(within(screen.getByTestId('report-broken-link-evidence')).getByTestId('report-issue-download-urls'));
    await waitFor(() => expect(saved).toHaveLength(1));
    expect(fetchLists).not.toHaveBeenCalled();
  });
});
