import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { configureStore } from '@reduxjs/toolkit';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { ApiError } from '@shared/api/client';
import type { CodeFixPromptInput } from '@shared/components/CodeFixPromptButton';
import { actionsReducer } from '../store/slice';
import type { ActionItem, ListActionsResponse } from '../types';
import { ActionsPanel, filtersFromQuery } from './ActionsPanel';
import { DEFAULT_ACTIONS_QUERY } from '../tabState';

const mocked = vi.hoisted(() => ({
  listActions: vi.fn(
    async (
      _payload?: unknown,
      _init?: unknown,
    ): Promise<ListActionsResponse> => ({
      items: [],
      sourceStatus: {},
      nextCursor: null,
    }),
  ),
  getActionHistory: vi.fn(async (..._args: unknown[]) => ({ entries: [] })),
  mutateActionState: vi.fn(async (_payload?: unknown) => {
    throw new Error('mutateActionState not stubbed');
  }),
  retestAction: vi.fn(async (_payload?: unknown) => {
    throw new Error('retestAction not stubbed');
  }),
}));

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  listActions: mocked.listActions,
  getActionHistory: mocked.getActionHistory,
  mutateActionState: mocked.mutateActionState,
  retestAction: mocked.retestAction,
}));

vi.mock('@shared/components/CodeFixPromptButton', () => ({
  CodeFixPromptButton: ({ input }: { input: CodeFixPromptInput }) => (
    <button type="button" data-testid="code-fix-prompt" data-input={JSON.stringify(input)}>
      Copy code prompt
    </button>
  ),
}));

/**
 * Walk the React fiber upward from a DOM element and collect every Radix
 * Dialog-family `onOpenChange` handler. The state dialog is controlled with
 * `open` always true, so `onOpenChange(true)` is never fired by user
 * interaction — the truthy branch of `if (!open)` is only reachable by
 * grabbing the handlers off the fiber (signals.test.tsx precedent).
 */
type FiberNode = { memoizedProps?: Record<string, unknown>; return: FiberNode | null };
function getFiberOnOpenChangeHandlers(el: Element): Array<(open: boolean) => void> {
  const handlers: Array<(open: boolean) => void> = [];
  const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber'));
  if (!fiberKey) return handlers;
  let node: FiberNode | null =
    (el as unknown as Record<string, FiberNode>)[fiberKey] ?? null;
  while (node) {
    const handler = node.memoizedProps?.onOpenChange;
    if (typeof handler === 'function') {
      handlers.push(handler as (open: boolean) => void);
    }
    node = node.return;
  }
  return handlers;
}

const item = (id: string, overrides: Partial<ActionItem> = {}): ActionItem => ({
  id,
  siteId: 's1',
  sourceType: 'audit_finding',
  sourceId: `run-1:${id}`,
  sourceLink: '/sites/s1?tab=report',
  problem: `${id} problem`,
  whyItMatters: `${id} why it matters`,
  nextStep: `${id} next step`,
  affectedUrls: [`https://example.com/${id}/a`, `https://example.com/${id}/b`],
  evidence: [
    {
      sourceRef: `audit:${id}`,
      url: `https://vendor.example/${id}`,
      observation: { freshness: 'fresh', observedAt: '2026-07-10T00:00:00.000Z' },
    },
  ],
  severity: 'critical',
  firstPartyImpact: 'high',
  confidence: 'high',
  effort: 'low',
  state: 'open',
  version: 1,
  reappearedAfterFix: false,
  observedAt: '2026-07-10T00:00:00.000Z',
  lastVerifiedAt: null,
  retest: { available: true },
  ...overrides,
  copy: overrides.copy ?? {
    problem: { messageKey: 'auditRules.missing-title.title' },
    whyItMatters: { messageKey: 'auditRules.missing-title.why' },
    nextStep: { messageKey: 'auditRules.missing-title.fix' },
  },
});

const okResponse = (
  items: ActionItem[],
  overrides: Partial<ListActionsResponse> = {},
): ListActionsResponse => ({
  items,
  sourceStatus: {
    audit_finding: { status: 'available', lastObservedAt: '2026-07-10T00:00:00.000Z' },
  },
  nextCursor: null,
  ...overrides,
});

const makeStore = () =>
  configureStore({
    reducer: { actions: actionsReducer },
  });

