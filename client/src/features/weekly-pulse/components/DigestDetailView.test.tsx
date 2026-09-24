import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import { initI18n } from '@shared/i18n';
import { DigestDetailView } from './DigestDetailView';
import type { DigestProjectionPayload } from '../types';

function payload(overrides: Partial<DigestProjectionPayload> = {}): DigestProjectionPayload {
  return {
    header: {
      siteId: 's1',
      siteLabel: 'Example',
      isoWeek: '2026-W01',
      market: null,
      renderedAt: '2026-01-05T09:00:00Z',
    },
    coverage: {
      supported: 2,
      total: 3,
      supportedCells: [],
      partial: true,
    },
    citations_new: [],
    citations_lost: [],
    citations_unknown_partial: [],
    confirmed_rank_drops: [],
    actions_completed: [],
    actions_regressed: [],
    next_actions_top3: [],
    gsc_appearance: { status: 'unavailable', window: null, rows: [] },
    deep_links: {
      digest: '/x',
      aiVisibility: '/x',
      google: '/x',
      contentIntelligence: '/x',
      audienceResearch: '/x',
      nextActions: '/x',
    },
    ...overrides,
  };
}

async function withI18n(children: React.ReactElement) {
  const i18n = initI18n({ initialLocale: 'en' });
  return <I18nextProvider i18n={i18n}>{children}</I18nextProvider>;
}

