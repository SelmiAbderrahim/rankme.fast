import { apiClient } from '@shared/api/client';
import type {
  AlertChannel,
  AlertDelivery,
  AlertDeliveryStatus,
  AlertRule,
  AlertRulesPage,
  AlertRuleType,
  AlertSite,
} from './types';

interface SitePage {
  sites: Array<{ id: string; domain: string; displayName: string }>;
}

/** The site picker's own read — this feature never touches another slice. */
export const fetchAlertSites = (
  init: { signal?: AbortSignal } = {},
): Promise<AlertSite[]> =>
  apiClient<SitePage>('/sites', init.signal ? { signal: init.signal } : {}).then((page) =>
    page.sites.map((site) => ({
      id: site.id,
      domain: site.domain,
      displayName: site.displayName,
    })),
  );

export interface FetchRulesOptions {
  siteId?: string | null;
  type?: AlertRuleType | null;
  enabled?: boolean | null;
  signal?: AbortSignal;
}

export const fetchAlertRules = (
  options: FetchRulesOptions = {},
): Promise<AlertRulesPage> => {
  const params = new URLSearchParams();
  if (options.siteId) params.set('siteId', options.siteId);
  if (options.type) params.set('type', options.type);
  if (options.enabled !== undefined && options.enabled !== null) {
    params.set('enabled', String(options.enabled));
  }
  const query = params.toString();
  return apiClient<AlertRulesPage>(
    `/alerts/rules${query ? `?${query}` : ''}`,
    options.signal ? { signal: options.signal } : {},
  );
};

export interface CreateRuleInput {
  siteId: string;
  type: AlertRuleType;
  threshold?: number;
  emailRecipientIds?: string[];
  slackWebhookUrl?: string;
  webhookUrl?: string;
}

export const createAlertRule = (input: CreateRuleInput): Promise<AlertRule> =>
  apiClient<AlertRule>('/alerts/rules', { method: 'POST', body: input });

export interface UpdateRuleInput {
  threshold?: number;
  enabled?: boolean;
  emailRecipientIds?: string[];
  slackWebhookUrl?: string | null;
  webhookUrl?: string | null;
  rotateWebhookSecret?: boolean;
}

export const updateAlertRule = (
  ruleId: string,
  input: UpdateRuleInput,
): Promise<AlertRule> =>
  apiClient<AlertRule>(`/alerts/rules/${ruleId}`, { method: 'PATCH', body: input });

export const deleteAlertRule = (ruleId: string): Promise<void> =>
  apiClient<void>(`/alerts/rules/${ruleId}`, { method: 'DELETE' });

export interface FetchDeliveriesOptions {
  status?: AlertDeliveryStatus | null;
  channel?: AlertChannel | null;
  signal?: AbortSignal;
}

export const fetchAlertDeliveries = (
  ruleId: string,
  options: FetchDeliveriesOptions = {},
): Promise<{ deliveries: AlertDelivery[] }> => {
  const params = new URLSearchParams();
  if (options.status) params.set('status', options.status);
  if (options.channel) params.set('channel', options.channel);
  const query = params.toString();
  return apiClient<{ deliveries: AlertDelivery[] }>(
    `/alerts/rules/${ruleId}/deliveries${query ? `?${query}` : ''}`,
    options.signal ? { signal: options.signal } : {},
  );
};
