import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { useAuthSession } from '@features/auth';
import { PageHeader } from '@shared/components/PageHeader';
import { APP_PAGE_ICONS } from '@shared/navigation/appPageIcons';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Spinner } from '@shared/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@shared/ui/tabs';
import type { CreateRuleInput } from '../api';
import { ALERT_RULE_TYPES, type AlertRule, type AlertRuleType } from '../types';
import { ALERT_TABS, useAlertsUrlState, type AlertTab } from '../urlState';
import { dismissRevealedSecret } from '../store/slice';
import {
  createAlertRuleThunk,
  deleteAlertRuleThunk,
  loadAlertDeliveries,
  loadAlertRules,
  loadAlertSites,
  updateAlertRuleThunk,
} from '../store/thunks';
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
  selectAlertSitesStatus,
  selectRevealedSecret,
} from '../store/selectors';
import { DeliveryLog } from './DeliveryLog';
import { RuleBuilder } from './RuleBuilder';
import { RuleList } from './RuleList';
import { SecretRevealPanel } from './SecretRevealPanel';
import { StateNotice } from './StateNotice';

/**
 * Alerts workspace. Two URL-backed tabs: the rule list plus its builder, and
 * one rule's delivery log. Every refusal the server can make has a visible
 * state here; nothing is silently swallowed.
 */
