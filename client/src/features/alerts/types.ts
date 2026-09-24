/**
 * Wire types for alert rules and their delivery log (community-requests spec
 * 06). Kept in lockstep with `server/src/modules/alerts/alerts.service.ts`.
 *
 * The client NEVER sees a channel credential: the server returns a masked
 * Slack host and a four-character secret tail, and the full webhook secret
 * appears exactly once — on the response that minted it.
 */
export const ALERT_RULE_TYPES = ['rank_drop', 'new_backlink', 'lost_backlink'] as const;
export type AlertRuleType = (typeof ALERT_RULE_TYPES)[number];

export const ALERT_CHANNELS = ['email', 'slack', 'webhook'] as const;
export type AlertChannel = (typeof ALERT_CHANNELS)[number];

export const ALERT_DELIVERY_STATUSES = [
  'pending',
  'sent',
  'failed',
  'suppressed',
] as const;
export type AlertDeliveryStatus = (typeof ALERT_DELIVERY_STATUSES)[number];

export const ALERT_THRESHOLD_MIN = 1;
export const ALERT_THRESHOLD_MAX = 100;
export const DEFAULT_ALERT_THRESHOLD = 10;

export interface AlertSite {
  id: string;
  domain: string;
  displayName: string;
}

export interface AlertRule {
  id: string;
  siteId: string;
  type: AlertRuleType;
  threshold: number | null;
  enabled: boolean;
  emailRecipientIds: string[];
  slackHostMasked: string | null;
  slackConfigured: boolean;
  webhookUrl: string | null;
  webhookSecretSet: boolean;
  webhookSecretLast4: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present ONLY on the create/rotate response. Never persisted client-side. */
  webhookSecret?: string;
}

export interface RankDropObservation {
  at: string;
  position: number | null;
}

export interface LinkObservation {
  at: string;
  reviewId: string;
  rowCount: number;
}

export interface RankDropEvidence {
  kind: 'rank_drop';
  keyword: string;
  threshold: number;
  before: RankDropObservation;
  after: RankDropObservation;
}

export interface LinkEvidence {
  kind: 'new_backlink' | 'lost_backlink';
  before: LinkObservation;
  after: LinkObservation;
  changedDomains: string[];
  changedTotal: number;
}

export type AlertEvidence = RankDropEvidence | LinkEvidence;

export interface AlertDelivery {
  id: string;
  ruleId: string;
  channel: AlertChannel;
  recipientRef: string | null;
  transitionKind: AlertRuleType;
  status: AlertDeliveryStatus;
  attempt: number;
  errorCode: string | null;
  suppressedReason: string | null;
  /** Both observations, always — the honesty invariant. */
  evidence: AlertEvidence;
  createdAt: string;
  updatedAt: string;
}

export interface AlertRulesPage {
  rules: AlertRule[];
  cap: { used: number };
}

/**
 * Every refusal this surface can render. `cap` and `tierLocked` both arrive as
 * 402 and are told apart by the server's message key, so the panel can disable
 * exactly the right control instead of showing a generic upgrade wall.
 */
export type AlertGateKind =
  | 'cap'
  | 'tierLocked'
  | 'disabled'
  | 'notFound'
  | 'rateLimited'
  | 'invalid'
  | 'failed';

export interface AlertGate {
  kind: AlertGateKind;
  message: string;
}

export type RequestStatus = 'idle' | 'loading' | 'succeeded' | 'failed';

export interface AlertsState {
  sites: AlertSite[];
  sitesStatus: RequestStatus;
  sitesError: string;
  rules: AlertRule[];
  capUsed: number;
  listStatus: RequestStatus;
  listGate: AlertGate | null;
  saveStatus: RequestStatus;
  saveGate: AlertGate | null;
  /** Shown once after create/rotate, then dismissed forever. */
  revealedSecret: { ruleId: string; secret: string } | null;
  deliveries: AlertDelivery[];
  logStatus: RequestStatus;
  logGate: AlertGate | null;
}

export const initialAlertsState: AlertsState = {
  sites: [],
  sitesStatus: 'idle',
  sitesError: '',
  rules: [],
  capUsed: 0,
  listStatus: 'idle',
  listGate: null,
  saveStatus: 'idle',
  saveGate: null,
  revealedSecret: null,
  deliveries: [],
  logStatus: 'idle',
  logGate: null,
};
