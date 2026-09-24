/**
 * URL-backed workspace state (`.claude/rules/url-tab-state.md`).
 *
 * `?tab=` switches rules ⇄ log; `?siteId=`, `?type=`, `?enabled=` filter the
 * rule list; `?rule=` opens one rule's delivery log; `?status=` and
 * `?channel=` filter that log. Every param defaults when absent, and an INVALID
 * value is normalized back out of the URL with
 * `navigate({ search }, { replace: true })` so a shared link never leaves the
 * address bar disagreeing with the screen.
 */
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  ALERT_CHANNELS,
  ALERT_DELIVERY_STATUSES,
  ALERT_RULE_TYPES,
  type AlertChannel,
  type AlertDeliveryStatus,
  type AlertRuleType,
} from './types';

export const ALERT_TABS = ['rules', 'log'] as const;
export type AlertTab = (typeof ALERT_TABS)[number];
export const DEFAULT_ALERT_TAB: AlertTab = 'rules';

const OBJECT_ID = /^[0-9a-f]{24}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isAlertTab = (value: unknown): value is AlertTab =>
  typeof value === 'string' && (ALERT_TABS as readonly string[]).includes(value);

export const isAlertRuleType = (value: unknown): value is AlertRuleType =>
  typeof value === 'string' && (ALERT_RULE_TYPES as readonly string[]).includes(value);

export const isAlertChannel = (value: unknown): value is AlertChannel =>
  typeof value === 'string' && (ALERT_CHANNELS as readonly string[]).includes(value);

export const isAlertDeliveryStatus = (value: unknown): value is AlertDeliveryStatus =>
  typeof value === 'string' &&
  (ALERT_DELIVERY_STATUSES as readonly string[]).includes(value);

export const isSiteId = (value: unknown): value is string =>
  typeof value === 'string' && OBJECT_ID.test(value);

export const isRuleId = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

export interface AlertsUrlState {
  tab: AlertTab;
  siteId: string | null;
  type: AlertRuleType | null;
  enabled: boolean | null;
  rule: string | null;
  status: AlertDeliveryStatus | null;
  channel: AlertChannel | null;
  setTab: (next: AlertTab) => void;
  setSiteId: (next: string | null) => void;
  setType: (next: AlertRuleType | null) => void;
  setEnabled: (next: boolean | null) => void;
  setRule: (next: string | null) => void;
  setStatus: (next: AlertDeliveryStatus | null) => void;
  setChannel: (next: AlertChannel | null) => void;
  /**
   * Write several params in ONE navigate. Two sequential setters in the same
   * tick would both derive from the same stale `location.search`, so the
   * second would silently drop the first's write.
   */
  setMany: (patch: Partial<Record<'tab' | 'siteId' | 'type' | 'enabled' | 'rule' | 'status' | 'channel', string | null>>) => void;
}

function readEnabled(raw: string | null): boolean | null {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  return null;
}

export function useAlertsUrlState(): AlertsUrlState {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );

  const rawTab = params.get('tab');
  const rawSiteId = params.get('siteId');
  const rawType = params.get('type');
  const rawEnabled = params.get('enabled');
  const rawRule = params.get('rule');
  const rawStatus = params.get('status');
  const rawChannel = params.get('channel');

  const tab: AlertTab = isAlertTab(rawTab) ? rawTab : DEFAULT_ALERT_TAB;
  const siteId = isSiteId(rawSiteId) ? rawSiteId : null;
  const type = isAlertRuleType(rawType) ? rawType : null;
  const enabled = readEnabled(rawEnabled);
  const rule = isRuleId(rawRule) ? rawRule : null;
  const status = isAlertDeliveryStatus(rawStatus) ? rawStatus : null;
  const channel = isAlertChannel(rawChannel) ? rawChannel : null;

  const write = useCallback(
    (mutate: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(location.search);
      mutate(next);
      navigate({ search: next.toString() }, { replace: true });
    },
    [location.search, navigate],
  );

  const setParam = useCallback(
    (key: string, value: string | null) => {
      write((next) => {
        if (value === null) next.delete(key);
        else next.set(key, value);
      });
    },
    [write],
  );

  // Normalize an invalid value straight back out of the address bar. Guarded by
  // a ref so the effect cannot loop on its own rewrite.
  const normalized = useRef('');
  useEffect(() => {
    const dirty =
      (rawTab !== null && !isAlertTab(rawTab)) ||
      (rawSiteId !== null && !isSiteId(rawSiteId)) ||
      (rawType !== null && !isAlertRuleType(rawType)) ||
      (rawEnabled !== null && readEnabled(rawEnabled) === null) ||
      (rawRule !== null && !isRuleId(rawRule)) ||
      (rawStatus !== null && !isAlertDeliveryStatus(rawStatus)) ||
      (rawChannel !== null && !isAlertChannel(rawChannel));
    if (!dirty || normalized.current === location.search) return;
    normalized.current = location.search;
    write((next) => {
      if (rawTab !== null && !isAlertTab(rawTab)) next.delete('tab');
      if (rawSiteId !== null && !isSiteId(rawSiteId)) next.delete('siteId');
      if (rawType !== null && !isAlertRuleType(rawType)) next.delete('type');
      if (rawEnabled !== null && readEnabled(rawEnabled) === null) next.delete('enabled');
      if (rawRule !== null && !isRuleId(rawRule)) next.delete('rule');
      if (rawStatus !== null && !isAlertDeliveryStatus(rawStatus)) next.delete('status');
      if (rawChannel !== null && !isAlertChannel(rawChannel)) next.delete('channel');
    });
  }, [
    location.search,
    rawChannel,
    rawEnabled,
    rawRule,
    rawSiteId,
    rawStatus,
    rawTab,
    rawType,
    write,
  ]);

  return {
    tab,
    siteId,
    type,
    enabled,
    rule,
    status,
    channel,
    setTab: useCallback((next: AlertTab) => setParam('tab', next), [setParam]),
    setSiteId: useCallback((next: string | null) => setParam('siteId', next), [setParam]),
    setType: useCallback((next: AlertRuleType | null) => setParam('type', next), [setParam]),
    setEnabled: useCallback(
      (next: boolean | null) => setParam('enabled', next === null ? null : String(next)),
      [setParam],
    ),
    setRule: useCallback((next: string | null) => setParam('rule', next), [setParam]),
    setStatus: useCallback(
      (next: AlertDeliveryStatus | null) => setParam('status', next),
      [setParam],
    ),
    setChannel: useCallback(
      (next: AlertChannel | null) => setParam('channel', next),
      [setParam],
    ),
    setMany: useCallback(
      (patch: Record<string, string | null | undefined>) => {
        write((next) => {
          for (const [key, value] of Object.entries(patch)) {
            if (value === undefined) continue;
            if (value === null) next.delete(key);
            else next.set(key, value);
          }
        });
      },
      [write],
    ),
  };
}