export const AlertsPage = () => {
  const { t } = useTranslation('alerts');
  const { user } = useAuthSession();
  const dispatch = useAppDispatch();
  const url = useAlertsUrlState();

  const sites = useAppSelector(selectAlertSites);
  const sitesStatus = useAppSelector(selectAlertSitesStatus);
  const rules = useAppSelector(selectAlertRules);
  const capUsed = useAppSelector(selectAlertCapUsed);
  const listStatus = useAppSelector(selectAlertListStatus);
  const listGate = useAppSelector(selectAlertListGate);
  const saveStatus = useAppSelector(selectAlertSaveStatus);
  const saveGate = useAppSelector(selectAlertSaveGate);
  const revealed = useAppSelector(selectRevealedSecret);
  const deliveries = useAppSelector(selectAlertDeliveries);
  const logStatus = useAppSelector(selectAlertLogStatus);
  const logGate = useAppSelector(selectAlertLogGate);

  useEffect(() => {
    void dispatch(loadAlertSites());
  }, [dispatch]);

  useEffect(() => {
    void dispatch(
      loadAlertRules({
        siteId: url.siteId,
        type: url.type,
        enabled: url.enabled,
      }),
    );
  }, [dispatch, url.siteId, url.type, url.enabled]);

  useEffect(() => {
    if (url.tab !== 'log' || url.rule === null) return;
    void dispatch(
      loadAlertDeliveries({
        ruleId: url.rule,
        status: url.status,
        channel: url.channel,
      }),
    );
  }, [dispatch, url.tab, url.rule, url.status, url.channel]);

  const handleCreate = useCallback(
    (input: CreateRuleInput) => {
      void dispatch(createAlertRuleThunk(input));
    },
    [dispatch],
  );

  const handleToggle = useCallback(
    (rule: AlertRule) => {
      void dispatch(updateAlertRuleThunk({ ruleId: rule.id, patch: { enabled: !rule.enabled } }));
    },
    [dispatch],
  );

  const handleDelete = useCallback(
    (rule: AlertRule) => {
      void dispatch(deleteAlertRuleThunk(rule.id));
    },
    [dispatch],
  );

  const handleOpenLog = useCallback(
    (rule: AlertRule) => {
      // One navigate — see `setMany` in urlState.
      url.setMany({ rule: rule.id, tab: 'log' });
    },
    [url],
  );

  // The server is the authority on both refusals; the builder only mirrors the
  // one it has already been told about so the right control disables.
  const capReached = saveGate?.kind === 'cap' || listGate?.kind === 'cap';
  const paidChannelsLocked = saveGate?.kind === 'tierLocked';
  const flagDisabled = saveGate?.kind === 'disabled' || listGate?.kind === 'disabled';

  return (
    <div className="flex flex-col gap-6" data-testid="alerts-page">
      <PageHeader
        icon={APP_PAGE_ICONS.alerts}
        title={t('title')}
        description={t('subtitle')}
      />

      <Tabs value={url.tab} onValueChange={(next) => url.setTab(next as AlertTab)}>
        <TabsList>
          {ALERT_TABS.map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {t(`tabs.${tab}`)}
            </TabsTrigger>
          ))}
        </TabsList>

        {flagDisabled ? (
          <StateNotice kind="disabled" message={saveGate?.message || listGate?.message} />
        ) : null}
        {revealed ? (
          <SecretRevealPanel
            secret={revealed.secret}
            onDismiss={() => dispatch(dismissRevealedSecret())}
          />
        ) : null}

        <TabsContent value="rules" className="mt-6">
          <div className="flex flex-col gap-6">
            <Card>
              <CardHeader>
                <CardTitle>{t('list.title')}</CardTitle>
                <CardDescription>{t('list.capUsed', { count: capUsed })}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-wrap gap-2">
                  <label className="flex flex-col gap-1 text-sm">
                    <span>{t('filters.type')}</span>
                    <select
                      className="rounded-md border border-input bg-background px-2 py-1"
                      value={url.type ?? ''}
                      onChange={(event) =>
                        url.setType((event.target.value || null) as AlertRuleType | null)
                      }
                    >
                      <option value="">{t('filters.all')}</option>
                      {ALERT_RULE_TYPES.map((type) => (
                        <option key={type} value={type}>
                          {t(`type.${type}`)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1 text-sm">
                    <span>{t('filters.state')}</span>
                    <select
                      className="rounded-md border border-input bg-background px-2 py-1"
                      value={url.enabled === null ? '' : String(url.enabled)}
                      onChange={(event) =>
                        url.setEnabled(
                          event.target.value === '' ? null : event.target.value === 'true',
                        )
                      }
                    >
                      <option value="">{t('filters.all')}</option>
                      <option value="true">{t('list.enabled')}</option>
                      <option value="false">{t('list.disabled')}</option>
                    </select>
                  </label>
                </div>

                {listStatus === 'loading' ? <Spinner /> : null}
                {listGate && listGate.kind !== 'disabled' ? (
                  <StateNotice kind={listGate.kind} message={listGate.message} />
                ) : null}
                {listStatus === 'succeeded' && rules.length === 0 ? (
                  <StateNotice kind="empty" />
                ) : null}
                {rules.length > 0 ? (
                  <RuleList
                    rules={rules}
                    busyRuleId={saveStatus === 'loading' ? (rules[0]?.id ?? null) : null}
                    onToggle={handleToggle}
                    onDelete={handleDelete}
                    onOpenLog={handleOpenLog}
                  />
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('builder.title')}</CardTitle>
                <CardDescription>{t('builder.description')}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {saveGate && saveGate.kind !== 'disabled' ? (
                  <StateNotice kind={saveGate.kind} message={saveGate.message} />
                ) : null}
                {sitesStatus === 'succeeded' && sites.length === 0 ? (
                  <StateNotice kind="noSites" />
                ) : (
                  <RuleBuilder
                    sites={sites}
                    siteId={url.siteId}
                    currentUserId={user?.id ?? null}
                    paidChannelsLocked={paidChannelsLocked}
                    capReached={capReached}
                    submitting={saveStatus === 'loading'}
                    onSubmit={handleCreate}
                  />
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="log" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('log.title')}</CardTitle>
              <CardDescription>{t('log.description')}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {url.rule === null ? (
                <StateNotice kind="empty" />
              ) : (
                <>
                  {logStatus === 'loading' ? <Spinner /> : null}
                  {logGate ? <StateNotice kind={logGate.kind} message={logGate.message} /> : null}
                  {logStatus === 'succeeded' && deliveries.length === 0 ? (
                    <StateNotice kind="empty" />
                  ) : null}
                  {deliveries.length > 0 ? <DeliveryLog deliveries={deliveries} /> : null}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
