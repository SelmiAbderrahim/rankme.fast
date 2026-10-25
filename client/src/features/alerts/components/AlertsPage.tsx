import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppDispatch, useAppSelector } from '@shared/hooks/redux';
import { useAuthSession } from '@features/auth';
import { PageHeader } from '@shared/components/PageHeader';
import { APP_PAGE_ICONS } from '@shared/navigation/appPageIcons';
import { isolateText } from '@shared/lib/bidi';
import { Button } from '@shared/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@shared/ui/card';
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from '@shared/ui/empty';
import { Label } from '@shared/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@shared/ui/select';
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

/** Radix Select forbids an empty item value, so "All" rides a sentinel that
 *  maps back to "no filter" in the URL. */
const ALL_FILTER = 'all';

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
  // Rules tab filters narrow the rule list; only an unfiltered empty list
  // means the account has no rules at all.
  const noRules =
    listStatus === 'succeeded' &&
    rules.length === 0 &&
    url.siteId === null &&
    url.type === null &&
    url.enabled === null;
  const logFiltered = url.status !== null || url.channel !== null;

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

  // The server is the authority on refusals; the builder only mirrors the
  // one it has already been told about so the right control disables.
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
                {/* Filters need rules to filter: with none on the account they are
                    hidden, and an active filter stays so it can be cleared. */}
                {capUsed > 0 || url.type !== null || url.enabled !== null ? (
                  <div className="flex flex-wrap gap-4">
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="alerts-filter-type">{t('filters.type')}</Label>
                      <Select
                        value={url.type ?? ALL_FILTER}
                        onValueChange={(next) =>
                          url.setType(next === ALL_FILTER ? null : (next as AlertRuleType))
                        }
                      >
                        <SelectTrigger id="alerts-filter-type" className="min-w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ALL_FILTER}>{t('filters.all')}</SelectItem>
                          {ALERT_RULE_TYPES.map((type) => (
                            <SelectItem key={type} value={type}>
                              {t(`type.${type}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex flex-col gap-2">
                      <Label htmlFor="alerts-filter-state">{t('filters.state')}</Label>
                      <Select
                        value={url.enabled === null ? ALL_FILTER : String(url.enabled)}
                        onValueChange={(next) =>
                          url.setEnabled(next === ALL_FILTER ? null : next === 'true')
                        }
                      >
                        <SelectTrigger id="alerts-filter-state" className="min-w-40">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ALL_FILTER}>{t('filters.all')}</SelectItem>
                          <SelectItem value="true">{t('list.enabled')}</SelectItem>
                          <SelectItem value="false">{t('list.disabled')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : null}

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
              {/* The log has its own empty states: "No rules yet" belongs to the
                  Rules tab; here the question is what has been sent. */}
              {noRules ? (
                <Empty data-testid="alerts-log-no-rules">
                  <EmptyHeader>
                    <EmptyTitle>{t('log.empty.title')}</EmptyTitle>
                    <EmptyDescription>{t('log.empty.noRules')}</EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => url.setMany({ tab: 'rules', rule: null })}
                      data-testid="alerts-log-create-rule"
                    >
                      {t('log.empty.createRule')}
                    </Button>
                  </EmptyContent>
                </Empty>
              ) : (
                <>
                  {rules.length > 0 ? (
                    <div className="flex max-w-md flex-col gap-2">
                      <Label htmlFor="alerts-log-rule">{t('log.rulePicker')}</Label>
                      <Select
                        value={url.rule ?? ''}
                        onValueChange={(next) => url.setMany({ rule: next })}
                      >
                        <SelectTrigger id="alerts-log-rule" data-testid="alerts-log-rule">
                          <SelectValue placeholder={t('log.rulePickerPlaceholder')} />
                        </SelectTrigger>
                        <SelectContent>
                          {rules.map((rule) => (
                            <SelectItem key={rule.id} value={rule.id}>
                              {t('log.ruleOption', {
                                type: t(`type.${rule.type}`),
                                site: isolateText(
                                  sites.find((site) => site.id === rule.siteId)?.domain ?? rule.siteId,
                                ),
                              })}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                  {url.rule === null ? (
                    <p className="text-sm text-muted-foreground" data-testid="alerts-log-pick-rule">
                      {t('log.empty.pickRule')}
                    </p>
                  ) : (
                    <>
                      {logStatus === 'loading' ? <Spinner /> : null}
                      {logGate ? <StateNotice kind={logGate.kind} message={logGate.message} /> : null}
                      {logStatus === 'succeeded' && deliveries.length === 0 ? (
                        logFiltered ? (
                          <Empty data-testid="alerts-log-filtered-empty">
                            <EmptyHeader>
                              <EmptyTitle>{t('log.filtered.title')}</EmptyTitle>
                              <EmptyDescription>{t('log.filtered.body')}</EmptyDescription>
                            </EmptyHeader>
                            <EmptyContent>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => url.setMany({ status: null, channel: null })}
                                data-testid="alerts-log-clear-filters"
                              >
                                {t('log.filtered.clear')}
                              </Button>
                            </EmptyContent>
                          </Empty>
                        ) : (
                          <Empty data-testid="alerts-log-empty">
                            <EmptyHeader>
                              <EmptyTitle>{t('log.empty.title')}</EmptyTitle>
                              <EmptyDescription>{t('log.empty.rule')}</EmptyDescription>
                            </EmptyHeader>
                          </Empty>
                        )
                      ) : null}
                      {deliveries.length > 0 ? <DeliveryLog deliveries={deliveries} /> : null}
                    </>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};
