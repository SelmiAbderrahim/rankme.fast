import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import * as api from './api';
import { backlinksReducer, BacklinksPanel } from './index';
import { referringHostOf, serializeSuspectedDisavow, safeDisavowDomain } from './disavow';
import type { BacklinkList, BacklinkRow } from './types';

const saved = vi.hoisted(() => ({ blobs: [] as Array<{ blob: Blob; name: string }> }));

vi.mock('@features/report-export', () => ({
  saveBlobAs: (blob: Blob, name: string) => saved.blobs.push({ blob, name }),
}));
vi.mock('./api', () => ({
  fetchBacklinkSummary: vi.fn(),
  fetchBacklinksList: vi.fn(),
  refreshBacklinkSummary: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { error: vi.fn() } }));

const mocked = vi.mocked(api);

const readBlob = (blob: Blob): Promise<string> =>
  new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });

const row = (overrides: Partial<BacklinkRow>): BacklinkRow => ({
  urlFrom: 'https://blog.example.net/best-tools',
  urlTo: 'https://example.com/',
  anchor: 'example tool',
  dofollow: true,
  isBroken: false,
  firstSeen: null,
  lastSeen: null,
  suspicion: null,
  ...overrides,
});

const list = (rows: BacklinkRow[]): BacklinkList => ({ rows, nextCursor: null, cached: false });

const flagged = (url: string, reasons: NonNullable<BacklinkRow['suspicion']>['reasons'], extra: Partial<BacklinkRow> = {}) =>
  row({ urlFrom: url, suspicion: { status: 'suspected', verified: false, reasons }, ...extra });

const renderPanel = async (rows: BacklinkRow[]) => {
  mocked.fetchBacklinksList.mockResolvedValue(list(rows));
  mocked.fetchBacklinkSummary.mockRejectedValue(new Error('no summary'));
  const store = configureStore({ reducer: { backlinks: backlinksReducer } });
  render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <BacklinksPanel siteId="abc" view="rows" />
        </MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );
  await screen.findByTestId('backlinks-table');
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
  saved.blobs.length = 0;
});

describe('suspected-spam review', () => {
  it('shows no review controls when nothing is flagged', async () => {
    await renderPanel([row({})]);
    expect(screen.queryByTestId('backlinks-suspicion-toolbar')).toBeNull();
    expect(screen.queryByTestId('backlinks-suspicion-0')).toBeNull();
  });

  it('labels a flagged link with its reasons and says it is not verified', async () => {
    await renderPanel([
      flagged('https://shop-officialsites.us/list/2026-07-24-247', ['dated_numbered_path', 'lookalike_domain']),
      row({ urlFrom: 'https://news.example.org/x' }),
    ]);
    const cell = screen.getByTestId('backlinks-suspicion-0');
    expect(within(cell).getByText('Suspected spam')).toBeInTheDocument();
    expect(within(cell).getByText(/ends in a date and a running number/)).toBeInTheDocument();
    expect(within(cell).getByText(/reads like a store or brand copy/)).toBeInTheDocument();
    expect(within(cell).getByText('Suspected, not verified. Review it before you act.')).toBeInTheDocument();
    expect(screen.queryByTestId('backlinks-suspicion-1')).toBeNull();
    expect(screen.getByTestId('backlinks-suspicion-toolbar')).toHaveTextContent('Links flagged for review: 1');
  });

  it('exports only the flagged domains the person selected, as a commented disavow file', async () => {
    const user = userEvent.setup();
    await renderPanel([
      flagged('https://www.bad-one.example/p/1', ['vendor_spam_score']),
      flagged('https://bad-two.example/p/2', ['vendor_spam_score'], { domainFrom: 'bad-two.example' }),
    ]);
    const download = screen.getByTestId('backlinks-disavow-download');
    expect(download).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'Select bad-one.example for the disavow file' }));
    expect(screen.getByTestId('backlinks-suspicion-selected')).toHaveTextContent('Selected for the file: 1');
    await user.click(download);
    expect(saved.blobs).toHaveLength(1);
    expect(saved.blobs[0]!.name).toBe('disavow.txt');
    const text = await readBlob(saved.blobs[0]!.blob);
    expect(text).toContain('domain:bad-one.example');
    expect(text).not.toContain('bad-two.example');
    expect(text).toContain('Suspected, not verified');

    await user.click(screen.getByTestId('backlinks-suspicion-select-all'));
    expect(screen.getByTestId('backlinks-suspicion-selected')).toHaveTextContent('Selected for the file: 2');
    await user.click(screen.getByTestId('backlinks-suspicion-clear'));
    expect(screen.getByTestId('backlinks-suspicion-selected')).toHaveTextContent('Selected for the file: 0');
    await user.click(screen.getByRole('checkbox', { name: 'Select bad-one.example for the disavow file' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select bad-one.example for the disavow file' }));
    await waitFor(() => expect(screen.getByTestId('backlinks-disavow-download')).toBeDisabled());
  });
});

describe('suspected-spam disavow helpers', () => {
  it('uses the reported host or the link host, without www.', () => {
    expect(referringHostOf({ domainFrom: 'www.a.example', urlFrom: 'https://b.example/x' })).toBe('a.example');
    expect(referringHostOf({ urlFrom: 'https://www.b.example/x' })).toBe('b.example');
    expect(referringHostOf({ domainFrom: '', urlFrom: 'https://c.example/x' })).toBe('c.example');
  });

  it('writes sorted, de-duplicated domain lines and drops anything that is not a plain hostname', () => {
    const text = serializeSuspectedDisavow(
      ['z.example', 'a.example', 'a.example', '=cmd.example', 'bad host.example', 'nodots', 'evil\nline.example'],
      new Date('2026-07-24T10:00:00.000Z'),
    );
    expect(text.split('\n')).toEqual([
      '# RankMeFast suspected-spam review export',
      '# Suspected, not verified: check every domain before you submit this file to Google.',
      '# heuristic: link-suspicion-v1',
      '# generated: 2026-07-24',
      'domain:a.example',
      'domain:z.example',
      '',
    ]);
    expect(safeDisavowDomain('Example.com.')).toBe('example.com');
  });
});
