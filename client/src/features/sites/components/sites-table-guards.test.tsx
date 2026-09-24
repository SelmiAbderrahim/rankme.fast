/**
 * Guard-branch tests for SitesTable.tsx:
 *
 * Line 309 — delete AlertDialog: `if (!open) setPendingDelete(null)`
 * Line 338 — rename Dialog:      `if (!open) closeRename()`
 *
 * In Radix controlled-dialog mode these handlers are only ever called with
 * open=false (close). The false branch — open=true, no-op — is unreachable
 * via the standard Radix API.
 *
 * Strategy: mock @shared/ui/alert-dialog and @shared/ui/dialog to render
 * children inline and expose a synthetic button that fires onOpenChange(true),
 * covering the false branch of each guard.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { configureStore } from '@reduxjs/toolkit';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { googleReducer } from '@features/google';
import { sitesReducer } from '../store/slice';
import { SitesTable } from './SitesTable';
import type { Site } from '../types';

// Inline-render AlertDialog, expose synthetic onOpenChange(true) trigger.
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
        data-testid="mock-alert-open-trigger"
        onClick={() => onOpenChange?.(true)}
      />
      {children}
    </div>
  ),
  AlertDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
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

// Inline-render Dialog, expose synthetic onOpenChange(true) trigger.
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
      {children}
    </div>
  ),
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

const sampleSite = (): Site => ({
  id: 's-1',
  url: 'https://example.com',
  domain: 'example.com',
  displayName: '',
  paused: false,
  pausedAt: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
});

const makeStore = () =>
  configureStore({
    reducer: { sites: sitesReducer, google: googleReducer },
    preloadedState: {
      sites: sitesReducer(undefined, { type: '@@init' }),
      google: { ...googleReducer(undefined, { type: '@@init' }), loaded: true },
    },
  });

const renderTable = (sites: Site[] = [sampleSite()]) => {
  render(
    <Provider store={makeStore()}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <SitesTable sites={sites} deletingId={null} onDelete={vi.fn()} />
        </MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
});

describe('SitesTable guard branches — inline AlertDialog/Dialog mock', () => {
  it('delete AlertDialog onOpenChange(true) no-ops — false branch at SitesTable.tsx:309', async () => {
    // Open the delete confirmation dialog, then fire onOpenChange(true) via the
    // synthetic trigger. `if (!open)` is false → setPendingDelete(null) NOT called.
    const user = userEvent.setup();
    renderTable();

    // Open the first row ⋯ menu and select Delete.
    await user.click(screen.getAllByRole('button', { name: /Open menu for/i })[0]!);
    await user.click(await screen.findByRole('menuitem', { name: /Delete/i }));

    // Inline-mocked AlertDialog renders; trigger synthetic onOpenChange(true).
    await waitFor(() =>
      expect(screen.getByTestId('mock-alert-open-trigger')).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId('mock-alert-open-trigger'));

    // pendingDelete NOT cleared — dialog stays mounted.
    expect(screen.getByTestId('mock-alert-open-trigger')).toBeInTheDocument();
  });

  it('pause AlertDialog onOpenChange(true) no-ops — false branch of its if(!open) guard', async () => {
    // Open the pause confirmation dialog, then fire onOpenChange(true) via the
    // synthetic trigger. `if (!open)` is false → setPendingPause(null) NOT called.
    const user = userEvent.setup();
    renderTable();

    // Open the first row ⋯ menu and select Pause site.
    await user.click(screen.getAllByRole('button', { name: /Open menu for/i })[0]!);
    await user.click(await screen.findByRole('menuitem', { name: /Pause site/i }));

    // Inline-mocked AlertDialog renders; trigger synthetic onOpenChange(true).
    await waitFor(() =>
      expect(screen.getByTestId('mock-alert-open-trigger')).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId('mock-alert-open-trigger'));

    // pendingPause NOT cleared — dialog stays mounted.
    expect(screen.getByTestId('mock-alert-open-trigger')).toBeInTheDocument();
  });

  it('rename Dialog onOpenChange(true) no-ops — false branch at SitesTable.tsx:338', async () => {
    // Open the rename dialog, then fire onOpenChange(true) via the synthetic trigger.
    // `if (!open)` is false → closeRename() NOT called → dialog stays mounted.
    const user = userEvent.setup();
    renderTable();

    // Open the first row ⋯ menu and select Edit display name.
    await user.click(screen.getAllByRole('button', { name: /Open menu for/i })[0]!);
    await user.click(await screen.findByRole('menuitem', { name: /Edit display name/i }));

    // Inline-mocked Dialog renders; trigger synthetic onOpenChange(true).
    await waitFor(() =>
      expect(screen.getByTestId('mock-dialog-open-trigger')).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId('mock-dialog-open-trigger'));

    // renaming NOT cleared — dialog stays mounted.
    expect(screen.getByTestId('mock-dialog-open-trigger')).toBeInTheDocument();
  });
});