let capturedSearch = '';
const LocationSpy = () => {
  const location = useLocation();
  capturedSearch = location.search;
  return null;
};

const renderPanel = (path = '/sites/s1?tab=actions', store = makeStore()) => {
  render(
    <Provider store={store}>
      <I18nextProvider i18n={i18n}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="/sites/:siteId"
              element={
                <>
                  <LocationSpy />
                  <ActionsPanel siteId="s1" />
                </>
              }
            />
          </Routes>
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
  mocked.listActions.mockImplementation(async () => okResponse([item('a1'), item('a2')]));
});

describe('filtersFromQuery', () => {
  it('maps non-default filters to single-element arrays and drops defaults', () => {
    expect(filtersFromQuery(DEFAULT_ACTIONS_QUERY)).toEqual({});
    expect(
      filtersFromQuery({
        state: 'planned',
        source: 'audit_finding',
        severity: 'critical',
        confidence: 'low',
        effort: 'high',
        cursor: null,
      }),
    ).toEqual({
      state: ['planned'],
      source: ['audit_finding'],
      severity: ['critical'],
      confidence: ['low'],
      effort: ['high'],
    });
  });
});

describe('ActionsPanel — load, order, filters, pagination', () => {
  it('loads unfiltered actions and renders them in server order', async () => {
    mocked.listActions.mockResolvedValueOnce(
      okResponse([item('z-second-by-alpha'), item('a-first-by-alpha')]),
    );
    renderPanel();
    const cards = await screen.findAllByTestId('action-card');
    expect(cards).toHaveLength(2);
    // Server order is authoritative — no client re-sort.
    expect(cards[0]).toHaveTextContent('z-second-by-alpha problem');
    expect(cards[1]).toHaveTextContent('a-first-by-alpha problem');
    expect(mocked.listActions).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: 's1', filters: {} }),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(screen.getByRole('status')).toHaveTextContent('Showing 2 actions');
  });

  it('refetches localized action copy on a switch while preserving source URLs and spend-free behavior', async () => {
    const english = item('localized', {
      problem: 'English problem',
      whyItMatters: 'English why',
      nextStep: 'English fix',
    });
    const arabic = item('localized', {
      problem: 'مشكلة عربية',
      whyItMatters: 'سبب عربي',
      nextStep: 'إصلاح عربي',
    });
    mocked.listActions
      .mockResolvedValueOnce(okResponse([english]))
      .mockResolvedValueOnce(okResponse([arabic]));
    const store = renderPanel();

    expect(await screen.findByText('English problem')).toBeInTheDocument();
    await act(async () => {
      await changeLanguage('ar');
    });

    expect(await screen.findByText('مشكلة عربية')).toBeInTheDocument();
    expect(screen.queryByText('English problem')).toBeNull();
    expect(mocked.listActions).toHaveBeenCalledTimes(2);
    expect(mocked.listActions.mock.calls[0]?.[1]).toMatchObject({
      presentationLocale: 'en',
    });
    expect(mocked.listActions.mock.calls[1]?.[1]).toMatchObject({
      presentationLocale: 'ar',
    });
    expect(store.getState().actions.items[0]?.affectedUrls).toEqual(
      english.affectedUrls,
    );
    expect(mocked.mutateActionState).not.toHaveBeenCalled();
    expect(mocked.retestAction).not.toHaveBeenCalled();
  });

  it('chips a completed action the source still reports', async () => {
    mocked.listActions.mockResolvedValueOnce(
      okResponse([
        item('held', { state: 'completed' }),
        item('back', { state: 'completed', reappearedAfterFix: true }),
      ]),
    );
    renderPanel();
    const chips = await screen.findAllByTestId('action-reappeared-chip');
    expect(chips).toHaveLength(1);
    expect(chips[0]).toHaveTextContent('Still detected after being marked fixed');
  });

  it('shows the initial loading skeleton', async () => {
    mocked.listActions.mockImplementation(() => new Promise(() => undefined));
    renderPanel();
    expect(await screen.findByTestId('actions-loading')).toBeInTheDocument();
  });

  it('passes deep-linked filters and cursor to the API', async () => {
    renderPanel('/sites/s1?tab=actions&state=planned&severity=critical&cursor=25');
    await waitFor(() =>
      expect(mocked.listActions).toHaveBeenCalledWith(
        expect.objectContaining({
          siteId: 's1',
          filters: { state: ['planned'], severity: ['critical'] },
          cursor: '25',
        }),
        expect.anything(),
      ),
    );
  });

  it('filter change writes the URL, clears the cursor, and refetches', async () => {
    renderPanel('/sites/s1?tab=actions&cursor=25');
    await screen.findAllByTestId('action-card');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('actions-filter-state'));
    await user.click(await screen.findByRole('option', { name: 'Planned' }));
    await waitFor(() =>
      expect(capturedSearch).toBe('?tab=actions&state=planned'),
    );
    await waitFor(() =>
      expect(mocked.listActions).toHaveBeenLastCalledWith(
        expect.objectContaining({ filters: { state: ['planned'] } }),
        expect.anything(),
      ),
    );
    expect(
      mocked.listActions.mock.calls.at(-1)?.[0],
    ).not.toHaveProperty('cursor');
  });

  it('reset clears every active filter from the URL', async () => {
    renderPanel('/sites/s1?tab=actions&state=planned&effort=high');
    await screen.findAllByTestId('action-card');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('actions-filters-reset'));
    await waitFor(() => expect(capturedSearch).toBe('?tab=actions'));
  });

  it('hides the reset affordance when no filter is active', async () => {
    renderPanel();
    await screen.findAllByTestId('action-card');
    expect(screen.queryByTestId('actions-filters-reset')).not.toBeInTheDocument();
  });

  it('pages forward with the server cursor and back to the first page', async () => {
    mocked.listActions.mockResolvedValueOnce(
      okResponse([item('p1')], { nextCursor: '25' }),
    );
    renderPanel();
    await screen.findAllByTestId('action-card');
    expect(screen.getByTestId('actions-prev')).toBeDisabled();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('actions-next'));
    await waitFor(() => expect(capturedSearch).toBe('?tab=actions&cursor=25'));
    await waitFor(() =>
      expect(mocked.listActions).toHaveBeenLastCalledWith(
        expect.objectContaining({ cursor: '25' }),
        expect.anything(),
      ),
    );
    await waitFor(() => expect(screen.getByTestId('actions-prev')).toBeEnabled());
    await user.click(screen.getByTestId('actions-prev'));
    await waitFor(() => expect(capturedSearch).toBe('?tab=actions'));
  });

  it('disables Next when the server reports no further page', async () => {
    renderPanel();
    await screen.findAllByTestId('action-card');
    expect(screen.getByTestId('actions-next')).toBeDisabled();
  });

  it('keeps the current list visible while refreshing', async () => {
    const store = makeStore();
    // Seed a ready list for the same site, then let the mount refetch hang —
    // the panel must retain the rows under the refreshing announcement.
    mocked.listActions.mockImplementationOnce(async () => okResponse([item('seeded')]));
    renderPanel('/sites/s1?tab=actions', store);
    await screen.findAllByTestId('action-card');
    mocked.listActions.mockImplementation(() => new Promise(() => undefined));
    const user = userEvent.setup();
    await user.click(screen.getByTestId('actions-filter-state'));
    await user.click(await screen.findByRole('option', { name: 'Open' }));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('Refreshing actions…'),
    );
    expect(screen.getAllByTestId('action-card')).toHaveLength(1);
    expect(screen.getByTestId('actions-list')).toHaveAttribute('aria-busy', 'true');
  });

  it('localizes the confidence and effort filter options', async () => {
    renderPanel();
    await screen.findAllByTestId('action-card');
    const user = userEvent.setup();
    await user.click(screen.getByTestId('actions-filter-confidence'));
    expect(await screen.findByRole('option', { name: 'High confidence' })).toBeVisible();
    await user.keyboard('{Escape}');
    await user.click(screen.getByTestId('actions-filter-effort'));
    expect(await screen.findByRole('option', { name: 'Low effort' })).toBeVisible();
    await user.keyboard('{Escape}');
    await user.click(screen.getByTestId('actions-filter-source'));
    expect(await screen.findByRole('option', { name: 'Site audit' })).toBeVisible();
  });
});

