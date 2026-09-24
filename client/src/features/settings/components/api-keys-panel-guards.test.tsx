/**
 * Guard-branch tests for ApiKeysPanel.tsx onOpenChange false branches.
 *
 * Line 258 — create Dialog:   `if (!open) setCreateOpen(false)`
 * Line 316 — reveal Dialog:   `if (!open) handleRevealClose()`
 * Line 358 — revoke AlertDialog: `if (!open) setRevokeTarget(null)`
 *
 * In Radix controlled-dialog mode the dialog is only mounted when its guard
 * state is truthy, so onOpenChange is only ever called with open=false (close).
 * The false branch (open=true, no-op) is unreachable via the standard Radix API.
 *
 * Strategy: mock @shared/ui/dialog and @shared/ui/alert-dialog to render
 * children inline and add a synthetic button that calls onOpenChange(true).
 * Clicking that button exercises !open → false, covering each skipped branch.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { configureStore } from '@reduxjs/toolkit';
import { ApiKeysPanel } from './ApiKeysPanel';
import { apiKeysReducer } from '../store/apiKeysSlice';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import * as api from '../api';
import { sitesReducer } from '@features/sites';
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

// Inline-render Dialog primitives, expose a synthetic onOpenChange(true) trigger.
vi.mock('@shared/ui/dialog', () => ({
  Dialog: ({
    children,
    onOpenChange,
  }: {
    children: React.ReactNode;
    onOpenChange?: (open: boolean) => void;
  }) => (
    <div>
      <button
        data-testid="mock-dialog-open-trigger"
        onClick={() => onOpenChange?.(true)}
      />
      <button
        data-testid="mock-dialog-close-trigger"
        onClick={() => onOpenChange?.(false)}
      />
      {children}
    </div>
  ),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// Inline-render AlertDialog primitives, expose a synthetic onOpenChange(true) trigger.
vi.mock('@shared/ui/alert-dialog', () => ({
  AlertDialog: ({
    children,
    onOpenChange,
  }: {
    children: React.ReactNode;
    onOpenChange?: (open: boolean) => void;
  }) => (
    <div>
      <button
        data-testid="mock-alert-dialog-open-trigger"
        onClick={() => onOpenChange?.(true)}
      />
      {children}
    </div>
  ),
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogCancel: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => <button onClick={onClick}>{children}</button>,
  AlertDialogAction: ({
    children,
    onClick,
  }: {
    children: React.ReactNode;
    onClick?: () => void;
  }) => <button onClick={onClick}>{children}</button>,
}));

const mocked = vi.mocked(api);

const sampleKey = (over: Partial<ApiKeySummary> = {}): ApiKeySummary => ({
  id: over.id ?? 'k-1',
  name: over.name ?? 'CI pipeline',
  prefix: over.prefix ?? 'rmf_abcd1234',
  createdAt: over.createdAt ?? '2026-07-01T10:00:00.000Z',
  lastUsedAt: over.lastUsedAt ?? null,
  revokedAt: over.revokedAt ?? null,
  scopes: over.scopes ?? null,
});

const makeStore = () => configureStore({
  reducer: { apiKeys: apiKeysReducer, sites: sitesReducer },
  preloadedState: {
    sites: { ...sitesReducer(undefined, { type: '@@init' }), loaded: true },
  },
});

const renderPanel = (store = makeStore()) => {
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

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
  mocked.listApiKeysRequest.mockResolvedValue({ apiKeys: [sampleKey()] });
  mocked.patchApiKeyScopesRequest.mockResolvedValue({ apiKey: sampleKey() });
});

describe('ApiKeysPanel onOpenChange false branches — inline Dialog/AlertDialog mock', () => {
  it('create dialog onOpenChange(true) no-ops — false branch at ApiKeysPanel.tsx:258', async () => {
    // Open the create dialog, then fire onOpenChange(true) via the synthetic trigger.
    // `if (!open)` is false → setCreateOpen(false) is NOT called → dialog stays open.
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText('CI pipeline');

    // Open the create dialog.
    await user.click(screen.getByRole('button', { name: /create key/i }));
    // Inline mock renders children directly; Name input should be present.
    await waitFor(() =>
      expect(screen.getByLabelText('Name')).toBeInTheDocument(),
    );

    // Trigger onOpenChange(true) — !open is false → setCreateOpen(false) skipped.
    await user.click(screen.getByTestId('mock-dialog-open-trigger'));

    // Dialog is still open (setCreateOpen not called with false).
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(mocked.createApiKeyRequest).not.toHaveBeenCalled();
  });

  it('reveal dialog onOpenChange(true) no-ops — false branch at ApiKeysPanel.tsx:316', async () => {
    // After create succeeds, the reveal dialog appears. Firing onOpenChange(true)
    // must NOT call handleRevealClose() — the key stays in the store.
    mocked.createApiKeyRequest.mockResolvedValue({
      apiKey: {
        id: 'k-reveal',
        name: 'test key',
        prefix: 'rmf_reveal',
        createdAt: '2026-07-06T00:00:00.000Z',
        key: 'rmf_reveal_full_secret_key_here',
        scopes: null,
      },
    });
    const user = userEvent.setup();
    const store = renderPanel();
    await screen.findByText('CI pipeline');

    // Open create dialog, fill name, submit.
    await user.click(screen.getByRole('button', { name: /create key/i }));
    await waitFor(() => expect(screen.getByLabelText('Name')).toBeInTheDocument());
    await user.type(screen.getByLabelText('Name'), 'test key');
    // Two "Create key" buttons are in the DOM: the panel header button (opens dialog)
    // and the form submit button (inside the inline-rendered Dialog mock).
    // The submit button is last in DOM order.
    const createBtns = screen.getAllByRole('button', { name: /^Create key$/i });
    await user.click(createBtns[createBtns.length - 1]!);

    // Wait for the reveal dialog (api-key-full element from the reveal Dialog mock).
    await waitFor(() =>
      expect(screen.getByTestId('api-key-full')).toBeInTheDocument(),
    );

    // Trigger onOpenChange(true) on the reveal Dialog — !open is false → handleRevealClose skipped.
    await user.click(screen.getByTestId('mock-dialog-open-trigger'));

    // createdKey is still in the store (handleRevealClose dispatches clearCreatedApiKey).
    expect(store.getState().apiKeys.createdKey).not.toBeNull();
  });

  it('revoke AlertDialog onOpenChange(true) no-ops — false branch at ApiKeysPanel.tsx:358', async () => {
    // Click Revoke → revokeTarget is set → AlertDialog renders.
    // Firing onOpenChange(true) must NOT call setRevokeTarget(null).
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText('CI pipeline');

    // Trigger the revoke confirmation.
    await user.click(screen.getByRole('button', { name: 'Revoke' }));

    // The inline-mocked AlertDialog appears (revokeTarget is set).
    await waitFor(() =>
      expect(screen.getByTestId('mock-alert-dialog-open-trigger')).toBeInTheDocument(),
    );

    // Fire onOpenChange(true) — !open is false → setRevokeTarget(null) skipped.
    await user.click(screen.getByTestId('mock-alert-dialog-open-trigger'));

    // AlertDialog still mounted (revokeTarget not cleared).
    expect(screen.getByTestId('mock-alert-dialog-open-trigger')).toBeInTheDocument();
    expect(mocked.revokeApiKeyRequest).not.toHaveBeenCalled();
  });

  it('scope editor handles open, close, and explicit cancel transitions', async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText('CI pipeline');

    await user.click(screen.getByRole('button', { name: 'Edit access' }));
    await user.click(screen.getByTestId('mock-dialog-open-trigger'));
    expect(screen.getByRole('checkbox', { name: 'Use custom restrictions' })).toBeInTheDocument();
    await user.click(screen.getByTestId('mock-dialog-close-trigger'));
    expect(screen.queryByText('Edit API key access')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Edit access' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByText('Edit API key access')).not.toBeInTheDocument();
  });

  it('keeps the scope editor open while its PATCH is pending', async () => {
    let resolvePatch: ((value: { apiKey: ApiKeySummary }) => void) | undefined;
    mocked.patchApiKeyScopesRequest.mockImplementation(
      () => new Promise((resolve) => { resolvePatch = resolve; }),
    );
    const user = userEvent.setup();
    renderPanel();
    await screen.findByText('CI pipeline');
    await user.click(screen.getByRole('button', { name: 'Edit access' }));
    await user.click(screen.getByRole('button', { name: 'Save access' }));
    expect(screen.getByRole('button', { name: 'Saving access…' })).toBeInTheDocument();
    await user.click(screen.getByTestId('mock-dialog-close-trigger'));
    expect(screen.getByText('Edit API key access')).toBeInTheDocument();

    resolvePatch?.({ apiKey: sampleKey() });
    await waitFor(() =>
      expect(screen.queryByText('Edit API key access')).not.toBeInTheDocument(),
    );
  });
});
