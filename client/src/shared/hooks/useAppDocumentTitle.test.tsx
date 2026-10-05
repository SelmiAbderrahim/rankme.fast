import { act, render } from '@testing-library/react';
import { configureStore } from '@reduxjs/toolkit';
import { I18nextProvider } from 'react-i18next';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { sitesReducer } from '@features/sites';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { useAppDocumentTitle } from './useAppDocumentTitle';

const site = {
  id: 'site-1',
  url: 'https://www.example.com',
  domain: 'www.example.com',
  displayName: '',
  paused: false,
  pausedAt: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
};

const makeStore = (items: unknown[]) =>
  configureStore({
    reducer: { sites: sitesReducer },
    preloadedState: {
      sites: { ...sitesReducer(undefined, { type: '@@init' }), loaded: true, items: items as never },
    },
  });

const Probe = () => {
  useAppDocumentTitle();
  return null;
};

const mount = (entry: string, items: unknown[] = [site]) =>
  render(
    <Provider store={makeStore(items)}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[entry]}>
          <Probe />
        </MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  document.title = 'Original';
});

describe('useAppDocumentTitle', () => {
  it('titles an account page', () => {
    mount('/assistant');
    expect(document.title).toBe('AI Assistant · RankMeFast');
  });

  it('titles a site workspace tab with the site domain', () => {
    mount('/sites/site-1?tab=keywords');
    expect(document.title).toBe('Keywords · www.example.com · RankMeFast');
  });

  it('prefers the site display name over its domain', () => {
    mount('/sites/site-1', [{ ...site, displayName: 'Example Co' }]);
    expect(document.title).toBe('Overview · Example Co · RankMeFast');
  });

  it('omits the site (never its raw id) until the site list has it', () => {
    mount('/sites/site-1?tab=report', []);
    expect(document.title).toBe('Report · RankMeFast');
  });

  it('falls back to the brand alone for an unmapped route', () => {
    mount('/nowhere');
    expect(document.title).toBe('RankMeFast');
  });

  it('retitles in the new language when the UI language changes', async () => {
    mount('/sites/site-1?tab=keywords');
    expect(document.title).toBe('Keywords · www.example.com · RankMeFast');
    await act(async () => {
      await changeLanguage('fr');
    });
    expect(document.title).toBe(`${i18n.t('sites:workspace.tabs.keywords')} · www.example.com · RankMeFast`);
    expect(i18n.t('sites:workspace.tabs.keywords')).not.toBe('Keywords');
    expect(document.title).not.toContain('Keywords');
  });

  it('restores the previous title on unmount', () => {
    const view = mount('/dashboard');
    expect(document.title).toBe('Dashboard · RankMeFast');
    view.unmount();
    expect(document.title).toBe('Original');
  });
});
