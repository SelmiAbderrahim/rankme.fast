import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { ApiError } from '@shared/api/client';
import { actionsReducer } from '../store/slice';
import { ACTION_NOTE_MAX_LENGTH, StateChangeDialog, newActionClientKey } from './StateChangeDialog';
import { HistoryDrawer } from './HistoryDrawer';
import { RetestDialog } from './RetestDialog';
import { RetestPreviewCard } from './RetestPreviewCard';

const mocked = vi.hoisted(() => ({
  mutateActionState: vi.fn(async (_payload?: unknown) => {
    throw new Error('mutateActionState not stubbed');
  }),
  retestAction: vi.fn(async (_payload?: unknown) => {
    throw new Error('retestAction not stubbed');
  }),
  getActionHistory: vi.fn(async (..._args: unknown[]) => ({ entries: [] })),
}));

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  mutateActionState: mocked.mutateActionState,
  retestAction: mocked.retestAction,
  getActionHistory: mocked.getActionHistory,
}));

const makeStore = () =>
  configureStore({
    reducer: { actions: actionsReducer },
  });

const renderWith = (node: React.ReactNode, store = makeStore()) => {
  render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={['/sites/s1?tab=actions']}>{node}</MemoryRouter>
      </I18nextProvider>
    </Provider>,
  );
  return store;
};

beforeEach(async () => {
  initI18n({ initialLocale: 'en' });
  await changeLanguage('en');
  vi.clearAllMocks();
});

describe('newActionClientKey', () => {
  it('produces unique non-empty idempotency keys', () => {
    const a = newActionClientKey();
    const b = newActionClientKey();
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });
});

