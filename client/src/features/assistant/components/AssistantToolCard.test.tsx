import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { stubViewerTimeZone } from '@/test/timeZone';
import type { ChatMessagePart } from '../types';
import { AssistantToolCard } from './AssistantToolCard';

type Call = Extract<ChatMessagePart, { type: 'tool_call' }>;
type Result = Extract<ChatMessagePart, { type: 'tool_result' }>;

const call = (toolName: string, args: unknown = {}): Call => ({
  type: 'tool_call',
  toolCallId: `call-${toolName}`,
  toolName,
  args,
});

const result = (
  toolName: string,
  structuredContent: Record<string, unknown>,
  overrides: Partial<Result> = {},
): Result => ({
  type: 'tool_result',
  toolCallId: `call-${toolName}`,
  toolName,
  ok: true,
  structuredContent,
  ...overrides,
});

async function renderOpen(toolCall: Call, toolResult?: Result) {
  render(<AssistantToolCard call={toolCall} result={toolResult} />);
  await userEvent.click(screen.getByRole('button'));
}

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
});

describe('AssistantToolCard', () => {
  it('renders pending known and unknown tools with text-only arguments', async () => {
    await renderOpen(call('start_audit', { siteId: '<script>bad()</script>' }));
    expect(screen.getByText('Start audit')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Waiting for the tool result…')).toBeInTheDocument();
    expect(screen.getByText(/<script>bad\(\)<\/script>/)).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();

    cleanup();
    await renderOpen(call('custom_tool', null));
    expect(screen.getByText('custom_tool')).toBeInTheDocument();
    expect(screen.getByText('Not available')).toBeInTheDocument();
  });

  it('renders rank history as an accessible table, including missing and invalid points', async () => {
    await renderOpen(
      call('get_rank_history'),
      result('get_rank_history', {
        keywords: [
          {
            phrase: 'rank me',
            series: [
              { checkedAt: '2026-08-01T00:00:00.000Z', position: 4 },
              { checkedAt: 'bad-date', position: null },
              { checkedAt: 7, position: Number.NaN },
              null,
            ],
          },
          { phrase: 'empty keyword', series: [] },
          { phrase: 12, series: [] },
        ],
      }),
    );
    expect(screen.getByRole('columnheader', { name: 'Keyword' })).toBeInTheDocument();
    expect(screen.getAllByText('rank me')).toHaveLength(3);
    expect(screen.getByText('bad-date')).toBeInTheDocument();
    expect(screen.getAllByText('Not ranked').length).toBeGreaterThan(1);
    expect(screen.getByText('empty keyword')).toBeInTheDocument();
  });

  it('shows each check\'s position change with the shared PositionDelta (production QA 3, F-AE)', async () => {
    await renderOpen(
      call('get_rank_history'),
      result('get_rank_history', {
        keywords: [
          {
            phrase: 'moving keyword',
            series: [
              { checkedAt: '2026-08-01', position: 9 },
              { checkedAt: '2026-08-08', position: 4 },
              { checkedAt: '2026-08-15', position: 4 },
              { checkedAt: '2026-08-22', position: 15 },
              { checkedAt: '2026-08-29', position: null },
              { checkedAt: '2026-09-05', position: null },
              { checkedAt: '2026-09-12', position: 30 },
            ],
          },
        ],
      }),
    );
    expect(screen.getByRole('columnheader', { name: /Change/ })).toBeInTheDocument();
    const directions = Array.from(document.querySelectorAll('[data-slot="position-delta"]'))
      .map((node) => node.getAttribute('data-direction'));
    expect(directions).toEqual(['new', 'improved', 'unchanged', 'declined', 'dropped', 'unranked', 'entered']);
    expect(screen.getByText('Improved by 5 positions')).toBeInTheDocument();
    expect(screen.getByText('Declined by 11 positions')).toBeInTheDocument();
  });

  it('handles empty and malformed rank-history payloads', async () => {
    await renderOpen(call('get_rank_history'), result('get_rank_history', { keywords: [] }));
    expect(screen.getByText('The tool returned no rows.')).toBeInTheDocument();

    cleanup();
    await renderOpen(call('get_rank_history'), result('get_rank_history', { keywords: 'bad' }));
    expect(screen.getByText('keywords')).toBeInTheDocument();
    expect(screen.getByText('bad')).toBeInTheDocument();
  });

  it('derives an audit score and renders top findings', async () => {
    await renderOpen(
      call('get_latest_audit_report'),
      result('get_latest_audit_report', {
        report: {
          counts: { fixNow: 1, watch: 1, passed: 2 },
          findings: [
            { copy: { title: 'Add a title.' } },
            { copy: { title: 'Repair broken links.' } },
            { copy: { title: 'Improve contrast.' } },
            { copy: { title: 'Fourth is clipped.' } },
            { copy: {} },
            { copy: 'invalid' },
            null,
          ],
        },
      }),
    );
    expect(screen.getByText('50/100')).toBeInTheDocument();
    // The fix-now count names its severity, like every other bucket label.
    expect(screen.getByText('Fix now')).toBeInTheDocument();
    expect(screen.getByText('Add a title.')).toBeInTheDocument();
    expect(screen.queryByText('Fourth is clipped.')).not.toBeInTheDocument();
  });

  it('handles empty and malformed audit summaries', async () => {
    await renderOpen(
      call('get_latest_audit_report'),
      result('get_latest_audit_report', {
        report: { counts: { fixNow: 'bad', watch: null, passed: false }, findings: [] },
      }),
    );
    expect(screen.getByText('0/100')).toBeInTheDocument();
    expect(screen.getByText('No findings were returned.')).toBeInTheDocument();

    cleanup();
    await renderOpen(
      call('get_latest_audit_report'),
      result('get_latest_audit_report', {
        report: { counts: { fixNow: 0, watch: 0, passed: 1 } },
      }),
    );
    expect(screen.getByText('No findings were returned.')).toBeInTheDocument();

    cleanup();
    await renderOpen(
      call('get_latest_audit_report'),
      result('get_latest_audit_report', { report: null }),
    );
    expect(screen.getByText('report')).toBeInTheDocument();
  });

  it('renders keyword and site lists as compact tables', async () => {
    await renderOpen(
      call('list_keywords'),
      result('list_keywords', {
        keywords: [
          { id: 'k1', phrase: 'seo audit' },
          { phrase: 'missing id' },
          { id: 'bad', phrase: 3 },
        ],
      }),
    );
    expect(screen.getByText('seo audit')).toBeInTheDocument();
    expect(screen.getByText('k1')).toBeInTheDocument();
    expect(screen.getByText('missing id')).toBeInTheDocument();
    expect(screen.getByText('Not available')).toBeInTheDocument();

    cleanup();
    await renderOpen(
      call('list_sites'),
      result('list_sites', {
        sites: [
          { id: 's1', domain: 'example.com', url: 'https://example.com' },
          { domain: 'no-url.example' },
          { domain: 9 },
        ],
      }),
    );
    expect(screen.getByText('example.com')).toBeInTheDocument();
    expect(screen.getByText('https://example.com')).toBeInTheDocument();
    expect(screen.getByText('no-url.example')).toBeInTheDocument();
  });

  it('handles empty and malformed keyword and site lists', async () => {
    await renderOpen(call('list_keywords'), result('list_keywords', { keywords: [] }));
    expect(screen.getByText('The tool returned no rows.')).toBeInTheDocument();

    cleanup();
    await renderOpen(call('list_keywords'), result('list_keywords', { keywords: null }));
    expect(screen.getByText('keywords')).toBeInTheDocument();

    cleanup();
    await renderOpen(call('list_sites'), result('list_sites', { sites: [] }));
    expect(screen.getByText('The tool returned no rows.')).toBeInTheDocument();

    cleanup();
    await renderOpen(call('list_sites'), result('list_sites', { sites: 'bad' }));
    expect(screen.getByText('sites')).toBeInTheDocument();
  });

  it('uses a text-node key/value fallback for structured results', async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await renderOpen(
      call('get_content_analysis', undefined),
      result(
        'get_content_analysis',
        {
          html: '<img src=x onerror=alert(1)>',
          count: 2,
          ready: false,
          nothing: null,
          cyclic,
        },
      ),
    );
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(screen.getAllByText('Not available')).toHaveLength(2);
    expect(document.querySelector('img')).toBeNull();

    cleanup();
    await renderOpen(
      call('get_audit_status'),
      result('get_audit_status', {}),
    );
    expect(screen.getByText('The tool returned no rows.')).toBeInTheDocument();
  });

  it('renders stored-data reads with status, explicit scope, a row table, and text-only values', async () => {
    await renderOpen(
      call('get_gsc_search_summary', { siteId: 'site-1', range: '28d' }),
      result('get_gsc_search_summary', {
        status: 'ok',
        truncated: true,
        locale: 'en',
        source: 'search_console',
        range: '28d',
        startDate: '2026-09-03',
        endDate: '2026-09-30',
        asOf: '2026-09-30',
        timezone: 'America/Los_Angeles',
        totals: { clicks: 376, impressions: 5000 },
        emptyList: [],
        topQueries: [
          { query: '<img src=x onerror=alert(1)>', clicks: 90, impressions: 900, ctr: 0.1, position: 4, extra: { nested: 1 }, a: 1, b: 2 },
          { query: 'seo audit', clicks: 80, impressions: 800, ctr: 0.1, position: 5, extra: null, a: 1, b: 2 },
        ],
      }),
    );
    expect(screen.getByText('Get Search Console summary')).toBeInTheDocument();
    expect(screen.getByText('Stored data')).toBeInTheDocument();
    expect(screen.getByText('search_console')).toBeInTheDocument();
    expect(screen.getByText('28d')).toBeInTheDocument();
    expect(screen.getByText('Sep 3, 2026 \u2013 Sep 30, 2026')).toBeInTheDocument();
    expect(screen.getByText('Sep 30, 2026')).toBeInTheDocument();
    expect(screen.getByText('America/Los_Angeles')).toBeInTheDocument();
    expect(screen.getByText('{"clicks":376,"impressions":5000}')).toBeInTheDocument();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
    expect(screen.getByText('Only the first rows are shown.')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.queryByText('emptyList')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
  });

  it('shows a localized marker for empty and unavailable stored reads without a table', async () => {
    await renderOpen(
      call('list_pages', {}),
      result('list_pages', { status: 'empty', reason: 'noCrawl', message: 'No crawl yet.', locale: 'en' }),
    );
    expect(screen.getByText('Nothing stored')).toBeInTheDocument();
    cleanup();
    await renderOpen(
      call('list_backlinks', {}),
      result('list_backlinks', { status: 'unavailable', message: 'Gone.' }),
    );
    expect(screen.getByText('Unavailable')).toBeInTheDocument();
    expect(screen.queryByText('status')).toBeNull();
  });

  it('falls back to the key/value list when a stored-read payload has no status', async () => {
    await renderOpen(
      call('list_competitors', {}),
      result('list_competitors', { counts: { active: 1 } }),
    );
    expect(screen.getByText('counts')).toBeInTheDocument();
    expect(screen.queryByText('Stored data')).toBeNull();
  });
});

describe('AssistantToolCard — stored-read dates (QA round 2, T6)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(['en', 'ar', 'de'] as const)(
    'formats the stored period and as-of day for %s, even west of UTC',
    async (locale) => {
      const day = (month: number, date: number) =>
        new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
          Date.UTC(2026, month - 1, date),
        );
      stubViewerTimeZone('America/Los_Angeles');
      await changeLanguage(locale);
      await renderOpen(
        call('get_gsc_search_summary', { siteId: 'site-1', range: '28d' }),
        result('get_gsc_search_summary', {
          status: 'ok',
          startDate: '2026-09-03',
          endDate: '2026-09-30',
          asOf: '2026-09-30',
        }),
      );
      expect(screen.getByText(`${day(9, 3)} \u2013 ${day(9, 30)}`)).toBeInTheDocument();
      expect(
        screen.getByText(i18n.t('assistant:results.scopeAsOf')).nextElementSibling,
      ).toHaveTextContent(day(9, 30));
      expect(document.body).not.toHaveTextContent('2026-09-30');
      await changeLanguage('en');
    },
  );

  describe('QA 03: a failed step explains itself and never shows raw JSON', () => {
    const failed = (errorCode?: string) =>
      result(
        'list_actions',
        { error: { code: errorCode ?? 'x' }, html: '<img src=x onerror=alert(1)>', secretish: 'sk-123' },
        { ok: false, ...(errorCode ? { errorCode } : {}) },
      );

    it.each([
      ['mcp.errors.forbiddenOutput', "This step's result was withheld"],
      ['mcp.errors.invalidInput', "This step couldn't run because the request was not valid."],
      ['sites.errors.notFound', "The site for this step isn't available"],
      ['common.internalError', 'Something went wrong on our side'],
      ['totally.unknown.code', "This step couldn't be completed."],
    ])('maps %s to plain language', async (code, text) => {
      await renderOpen(call('list_actions'), failed(code));
      const box = screen.getByTestId('assistant-tool-failure');
      expect(box).toHaveTextContent(text);
      expect(box).toHaveAttribute('data-error-code', code);
      // Neither the code nor the structured payload reaches the screen.
      expect(screen.queryByText(code)).toBeNull();
      expect(document.body.textContent).not.toContain('onerror');
      expect(document.body.textContent).not.toContain('sk-123');
      expect(document.querySelector('img')).toBeNull();
    });

    it('treats a missing code as a generic failure and an inherited name as unknown', async () => {
      await renderOpen(call('list_actions'), failed());
      expect(screen.getByTestId('assistant-tool-failure')).toHaveAttribute('data-error-code', 'unknown');
      expect(screen.getByTestId('assistant-tool-failure')).toHaveTextContent("This step couldn't be completed.");
      cleanup();
      await renderOpen(call('list_actions'), failed('constructor'));
      expect(screen.getByTestId('assistant-tool-failure')).toHaveTextContent("This step couldn't be completed.");
    });

    it('offers one retry when the host provides it, and disables it while busy', async () => {
      const onRetry = vi.fn();
      const { rerender } = render(
        <AssistantToolCard call={call('list_actions')} result={failed('mcp.errors.forbiddenOutput')} onRetry={onRetry} />,
      );
      await userEvent.click(screen.getByRole('button', { name: /list_actions|Failed/ }));
      await userEvent.click(screen.getByRole('button', { name: 'Ask again' }));
      expect(onRetry).toHaveBeenCalledTimes(1);
      rerender(
        <AssistantToolCard call={call('list_actions')} result={failed('mcp.errors.forbiddenOutput')} onRetry={onRetry} retryDisabled />,
      );
      expect(screen.getByRole('button', { name: 'Ask again' })).toBeDisabled();
    });

    it('shows no retry without a host handler', async () => {
      await renderOpen(call('list_actions'), failed('mcp.errors.forbiddenOutput'));
      expect(screen.queryByRole('button', { name: 'Ask again' })).toBeNull();
    });
  });
});
