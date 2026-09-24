import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { configureStore } from '@reduxjs/toolkit';
import { ApiError } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { sitesReducer, type Site } from '@features/sites';
import * as api from '../api';
import { apiKeysReducer } from '../store/apiKeysSlice';
import {
  createApiKey,
  loadApiKeys,
  revokeApiKey,
  updateApiKeyScopes,
} from '../store/apiKeysThunks';
import { ApiKeysPanel } from './ApiKeysPanel';
import type { ApiKeySummary } from '../types';

vi.mock('../api', () => ({
  getNotificationPreferencesRequest: vi.fn(),
  patchNotificationPreferencesRequest: vi.fn(),
  listApiKeysRequest: vi.fn(),
  createApiKeyRequest: vi.fn(),
  getMcpPermissionsRequest: vi.fn(),
  patchApiKeyScopesRequest: vi.fn(),
  putMcpPermissionsRequest: vi.fn(),
  revokeApiKeyRequest: vi.fn(),
}));

const mocked = vi.mocked(api);

const sitesFeature = vi.hoisted(() => ({
  loadSites: vi.fn((input: unknown) => ({
    type: 'api-keys-test/load-sites',
    payload: input,
  })),
}));

vi.mock('@features/sites', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@features/sites')>();
  return { ...actual, loadSites: sitesFeature.loadSites };
});

const sampleKey = (over: Partial<ApiKeySummary> = {}): ApiKeySummary => ({
  id: over.id ?? 'k-1',
  name: over.name ?? 'CI pipeline',
  prefix: over.prefix ?? 'rmf_abcd1234',
  createdAt: over.createdAt ?? '2026-07-01T10:00:00.000Z',
  lastUsedAt: over.lastUsedAt ?? null,
  revokedAt: over.revokedAt ?? null,
  scopes: over.scopes ?? null,
});

const apiError = (status: number, message: string) =>
  new ApiError(`status ${status}`, status, { error: { message } });

const site: Site = {
  id: '64b000000000000000000001',
  url: 'https://example.com',
  domain: 'example.com',
  displayName: 'Example Site',
  paused: false,
  pausedAt: null,
  createdAt: '2026-07-01T10:00:00.000Z',
  updatedAt: '2026-07-01T10:00:00.000Z',
};

const makeStore = (
  siteOverrides: Partial<ReturnType<typeof sitesReducer>> = {},
) => configureStore({
  reducer: { apiKeys: apiKeysReducer, sites: sitesReducer },
  preloadedState: {
    sites: {
      ...sitesReducer(undefined, { type: '@@init' }),
      loaded: true,
      items: [site],
      ...siteOverrides,
    },
  },
});
type Store = ReturnType<typeof makeStore>;

const renderPanel = (store: Store = makeStore()) => {
  render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <ApiKeysPanel />
        </MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );
  return store;
};

const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
  mocked.listApiKeysRequest.mockResolvedValue({ apiKeys: [sampleKey()] });
  mocked.patchApiKeyScopesRequest.mockResolvedValue({ apiKey: sampleKey() });
});

