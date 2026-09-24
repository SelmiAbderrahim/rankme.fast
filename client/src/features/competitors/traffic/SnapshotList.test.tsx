import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { maliciousTrafficDetail } from './__fixtures__/xss';
import { readTrafficFilters, SnapshotList } from './components/SnapshotList';
import type { TrafficSnapshotListResponse } from './types';

const data = (nextCursor: string | null = 'next+cursor='): TrafficSnapshotListResponse => ({
  snapshots: [
    {
      id: maliciousTrafficDetail.id,
      siteId: null,
      targetDomain: maliciousTrafficDetail.targetDomain,
      capturedAt: maliciousTrafficDetail.snapshot!.capturedAt,
      payload: maliciousTrafficDetail.snapshot!.payload,
    },
  ],
  nextCursor,
});

let search = '';
const LocationProbe = () => {
  search = useLocation().search;
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate(-1)}>History back</button>
      <button type="button" onClick={() => navigate(1)}>History forward</button>
    </>
  );
};

const renderList = (
  props: Partial<React.ComponentProps<typeof SnapshotList>> = {},
  entry = '/sites/site-1?tab=traffic',
) => {
  const onOpen = vi.fn();
  return {
    onOpen,
    ...render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[entry]}>
          <SnapshotList data={data()} status="succeeded" onOpen={onOpen} {...props} />
          <LocationProbe />
        </MemoryRouter>
      </I18nextProvider>,
    ),
  };
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  search = '';
});

describe('SnapshotList URL-backed filters', () => {
  it('round-trips domain/from/to/cursor and preserves the workspace tab', async () => {
    renderList({}, '/sites/site-1?tab=traffic&domain=old.example&from=2026-01-01&to=2026-07-01');
    const user = userEvent.setup();
    const domain = screen.getByRole('textbox', { name: 'Filter by domain' });
    await user.clear(domain);
    await user.type(domain, 'new.example');
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '2026-02-01' } });
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '2026-08-01' } });
    await waitFor(() => {
      const params = new URLSearchParams(search);
      expect(params.get('tab')).toBe('traffic');
      expect(params.get('domain')).toBe('new.example');
      expect(params.get('from')).toBe('2026-02-01');
      expect(params.get('to')).toBe('2026-08-01');
    });

    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(new URLSearchParams(search).get('cursor')).toBe('next+cursor='));
    await user.click(screen.getByRole('button', { name: 'Previous' }));
    await waitFor(() => expect(new URLSearchParams(search).has('cursor')).toBe(false));
  });

  it('opens a snapshot with keyboard-only navigation', async () => {
    const { onOpen } = renderList({ data: data(null) });
    const open = screen.getByRole('button', { name: 'Open snapshot' });
    open.focus();
    await userEvent.keyboard('{Enter}');
    expect(onOpen).toHaveBeenCalledWith(maliciousTrafficDetail.id);
    expect(screen.getByText(maliciousTrafficDetail.targetDomain)).toBeInTheDocument();
  });

  it('restores filter values through browser back and forward navigation', async () => {
    renderList({}, '/sites/site-1?tab=traffic&domain=old.example');
    const domain = screen.getByRole('textbox', { name: 'Filter by domain' });
    fireEvent.change(domain, { target: { value: 'new.example' } });
    await waitFor(() => expect(domain).toHaveValue('new.example'));

    await userEvent.click(screen.getByRole('button', { name: 'History back' }));
    await waitFor(() => expect(domain).toHaveValue('old.example'));

    await userEvent.click(screen.getByRole('button', { name: 'History forward' }));
    await waitFor(() => expect(domain).toHaveValue('new.example'));
  });

  it('renders loading, error, and localized empty CTA states', async () => {
    const loading = renderList({ data: null, status: 'loading' });
    expect(loading.container.querySelector('[data-slot="skeleton"]')).toBeInTheDocument();
    loading.unmount();

    const error = renderList({ data: null, status: 'failed', error: 'list broke' });
    expect(screen.getByRole('alert')).toHaveTextContent('list broke');
    error.unmount();

    renderList({ data: { snapshots: [], nextCursor: null }, status: 'succeeded' });
    expect(screen.getByTestId('traffic-list-empty')).toHaveTextContent('No traffic snapshots yet');
    await userEvent.click(screen.getByRole('button', { name: 'Start with a domain' }));
    expect(screen.getByRole('textbox', { name: 'Filter by domain' })).toHaveFocus();
  });

  it('handles clearing every filter and parses empty/full parameter sets', async () => {
    expect(readTrafficFilters(new URLSearchParams())).toEqual({});
    expect(
      readTrafficFilters(
        new URLSearchParams(
          'domain=A.TEST&from=2026-01-01&to=2026-02-01&cursor=c',
        ),
      ),
    ).toEqual({
      domain: 'a.test',
      from: '2026-01-01',
      to: '2026-02-01',
      cursor: 'c',
    });
    renderList({}, '/sites/site-1?tab=traffic&domain=a.test&from=2026-01-01&to=2026-02-01&cursor=c');
    const user = userEvent.setup();
    await user.clear(screen.getByRole('textbox', { name: 'Filter by domain' }));
    fireEvent.change(screen.getByLabelText('From date'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('To date'), { target: { value: '' } });
    await waitFor(() => expect(search).toBe('?tab=traffic'));
  });

  it('normalizes invalid filters with replace while preserving unrelated params', async () => {
    renderList(
      {},
      `/sites/site-1?tab=traffic&domain=https%3A%2F%2Fbad.example&from=2026-02-02&to=2026-01-01&cursor=${'x'.repeat(501)}&utm=sweep`,
    );
    await waitFor(() =>
      expect(search).toBe('?tab=traffic&utm=sweep'),
    );
  });

  it('rejects a calendar-shaped date that does not exist', () => {
    expect(readTrafficFilters(new URLSearchParams('from=2026-02-30'))).toEqual({});
  });
});
