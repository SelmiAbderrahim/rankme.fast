import { configureStore } from '@reduxjs/toolkit';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { ApiError } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import * as api from '../api';
import type { AppProfile, AppSeoState } from '../types';
import { appSeoReducer } from '../store/slice';
import { AppProfileForm } from './AppProfileForm';
import { AppsPanel } from './AppsPanel';

vi.mock('../api', () => ({
  fetchAppProfiles: vi.fn(),
  createAppProfile: vi.fn(),
  removeAppProfile: vi.fn(),
}));

const profile = (id: string, overrides: Partial<AppProfile> = {}): AppProfile => ({
  id,
  siteId: 'site-1',
  playPackageId: `com.example.${id}`,
  appStoreId: null,
  paired: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const renderPanel = (
  path = '/sites/site-1?tab=apps',
  options: {
    state?: AppSeoState;
  } = {},
) => {
  const store = configureStore({
    reducer: { appSeo: appSeoReducer },
    ...(options.state ? { preloadedState: { appSeo: options.state } } : {}),
  });
  return {
    store,
    ...render(
      <I18nextProvider i18n={i18n}>
        <Provider store={store}>
          <MemoryRouter initialEntries={[path]}>
            <AppsPanel siteId="site-1" />
          </MemoryRouter>
        </Provider>
      </I18nextProvider>,
    ),
  };
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.resetAllMocks();
  vi.mocked(api.fetchAppProfiles).mockResolvedValue([]);
  vi.mocked(api.removeAppProfile).mockResolvedValue(undefined);
});

describe('AppsPanel access and view shells', () => {
  it.each([
    ['profiles', 'No app profiles yet'],
    ['keywords', 'Register an app first'],
    ['listing', 'Add an app profile first'],
    ['charts', 'Register an app first'],
    ['research', 'Register an app first'],
    ['reviews', 'Add an app profile first'],
    ['compare', 'No app profiles yet'],
  ] as const)(
    'renders the %s view from ?view=',
    async (view, expectedCopy) => {
      const { unmount } = renderPanel(`/sites/site-1?tab=apps&view=${view}`);
      expect(screen.getByTestId(`app-seo-view-${view}`)).toBeInTheDocument();
      expect(screen.getByTestId(`app-seo-view-${view}`)).toHaveTextContent(expectedCopy);
      await waitFor(() => expect(api.fetchAppProfiles).toHaveBeenCalledWith('site-1'));
      unmount();
    },
  );

  it('moves to a selected app view through the URL-backed tab control', async () => {
    renderPanel();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('tab', { name: 'Keywords' }));
    expect(screen.getByTestId('app-seo-view-keywords')).toBeVisible();
  });

  it('renders the Arabic shell in RTL', async () => {
    await changeLanguage('ar');
    renderPanel('/sites/site-1?tab=apps&view=compare');
    expect(document.documentElement).toHaveAttribute('dir', 'rtl');
    expect(screen.getByTestId('app-seo-view-compare')).toHaveTextContent(
      'لا توجد ملفات تطبيقات بعد',
    );
  });
});

