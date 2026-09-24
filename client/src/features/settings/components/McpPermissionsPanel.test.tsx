import { configureStore } from '@reduxjs/toolkit';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@shared/api/client';
import { changeLanguage, initI18n } from '@shared/i18n';
import { sitesReducer, type Site, type SitesState } from '@features/sites';
import * as api from '../api';
import { createPermissiveMcpSettings } from '../mcpScopes';
import { mcpPermissionsReducer } from '../store/mcpPermissionsSlice';
import type { McpPermissionsState } from '../types';
import { McpPermissionsPanel } from './McpPermissionsPanel';

const sitesFeature = vi.hoisted(() => ({
  loadSites: vi.fn((input: unknown) => ({ type: 'mcp-test/load-sites', payload: input })),
}));

vi.mock('@features/sites', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@features/sites')>();
  return { ...actual, loadSites: sitesFeature.loadSites };
});

vi.mock('../api', () => ({
  createApiKeyRequest: vi.fn(),
  getMcpPermissionsRequest: vi.fn(),
  patchApiKeyScopesRequest: vi.fn(),
  putMcpPermissionsRequest: vi.fn(),
  revokeApiKeyRequest: vi.fn(),
}));

const mocked = vi.mocked(api);

const site: Site = {
  id: '64b000000000000000000001',
  url: 'https://example.com',
  domain: 'example.com',
  displayName: 'Example Site',
  paused: false,
  pausedAt: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const permissionsState = (
  overrides: Partial<McpPermissionsState> = {},
): McpPermissionsState => ({
  ...mcpPermissionsReducer(undefined, { type: '@@init' }),
  loaded: true,
  ...overrides,
});

const sitesState = (overrides: Partial<SitesState> = {}): SitesState => ({
  ...sitesReducer(undefined, { type: '@@init' }),
  loaded: true,
  items: [site],
  ...overrides,
});

function renderPanel(mcp = permissionsState(), siteStore = sitesState()) {
  const store = configureStore({
    reducer: {
      mcpPermissions: mcpPermissionsReducer,
      sites: sitesReducer,
    },
    preloadedState: { mcpPermissions: mcp, sites: siteStore },
  });
  const view = render(
    <Provider store={store}>
      <MemoryRouter>
        <McpPermissionsPanel />
      </MemoryRouter>
    </Provider>,
  );
  return { ...view, store };
}

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
  mocked.getMcpPermissionsRequest.mockResolvedValue(createPermissiveMcpSettings());
  mocked.putMcpPermissionsRequest.mockImplementation(async (settings) => settings);
});

describe('McpPermissionsPanel', () => {
  it('loads permissions and sites before showing the panel', async () => {
    renderPanel(permissionsState({ loaded: false }), sitesState({ loaded: false, items: [] }));
    expect(screen.getByRole('status', { name: 'Loading MCP permissions…' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'MCP permissions' })).toBeInTheDocument();
    expect(mocked.getMcpPermissionsRequest).toHaveBeenCalledTimes(1);
    expect(sitesFeature.loadSites).toHaveBeenCalledWith({});
    expect(screen.getByRole('heading', { name: 'Quick start' })).toBeInTheDocument();
  });

  it('saves tool, spend, and selected-site defaults with shared loading feedback', async () => {
    let resolveSave: ((value: ReturnType<typeof createPermissiveMcpSettings>) => void) | undefined;
    mocked.putMcpPermissionsRequest.mockImplementation(
      () => new Promise((resolve) => { resolveSave = resolve; }),
    );
    renderPanel();
    await userEvent.click(screen.getByRole('switch', { name: 'List sites' }));
    await userEvent.click(
      screen.getByRole('switch', { name: 'Allow tools that use plan allowance' }),
    );
    await userEvent.click(screen.getByRole('checkbox', { name: 'Allow all sites' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save permissions' }));
    expect(screen.getByRole('button', { name: 'Saving permissions…' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    const submitted = mocked.putMcpPermissionsRequest.mock.calls[0]?.[0];
    expect(submitted).toMatchObject({
      allowedSiteIds: [site.id],
      allowSpend: false,
    });
    expect(submitted?.tools.list_sites).toBe(false);
    resolveSave?.(submitted!);
    expect(await screen.findByRole('status')).toHaveTextContent('MCP permissions saved.');
  });

  it('surfaces save and site-load errors', async () => {
    mocked.putMcpPermissionsRequest.mockRejectedValue(
      new ApiError('save', 500, { error: { message: 'save refused' } }),
    );
    renderPanel(permissionsState(), sitesState({ error: 'sites unavailable' }));
    expect(screen.getByRole('alert')).toHaveTextContent("We couldn't load your sites");
    await userEvent.click(screen.getByRole('switch', { name: 'List sites' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save permissions' }));
    expect(await screen.findByText('save refused')).toBeInTheDocument();
  });

  it('retries a failed permission load', async () => {
    mocked.getMcpPermissionsRequest
      .mockRejectedValueOnce(
        new ApiError('load', 500, { error: { message: 'load refused' } }),
      )
      .mockResolvedValueOnce(createPermissiveMcpSettings());
    renderPanel(permissionsState({ loaded: false }));
    expect(await screen.findByText('load refused')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(mocked.getMcpPermissionsRequest).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('switch', { name: 'List sites' })).toBeChecked();
  });

  it('does not refetch already-loaded state', () => {
    renderPanel();
    expect(mocked.getMcpPermissionsRequest).not.toHaveBeenCalled();
    expect(sitesFeature.loadSites).not.toHaveBeenCalled();
  });
});
