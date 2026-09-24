import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { configureStore } from '@reduxjs/toolkit';
import { Provider } from 'react-redux';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ApiError, apiClient } from '@shared/api/client';
import { changeLanguage, i18n, initI18n } from '@shared/i18n';
import { AlertsPage } from './components/AlertsPage';
import { DeliveryLog } from './components/DeliveryLog';
import { RuleBuilder } from './components/RuleBuilder';
import { RuleList } from './components/RuleList';
import { SecretRevealPanel } from './components/SecretRevealPanel';
import { StateNotice } from './components/StateNotice';
import {
  createAlertRule,
  deleteAlertRule,
  fetchAlertDeliveries,
  fetchAlertRules,
  fetchAlertSites,
  updateAlertRule,
} from './api';
import { alertsRoutes } from './routes';
import {
  alertsReducer,
  clearAlertSaveGate,
  dismissRevealedSecret,
  resetAlerts,
} from './store/slice';
import {
  selectAlertCapUsed,
  selectAlertDeliveries,
  selectAlertListGate,
  selectAlertListStatus,
  selectAlertLogGate,
  selectAlertLogStatus,
  selectAlertRules,
  selectAlertSaveGate,
  selectAlertSaveStatus,
  selectAlertSites,
  selectAlertSitesError,
  selectAlertSitesStatus,
  selectRevealedSecret,
} from './store/selectors';
import {
  createAlertRuleThunk,
  deleteAlertRuleThunk,
  loadAlertDeliveries,
  loadAlertRules,
  loadAlertSites,
  updateAlertRuleThunk,
} from './store/thunks';
import { toAlertGate } from './gate';
import { initialAlertsState, type AlertDelivery, type AlertRule } from './types';
import {
  isAlertChannel,
  isAlertDeliveryStatus,
  isAlertRuleType,
  isAlertTab,
  isRuleId,
  isSiteId,
  type AlertsUrlState,
  useAlertsUrlState,
} from './urlState';

vi.mock('@shared/api/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shared/api/client')>()),
  apiClient: vi.fn(),
}));

const authSession = vi.hoisted(() => ({
  user: { id: 'u1', email: 'owner@example.test', emailVerified: true } as {
    id: string;
    email: string;
    emailVerified: boolean;
  } | null,
}));

vi.mock('@features/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@features/auth')>()),
  useAuthSession: () => ({
    authenticated: true,
    isPending: false,
    emailVerified: true,
    user: authSession.user,
  }),
}));

const mockedApiClient = vi.mocked(apiClient);

const SITE_ID = 'a'.repeat(24);
const RULE_ID = '11111111-2222-4333-8444-555555555555';

const rule = (overrides: Partial<AlertRule> = {}): AlertRule => ({
  id: RULE_ID,
  siteId: SITE_ID,
  type: 'rank_drop',
  threshold: 10,
  enabled: true,
  emailRecipientIds: ['u1'],
  slackHostMasked: null,
  slackConfigured: false,
  webhookUrl: null,
  webhookSecretSet: false,
  webhookSecretLast4: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  ...overrides,
});

const delivery = (overrides: Partial<AlertDelivery> = {}): AlertDelivery => ({
  id: 'd1',
  ruleId: RULE_ID,
  channel: 'email',
  recipientRef: 'u1',
  transitionKind: 'rank_drop',
  status: 'sent',
  attempt: 1,
  errorCode: null,
  suppressedReason: null,
  evidence: {
    kind: 'rank_drop',
    keyword: 'seo audit tool',
    threshold: 10,
    before: { at: '2026-07-01T00:00:00.000Z', position: 3 },
    after: { at: '2026-07-02T00:00:00.000Z', position: 24 },
  },
  createdAt: '2026-07-02T00:00:00.000Z',
  updatedAt: '2026-07-02T00:00:00.000Z',
  ...overrides,
});

let search = '';
const LocationProbe = () => {
  search = useLocation().search;
  return null;
};

let capturedUrlState: AlertsUrlState | null = null;
const UrlStateProbe = () => {
  capturedUrlState = useAlertsUrlState();
  return <LocationProbe />;
};

const renderPage = (entry = '/dashboard/alerts') => {
  search = '';
  const store = configureStore({ reducer: { alerts: alertsReducer } });
  return {
    store,
    ...render(
      <Provider store={store}>
        <I18nextProvider i18n={i18n}>
          <MemoryRouter initialEntries={[entry]}>
            <AlertsPage />
            <LocationProbe />
          </MemoryRouter>
        </I18nextProvider>
      </Provider>,
    ),
  };
};

interface Handlers {
  sites?: () => unknown;
  rules?: () => unknown;
  create?: () => unknown;
  patch?: () => unknown;
  remove?: () => unknown;
  deliveries?: () => unknown;
}