describe('ActionsPanel — source status and empty states', () => {
  it('keeps usable actions visible under a partial-source warning', async () => {
    mocked.listActions.mockResolvedValueOnce(
      okResponse([item('a1')], {
        sourceStatus: {
          audit_finding: { status: 'available' },
          ga4_decline: { status: 'stale' },
        },
      }),
    );
    renderPanel();
    expect(await screen.findByTestId('actions-partial-warning')).toBeInTheDocument();
    expect(screen.getAllByTestId('action-card')).toHaveLength(1);
  });

  it('distinguishes sources-unavailable from a true all-clear', async () => {
    mocked.listActions.mockResolvedValueOnce(
      okResponse([], {
        sourceStatus: {
          audit_finding: { status: 'unavailable' },
          confirmed_rank_drop: { status: 'unavailable' },
        },
      }),
    );
    renderPanel();
    expect(await screen.findByTestId('actions-empty-unavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('actions-empty-clear')).not.toBeInTheDocument();
  });

  it('shows the true all-clear only when every source is healthy', async () => {
    mocked.listActions.mockResolvedValueOnce(okResponse([]));
    renderPanel();
    expect(await screen.findByTestId('actions-empty-clear')).toBeInTheDocument();
    expect(screen.queryByTestId('actions-empty-unavailable')).not.toBeInTheDocument();
  });
});

describe('ActionsPanel — error states', () => {
  it('surfaces the server error message with a working retry', async () => {
    mocked.listActions.mockRejectedValueOnce(
      new ApiError('boom', 500, { error: { message: 'server exploded' } }),
    );
    renderPanel();
    expect(await screen.findByTestId('actions-error')).toHaveTextContent(
      'server exploded',
    );
    const user = userEvent.setup();
    await user.click(screen.getByTestId('actions-retry'));
    expect(await screen.findAllByTestId('action-card')).toHaveLength(2);
  });

  it('retry keeps the deep-linked cursor so the same page reloads', async () => {
    mocked.listActions.mockRejectedValueOnce(
      new ApiError('boom', 500, { error: { message: 'server exploded' } }),
    );
    renderPanel('/sites/s1?tab=actions&cursor=25');
    expect(await screen.findByTestId('actions-error')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByTestId('actions-retry'));
    await waitFor(() =>
      expect(mocked.listActions).toHaveBeenLastCalledWith(
        expect.objectContaining({ siteId: 's1', cursor: '25' }),
        expect.anything(),
      ),
    );
  });

  it('renders the generic localized not-found state on 404', async () => {
    mocked.listActions.mockRejectedValueOnce(new ApiError('missing', 404, {}));
    renderPanel();
    expect(await screen.findByTestId('actions-not-found')).toBeInTheDocument();
  });

  it('renders the sign-in-again guidance on 401', async () => {
    mocked.listActions.mockRejectedValueOnce(new ApiError('nope', 401, {}));
    renderPanel();
    expect(await screen.findByTestId('actions-error')).toHaveTextContent(
      'You need to sign in again to see this.',
    );
  });
});

describe('ActionCard — content, safe links, collapse', () => {
  it('maps eligible action context into a code prompt across workflow states', async () => {
    mocked.listActions.mockResolvedValueOnce(
      okResponse([
        item('eligible', {
          state: 'completed',
          codeFixPrompt: {
            reference: 'title-missing-or-weak',
            recommendedFix: 'Update the shared title template.',
            affectedUrlCount: 24,
          },
        }),
        item('manual'),
      ]),
    );
    renderPanel();
    const cards = await screen.findAllByTestId('action-card');
    const button = within(cards[0]!).getByTestId('code-fix-prompt');
    expect(JSON.parse(button.dataset.input ?? '')).toEqual({
      reference: 'title-missing-or-weak',
      severity: 'critical',
      confidence: 'high',
      problem: 'eligible problem',
      whyItMatters: 'eligible why it matters',
      recommendedFix: 'Update the shared title template.',
      affectedUrls: [
        'https://example.com/eligible/a',
        'https://example.com/eligible/b',
      ],
      affectedUrlCount: 24,
    });
    expect(within(cards[1]!).queryByTestId('code-fix-prompt')).toBeNull();
  });

  it('renders chips, meta, next step, and freshness from the payload', async () => {
    renderPanel();
    const card = (await screen.findAllByTestId('action-card'))[0]!;
    expect(within(card).getByTestId('action-state-chip')).toHaveTextContent('Open');
    expect(within(card).getByTestId('action-severity-chip')).toHaveTextContent(
      'Critical',
    );
    expect(within(card).getByTestId('action-source-chip')).toHaveTextContent(
      'Site audit',
    );
    expect(within(card).getByTestId('action-freshness-chip')).toHaveTextContent(
      'Fresh',
    );
    expect(within(card).getByTestId('action-why')).toHaveTextContent(
      'a1 why it matters',
    );
    expect(within(card).getByTestId('action-next-step')).toHaveTextContent(
      'a1 next step',
    );
    expect(within(card).getByTestId('action-impact')).toHaveTextContent('High impact');
    expect(within(card).getByTestId('action-confidence')).toHaveTextContent(
      'High confidence',
    );
    expect(within(card).getByTestId('action-effort')).toHaveTextContent('Low effort');
  });

  it('collapses affected URLs behind an accessible expansion', async () => {
    renderPanel();
    const card = (await screen.findAllByTestId('action-card'))[0]!;
    const toggle = within(card).getByTestId('action-urls-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('2 affected URLs');
    expect(within(card).queryByTestId('action-urls-list')).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(within(card).getByTestId('action-urls-list')).toHaveTextContent(
      'https://example.com/a1/a',
    );
  });

  it('labels a site-wide action and the one-URL case', async () => {
    mocked.listActions.mockResolvedValueOnce(
      okResponse([
        item('wide', { affectedUrls: [] }),
        item('single', { affectedUrls: ['https://example.com/one'] }),
      ]),
    );
    renderPanel();
    const cards = await screen.findAllByTestId('action-card');
    expect(within(cards[0]!).getByTestId('action-site-wide')).toHaveTextContent(
      'Site-wide',
    );
    expect(within(cards[1]!).getByTestId('action-urls-toggle')).toHaveTextContent(
      '1 affected URL',
    );
  });

  it('renders interpolated response copy as text without creating markup', async () => {
    mocked.listActions.mockResolvedValueOnce(okResponse([
      item('escaped', {
        problem: 'Review <img src=x onerror=alert(1)> safely',
      }),
    ]));
    renderPanel();

    const card = (await screen.findAllByTestId('action-card'))[0]!;
    expect(card).toHaveTextContent('Review <img src=x onerror=alert(1)> safely');
    expect(card.querySelector('img')).toBeNull();
  });

  it('renders safe evidence links with the required rel and drops unsafe ones', async () => {
    mocked.listActions.mockResolvedValueOnce(
      okResponse([
        item('safe'),
        item('unsafe', {
          evidence: [
            {
              sourceRef: 'sneaky',
              url: 'javascript:alert(1)',
              observation: { freshness: 'stale', observedAt: '2026-07-01T00:00:00.000Z' },
            },
          ],
        }),
        item('linkless', {
          evidence: [
            {
              sourceRef: 'no-url',
              observation: {
                freshness: 'unavailable',
                observedAt: '2026-07-01T00:00:00.000Z',
              },
            },
          ],
        }),
      ]),
    );
    renderPanel();
    const cards = await screen.findAllByTestId('action-card');
    const safeLink = within(cards[0]!).getByTestId('action-evidence-link');
    expect(safeLink).toHaveAttribute('href', 'https://vendor.example/safe');
    expect(safeLink).toHaveAttribute('rel', 'nofollow ugc noopener noreferrer');
    expect(
      within(cards[1]!).queryByTestId('action-evidence-link'),
    ).not.toBeInTheDocument();
    expect(within(cards[1]!).getByText('sneaky')).toBeInTheDocument();
    expect(
      within(cards[2]!).queryByTestId('action-evidence-link'),
    ).not.toBeInTheDocument();
  });

  it('renders the internal source link only when revalidation passes', async () => {
    mocked.listActions.mockResolvedValueOnce(
      okResponse([
        item('good'),
        item('bad', { sourceLink: 'https://evil.example/x' }),
        item('sneaky', { sourceLink: '//evil.example/x' }),
      ]),
    );
    renderPanel();
    const cards = await screen.findAllByTestId('action-card');
    expect(within(cards[0]!).getByTestId('action-source-link')).toHaveAttribute(
      'href',
      '/sites/s1?tab=report',
    );
    expect(within(cards[1]!).queryByTestId('action-source-link')).toBeNull();
    expect(within(cards[2]!).queryByTestId('action-source-link')).toBeNull();
  });

  it('offers only the allowed transitions for the current state', async () => {
    mocked.listActions.mockResolvedValueOnce(
      okResponse([item('o', { state: 'open' }), item('d', { state: 'dismissed' })]),
    );
    renderPanel();
    const cards = await screen.findAllByTestId('action-card');
    const open = cards[0]!;
    expect(within(open).getByTestId('action-transition-planned')).toBeInTheDocument();
    expect(within(open).getByTestId('action-transition-dismissed')).toBeInTheDocument();
    expect(within(open).getByTestId('action-transition-completed')).toBeInTheDocument();
    expect(within(open).queryByTestId('action-transition-open')).toBeNull();
    const dismissed = cards[1]!;
    expect(within(dismissed).getByTestId('action-transition-open')).toBeInTheDocument();
    expect(within(dismissed).getByTestId('action-transition-planned')).toBeInTheDocument();
    expect(within(dismissed).queryByTestId('action-transition-completed')).toBeNull();
  });

  it('shows the retest control only when the API advertises it, with the reason verbatim', async () => {
    mocked.listActions.mockResolvedValueOnce(
      okResponse([
        item('can'),
        item('cannot', {
          retest: { available: false, reason: 'Server says retest unavailable.' },
        }),
        item('silent', { retest: { available: false } }),
      ]),
    );
    renderPanel();
    const cards = await screen.findAllByTestId('action-card');
    expect(within(cards[0]!).getByTestId('action-retest-open')).toBeInTheDocument();
    expect(within(cards[1]!).queryByTestId('action-retest-open')).toBeNull();
    expect(within(cards[1]!).getByTestId('action-retest-reason')).toHaveTextContent(
      'Server says retest unavailable.',
    );
    expect(within(cards[2]!).queryByTestId('action-retest-open')).toBeNull();
    expect(within(cards[2]!).queryByTestId('action-retest-reason')).toBeNull();
  });

  it('omits the freshness chip and evidence block when the payload has no evidence', async () => {
    mocked.listActions.mockResolvedValueOnce(
      okResponse([item('bare', { evidence: [] })]),
    );
    renderPanel();
    const card = (await screen.findAllByTestId('action-card'))[0]!;
    expect(within(card).queryByTestId('action-freshness-chip')).toBeNull();
    expect(within(card).queryByTestId('action-evidence')).toBeNull();
  });

  it('onOpenChange(true) keeps the state dialog open without resetting the target', async () => {
    renderPanel();
    const card = (await screen.findAllByTestId('action-card'))[0]!;
    const user = userEvent.setup();
    await user.click(within(card).getByTestId('action-transition-planned'));
    const dialog = await screen.findByTestId('action-state-dialog');
    const handlers = getFiberOnOpenChangeHandlers(dialog);
    expect(handlers.length).toBeGreaterThan(0);
    act(() => {
      for (const h of handlers) h(true);
    });
    expect(screen.getByTestId('action-state-dialog')).toBeInTheDocument();
    expect(mocked.mutateActionState).not.toHaveBeenCalled();
  });

  it('opens the history drawer from the card control', async () => {
    renderPanel();
    const card = (await screen.findAllByTestId('action-card'))[0]!;
    const user = userEvent.setup();
    await user.click(within(card).getByTestId('action-history-open'));
    expect(await screen.findByTestId('action-history-drawer')).toBeInTheDocument();
    await waitFor(() =>
      expect(mocked.getActionHistory).toHaveBeenCalledWith(
        's1',
        'a1',
        expect.anything(),
      ),
    );
  });

  it('opens the retest dialog from the card control', async () => {
    renderPanel();
    const card = (await screen.findAllByTestId('action-card'))[0]!;
    const user = userEvent.setup();
    await user.click(within(card).getByTestId('action-retest-open'));
    expect(await screen.findByTestId('action-retest-dialog')).toBeInTheDocument();
    // Opening alone never spends — the retest call waits for the confirm.
    expect(mocked.retestAction).not.toHaveBeenCalled();
  });

  it('returns focus to the triggering control when the dialog closes on Escape', async () => {
    renderPanel();
    const card = (await screen.findAllByTestId('action-card'))[0]!;
    const trigger = within(card).getByTestId('action-transition-planned');
    const user = userEvent.setup();
    await user.click(trigger);
    expect(await screen.findByTestId('action-state-dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByTestId('action-state-dialog')).not.toBeInTheDocument(),
    );
    expect(mocked.mutateActionState).not.toHaveBeenCalled();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