describe('AppsPanel profile registration and deletion', () => {
  it('uses localized fallback copy when a rejected registration has no message', () => {
    const store = configureStore({
      reducer: { appSeo: appSeoReducer },
      preloadedState: {
        appSeo: {
          profiles: [],
          registration: { status: 'failed' as const, message: '' },
        },
      },
    });
    render(
      <I18nextProvider i18n={i18n}>
        <Provider store={store}>
          <MemoryRouter>
            <AppProfileForm siteId="site-1" />
          </MemoryRouter>
        </Provider>
      </I18nextProvider>,
    );
    expect(screen.getByTestId('app-profile-error')).toHaveTextContent(
      'The request could not be completed. Try again.',
    );
  });

  it('validates empty, malformed, and incomplete paired registrations', async () => {
    renderPanel();
    await screen.findByTestId('app-profile-empty');
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Register app' }));
    expect(await screen.findByText('Enter at least one store ID.')).toBeVisible();

    await user.type(screen.getByLabelText('Google Play package ID'), 'bad-package');
    await user.click(screen.getByRole('button', { name: 'Register app' }));
    expect(
      await screen.findByText('Enter a reverse-DNS package ID, such as com.example.app.'),
    ).toBeVisible();

    await user.clear(screen.getByLabelText('Google Play package ID'));
    await user.type(screen.getByLabelText('Apple App Store ID'), '123456');
    await user.click(screen.getByLabelText('Treat these as the same app'));
    await user.click(screen.getByRole('button', { name: 'Register app' }));
    expect(await screen.findByText('Paired profiles need both store IDs.')).toBeVisible();
    expect(api.createAppProfile).not.toHaveBeenCalled();
  });

  it('registers paired store IDs and resets the form', async () => {
    vi.mocked(api.createAppProfile).mockResolvedValueOnce(
      profile('new', { appStoreId: '123456789', paired: true }),
    );
    renderPanel();
    await screen.findByTestId('app-profile-empty');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Google Play package ID'), 'com.example.new');
    await user.type(screen.getByLabelText('Apple App Store ID'), '123456789');
    await user.click(screen.getByLabelText('Treat these as the same app'));
    await user.click(screen.getByRole('button', { name: 'Register app' }));

    await waitFor(() =>
      expect(api.createAppProfile).toHaveBeenCalledWith('site-1', {
        playPackageId: 'com.example.new',
        appStoreId: '123456789',
        paired: true,
      }),
    );
    expect(await screen.findByTestId('app-profile-new')).toHaveTextContent('Paired');
    expect(screen.getByLabelText('Google Play package ID')).toHaveValue('');
  });

  it('accepts an Apple-only registration and omits the empty Play field', async () => {
    vi.mocked(api.createAppProfile).mockResolvedValueOnce(
      profile('apple', { playPackageId: null, appStoreId: '123456' }),
    );
    renderPanel();
    await screen.findByTestId('app-profile-empty');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Apple App Store ID'), '123456');
    await user.click(screen.getByRole('button', { name: 'Register app' }));
    await waitFor(() =>
      expect(api.createAppProfile).toHaveBeenCalledWith('site-1', {
        appStoreId: '123456',
        paired: false,
      }),
    );
  });

  it('accepts a Play-only registration and lists it without an Apple badge', async () => {
    vi.mocked(api.createAppProfile).mockResolvedValueOnce(profile('play'));
    renderPanel();
    await screen.findByTestId('app-profile-empty');
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Google Play package ID'), 'com.example.play');
    await user.click(screen.getByRole('button', { name: 'Register app' }));
    await waitFor(() =>
      expect(api.createAppProfile).toHaveBeenCalledWith('site-1', {
        playPackageId: 'com.example.play',
        paired: false,
      }),
    );
    const card = await screen.findByTestId('app-profile-play');
    expect(card).toHaveTextContent('com.example.play');
    expect(card).not.toHaveTextContent('App Store');
  });

  it('surfaces unavailable list reads without hiding the stored-profile workspace', async () => {
    vi.mocked(api.fetchAppProfiles).mockRejectedValueOnce(
      new ApiError('disabled', 503, { error: { message: 'App SEO is temporarily unavailable.' } }),
    );
    renderPanel();
    expect(await screen.findByTestId('app-profile-error')).toHaveTextContent(
      'App SEO is temporarily unavailable.',
    );
    expect(screen.getByTestId('app-seo-view-profiles')).toBeInTheDocument();
  });

  it('deletes a profile only after confirmation', async () => {
    vi.mocked(api.fetchAppProfiles).mockResolvedValueOnce([
      profile('delete', { playPackageId: null, appStoreId: '987654' }),
    ]);
    renderPanel();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Delete 987654' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('This cannot be undone.');
    await user.click(screen.getByRole('button', { name: 'Delete profile' }));
    await waitFor(() => expect(api.removeAppProfile).toHaveBeenCalledWith('site-1', 'delete'));
    expect(await screen.findByTestId('app-profile-empty')).toBeVisible();
  });
});
