/**
 * Guard-branch tests for KeywordsTable.tsx:325.
 *
 * `if (!open) setPendingRemove(null)` — false branch fires when the AlertDialog's
 * onOpenChange handler is called with open=true. In normal Radix controlled-dialog
 * usage this never happens (the dialog is already open), so the false branch is
 * unreachable via the standard Radix API.
 *
 * Strategy: mock @shared/ui/alert-dialog to render children inline and expose a
 * synthetic button that fires onOpenChange(true). The guard then evaluates !open
 * as false and skips setPendingRemove(null) — keeping the dialog mounted and
 * covering the uncovered branch.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { i18n, initI18n } from '@shared/i18n';
import { KeywordsTable } from './components/KeywordsTable';
import type { Keyword } from './types';

// Inline-render all AlertDialog primitives so the dialog content is always in
// the DOM, and expose a synthetic trigger that fires onOpenChange(true).
vi.mock('@shared/ui/alert-dialog', () => ({
  AlertDialog: ({
    children,
    onOpenChange,
  }: {
    children: React.ReactNode;
    onOpenChange?: (open: boolean) => void;
  }) => (
    <div>
      <button data-testid="mock-alert-open-trigger" onClick={() => onOpenChange?.(true)} />
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

const kw = (id: string, overrides: Partial<Keyword> = {}): Keyword => ({
  id,
  siteId: 'site-1',
  phrase: `phrase-${id}`,
  locationCode: 2840,
  languageCode: 'en',
  device: 'desktop',
  active: true,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  latestPosition: 5,
  previousPosition: 6,
  delta: 1,
  lastCheckedAt: '2026-07-02T00:00:00.000Z',
  aiOverviewPresent: null,
  aiCited: null,
  aiCitedUrl: null,
  lastFailedCheckAt: null,
  lastFailedReason: null,
  engine: 'google',
  engineTarget: null,
  observationMeta: null,
  ...overrides,
});

beforeEach(() => {
  initI18n({ initialLocale: 'en' });
  vi.clearAllMocks();
});

describe('KeywordsTable guard branches — AlertDialog inline mock', () => {
  it('onOpenChange(true) no-ops when the remove confirm dialog is open — false branch at KeywordsTable.tsx:325', async () => {
    // Step 1: open the row DropdownMenu and click "Remove keyword" to set pendingRemove.
    // Step 2: the inline-mocked AlertDialog appears.
    // Step 3: clicking mock-alert-open-trigger fires onOpenChange(true).
    //         `if (!open)` evaluates to false → setPendingRemove(null) is NOT called.
    //         The dialog stays in the DOM — confirming the false branch was taken.
    const user = userEvent.setup();
    const onRemove = vi.fn();

    render(
      <I18nextProvider i18n={i18n}>
        <KeywordsTable
          keywords={[kw('k1')]}
          removingId={null}
          selectedId={null}
          onSelect={vi.fn()}
          onRemove={onRemove}
        />
      </I18nextProvider>,
    );

    // Open the row ⋯ menu via the desktop table row (KeywordsTable renders both
    // a desktop <tr> and a mobile card; scope to the <tr> to avoid ambiguity).
    const row = screen.getByTestId('keyword-row-k1');
    await user.click(within(row).getByRole('button', { name: /Open menu for phrase-k1/i }));
    // Click "Remove keyword" to set pendingRemove → AlertDialog renders.
    await user.click(await screen.findByRole('menuitem', { name: /Remove keyword/i }));

    // AlertDialog is now rendered; trigger onOpenChange(true).
    await waitFor(() => expect(screen.getByTestId('mock-alert-open-trigger')).toBeInTheDocument());
    await user.click(screen.getByTestId('mock-alert-open-trigger'));

    // !open is false → setPendingRemove(null) was NOT called → dialog still present.
    expect(screen.getByTestId('mock-alert-open-trigger')).toBeInTheDocument();
    expect(onRemove).not.toHaveBeenCalled();
  });
});