describe('ApiKeysPanel', () => {
  it('loads on mount and renders the key list with prefix only', async () => {
    renderPanel();
    expect(await screen.findByText('CI pipeline')).toBeInTheDocument();
    expect(screen.getByTestId('docs-link-rankmefast-mcp')).toHaveAttribute(
      'href',
      '/docs/rankmefast-mcp',
    );
    expect(screen.getByText('rmf_abcd1234…')).toBeInTheDocument();
    // Never used yet.
    expect(screen.getByText('Never')).toBeInTheDocument();
    expect(mocked.listApiKeysRequest).toHaveBeenCalledTimes(1);
  });

  it('loads sites when the site state has not been initialized', async () => {
    renderPanel(makeStore({ loaded: false, items: [] }));
    await screen.findByText('CI pipeline');
    expect(sitesFeature.loadSites).toHaveBeenCalledWith({});
  });

  it.each([
    ['already loading', { loaded: false, loading: true, items: [] }],
    ['already failed', { loaded: false, error: 'site load failed', items: [] }],
  ])('does not duplicate a site request when it has %s', async (_label, state) => {
    renderPanel(makeStore(state));
    await screen.findByText('CI pipeline');
    expect(sitesFeature.loadSites).not.toHaveBeenCalled();
  });

  it('shows a skeleton while loading', () => {
    mocked.listApiKeysRequest.mockReturnValue(new Promise(() => {}));
    renderPanel();
    expect(screen.getByTestId('api-keys-skeleton')).toBeInTheDocument();
  });

  it('shows the empty state when the account has no keys', async () => {
    mocked.listApiKeysRequest.mockResolvedValue({ apiKeys: [] });
    renderPanel();
    expect(await screen.findByText('No API keys yet.')).toBeInTheDocument();
  });

  it('surfaces a load error', async () => {
    mocked.listApiKeysRequest.mockRejectedValue(apiError(500, 'list broke'));
    renderPanel();
    expect(await screen.findByRole('alert')).toHaveTextContent('list broke');
  });

  it('validates the name before creating', async () => {
    renderPanel();
    await screen.findByText('CI pipeline');
    await userEvent.click(screen.getByRole('button', { name: /create key/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Create key' }));
    expect(
      await screen.findByText('Enter a name between 1 and 60 characters.'),
    ).toBeInTheDocument();
    expect(mocked.createApiKeyRequest).not.toHaveBeenCalled();
  });

  it('creates a key, reveals it exactly once, copies it, and cannot reopen it', async () => {
    mocked.createApiKeyRequest.mockResolvedValue({
      apiKey: {
        id: 'k-2',
        name: 'new key',
        prefix: 'rmf_zzzz9999',
        createdAt: '2026-07-06T00:00:00.000Z',
        key: 'rmf_zzzz9999_full_secret_value_here_abcd',
        scopes: null,
      },
    });
    const store = renderPanel();
    await screen.findByText('CI pipeline');

    await userEvent.click(screen.getByRole('button', { name: /create key/i }));
    await userEvent.type(screen.getByLabelText('Name'), 'new key');
    await userEvent.click(screen.getByRole('button', { name: 'Create key' }));

    // Show-once dialog with the full key.
    const full = await screen.findByTestId('api-key-full');
    expect(full).toHaveTextContent('rmf_zzzz9999_full_secret_value_here_abcd');
    expect(mocked.createApiKeyRequest).toHaveBeenCalledWith({ name: 'new key' });

    // Copy to clipboard.
    await userEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('rmf_zzzz9999_full_secret_value_here_abcd');
    expect(await screen.findByText('Copied')).toBeInTheDocument();

    // Close — the key is discarded and cannot be shown again.
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    await waitFor(() =>
      expect(screen.queryByTestId('api-key-full')).not.toBeInTheDocument(),
    );
    expect(store.getState().apiKeys.createdKey).toBeNull();

    // The list now carries the new key (prefix only).
    expect(screen.getByText('rmf_zzzz9999…')).toBeInTheDocument();
  });

  it('creates a key with optional tool, spend, and site restrictions', async () => {
    const scoped = {
      tools: {
        list_sites: true,
        get_latest_audit_report: true,
        list_keywords: true,
        get_rank_history: true,
        list_content_analyses: true,
        get_content_analysis: true,
        start_audit: false,
        get_audit_status: true,
        list_actions: true,
        set_action_state: true,
      },
      allowedSiteIds: [site.id],
      allowSpend: false,
    };
    mocked.createApiKeyRequest.mockResolvedValue({
      apiKey: {
        id: 'k-scoped',
        name: 'scoped key',
        prefix: 'rmf_scoped12',
        createdAt: '2026-07-06T00:00:00.000Z',
        key: 'rmf_scoped12_full_secret',
        scopes: scoped,
      },
    });
    renderPanel();
    await screen.findByText('CI pipeline');
    await userEvent.click(screen.getByRole('button', { name: /create key/i }));
    await userEvent.type(screen.getByLabelText('Name'), 'scoped key');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Restrict this key' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Start audit' }));
    await userEvent.click(
      screen.getByRole('switch', { name: 'Allow tools that use plan allowance' }),
    );
    await userEvent.click(screen.getByRole('checkbox', { name: 'Allow all sites' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create key' }));
    await screen.findByTestId('api-key-full');
    expect(mocked.createApiKeyRequest).toHaveBeenCalledWith({
      name: 'scoped key',
      scopes: scoped,
    });
  });

  it('shows a site-loading error when create restrictions are expanded', async () => {
    renderPanel(makeStore({ error: 'site load failed' }));
    await screen.findByText('CI pipeline');
    await userEvent.click(screen.getByRole('button', { name: /create key/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Restrict this key' }));
    expect(screen.getByRole('alert')).toHaveTextContent("We couldn't load your sites");
  });

  it('edits and clears per-key restrictions', async () => {
    const restricted = sampleKey({
      scopes: {
        tools: { start_audit: false },
        allowedSiteIds: [site.id],
        allowSpend: false,
      },
    });
    mocked.listApiKeysRequest.mockResolvedValue({ apiKeys: [restricted] });
    mocked.patchApiKeyScopesRequest
      .mockResolvedValueOnce({
        apiKey: sampleKey({ scopes: { tools: { start_audit: true } } }),
      })
      .mockResolvedValueOnce({ apiKey: sampleKey({ scopes: null }) });
    renderPanel();
    await screen.findByText('Restricted');

    await userEvent.click(screen.getByRole('button', { name: 'Edit access' }));
    expect(screen.getByRole('checkbox', { name: 'Use custom restrictions' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Start audit' })).not.toBeChecked();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Start audit' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save access' }));
    await waitFor(() => expect(mocked.patchApiKeyScopesRequest).toHaveBeenCalledTimes(1));
    expect(mocked.patchApiKeyScopesRequest.mock.calls[0]?.[0]).toBe('k-1');
    expect(mocked.patchApiKeyScopesRequest.mock.calls[0]?.[1]?.tools?.start_audit).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Edit access' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Use custom restrictions' }));
    expect(screen.getByText(/follows the account defaults/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Save access' }));
    await waitFor(() => expect(mocked.patchApiKeyScopesRequest).toHaveBeenLastCalledWith('k-1', null));
    expect(await screen.findByText('Unrestricted')).toBeInTheDocument();
  });

  it('keeps the scope editor open on errors', async () => {
    mocked.patchApiKeyScopesRequest.mockRejectedValueOnce(apiError(500, 'scope refused'));
    renderPanel();
    await screen.findByText('CI pipeline');
    await userEvent.click(screen.getByRole('button', { name: 'Edit access' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Use custom restrictions' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save access' }));
    expect(await screen.findByText('scope refused')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save access' })).toBeInTheDocument();
  });

  it('escape on the reveal dialog also discards the key', async () => {
    mocked.createApiKeyRequest.mockResolvedValue({
      apiKey: {
        id: 'k-3',
        name: 'esc key',
        prefix: 'rmf_escesces',
        createdAt: '2026-07-06T00:00:00.000Z',
        key: 'rmf_escesces_full_secret',
        scopes: null,
      },
    });
    const store = renderPanel();
    await screen.findByText('CI pipeline');
    await userEvent.click(screen.getByRole('button', { name: /create key/i }));
    await userEvent.type(screen.getByLabelText('Name'), 'esc key');
    await userEvent.click(screen.getByRole('button', { name: 'Create key' }));
    await screen.findByTestId('api-key-full');
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByTestId('api-key-full')).not.toBeInTheDocument(),
    );
    expect(store.getState().apiKeys.createdKey).toBeNull();
  });

  it('cancel closes the create dialog without calling the API', async () => {
    renderPanel();
    await screen.findByText('CI pipeline');
    await userEvent.click(screen.getByRole('button', { name: /create key/i }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByLabelText('Name')).not.toBeInTheDocument(),
    );
    expect(mocked.createApiKeyRequest).not.toHaveBeenCalled();
  });

  it('escape closes the create dialog via onOpenChange', async () => {
    renderPanel();
    await screen.findByText('CI pipeline');
    await userEvent.click(screen.getByRole('button', { name: /create key/i }));
    await userEvent.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByLabelText('Name')).not.toBeInTheDocument(),
    );
  });

  it('shows the server error inside the create dialog', async () => {
    mocked.createApiKeyRequest.mockRejectedValue(apiError(409, 'too many keys'));
    renderPanel();
    await screen.findByText('CI pipeline');
    await userEvent.click(screen.getByRole('button', { name: /create key/i }));
    await userEvent.type(screen.getByLabelText('Name'), 'overflow');
    await userEvent.click(screen.getByRole('button', { name: 'Create key' }));
    expect(await screen.findByText('too many keys')).toBeInTheDocument();
  });

  it('revokes a key after confirmation and shows the server message', async () => {
    mocked.revokeApiKeyRequest.mockResolvedValue({ message: 'API key revoked.' });
    renderPanel();
    await screen.findByText('CI pipeline');
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    // Confirm dialog carries the key name.
    expect(
      await screen.findByText(/“CI pipeline” will stop working immediately/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('API key revoked.')).toBeInTheDocument();
    expect(mocked.revokeApiKeyRequest).toHaveBeenCalledWith('k-1');
    // Row now shows the revoked badge; the revoke button is gone.
    expect(screen.getByText('Revoked')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke' })).not.toBeInTheDocument();
  });

  it('cancelling the revoke confirm leaves the key untouched', async () => {
    renderPanel();
    await screen.findByText('CI pipeline');
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(
        screen.queryByText(/will stop working immediately/),
      ).not.toBeInTheDocument(),
    );
    expect(mocked.revokeApiKeyRequest).not.toHaveBeenCalled();
  });

  it('surfaces a revoke error', async () => {
    mocked.revokeApiKeyRequest.mockRejectedValue(apiError(500, 'revoke broke'));
    renderPanel();
    await screen.findByText('CI pipeline');
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('revoke broke')).toBeInTheDocument();
  });

  it('formats lastUsedAt when present', async () => {
    mocked.listApiKeysRequest.mockResolvedValue({
      apiKeys: [sampleKey({ lastUsedAt: '2026-07-02T08:30:00.000Z' })],
    });
    renderPanel();
    await screen.findByText('CI pipeline');
    expect(screen.queryByText('Never')).not.toBeInTheDocument();
  });

  it('renders localized copy (fr)', async () => {
    await changeLanguage('fr');
    renderPanel();
    expect(await screen.findByText('Clés API')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Créer une clé/ })).toBeInTheDocument();
  });
});

describe('apiKeys slice fallbacks', () => {
  it('revoke fulfilled only marks the matching key as revoked', () => {
    const store = makeStore();
    store.dispatch(loadApiKeys.fulfilled([sampleKey(), sampleKey({ id: 'k-2', name: 'other' })], 'req', undefined));
    store.dispatch(revokeApiKey.fulfilled({ id: 'k-1', message: 'done' }, 'req', { id: 'k-1' }));
    const [first, second] = store.getState().apiKeys.keys;
    expect(first?.revokedAt).not.toBeNull();
    expect(second?.revokedAt).toBeNull();
  });

  it('scope updates replace only the matching key', () => {
    const store = makeStore();
    const other = sampleKey({ id: 'k-2', name: 'other' });
    store.dispatch(loadApiKeys.fulfilled([sampleKey(), other], 'req', undefined));
    const updated = sampleKey({ scopes: { allowSpend: false } });
    store.dispatch(updateApiKeyScopes.fulfilled(updated, 'req', {
      id: 'k-1',
      scopes: { allowSpend: false },
    }));
    const [first, second] = store.getState().apiKeys.keys;
    expect(first).toEqual(updated);
    expect(second).toEqual(other);
  });

  it.each([
    ['loadApiKeys', loadApiKeys.rejected(null, 'req', undefined)],
    ['createApiKey', createApiKey.rejected(null, 'req', { name: 'x' })],
    ['revokeApiKey', revokeApiKey.rejected(null, 'req', { id: 'k-1' })],
    [
      'updateApiKeyScopes',
      updateApiKeyScopes.rejected(null, 'req', { id: 'k-1', scopes: null }),
    ],
  ] as const)('%s.rejected without payload keeps safe defaults', (_name, action) => {
    const store = makeStore();
    store.dispatch(action);
    const state = store.getState().apiKeys;
    expect(state.loadError === '' || state.loadError === undefined).toBe(true);
    expect(state.createError).toBe('');
    expect(state.revokeError).toBe('');
    expect(state.scopesError).toBe('');
  });
});