describe('StateChangeDialog', () => {
  const baseProps = {
    open: true,
    siteId: 's1',
    actionId: 'a'.repeat(64),
    actionTitle: 'Fix the broken titles',
    targetState: 'dismissed' as const,
    expectedVersion: 3,
  };

  it('restates the action title, bounds the note, and submits version + idempotency key', async () => {
    mocked.mutateActionState.mockResolvedValueOnce({
      actionId: baseProps.actionId,
      state: 'dismissed',
      version: 4,
      replayed: false,
    } as never);
    const onOpenChange = vi.fn();
    const onConflictReload = vi.fn();
    renderWith(
      <StateChangeDialog
        {...baseProps}
        onOpenChange={onOpenChange}
        onConflictReload={onConflictReload}
      />,
    );
    expect(screen.getByTestId('action-state-dialog-title')).toHaveTextContent(
      'Fix the broken titles',
    );
    expect(screen.getByText('Dismiss this action?')).toBeInTheDocument();
    const note = screen.getByTestId('action-state-note');
    const user = userEvent.setup();
    await user.type(note, 'not a real problem');
    expect(
      screen.getByText(`18 of ${ACTION_NOTE_MAX_LENGTH} characters`),
    ).toBeInTheDocument();
    await user.click(screen.getByTestId('action-state-confirm'));
    await waitFor(() => expect(mocked.mutateActionState).toHaveBeenCalledTimes(1));
    const payload = mocked.mutateActionState.mock.calls[0]![0] as unknown as {
      siteId: string;
      actionId: string;
      state: string;
      expectedVersion: number;
      clientKey: string;
      note?: string;
    };
    expect(payload.siteId).toBe('s1');
    expect(payload.state).toBe('dismissed');
    expect(payload.expectedVersion).toBe(3);
    expect(payload.clientKey.length).toBeGreaterThan(0);
    expect(payload.note).toBe('not a real problem');
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('clamps the note at the 500-character bound', async () => {
    renderWith(
      <StateChangeDialog
        {...baseProps}
        onOpenChange={vi.fn()}
        onConflictReload={vi.fn()}
      />,
    );
    const note = screen.getByTestId('action-state-note') as HTMLTextAreaElement;
    // Paste beyond the bound in one event — the handler slices to 500.
    const user = userEvent.setup();
    await user.click(note);
    await user.paste('x'.repeat(ACTION_NOTE_MAX_LENGTH + 50));
    expect(note.value).toHaveLength(ACTION_NOTE_MAX_LENGTH);
    expect(
      screen.getByText(`${ACTION_NOTE_MAX_LENGTH} of ${ACTION_NOTE_MAX_LENGTH} characters`),
    ).toBeInTheDocument();
  });

  it('omits the note field entirely when left blank', async () => {
    mocked.mutateActionState.mockResolvedValueOnce({
      actionId: baseProps.actionId,
      state: 'dismissed',
      version: 4,
      replayed: false,
    } as never);
    renderWith(
      <StateChangeDialog
        {...baseProps}
        onOpenChange={vi.fn()}
        onConflictReload={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId('action-state-confirm'));
    await waitFor(() => expect(mocked.mutateActionState).toHaveBeenCalled());
    expect(mocked.mutateActionState.mock.calls[0]![0]).not.toHaveProperty('note');
  });

  it('prevents double submission while the mutation is pending', async () => {
    let resolveMutation: (value: unknown) => void = () => undefined;
    mocked.mutateActionState.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveMutation = resolve;
        }) as never,
    );
    renderWith(
      <StateChangeDialog
        {...baseProps}
        onOpenChange={vi.fn()}
        onConflictReload={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    const confirm = screen.getByTestId('action-state-confirm');
    await user.click(confirm);
    await waitFor(() => expect(confirm).toBeDisabled());
    expect(confirm).toHaveAttribute('aria-busy', 'true');
    // A second click while pending must not fire another request.
    await user.click(confirm);
    expect(mocked.mutateActionState).toHaveBeenCalledTimes(1);
    resolveMutation({
      actionId: baseProps.actionId,
      state: 'dismissed',
      version: 4,
      replayed: false,
    });
  });

  it('recovers from a 409 with localized guidance and a caller-driven reload', async () => {
    mocked.mutateActionState.mockRejectedValueOnce(
      new ApiError('conflict', 409, {
        error: { message: 'Version conflict.' },
      }) as never,
    );
    const onConflictReload = vi.fn();
    renderWith(
      <StateChangeDialog
        {...baseProps}
        onOpenChange={vi.fn()}
        onConflictReload={onConflictReload}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId('action-state-confirm'));
    expect(await screen.findByTestId('action-state-conflict')).toHaveTextContent(
      'Someone else changed this action first.',
    );
    await user.click(screen.getByTestId('action-state-conflict-reload'));
    expect(onConflictReload).toHaveBeenCalledTimes(1);
  });

  it('shows a non-conflict server error verbatim', async () => {
    mocked.mutateActionState.mockRejectedValueOnce(
      new ApiError('boom', 500, { error: { message: 'backend down' } }) as never,
    );
    renderWith(
      <StateChangeDialog
        {...baseProps}
        onOpenChange={vi.fn()}
        onConflictReload={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId('action-state-confirm'));
    expect(await screen.findByTestId('action-state-error')).toHaveTextContent(
      'backend down',
    );
  });

  it('cancel closes without any mutation', async () => {
    const onOpenChange = vi.fn();
    renderWith(
      <StateChangeDialog
        {...baseProps}
        onOpenChange={onOpenChange}
        onConflictReload={vi.fn()}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocked.mutateActionState).not.toHaveBeenCalled();
  });

  it('renders nothing while closed and never resets state eagerly', () => {
    renderWith(
      <StateChangeDialog
        {...baseProps}
        open={false}
        onOpenChange={vi.fn()}
        onConflictReload={vi.fn()}
      />,
    );
    expect(screen.queryByTestId('action-state-dialog')).not.toBeInTheDocument();
  });
});

describe('HistoryDrawer', () => {
  const props = {
    siteId: 's1',
    actionId: 'b'.repeat(64),
    actionTitle: 'Fix the broken titles',
  };

  it('loads history on demand only when opened', async () => {
    mocked.getActionHistory.mockResolvedValueOnce({
      entries: [
        {
          ordinal: 2,
          priorState: 'open',
          newState: 'planned',
          eventKind: 'state_change',
          actorUserId: 'user-secret-id-123',
          note: 'scheduled for sprint 12',
          createdAt: '2026-07-10T10:00:00.000Z',
        },
        {
          ordinal: 1,
          priorState: null,
          newState: 'open',
          eventKind: 'created',
          actorUserId: 'user-secret-id-123',
          note: null,
          createdAt: '2026-07-01T00:00:00.000Z',
        },
      ],
    } as never);
    const { rerender } = render(
      <Provider store={makeStore()}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <HistoryDrawer {...props} open={false} onOpenChange={vi.fn()} />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    expect(mocked.getActionHistory).not.toHaveBeenCalled();
    rerender(
      <Provider store={makeStore()}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter>
            <HistoryDrawer {...props} open onOpenChange={vi.fn()} />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    );
    await waitFor(() => expect(mocked.getActionHistory).toHaveBeenCalledTimes(1));
    const entries = await screen.findAllByTestId('action-history-entry');
    expect(entries).toHaveLength(2);
    expect(entries[0]).toHaveTextContent('Planned');
    expect(entries[0]).toHaveTextContent('from Open');
    expect(entries[0]).toHaveTextContent('scheduled for sprint 12');
    // Actor-safe display: the raw account id never renders.
    expect(screen.queryByText(/user-secret-id-123/)).not.toBeInTheDocument();
    expect(entries[0]).toHaveTextContent('Team member');
  });

  it('shows the empty state when no changes are recorded', async () => {
    mocked.getActionHistory.mockResolvedValueOnce({ entries: [] } as never);
    renderWith(<HistoryDrawer {...props} open onOpenChange={vi.fn()} />);
    expect(await screen.findByTestId('action-history-empty')).toHaveTextContent(
      'No changes recorded yet.',
    );
  });

  it('surfaces a load failure with a working retry', async () => {
    mocked.getActionHistory
      .mockRejectedValueOnce(
        new ApiError('x', 500, { error: { message: 'history broke' } }) as never,
      )
      .mockResolvedValueOnce({ entries: [] } as never);
    renderWith(<HistoryDrawer {...props} open onOpenChange={vi.fn()} />);
    expect(await screen.findByTestId('action-history-error')).toHaveTextContent(
      'history broke',
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByTestId('action-history-empty')).toBeInTheDocument();
    expect(mocked.getActionHistory).toHaveBeenCalledTimes(2);
  });
});

describe('RetestPreviewCard', () => {
  it('renders the one-run, fresh-crawl facts', () => {
    renderWith(<RetestPreviewCard />);
    expect(screen.getByTestId('retest-preview-units')).toHaveTextContent('1');
    expect(screen.getByTestId('retest-preview')).toHaveTextContent(
      'Retests always run a fresh crawl',
    );
  });
});

describe('RetestDialog', () => {
  const props = {
    siteId: 's1',
    actionId: 'c'.repeat(64),
    actionTitle: 'Fix the broken titles',
  };

  it('previews the run, then enqueues exactly one retest', async () => {
    mocked.retestAction.mockResolvedValueOnce({
      actionId: props.actionId,
      run: { runId: 'run-9', status: 'queued' },
    } as never);
    renderWith(<RetestDialog {...props} open onOpenChange={vi.fn()} />);
    expect(screen.getByTestId('action-retest-title')).toHaveTextContent(
      'Fix the broken titles',
    );
    expect(screen.getByTestId('retest-preview-units')).toHaveTextContent('1');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('action-retest-confirm'));
    await waitFor(() => expect(mocked.retestAction).toHaveBeenCalledTimes(1));
    expect(mocked.retestAction.mock.calls[0]![0]).toMatchObject({
      siteId: 's1',
      actionId: props.actionId,
    });
    expect(await screen.findByTestId('action-retest-queued')).toBeInTheDocument();
    expect(screen.getByTestId('action-retest-progress-link')).toHaveAttribute(
      'href',
      '/sites/s1?tab=report',
    );
    // The confirm affordance is gone — no second enqueue possible.
    expect(screen.queryByTestId('action-retest-confirm')).not.toBeInTheDocument();
  });

  it('surfaces the server error verbatim before any enqueue succeeds', async () => {
    mocked.retestAction.mockRejectedValueOnce(
      new ApiError('busy', 503, {
        error: { message: 'The audit queue is busy. Try again shortly.' },
      }) as never,
    );
    renderWith(<RetestDialog {...props} open onOpenChange={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('action-retest-confirm'));
    expect(await screen.findByTestId('action-retest-error')).toHaveTextContent(
      'The audit queue is busy. Try again shortly.',
    );
    expect(screen.queryByTestId('action-retest-queued')).not.toBeInTheDocument();
  });

  it('cancel closes without calling the mutation route', async () => {
    const onOpenChange = vi.fn();
    renderWith(<RetestDialog {...props} open onOpenChange={onOpenChange} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mocked.retestAction).not.toHaveBeenCalled();
  });

  it('renders nothing while closed', () => {
    renderWith(<RetestDialog {...props} open={false} onOpenChange={vi.fn()} />);
    expect(screen.queryByTestId('action-retest-dialog')).not.toBeInTheDocument();
  });

  it('ignores a confirm click while the enqueue is pending', async () => {
    mocked.retestAction.mockImplementationOnce(
      () => new Promise(() => undefined) as never,
    );
    renderWith(<RetestDialog {...props} open onOpenChange={vi.fn()} />);
    const user = userEvent.setup();
    const confirm = screen.getByTestId('action-retest-confirm');
    await user.click(confirm);
    await waitFor(() => expect(confirm).toBeDisabled());
    await user.click(confirm);
    expect(mocked.retestAction).toHaveBeenCalledTimes(1);
  });
});