describe('DigestDetailView', () => {
  it('renders the header with iso week + coverage summary', async () => {
    render(await withI18n(<DigestDetailView projection={payload()} />));
    expect(screen.getByText(/Weekly pulse digest — 2026-W01/)).toBeInTheDocument();
    expect(
      screen.getByText(/Coverage — 2 of 3 engines supported/i),
    ).toBeInTheDocument();
  });

  it('renders empty states for all-empty sections', async () => {
    render(await withI18n(<DigestDetailView projection={payload()} />));
    expect(screen.getByText(/No new citations/i)).toBeInTheDocument();
    expect(screen.getByText(/No lost citations/i)).toBeInTheDocument();
    expect(screen.getByText(/No unknown or partial citations/i)).toBeInTheDocument();
    expect(screen.getByText(/No confirmed rank drops/i)).toBeInTheDocument();
    expect(screen.getByText(/No action state changes/i)).toBeInTheDocument();
    expect(screen.getByText(/up to date/i)).toBeInTheDocument();
  });

  it('renders each new/lost/unknown citation entry', async () => {
    render(
      await withI18n(
        <DigestDetailView
          projection={payload({
            citations_new: [
              {
                citationId: 'c1',
                engine: 'chatgpt',
                surface: 'mentions',
                host: 'a.example',
                canonicalUrl: 'https://a.example',
                titleSafe: null,
              },
            ],
            citations_lost: [
              {
                citationId: 'c2',
                engine: 'perplexity',
                surface: 'mentions',
                host: 'b.example',
                canonicalUrl: 'https://b.example',
                titleSafe: null,
              },
            ],
            citations_unknown_partial: [
              {
                citationId: null,
                engine: 'gemini',
                surface: 'mentions',
                host: 'c.example',
                canonicalUrl: 'https://c.example',
                titleSafe: null,
              },
            ],
          })}
        />,
      ),
    );
    expect(screen.getByText(/a\.example/)).toBeInTheDocument();
    expect(screen.getByText(/b\.example/)).toBeInTheDocument();
    expect(screen.getByText(/c\.example/)).toBeInTheDocument();
  });

  it('omits the partial-coverage note when coverage is complete', async () => {
    render(
      await withI18n(
        <DigestDetailView
          projection={payload({
            coverage: { supported: 3, total: 3, supportedCells: [], partial: false },
          })}
        />,
      ),
    );
    expect(
      screen.queryByText(/Some engines returned partial data/i),
    ).not.toBeInTheDocument();
  });

  it('renders rank drops', async () => {
    render(
      await withI18n(
        <DigestDetailView
          projection={payload({
            confirmed_rank_drops: [
              {
                keyword: 'foo',
                priorRank: 3,
                currentRank: 8,
                confirmedAt: '2026-01-03T00:00:00Z',
              },
            ],
          })}
        />,
      ),
    );
    expect(screen.getByText(/foo — 3 → 8/)).toBeInTheDocument();
  });

  it('renders rank drops with unknown prior/current ranks as placeholders', async () => {
    render(
      await withI18n(
        <DigestDetailView
          projection={payload({
            confirmed_rank_drops: [
              {
                keyword: 'bar',
                priorRank: null,
                currentRank: null,
                confirmedAt: '2026-01-03T00:00:00Z',
              },
            ],
          })}
        />,
      ),
    );
    expect(screen.getByText(/bar — \? → \?/)).toBeInTheDocument();
  });

  it('renders action transitions', async () => {
    render(
      await withI18n(
        <DigestDetailView
          projection={payload({
            actions_completed: [
              { actionId: 'a1', messageKey: 'weeklyPulse.actions.completed', targetUrl: null, targetMessageKey: 'weeklyPulse.actions.targetUnavailable', verb: 'add', target: 'sitemap', state: 'completed' },
            ],
            actions_regressed: [
              { actionId: 'a2', messageKey: 'weeklyPulse.actions.regressed', targetUrl: null, targetMessageKey: 'weeklyPulse.actions.targetUnavailable', verb: 'restore', target: 'canonical', state: 'regressed' },
            ],
            next_actions_top3: [
              { actionId: 'a3', messageKey: 'weeklyPulse.actions.open', targetUrl: null, targetMessageKey: 'weeklyPulse.actions.targetUnavailable', verb: 'fix', target: 'meta', state: 'open' },
            ],
          })}
        />,
      ),
    );
    expect(screen.getByText(/add sitemap/)).toBeInTheDocument();
    expect(screen.getByText(/restore canonical/)).toBeInTheDocument();
    expect(screen.getByText(/fix meta/)).toBeInTheDocument();
  });

  it('renders the GSC generative section (available)', async () => {
    render(
      await withI18n(
        <DigestDetailView
          projection={payload({
            gsc_appearance: {
              status: 'available',
              window: { start: '2025-12-01', end: '2026-01-04' },
              rows: [
                {
                  rawAppearance: 'AI_OVERVIEW',
                  classificationSlug: 'ai_overviews',
                  isGenerative: true,
                  clicks: 5,
                  impressions: 120,
                  ctr: 0.04,
                  position: 4,
                },
              ],
            },
          })}
        />,
      ),
    );
    expect(screen.getByText(/AI_OVERVIEW/)).toBeInTheDocument();
  });

  it('renders the GSC generative section (reconnect_required)', async () => {
    render(
      await withI18n(
        <DigestDetailView
          projection={payload({
            gsc_appearance: {
              status: 'reconnect_required',
              window: null,
              rows: [],
            },
          })}
        />,
      ),
    );
    expect(screen.getByText(/Reconnect Google Search Console/i)).toBeInTheDocument();
  });

  it('renders the GSC generative section (partial)', async () => {
    render(
      await withI18n(
        <DigestDetailView
          projection={payload({
            gsc_appearance: { status: 'partial', window: null, rows: [] },
          })}
        />,
      ),
    );
    expect(screen.getAllByText(/partial data/i).length).toBeGreaterThan(0);
  });

  it('close button calls onClose', async () => {
    const onClose = vi.fn();
    render(await withI18n(<DigestDetailView projection={payload()} onClose={onClose} />));
    const user = userEvent.setup();
    await user.click(screen.getByTestId('digest-detail-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('DigestDetailView — Brand Radar deltas', () => {
  it('renders the account-scope note and the honest empty state', async () => {
    render(await withI18n(<DigestDetailView projection={payload()} />));
    expect(
      screen.getByText(/These changes cover your whole account/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/No brand scans to compare yet/i)).toBeInTheDocument();
    expect(screen.queryByTestId('digest-brand-deltas')).not.toBeInTheDocument();
  });

  it('renders the delta line with signed mention and sentiment values', async () => {
    render(
      await withI18n(
        <DigestDetailView
          projection={payload({
            brand_deltas: [
              {
                queryHash: 'a'.repeat(64),
                brandQuerySafe: 'acme crm',
                currentScanId: 'scan-2',
                previousScanId: 'scan-1',
                hasNewScan: true,
                newMentionCount: 4,
                sentimentShift: { positive: 5, neutral: -2, negative: -3, unknown: 0 },
              },
            ],
          })}
        />,
      ),
    );
    expect(screen.getByTestId('digest-brand-deltas')).toBeInTheDocument();
    expect(screen.getByText(/acme crm — mentions \+4/)).toBeInTheDocument();
    expect(
      screen.getByText(/positive \+5, neutral -2, negative -3, unknown 0/),
    ).toBeInTheDocument();
  });

  it('renders the first-scan line instead of a fabricated zero', async () => {
    render(
      await withI18n(
        <DigestDetailView
          projection={payload({
            brand_deltas: [
              {
                queryHash: 'a'.repeat(64),
                brandQuerySafe: 'acme crm',
                currentScanId: 'scan-1',
                previousScanId: null,
                hasNewScan: true,
                newMentionCount: null,
                sentimentShift: null,
              },
            ],
          })}
        />,
      ),
    );
    expect(
      screen.getByText(/acme crm — first scan, nothing to compare yet/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/mentions \+0/)).not.toBeInTheDocument();
  });

  it('renders the first-scan line when only the sentiment shift is missing', async () => {
    render(
      await withI18n(
        <DigestDetailView
          projection={payload({
            brand_deltas: [
              {
                queryHash: 'a'.repeat(64),
                brandQuerySafe: 'acme crm',
                currentScanId: 'scan-2',
                previousScanId: 'scan-1',
                hasNewScan: true,
                newMentionCount: 2,
                sentimentShift: null,
              },
            ],
          })}
        />,
      ),
    );
    expect(
      screen.getByText(/acme crm — first scan, nothing to compare yet/),
    ).toBeInTheDocument();
  });

  it('renders the no-new-scan line for a query with no settled scan this period', async () => {
    render(
      await withI18n(
        <DigestDetailView
          projection={payload({
            brand_deltas: [
              {
                queryHash: 'a'.repeat(64),
                brandQuerySafe: 'acme crm',
                currentScanId: 'scan-1',
                previousScanId: null,
                hasNewScan: false,
                newMentionCount: null,
                sentimentShift: null,
              },
            ],
          })}
        />,
      ),
    );
    expect(
      screen.getByText(/acme crm — no new scan this period/),
    ).toBeInTheDocument();
  });

  it('keeps a hostile brand query inert as a text node', async () => {
    render(
      await withI18n(
        <DigestDetailView
          projection={payload({
            brand_deltas: [
              {
                queryHash: 'a'.repeat(64),
                brandQuerySafe: '<img src=x onerror=alert(1)>',
                currentScanId: 'scan-2',
                previousScanId: 'scan-1',
                hasNewScan: true,
                newMentionCount: -1,
                sentimentShift: { positive: 0, neutral: 0, negative: 0, unknown: 0 },
              },
            ],
          })}
        />,
      ),
    );
    const list = screen.getByTestId('digest-brand-deltas');
    expect(list.querySelector('img')).toBeNull();
    expect(list.textContent).toContain('<img src=x onerror=alert(1)> — mentions -1');
  });
});
