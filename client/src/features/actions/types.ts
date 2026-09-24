// Client-side mirror of the server's action wire types (`server/src/modules/
// actions/actions.types.ts` and `server/src/db/schema/action-events.ts`).
// The server is authoritative; this file exists so client feature code can
// import stable, narrow types without reaching into a server package.

export const ACTION_STATES = [
  'open',
  'planned',
  'dismissed',
  'completed',
] as const;
export type ActionState = (typeof ACTION_STATES)[number];

export const ACTION_SOURCE_TYPES = [
  'audit_finding',
  'confirmed_rank_drop',
  'gsc_decline',
  'ga4_decline',
  'content_recommendation',
  'citation_gap',
  'audience_research',
  'competitor_opportunity',
] as const;
export type ActionSourceType = (typeof ACTION_SOURCE_TYPES)[number];

export const ACTION_SEVERITIES = ['critical', 'warning', 'info'] as const;
export type ActionSeverity = (typeof ACTION_SEVERITIES)[number];

export const ACTION_FIRST_PARTY_IMPACTS = [
  'high',
  'medium',
  'low',
  'none',
] as const;
export type ActionFirstPartyImpact =
  (typeof ACTION_FIRST_PARTY_IMPACTS)[number];

export const ACTION_CONFIDENCES = ['high', 'medium', 'low'] as const;
export type ActionConfidence = (typeof ACTION_CONFIDENCES)[number];

export const ACTION_EFFORTS = ['low', 'medium', 'high'] as const;
export type ActionEffort = (typeof ACTION_EFFORTS)[number];

export const ACTION_SOURCE_STATUSES = [
  'available',
  'stale',
  'unavailable',
] as const;
export type ActionSourceStatus = (typeof ACTION_SOURCE_STATUSES)[number];

// Observation freshness matches shared/observations on the server.
export const ACTION_OBSERVATION_FRESHNESSES = [
  'fresh',
  'stale',
  'unavailable',
] as const;
export type ActionObservationFreshness =
  (typeof ACTION_OBSERVATION_FRESHNESSES)[number];

export interface ActionObservation {
  freshness: ActionObservationFreshness;
  observedAt: string;
  ttlHours?: number;
  cachedFrom?: string;
}

export interface ActionEvidence {
  sourceRef: string;
  url?: string;
  observation: ActionObservation;
}

export interface ActionRetestInfo {
  available: boolean;
  reason?: string;
  code?: 'RETEST_UNSUPPORTED';
  messageKey?: string;
  messageVars?: Record<string, string | number>;
}

export interface ActionSemanticCopy {
  messageKey: string;
  messageVars?: Record<string, string | number>;
}

export interface ActionItem {
  id: string;
  siteId: string;
  sourceType: ActionSourceType;
  sourceId: string;
  sourceLink: string;
  problem: string;
  whyItMatters: string;
  nextStep: string;
  codeFixPrompt?: {
    reference: string;
    recommendedFix: string;
    affectedUrlCount: number;
  };
  copy: {
    problem: ActionSemanticCopy;
    whyItMatters: ActionSemanticCopy;
    nextStep: ActionSemanticCopy;
  };
  affectedUrls: string[];
  evidence: ActionEvidence[];
  severity: ActionSeverity;
  firstPartyImpact: ActionFirstPartyImpact;
  confidence: ActionConfidence;
  effort: ActionEffort;
  state: ActionState;
  version: number;
  /** Completed, yet the source still reports it from a later observation. */
  reappearedAfterFix: boolean;
  observedAt: string;
  lastVerifiedAt: string | null;
  retest: ActionRetestInfo;
}

export interface ActionSourceStatusEntry {
  status: ActionSourceStatus;
  lastObservedAt?: string;
}

export type ActionSourceStatusEnvelope = Partial<
  Record<ActionSourceType, ActionSourceStatusEntry>
>;

export interface ListActionsResponse {
  items: ActionItem[];
  sourceStatus: ActionSourceStatusEnvelope;
  nextCursor: string | null;
}

export interface ActionHistoryEntry {
  ordinal: number;
  priorState: ActionState | null;
  newState: ActionState;
  eventKind: string;
  actorUserId: string;
  note: string | null;
  createdAt: string;
}

export interface ActionHistoryResponse {
  entries: ActionHistoryEntry[];
}

export interface MutateActionStateResponse {
  actionId: string;
  state: ActionState;
  version: number;
  replayed: boolean;
}

export interface RetestActionResponse {
  actionId: string;
  run: {
    runId: string;
    status: string;
    queuedAt?: string;
  };
}

export function isActionState(v: unknown): v is ActionState {
  return typeof v === 'string' && (ACTION_STATES as readonly string[]).includes(v);
}

export function isActionSourceType(v: unknown): v is ActionSourceType {
  return (
    typeof v === 'string' &&
    (ACTION_SOURCE_TYPES as readonly string[]).includes(v)
  );
}

export function isActionSeverity(v: unknown): v is ActionSeverity {
  return (
    typeof v === 'string' &&
    (ACTION_SEVERITIES as readonly string[]).includes(v)
  );
}

export function isActionConfidence(v: unknown): v is ActionConfidence {
  return (
    typeof v === 'string' &&
    (ACTION_CONFIDENCES as readonly string[]).includes(v)
  );
}

export function isActionEffort(v: unknown): v is ActionEffort {
  return (
    typeof v === 'string' && (ACTION_EFFORTS as readonly string[]).includes(v)
  );
}

// Same allowed-transition matrix as
// `server/src/modules/actions/actions.orders.ts` — deliberately duplicated as
// static data so the client can disable UI without a server round-trip.
// Any drift is caught by the parity assertion in `types.test.ts`.
export const ACTION_ALLOWED_TRANSITIONS: Record<
  ActionState,
  readonly ActionState[]
> = {
  open: ['planned', 'dismissed', 'completed'],
  planned: ['open', 'dismissed', 'completed'],
  dismissed: ['open', 'planned'],
  completed: ['open'],
};

export function isAllowedActionTransition(
  from: ActionState,
  to: ActionState,
): boolean {
  return ACTION_ALLOWED_TRANSITIONS[from].includes(to);
}
