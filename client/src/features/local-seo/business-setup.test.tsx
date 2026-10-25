/**
 * Local SEO business setup: search, pick, save, change, deep link, paused
 * refresh, provenance.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { toast } from 'sonner';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { ApiError } from '@shared/api/client';
import { SiteLifecycleProvider } from '@shared/site/capabilities';
import * as api from './api';
import { LocalSeoPanel, localSeoReducer } from './index';
import { initialState } from './store/slice';
import { loadLocalBusinessSetup, searchLocalBusiness, selectLocalBusiness } from './store/thunks';
import type { LocalBusinessCandidate, LocalBusinessSetup, LocalSeoSnapshot } from './types';
import { isolateText } from '@shared/lib/bidi';

vi.mock('./api', () => ({
  fetchLocalSeo: vi.fn(),
  refreshLocalSeo: vi.fn(),
  fetchLocalBusinessSetup: vi.fn(),
  searchLocalBusinessRequest: vi.fn(),
  selectLocalBusinessRequest: vi.fn(),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const mocked = vi.mocked(api);

const DOWNTOWN: LocalBusinessCandidate = {
  candidateId: '11111111-1111-4111-8111-111111111111',
  placeId: 'ChIJdowntown',
  cid: null,
  name: 'Example Dental Studio',
  address: '100 Main St, Austin, TX 78701',
  phone: '+1 512-555-0100',
  domain: 'example.com',
  category: 'Dentist',
  latitude: 30.2672,
  longitude: -97.7431,
};

const NORTH: LocalBusinessCandidate = {
  ...DOWNTOWN,
  candidateId: '22222222-2222-4222-8222-222222222222',
  placeId: 'ChIJnorth',
  address: '9000 Research Blvd, Austin, TX 78758',
  category: null,
  latitude: null,
  longitude: null,
};

const noSetup = (): LocalBusinessSetup => ({ selected: null, candidates: [], query: null, candidatesExpireAt: null });

const withResults = (candidates = [DOWNTOWN, NORTH]): LocalBusinessSetup => ({
  selected: null,
  candidates,
  query: 'Example Dental',
  candidatesExpireAt: '2026-07-01T00:30:00.000Z',
});

const saved = (business: LocalBusinessCandidate = NORTH): LocalBusinessSetup => {
  const { candidateId: _id, ...rest } = business;
  return {
    selected: { ...rest, locationCode: 2840, languageCode: 'en', selectedAt: '2026-07-01T00:00:00.000Z' },
    candidates: [],
    query: null,
    candidatesExpireAt: null,
  };
};

const emptySnapshot = (overrides: Partial<LocalSeoSnapshot> = {}): LocalSeoSnapshot => ({
  provenance: null,
  listings: [],
  fetchedAt: null,
  reviews: null,
  reviewsFetchedAt: null,
  localPack: [],
  ...overrides,
});

let currentSearch = '';
const LocationProbe = () => {
  currentSearch = useLocation().search;
  return null;
};

function renderPanel({ url = '/sites/site-1?tab=local-seo', paused = false } = {}) {
  const store = configureStore({ reducer: { localSeo: localSeoReducer } });
  render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[url]}>
          <SiteLifecycleProvider paused={paused}>
            <LocalSeoPanel siteId="site-1" />
          </SiteLifecycleProvider>
          <LocationProbe />
        </MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );
  return store;
}

async function searchFor(query: string) {
  const input = await screen.findByTestId('local-seo-setup-query');
  await userEvent.clear(input);
  await userEvent.type(input, query);
  await userEvent.click(screen.getByTestId('local-seo-setup-search'));
}

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  mocked.fetchLocalSeo.mockReset().mockResolvedValue(emptySnapshot());
  mocked.refreshLocalSeo.mockReset();
  mocked.fetchLocalBusinessSetup.mockReset().mockResolvedValue(noSetup());
  mocked.searchLocalBusinessRequest.mockReset();
  mocked.selectLocalBusinessRequest.mockReset();
  vi.mocked(toast.success).mockReset();
});

describe('Local SEO business setup', () => {
  it('starts with setup when no business is chosen; refresh waits for it', async () => {
    renderPanel();
    expect(await screen.findByTestId('local-seo-setup')).toBeVisible();
    expect(screen.getByText('Choose your business')).toBeVisible();
    const refresh = screen.getByTestId('local-seo-refresh');
    expect(refresh).toBeDisabled();
    expect(screen.getByTestId('local-seo-refresh-reason')).toHaveTextContent(
      'Choose your business below before refreshing.',
    );
    expect(refresh).toHaveAttribute('aria-describedby', 'local-seo-refresh-reason');
    // The setup card is the action, so the generic empty state stays away.
    expect(screen.queryByTestId('local-seo-empty')).not.toBeInTheDocument();
    expect(mocked.searchLocalBusinessRequest).not.toHaveBeenCalled();
    expect(mocked.refreshLocalSeo).not.toHaveBeenCalled();
  });

  it('refuses a too-short query inline, without a search', async () => {
    renderPanel();
    await searchFor('a');
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter between 2 and 200 characters.');
    expect(screen.getByTestId('local-seo-setup-query')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByTestId('local-seo-setup-query')).toHaveFocus();
    expect(mocked.searchLocalBusinessRequest).not.toHaveBeenCalled();
    await userEvent.type(screen.getByTestId('local-seo-setup-query'), 'b');
    expect(screen.getByTestId('local-seo-setup-query')).not.toHaveAttribute('aria-invalid');
  });

  it('searches, then saves only the business the owner picks', async () => {
    mocked.searchLocalBusinessRequest.mockResolvedValueOnce(withResults());
    mocked.selectLocalBusinessRequest.mockResolvedValueOnce(saved(NORTH));
    renderPanel();
    await searchFor('  Example Dental ');
    await waitFor(() =>
      expect(mocked.searchLocalBusinessRequest).toHaveBeenCalledWith('site-1', 'Example Dental'),
    );

    const results = await screen.findByTestId('local-seo-setup-results');
    expect(screen.getByText(`2 results for “${isolateText('Example Dental')}”. Pick yours:`)).toBeVisible();
    // Same name, told apart by address; nothing is picked for the owner.
    expect(within(results).getAllByText('Example Dental Studio')).toHaveLength(2);
    expect(within(results).getByText('100 Main St, Austin, TX 78701')).toBeVisible();
    expect(within(results).getByText('9000 Research Blvd, Austin, TX 78758')).toBeVisible();
    expect(within(results).getByText('Google Business Profile · Dentist')).toBeVisible();
    expect(within(results).getByText('30.26720, -97.74310')).toHaveAttribute('dir', 'ltr');
    const save = screen.getByTestId('local-seo-setup-save');
    expect(save).toBeDisabled();

    await userEvent.click(within(screen.getByTestId('local-seo-setup-result-1')).getByRole('radio'));
    expect(save).toBeEnabled();
    await userEvent.click(save);
    expect(mocked.selectLocalBusinessRequest).toHaveBeenCalledWith('site-1', NORTH.candidateId);
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        `Local SEO now reports on ${isolateText('Example Dental Studio')}.`,
      ),
    );
    const business = await screen.findByTestId('local-seo-business');
    expect(business).toHaveTextContent('9000 Research Blvd, Austin, TX 78758');
    expect(screen.queryByTestId('local-seo-setup')).not.toBeInTheDocument();
    expect(new URLSearchParams(currentSearch).get('view')).toBe('overview');
    await waitFor(() => expect(screen.getByTestId('local-seo-refresh')).toBeEnabled());
    expect(screen.queryByTestId('local-seo-refresh-reason')).not.toBeInTheDocument();
    // With a business and no data yet, the empty state points at Refresh.
    expect(screen.getByTestId('local-seo-empty')).toBeVisible();
  });

  it('picks a result with the keyboard', async () => {
    mocked.fetchLocalBusinessSetup.mockResolvedValueOnce(withResults());
    renderPanel();
    const first = within(await screen.findByTestId('local-seo-setup-result-0')).getByRole('radio');
    await userEvent.click(screen.getByTestId('local-seo-setup-query'));
    // Tab past the search field and button into the results.
    await userEvent.tab();
    await userEvent.tab();
    expect(first).toHaveFocus();
    await userEvent.keyboard('[Space]');
    expect(first).toBeChecked();
    const second = within(screen.getByTestId('local-seo-setup-result-1')).getByRole('radio');
    await userEvent.keyboard('{ArrowDown}');
    expect(second).toHaveFocus();
    await userEvent.keyboard('[Space]');
    expect(second).toBeChecked();
    expect(screen.getByTestId('local-seo-setup-save')).toBeEnabled();
  });

  it('says when nothing matched and keeps the query', async () => {
    mocked.searchLocalBusinessRequest.mockResolvedValueOnce({ ...noSetup(), query: 'Nowhere Bakery' });
    renderPanel();
    await searchFor('Nowhere Bakery');
    expect(await screen.findByTestId('local-seo-setup-no-results')).toHaveTextContent(
      `No businesses found for “${isolateText('Nowhere Bakery')}”.`,
    );
    expect(screen.queryByTestId('local-seo-setup-save')).not.toBeInTheDocument();
  });

  it('falls back to the typed query when the answer carries none', async () => {
    mocked.searchLocalBusinessRequest.mockResolvedValueOnce(noSetup());
    renderPanel();
    await searchFor('Nowhere Bakery');
    expect(await screen.findByTestId('local-seo-setup-no-results')).toHaveTextContent(`“${isolateText('Nowhere Bakery')}”`);
  });

  it('shows a search failure inline and keeps earlier results out of view', async () => {
    mocked.searchLocalBusinessRequest.mockRejectedValueOnce(
      new ApiError('down', 503, { error: { message: 'Local SEO data is temporarily unavailable.' } }),
    );
    renderPanel();
    await searchFor('Example Dental');
    expect(await screen.findByTestId('local-seo-setup-search-error')).toHaveTextContent(
      'Local SEO data is temporarily unavailable.',
    );
    expect(screen.queryByTestId('local-seo-setup-no-results')).not.toBeInTheDocument();
  });

  it('keeps the earlier business when a pick has gone stale', async () => {
    mocked.fetchLocalBusinessSetup.mockResolvedValueOnce({ ...withResults(), selected: saved(DOWNTOWN).selected });
    mocked.selectLocalBusinessRequest.mockRejectedValueOnce(
      new ApiError('stale', 409, { error: { message: 'Those search results have expired.' } }),
    );
    renderPanel({ url: '/sites/site-1?tab=local-seo&view=setup' });
    await userEvent.click(within(await screen.findByTestId('local-seo-setup-result-1')).getByRole('radio'));
    await userEvent.click(screen.getByTestId('local-seo-setup-save'));
    expect(await screen.findByTestId('local-seo-setup-select-error')).toHaveTextContent(
      'Those search results have expired.',
    );
    expect(toast.success).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('local-seo-setup-cancel'));
    expect(await screen.findByTestId('local-seo-business')).toHaveTextContent('100 Main St, Austin, TX 78701');
  });

  it('deep link ?view=setup opens setup with the search field focused, and Cancel returns', async () => {
    mocked.fetchLocalBusinessSetup.mockResolvedValueOnce(saved());
    renderPanel({ url: '/sites/site-1?tab=local-seo&view=setup' });
    const input = await screen.findByTestId('local-seo-setup-query');
    await waitFor(() => expect(input).toHaveFocus());
    expect(screen.getByText(/Your current one stays until you save a new choice/)).toBeVisible();
    await userEvent.click(screen.getByTestId('local-seo-setup-cancel'));
    expect(await screen.findByTestId('local-seo-business')).toBeVisible();
    expect(new URLSearchParams(currentSearch).get('tab')).toBe('local-seo');
  });

  it('"Change business" opens setup in the URL', async () => {
    mocked.fetchLocalBusinessSetup.mockResolvedValueOnce(saved());
    renderPanel();
    await userEvent.click(await screen.findByTestId('local-seo-change-business'));
    expect(new URLSearchParams(currentSearch).get('view')).toBe('setup');
    expect(await screen.findByTestId('local-seo-setup')).toBeVisible();
  });

  it('a saved business without an address says so', async () => {
    mocked.fetchLocalBusinessSetup.mockResolvedValueOnce(saved({ ...NORTH, address: null }));
    renderPanel();
    expect(await screen.findByTestId('local-seo-business')).toHaveTextContent('No address listed');
  });

  it('a result without an address or category says so', async () => {
    mocked.fetchLocalBusinessSetup.mockResolvedValueOnce(withResults([{ ...NORTH, address: null }]));
    renderPanel();
    const row = await screen.findByTestId('local-seo-setup-result-0');
    expect(row).toHaveTextContent('No address listed');
    expect(within(row).getByText('Google Business Profile')).toBeVisible();
    expect(screen.getByText(`1 result for “${isolateText('Example Dental')}”. Pick yours:`)).toBeVisible();
  });

  it('a paused site can neither search nor refresh, and says why', async () => {
    mocked.fetchLocalBusinessSetup.mockResolvedValueOnce({ ...noSetup() });
    renderPanel({ paused: true });
    const search = await screen.findByTestId('local-seo-setup-search');
    expect(search).toBeDisabled();
    const reason = i18n.t('sites:paused.actionBlocked');
    expect(screen.getAllByText(reason).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByTestId('local-seo-refresh')).toBeDisabled();
    expect(screen.getByTestId('local-seo-refresh-reason')).toHaveTextContent(reason);
  });

  it('a failed setup load shows an error instead of setup', async () => {
    mocked.fetchLocalBusinessSetup.mockRejectedValueOnce(new ApiError('boom', 500, null));
    renderPanel();
    expect(await screen.findByTestId('local-seo-setup-error')).toHaveTextContent(
      'Could not load your business setup.',
    );
    expect(screen.queryByTestId('local-seo-setup')).not.toBeInTheDocument();
  });
});

describe('Local SEO provenance', () => {
  it('names the business the stored data describes', async () => {
    mocked.fetchLocalBusinessSetup.mockResolvedValueOnce(saved());
    mocked.fetchLocalSeo.mockResolvedValueOnce(
      emptySnapshot({
        provenance: { kind: 'business', name: 'Example Dental Studio North', ref: 'place_id:ChIJnorth' },
        reviews: { averageRating: 4, reviewCount: 3, unansweredQuestionCount: 0 },
      }),
    );
    renderPanel();
    expect(await screen.findByTestId('local-seo-provenance')).toHaveTextContent(
      'Showing data for Example Dental Studio North.',
    );
  });

  it('labels older domain-only data as such', async () => {
    mocked.fetchLocalSeo.mockResolvedValueOnce(
      emptySnapshot({
        provenance: { kind: 'domain', domain: 'example.com' },
        reviews: { averageRating: 4, reviewCount: 3, unansweredQuestionCount: 0 },
      }),
    );
    renderPanel();
    const label = await screen.findByTestId('local-seo-provenance');
    expect(label).toHaveTextContent('Older data, looked up by website example.com.');
    expect(label.querySelector('bdi')).toHaveTextContent('example.com');
    // No business chosen any more: setup is the way forward.
    expect(screen.getByTestId('local-seo-setup')).toBeVisible();
  });
});

describe('business setup reducers', () => {
  const meta = (siteId: string) => ({ arg: { siteId, query: 'x', candidateId: 'c' }, requestId: 'r', requestStatus: 'rejected' as const });

  it('ignores setup answers for another site and tolerates rejections without text', () => {
    const state = { ...initialState, siteId: 'site-1' };
    const other = localSeoReducer(state, { type: loadLocalBusinessSetup.fulfilled.type, payload: saved(), meta: meta('site-2') });
    expect(other.setup).toBeNull();
    const otherRejected = localSeoReducer(state, { type: loadLocalBusinessSetup.rejected.type, payload: 'x', meta: meta('site-2') });
    expect(otherRejected.setupError).toBe('');
    expect(
      localSeoReducer(state, { type: loadLocalBusinessSetup.rejected.type, meta: meta('site-1') }).setupError,
    ).toBe('');
    expect(localSeoReducer(state, { type: searchLocalBusiness.rejected.type, meta: meta('site-1') }).searchError).toBe('');
    expect(localSeoReducer(state, { type: selectLocalBusiness.rejected.type, meta: meta('site-1') }).selectError).toBe('');
  });

  it('a setup load for a new site starts from a clean slate', () => {
    const state = { ...initialState, siteId: 'site-1', setup: saved() };
    const next = localSeoReducer(state, { type: loadLocalBusinessSetup.pending.type, meta: meta('site-2') });
    expect(next).toMatchObject({ siteId: 'site-2', setup: null });
    const same = localSeoReducer(state, { type: loadLocalBusinessSetup.pending.type, meta: meta('site-1') });
    expect(same.setup).not.toBeNull();
  });
});
