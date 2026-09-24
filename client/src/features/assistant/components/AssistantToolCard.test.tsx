import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { changeLanguage, initI18n } from '@shared/i18n';
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

  it('uses a text-node key/value fallback and reports failed tool codes', async () => {
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
        { ok: false, errorCode: 'tool_failed' },
      ),
    );
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('tool_failed')).toBeInTheDocument();
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
});