/** Route each mocked call by path so ordering never matters. */
const routeApi = (handlers: Handlers = {}) => {
  mockedApiClient.mockImplementation((path: string, init?: { method?: string }) => {
    if (path === '/sites') {
      return Promise.resolve(
        handlers.sites?.() ?? {
          sites: [{ id: SITE_ID, domain: 'example.test', displayName: 'example.test' }],
        },
      ) as never;
    }
    if (path.includes('/deliveries')) {
      return Promise.resolve(handlers.deliveries?.() ?? { deliveries: [delivery()] }) as never;
    }
    if (path.startsWith('/alerts/rules') && init?.method === 'POST') {
      return Promise.resolve(handlers.create?.() ?? rule()) as never;
    }
    if (path.startsWith('/alerts/rules/') && init?.method === 'PATCH') {
      return Promise.resolve(handlers.patch?.() ?? rule({ enabled: false })) as never;
    }
    if (path.startsWith('/alerts/rules/') && init?.method === 'DELETE') {
      return Promise.resolve(handlers.remove?.() ?? undefined) as never;
    }
    return Promise.resolve(handlers.rules?.() ?? { rules: [rule()], cap: { used: 1 } }) as never;
  });
};

beforeEach(async () => {
  await initI18n();
  await changeLanguage('en');
  mockedApiClient.mockReset();
  authSession.user = { id: 'u1', email: 'owner@example.test', emailVerified: true };
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('alerts API and route loader', () => {
  it('serializes every optional filter and forwards abort signals', async () => {
    const controller = new AbortController();
    mockedApiClient
      .mockResolvedValueOnce({
        sites: [{ id: SITE_ID, domain: 'example.test', displayName: 'Example' }],
      } as never)
      .mockResolvedValueOnce({ sites: [] } as never)
      .mockResolvedValueOnce({ rules: [], cap: { used: 0 } } as never)
      .mockResolvedValueOnce({ rules: [], cap: { used: 0 } } as never)
      .mockResolvedValueOnce(rule() as never)
      .mockResolvedValueOnce(rule({ enabled: false }) as never)
      .mockResolvedValueOnce(undefined as never)
      .mockResolvedValueOnce({ deliveries: [] } as never)
      .mockResolvedValueOnce({ deliveries: [delivery()] } as never);

    await expect(fetchAlertSites()).resolves.toEqual([
      { id: SITE_ID, domain: 'example.test', displayName: 'Example' },
    ]);
    await fetchAlertSites({ signal: controller.signal });
    await fetchAlertRules();
    await fetchAlertRules({
      siteId: SITE_ID,
      type: 'lost_backlink',
      enabled: false,
      signal: controller.signal,
    });
    await createAlertRule({ siteId: SITE_ID, type: 'new_backlink' });
    await updateAlertRule(RULE_ID, { enabled: false });
    await deleteAlertRule(RULE_ID);
    await fetchAlertDeliveries(RULE_ID);
    await fetchAlertDeliveries(RULE_ID, {
      status: 'failed',
      channel: 'webhook',
      signal: controller.signal,
    });

    expect(mockedApiClient.mock.calls).toEqual([
      ['/sites', {}],
      ['/sites', { signal: controller.signal }],
      ['/alerts/rules', {}],
      [
        `/alerts/rules?siteId=${SITE_ID}&type=lost_backlink&enabled=false`,
        { signal: controller.signal },
      ],
      ['/alerts/rules', { method: 'POST', body: { siteId: SITE_ID, type: 'new_backlink' } }],
      [`/alerts/rules/${RULE_ID}`, { method: 'PATCH', body: { enabled: false } }],
      [`/alerts/rules/${RULE_ID}`, { method: 'DELETE' }],
      [`/alerts/rules/${RULE_ID}/deliveries`, {}],
      [
        `/alerts/rules/${RULE_ID}/deliveries?status=failed&channel=webhook`,
        { signal: controller.signal },
      ],
    ]);
  });

  it('keeps the authenticated workspace distinct from the public alerts landing page', () => {
    expect(alertsRoutes[0]?.path).toBe('dashboard/alerts');
  });

  it('loads the lazily injected authenticated route', async () => {
    expect(alertsRoutes).toHaveLength(1);
    const loaded = await alertsRoutes[0]!.lazy!();
    expect(loaded).toHaveProperty('element');
  });
});

describe('alerts URL state', () => {
  it('validates every finite URL-state domain', () => {
    expect(isAlertTab('rules')).toBe(true);
    expect(isAlertTab(null)).toBe(false);
    expect(isAlertRuleType('rank_drop')).toBe(true);
    expect(isAlertRuleType(1)).toBe(false);
    expect(isAlertChannel('email')).toBe(true);
    expect(isAlertChannel({})).toBe(false);
    expect(isAlertDeliveryStatus('sent')).toBe(true);
    expect(isAlertDeliveryStatus(undefined)).toBe(false);
    expect(isSiteId(SITE_ID)).toBe(true);
    expect(isSiteId('short')).toBe(false);
    expect(isRuleId(RULE_ID)).toBe(true);
    expect(isRuleId('not-a-rule')).toBe(false);
  });

  it('normalizes every hostile parameter and exercises every setter', async () => {
    const invalid = render(
      <MemoryRouter
        initialEntries={[
          '/dashboard/alerts?tab=x&siteId=x&type=x&enabled=x&rule=x&status=x&channel=x',
        ]}
      >
        <UrlStateProbe />
      </MemoryRouter>,
    );
    await waitFor(() => expect(search).toBe(''));
    invalid.unmount();

    const validTab = render(
      <MemoryRouter initialEntries={['/dashboard/alerts?tab=rules&type=x']}>
        <UrlStateProbe />
      </MemoryRouter>,
    );
    await waitFor(() => expect(search).toBe('?tab=rules'));
    validTab.unmount();

    render(
      <MemoryRouter initialEntries={['/dashboard/alerts']}>
        <UrlStateProbe />
      </MemoryRouter>,
    );
    expect(capturedUrlState).not.toBeNull();

    act(() => capturedUrlState!.setTab('log'));
    await waitFor(() => expect(search).toContain('tab=log'));
    act(() => capturedUrlState!.setSiteId(SITE_ID));
    await waitFor(() => expect(search).toContain(`siteId=${SITE_ID}`));
    act(() => capturedUrlState!.setType('new_backlink'));
    await waitFor(() => expect(search).toContain('type=new_backlink'));
    act(() => capturedUrlState!.setEnabled(true));
    await waitFor(() => expect(search).toContain('enabled=true'));
    act(() => capturedUrlState!.setRule(RULE_ID));
    await waitFor(() => expect(search).toContain(`rule=${RULE_ID}`));
    act(() => capturedUrlState!.setStatus('suppressed'));
    await waitFor(() => expect(search).toContain('status=suppressed'));
    act(() => capturedUrlState!.setChannel('slack'));
    await waitFor(() => expect(search).toContain('channel=slack'));

    act(() =>
      capturedUrlState!.setMany({
        tab: 'rules',
        siteId: null,
        type: undefined,
        channel: 'webhook',
      }),
    );
    await waitFor(() => {
      expect(search).toContain('tab=rules');
      expect(search).not.toContain('siteId=');
      expect(search).toContain('type=new_backlink');
      expect(search).toContain('channel=webhook');
    });
    act(() => capturedUrlState!.setEnabled(null));
    await waitFor(() => expect(search).not.toContain('enabled='));
    act(() => capturedUrlState!.setRule(null));
    await waitFor(() => expect(search).not.toContain('rule='));
    act(() => capturedUrlState!.setStatus(null));
    await waitFor(() => expect(search).not.toContain('status='));
    act(() => capturedUrlState!.setChannel(null));
    await waitFor(() => expect(search).not.toContain('channel='));
  });
});

describe('AlertsPage — rules tab', () => {
  it('lists configured rules with their cap usage', async () => {
    routeApi();
    renderPage();

    expect(await screen.findByTestId('alerts-rule-list')).toBeInTheDocument();
    expect(screen.getByText('1 rules in use.')).toBeInTheDocument();
    // 'Rank drop' also appears as a builder <option>, so scope to the table.
    const list = screen.getByTestId('alerts-rule-list');
    expect(within(list).getByText('Rank drop')).toBeInTheDocument();
  });

  it('shows the empty state when no rule exists', async () => {
    routeApi({ rules: () => ({ rules: [], cap: { used: 0 } }) });
    renderPage();

    expect(await screen.findByTestId('alerts-state-empty')).toBeInTheDocument();
  });

  it('keeps a pending save safe when a malformed list has no first row', async () => {
    routeApi({
      rules: () => ({ rules: Array<AlertRule>(1), cap: { used: 1 } }),
      create: () => new Promise(() => {}),
    });
    renderPage(`/alerts?siteId=${SITE_ID}`);
    await screen.findByTestId('alerts-rule-list');

    await userEvent.click(screen.getByRole('button', { name: 'Create rule' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create rule' })).toBeDisabled());
  });

  it('shows the no-sites state and switches tabs through the Tabs control', async () => {
    routeApi({
      sites: () => ({ sites: [] }),
      rules: () => ({ rules: [], cap: { used: 0 } }),
    });
    renderPage();

    expect(await screen.findByTestId('alerts-state-noSites')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Delivery log' }));
    await waitFor(() => expect(search).toContain('tab=log'));
  });

  it('shows a list-level disabled notice while preserving the builder', async () => {
    routeApi({
      rules: () => {
        throw new ApiError('Service Unavailable', 503, {
          error: { message: 'Stored alert reads are temporarily unavailable.' },
        });
      },
    });
    renderPage(`/alerts?siteId=${SITE_ID}`);

    expect(await screen.findByTestId('alerts-state-disabled')).toHaveTextContent(
      'Stored alert reads are temporarily unavailable.',
    );
    expect(screen.getByTestId('alerts-rule-builder')).toBeInTheDocument();
  });

  it('renders the cap refusal with the server message and a plans link', async () => {
    routeApi({
      rules: () => {
        throw new ApiError('Payment Required', 402, {
          error: {
            message: 'You have used every alert rule on your plan.',
            details: { structuralLimit: 'alertRules', used: 2, limit: 2 },
          },
        });
      },
    });
    renderPage();

    expect(await screen.findByTestId('alerts-state-cap')).toBeInTheDocument();
    expect(screen.getByText('You have used every alert rule on your plan.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'See plans' })).not.toBeInTheDocument();
  });

  it('keeps stored rules readable when the kill switch is off', async () => {
    routeApi({
      create: () => {
        throw new ApiError('Service Unavailable', 503, {
          error: { message: 'Alerts are temporarily unavailable.' },
        });
      },
    });
    const { store } = renderPage(`/alerts?siteId=${SITE_ID}`);
    await screen.findByTestId('alerts-rule-list');

    await userEvent.click(screen.getByRole('button', { name: 'Create rule' }));

    expect(await screen.findByTestId('alerts-state-disabled')).toBeInTheDocument();
    // The list survived the refusal — stored reads are never gated.
    expect(selectAlertRules(store.getState() as never)).toHaveLength(1);
  });

  it('locks the paid channel inputs after a tier refusal', async () => {
    routeApi({
      create: () => {
        throw new ApiError('Payment Required', 402, {
          error: {
            message: 'Slack and webhook channels need the Pro plan or higher.',
            details: { requiredTier: 'pro' },
          },
        });
      },
    });
    renderPage(`/alerts?siteId=${SITE_ID}`);
    await screen.findByTestId('alerts-rule-builder');

    await userEvent.click(screen.getByRole('button', { name: 'Create rule' }));

    expect(await screen.findByTestId('alerts-state-tierLocked')).toBeInTheDocument();
    expect(screen.getByLabelText('Slack')).toBeDisabled();
    expect(screen.getByLabelText('Webhook')).toBeDisabled();
    expect(screen.getAllByTestId(/alerts-(slack|webhook)-locked/)).toHaveLength(2);
  });

  it('reveals a freshly minted secret once, then never again', async () => {
    const secret = 'f'.repeat(64);
    routeApi({
      create: () => rule({ webhookUrl: 'https://hooks.example.test/x', webhookSecret: secret }),
    });
    const { store } = renderPage(`/alerts?siteId=${SITE_ID}`);
    await screen.findByTestId('alerts-rule-builder');

    await userEvent.click(screen.getByRole('button', { name: 'Create rule' }));

    expect(await screen.findByTestId('alerts-secret-value')).toHaveTextContent(secret);
    // The secret lives ONLY in `revealedSecret` — never on the stored rule row.
    expect(selectAlertRules(store.getState() as never)[0]).not.toHaveProperty('webhookSecret');

    await userEvent.click(screen.getByRole('button', { name: 'I have copied it' }));
    await waitFor(() =>
      expect(screen.queryByTestId('alerts-secret-reveal')).not.toBeInTheDocument(),
    );
    expect(selectRevealedSecret(store.getState() as never)).toBeNull();
  });

  it('refuses to submit with no channel selected', async () => {
    routeApi();
    renderPage();
    await screen.findByTestId('alerts-rule-builder');

    await userEvent.click(screen.getByLabelText('Email'));

    expect(await screen.findByTestId('alerts-no-channel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create rule' })).toBeDisabled();
  });

  it('does not invent an email recipient when the auth session has no user', async () => {
    authSession.user = null;
    routeApi();
    renderPage(`/alerts?siteId=${SITE_ID}`);

    expect(await screen.findByTestId('alerts-no-channel')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create rule' })).toBeDisabled();
  });

  it('persists list filters in the URL', async () => {
    routeApi();
    renderPage();
    await screen.findByTestId('alerts-rule-list');

    await userEvent.selectOptions(screen.getByLabelText('Type'), 'new_backlink');
    await waitFor(() => expect(search).toContain('type=new_backlink'));

    await userEvent.selectOptions(screen.getByLabelText('State'), 'false');
    await waitFor(() => expect(search).toContain('enabled=false'));

    await userEvent.selectOptions(screen.getByLabelText('Type'), '');
    await waitFor(() => expect(search).not.toContain('type='));
    await userEvent.selectOptions(screen.getByLabelText('State'), '');
    await waitFor(() => expect(search).not.toContain('enabled='));
  });

  it('normalizes an invalid tab straight back out of the URL', async () => {
    routeApi();
    renderPage('/dashboard/alerts?tab=bogus');
    await screen.findByTestId('alerts-rule-list');
    await waitFor(() => expect(search).not.toContain('bogus'));
  });

  it('toggles and deletes a rule', async () => {
    routeApi();
    const { store } = renderPage();
    await screen.findByTestId('alerts-rule-list');

    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    await waitFor(() =>
      expect(selectAlertRules(store.getState() as never)[0]!.enabled).toBe(false),
    );

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(selectAlertRules(store.getState() as never)).toHaveLength(0));
  });
});

describe('RuleBuilder', () => {
  it('edits every field and submits a non-rank rule with paid channels', async () => {
    const onSubmit = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <RuleBuilder
          sites={[{ id: SITE_ID, domain: 'example.test', displayName: 'Example' }]}
          siteId={null}
          currentUserId="u1"
          paidChannelsLocked={false}
          capReached={false}
          submitting={false}
          onSubmit={onSubmit}
        />
      </I18nextProvider>,
    );

    await userEvent.click(screen.getByLabelText('Site'));
    await userEvent.click(screen.getByRole('option', { name: 'Example' }));
    await userEvent.clear(screen.getByLabelText('Position threshold'));
    await userEvent.type(screen.getByLabelText('Position threshold'), '17');
    await userEvent.click(screen.getByLabelText('Alert type'));
    await userEvent.click(screen.getByRole('option', { name: 'New links' }));
    await userEvent.click(screen.getByLabelText('Email'));
    await userEvent.type(screen.getByLabelText('Slack'), 'https://hooks.slack.test/services/x');
    await userEvent.type(screen.getByLabelText('Webhook'), 'https://hooks.example.test/x');
    await userEvent.click(screen.getByRole('button', { name: 'Create rule' }));

    expect(onSubmit).toHaveBeenCalledWith({
      siteId: SITE_ID,
      type: 'new_backlink',
      slackWebhookUrl: 'https://hooks.slack.test/services/x',
      webhookUrl: 'https://hooks.example.test/x',
    });
  });

  it('submits the authenticated user id for the email channel', async () => {
    const onSubmit = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <RuleBuilder
          sites={[{ id: SITE_ID, domain: 'example.test', displayName: 'Example' }]}
          siteId={SITE_ID}
          currentUserId="authenticated-user-id"
          paidChannelsLocked={false}
          capReached={false}
          submitting={false}
          onSubmit={onSubmit}
        />
      </I18nextProvider>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Create rule' }));

    expect(onSubmit).toHaveBeenCalledWith({
      siteId: SITE_ID,
      type: 'rank_drop',
      threshold: 10,
      emailRecipientIds: ['authenticated-user-id'],
    });
  });

  it('refuses a forged submit while the builder is disabled', () => {
    const onSubmit = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <RuleBuilder
          sites={[]}
          siteId={null}
          currentUserId="u1"
          paidChannelsLocked={false}
          capReached
          submitting={false}
          onSubmit={onSubmit}
        />
      </I18nextProvider>,
    );
    fireEvent.submit(screen.getByTestId('alerts-rule-builder'));
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('AlertsPage — log tab', () => {
  it('opens one rule log and shows both observations', async () => {
    routeApi();
    renderPage();
    await screen.findByTestId('alerts-rule-list');

    await userEvent.click(screen.getByRole('button', { name: 'View log' }));

    expect(await screen.findByTestId('alerts-delivery-log')).toBeInTheDocument();
    expect(
      screen.getByText('Position 3 on 2026-07-01, then 24 on 2026-07-02.'),
    ).toBeInTheDocument();
    await waitFor(() => expect(search).toContain(`rule=${RULE_ID}`));
  });

  it('asks for a rule before rendering a log', async () => {
    routeApi();
    renderPage('/dashboard/alerts?tab=log');
    expect(await screen.findByTestId('alerts-state-empty')).toBeInTheDocument();
  });

  it('discloses a log read failure', async () => {
    routeApi({
      deliveries: () => {
        throw new ApiError('Not Found', 404, {
          error: { message: 'Alert rule not found.' },
        });
      },
    });
    renderPage(`/alerts?tab=log&rule=${RULE_ID}`);
    expect(await screen.findByTestId('alerts-state-notFound')).toBeInTheDocument();
  });

  it('renders an empty completed delivery log', async () => {
    routeApi({ deliveries: () => ({ deliveries: [] }) });
    renderPage(`/alerts?tab=log&rule=${RULE_ID}`);
    expect(await screen.findByTestId('alerts-state-empty')).toBeInTheDocument();
  });
});

describe('DeliveryLog', () => {
  it('labels a lost ranking instead of printing a bare null', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <DeliveryLog
          deliveries={[
            delivery({
              evidence: {
                kind: 'rank_drop',
                keyword: 'seo audit tool',
                threshold: 10,
                before: { at: '2026-07-01T00:00:00.000Z', position: 3 },
                after: { at: '2026-07-02T00:00:00.000Z', position: null },
              },
            }),
          ]}
        />
      </I18nextProvider>,
    );
    expect(
      screen.getByText(/Position 3 on 2026-07-01, then below the top 100/),
    ).toBeInTheDocument();
  });

  it('labels an absent starting rank as well', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <DeliveryLog
          deliveries={[
            delivery({
              evidence: {
                kind: 'rank_drop',
                keyword: 'seo audit tool',
                threshold: 10,
                before: { at: '2026-07-01T00:00:00.000Z', position: null },
                after: { at: '2026-07-02T00:00:00.000Z', position: 24 },
              },
            }),
          ]}
        />
      </I18nextProvider>,
    );
    expect(
      screen.getByText(/Position below the top 100 on 2026-07-01, then 24/),
    ).toBeInTheDocument();
  });

  it('renders a link transition with its bounded domain sample', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <DeliveryLog
          deliveries={[
            delivery({
              channel: 'webhook',
              recipientRef: null,
              transitionKind: 'new_backlink',
              evidence: {
                kind: 'new_backlink',
                before: { at: '2026-07-01T00:00:00.000Z', reviewId: 'r1', rowCount: 4 },
                after: { at: '2026-07-02T00:00:00.000Z', reviewId: 'r2', rowCount: 9 },
                changedDomains: ['fresh.test'],
                changedTotal: 5,
              },
            }),
          ]}
        />
      </I18nextProvider>,
    );
    expect(screen.getByText('5 domains changed')).toBeInTheDocument();
    expect(screen.getByText('fresh.test')).toBeInTheDocument();
  });

  it('names a suppression and a failure without vendor prose', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <DeliveryLog
          deliveries={[
            delivery({ id: 'd2', status: 'suppressed', suppressedReason: 'opted_out' }),
            delivery({
              id: 'd3',
              status: 'failed',
              channel: 'slack',
              recipientRef: null,
              errorCode: 'transport_rejected',
            }),
          ]}
        />
      </I18nextProvider>,
    );
    expect(screen.getByText('Recipient turned these emails off.')).toBeInTheDocument();
    expect(screen.getByText('The channel refused the message.')).toBeInTheDocument();
  });

  it('renders a hostile domain as inert text', () => {
    const hostile = '<script>alert(1)</script>.test';
    render(
      <I18nextProvider i18n={i18n}>
        <DeliveryLog
          deliveries={[
            delivery({
              transitionKind: 'lost_backlink',
              evidence: {
                kind: 'lost_backlink',
                before: { at: '2026-07-01T00:00:00.000Z', reviewId: 'r1', rowCount: 2 },
                after: { at: '2026-07-02T00:00:00.000Z', reviewId: 'r2', rowCount: 1 },
                changedDomains: [hostile],
                changedTotal: 1,
              },
            }),
          ]}
        />
      </I18nextProvider>,
    );
    expect(screen.getByText(hostile)).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
  });
});

describe('RuleList', () => {
  it('shows masked channel values only', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <RuleList
            rules={[
              rule({
                slackConfigured: true,
                slackHostMasked: 'hooks.slack.test/services/…',
                webhookUrl: 'https://hooks.example.test/x',
                webhookSecretSet: true,
                webhookSecretLast4: 'abcd',
              }),
            ]}
            busyRuleId={null}
            onToggle={() => {}}
            onDelete={() => {}}
            onOpenLog={() => {}}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.getByText('hooks.slack.test/services/…')).toBeInTheDocument();
    expect(screen.getByText('signing key ends abcd')).toBeInTheDocument();
    // A customer-supplied webhook URL is text, never an anchor.
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders nullable fields and invokes every row action', async () => {
    const inactive = rule({
      threshold: null,
      enabled: false,
      emailRecipientIds: [],
      slackConfigured: false,
      slackHostMasked: null,
      webhookUrl: null,
      webhookSecretLast4: null,
    });
    const onToggle = vi.fn();
    const onDelete = vi.fn();
    const onOpenLog = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <RuleList
            rules={[inactive]}
            busyRuleId={null}
            onToggle={onToggle}
            onDelete={onDelete}
            onOpenLog={onOpenLog}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );

    expect(screen.getByText('—')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    await userEvent.click(screen.getByRole('button', { name: 'View log' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onToggle).toHaveBeenCalledWith(inactive);
    expect(onOpenLog).toHaveBeenCalledWith(inactive);
    expect(onDelete).toHaveBeenCalledWith(inactive);
  });
});

describe('SecretRevealPanel', () => {
  it('renders the secret in a code element and dismisses', async () => {
    const onDismiss = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <SecretRevealPanel secret="deadbeef" onDismiss={onDismiss} />
      </I18nextProvider>,
    );
    expect(screen.getByTestId('alerts-secret-value').tagName).toBe('CODE');
    await userEvent.click(screen.getByRole('button', { name: 'I have copied it' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});

describe('StateNotice', () => {
  it('falls back to its own copy when the server said nothing', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <MemoryRouter>
          <StateNotice kind="noSites" />
        </MemoryRouter>
      </I18nextProvider>,
    );
    expect(screen.getByText('Alerts watch a site, so add one to begin.')).toBeInTheDocument();
  });
});

describe('toAlertGate', () => {
  it('separates a structural cap from a channel tier refusal on the same 402', () => {
    const cap = toAlertGate(
      new ApiError('x', 402, {
        error: { message: 'cap', details: { structuralLimit: 'alertRules' } },
      }),
      'fallback',
    );
    expect(cap).toEqual({ kind: 'cap', message: 'cap' });

    const tier = toAlertGate(
      new ApiError('x', 402, {
        error: { message: 'tier', details: { requiredTier: 'pro' } },
      }),
      'fallback',
    );
    expect(tier).toEqual({ kind: 'tierLocked', message: 'tier' });
  });

  it('maps every other disclosed status and falls back for the rest', () => {
    expect(toAlertGate(new ApiError('x', 400, {}), 'f').kind).toBe('invalid');
    expect(toAlertGate(new ApiError('x', 404, {}), 'f').kind).toBe('notFound');
    expect(toAlertGate(new ApiError('x', 429, {}), 'f').kind).toBe('rateLimited');
    expect(toAlertGate(new ApiError('x', 503, {}), 'f').kind).toBe('disabled');
    expect(toAlertGate(new ApiError('x', 418, {}), 'f')).toEqual({
      kind: 'failed',
      message: 'f',
    });
    expect(toAlertGate(new Error('boom'), 'f')).toEqual({ kind: 'failed', message: 'f' });
  });
});

describe('alerts slice', () => {
  it('starts from the documented initial state', () => {
    const store = configureStore({ reducer: { alerts: alertsReducer } });
    expect((store.getState() as { alerts: typeof initialAlertsState }).alerts).toEqual(
      initialAlertsState,
    );
  });

  it('dismissing a secret is idempotent', () => {
    const store = configureStore({ reducer: { alerts: alertsReducer } });
    store.dispatch(dismissRevealedSecret());
    store.dispatch(dismissRevealedSecret());
    expect(selectRevealedSecret(store.getState() as never)).toBeNull();
  });

  it('selectors survive a store with the slice not yet injected', () => {
    const bare = configureStore({ reducer: { other: () => 0 } });
    expect(selectAlertRules(bare.getState() as never)).toEqual([]);
    expect(selectRevealedSecret(bare.getState() as never)).toBeNull();
  });

  it('exposes every slice field through selectors', () => {
    const state = {
      alerts: {
        ...initialAlertsState,
        sites: [{ id: SITE_ID, domain: 'example.test', displayName: 'Example' }],
        sitesStatus: 'failed' as const,
        sitesError: 'offline',
        rules: [rule()],
        capUsed: 1,
        listStatus: 'failed' as const,
        listGate: { kind: 'cap' as const, message: 'cap' },
        saveStatus: 'loading' as const,
        saveGate: { kind: 'tierLocked' as const, message: 'tier' },
        revealedSecret: { ruleId: RULE_ID, secret: 'secret' },
        deliveries: [delivery()],
        logStatus: 'succeeded' as const,
        logGate: { kind: 'notFound' as const, message: 'missing' },
      },
    };
    expect(selectAlertSites(state as never)).toHaveLength(1);
    expect(selectAlertSitesStatus(state as never)).toBe('failed');
    expect(selectAlertSitesError(state as never)).toBe('offline');
    expect(selectAlertRules(state as never)).toHaveLength(1);
    expect(selectAlertCapUsed(state as never)).toBe(1);
    expect(selectAlertListStatus(state as never)).toBe('failed');
    expect(selectAlertListGate(state as never)?.kind).toBe('cap');
    expect(selectAlertSaveStatus(state as never)).toBe('loading');
    expect(selectAlertSaveGate(state as never)?.kind).toBe('tierLocked');
    expect(selectRevealedSecret(state as never)?.secret).toBe('secret');
    expect(selectAlertDeliveries(state as never)).toHaveLength(1);
    expect(selectAlertLogStatus(state as never)).toBe('succeeded');
    expect(selectAlertLogGate(state as never)?.kind).toBe('notFound');
  });

  it('reduces every fulfilled lifecycle and clears matching one-time secrets', async () => {
    let createCount = 0;
    routeApi({
      rules: () => ({
        rules: [rule(), rule({ id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' })],
        cap: { used: 2 },
      }),
      create: () => rule({ webhookSecret: createCount++ === 0 ? 'minted-secret' : undefined }),
      patch: () => rule({ enabled: false, webhookSecret: 'rotated-secret' }),
      deliveries: () => ({ deliveries: [delivery()] }),
    });
    const store = configureStore({ reducer: { alerts: alertsReducer } });

    await store.dispatch(loadAlertSites());
    await store.dispatch(loadAlertRules(undefined));
    await store.dispatch(createAlertRuleThunk({ siteId: SITE_ID, type: 'rank_drop' }));
    expect(selectRevealedSecret(store.getState() as never)?.secret).toBe('minted-secret');
    await store.dispatch(createAlertRuleThunk({ siteId: SITE_ID, type: 'rank_drop' }));
    expect(selectRevealedSecret(store.getState() as never)).toBeNull();
    await store.dispatch(updateAlertRuleThunk({ ruleId: RULE_ID, patch: { enabled: false } }));
    expect(selectRevealedSecret(store.getState() as never)?.secret).toBe('rotated-secret');
    await store.dispatch(loadAlertDeliveries({ ruleId: RULE_ID }));
    await store.dispatch(deleteAlertRuleThunk(RULE_ID));

    expect(selectAlertSitesStatus(store.getState() as never)).toBe('succeeded');
    expect(selectAlertListStatus(store.getState() as never)).toBe('succeeded');
    expect(selectAlertLogStatus(store.getState() as never)).toBe('succeeded');
    expect(selectRevealedSecret(store.getState() as never)).toBeNull();
    expect(selectAlertRules(store.getState() as never)).toHaveLength(1);

    store.dispatch(clearAlertSaveGate());
    expect(selectAlertSaveStatus(store.getState() as never)).toBe('idle');
    store.dispatch(resetAlerts());
    expect((store.getState() as { alerts: typeof initialAlertsState }).alerts).toEqual(
      initialAlertsState,
    );
  });

  it('reduces every rejected lifecycle, including payload-less fallbacks', async () => {
    mockedApiClient.mockRejectedValue(new Error('offline'));
    const store = configureStore({ reducer: { alerts: alertsReducer } });

    await store.dispatch(loadAlertSites());
    expect(selectAlertSitesStatus(store.getState() as never)).toBe('failed');
    expect(selectAlertSitesError(store.getState() as never)).not.toBe('');
    await store.dispatch(loadAlertRules(undefined));
    await store.dispatch(createAlertRuleThunk({ siteId: SITE_ID, type: 'new_backlink' }));
    await store.dispatch(updateAlertRuleThunk({ ruleId: RULE_ID, patch: { enabled: false } }));
    await store.dispatch(deleteAlertRuleThunk(RULE_ID));
    await store.dispatch(loadAlertDeliveries({ ruleId: RULE_ID }));

    expect(selectAlertListStatus(store.getState() as never)).toBe('failed');
    expect(selectAlertSaveStatus(store.getState() as never)).toBe('failed');
    expect(selectAlertLogStatus(store.getState() as never)).toBe('failed');

    store.dispatch({ type: loadAlertSites.rejected.type });
    store.dispatch({ type: loadAlertRules.rejected.type });
    store.dispatch({ type: updateAlertRuleThunk.rejected.type });
    store.dispatch({ type: deleteAlertRuleThunk.rejected.type });
    expect(selectAlertSitesError(store.getState() as never)).toBe('');
    expect(selectAlertListGate(store.getState() as never)).toBeNull();
    expect(selectAlertSaveGate(store.getState() as never)).toBeNull();
  });
});

describe('Arabic RTL', () => {
  it('renders the workspace in Arabic', async () => {
    routeApi();
    await changeLanguage('ar');
    renderPage();
    expect(await screen.findByText('التنبيهات')).toBeInTheDocument();
    await changeLanguage('en');
  });
});
