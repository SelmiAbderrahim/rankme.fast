/**
 * Wire types for the Audience Research workspace. Mirrors
 * `server/src/modules/audience-research/index.ts` (the module's public
 * barrel) verbatim — do not re-author server DTO shapes here.
 *
 * Server source of truth:
 *   - enums: `audience-research.model.ts`
 *   - `RunStatusView` / `RunResultView` / `ListRunsResult`:
 *     `audience-research.service.ts`
 *
 * `RunResultView.input.siteMarket` is typed `unknown` on the server DTO
 * (defensive default). The client narrows it to `SiteMarket | null` because
 * every persisted run was created from a `siteMarketSchema`-validated input
 * (see `audience-research.schemas.ts`) — this is a documented, deliberate
 * narrowing, not a re-authoring of the server contract.
 */
import type { SiteMarket } from '@shared/observations/types';
import type { SupportedLocale } from '@shared/i18n';

export const AUDIENCE_RESEARCH_STATES = [
  'queued',
  'discovering',
  'selecting',
  'collecting',
  'clustering',
  'completed',
  'partial',
  'failed',
] as const;
export type AudienceResearchState = (typeof AUDIENCE_RESEARCH_STATES)[number];

export const AUDIENCE_RESEARCH_TERMINAL_STATES: readonly AudienceResearchState[] = [
  'completed',
  'partial',
  'failed',
];

export function isAudienceResearchTerminal(state: AudienceResearchState): boolean {
  return (AUDIENCE_RESEARCH_TERMINAL_STATES as readonly string[]).includes(state);
}

export const AUDIENCE_RESEARCH_SIGNAL_TYPES = [
  'complaint',
  'request',
  'question',
  'competitor_gap',
] as const;
export type AudienceResearchSignalType = (typeof AUDIENCE_RESEARCH_SIGNAL_TYPES)[number];

export const AUDIENCE_RESEARCH_SUGGESTED_ROUTES = [
  'content',
  'comparison_page',
  'product',
  'seo',
] as const;
export type AudienceResearchSuggestedRoute = (typeof AUDIENCE_RESEARCH_SUGGESTED_ROUTES)[number];

export const AUDIENCE_RESEARCH_CONFIDENCE = ['high', 'medium', 'low'] as const;
export type AudienceResearchConfidence = (typeof AUDIENCE_RESEARCH_CONFIDENCE)[number];

export const AUDIENCE_RESEARCH_SOURCE_TYPES = [
  'forum',
  'review',
  'comparison',
  'question',
  'other',
] as const;
export type AudienceResearchSourceType = (typeof AUDIENCE_RESEARCH_SOURCE_TYPES)[number];

export type AudienceResearchStage =
  | 'queued'
  | 'discovering'
  | 'selecting'
  | 'collecting'
  | 'clustering'
  | 'terminal';

export type AudienceResearchTerminalState = 'completed' | 'partial' | 'failed';

/** POST /sites/:siteId/audience-research/runs input shape. */
export interface AudienceResearchInput {
  siteMarket: SiteMarket;
  competitorDomains: readonly string[];
  seedTopics: readonly string[];
}

export interface StartedRun {
  runId: string;
  status: AudienceResearchState;
  duplicate: boolean;
  outputLocale: SupportedLocale;
}

export interface RunStatusView {
  runId: string;
  siteId: string;
  outputLocale: SupportedLocale | null;
  state: AudienceResearchState;
  stage: AudienceResearchStage;
  counts: {
    candidates: number;
    sources: number;
    signals: number;
  };
  progress: {
    percent: number;
  };
  coverageNoteKey: string | null;
  costMicros: {
    total: number;
    byStage: Record<string, number>;
  };
  terminal: {
    state: AudienceResearchTerminalState | null;
    reasonCode: string | null;
    completedAt: string | null;
  };
  requestedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
}

export interface RunResultSource {
  sourceId: string;
  canonicalUrl: string;
  title: string;
  sourceType: string;
  registrableDomain: string;
  observedAt: string | null;
  contentHash: string;
  excerpt: string;
  observationMeta: unknown;
}

export interface RunResultSignal {
  signalId: string;
  type: string;
  title: string;
  summary: string;
  suggestedRoute: string;
  citedSourceIds: string[];
  independentDomainCount: number;
  sourceTypeCount: number;
  mostRecentSourceObservedAt: string | null;
  confidence: string;
}

export interface RunResultView extends RunStatusView {
  input: {
    siteMarket: SiteMarket | null;
    competitorDomains: string[];
    seedTopics: string[];
    queryTemplateVersion: number;
    outputLocale: SupportedLocale | null;
  };
  sources: RunResultSource[];
  signals: RunResultSignal[];
  ledgerSummary: {
    total: number;
    ai: number;
    byStage: Record<string, number>;
  };
  /**
   * The account's durable terminal decisions for this run's signals. The
   * slice hydrates `decisions.terminal` from this on every result read so
   * accepted/dismissed state survives a reload (the session cache alone
   * reverted decided cards to their undecided controls). Optional so older
   * cached payloads without the field stay parseable.
   */
  decisions?: SignalDecisionResult[];
}

export interface ListRunsResult {
  items: RunStatusView[];
  nextCursor: string | null;
}

export interface StartRunResponse {
  runId: string;
  status: AudienceResearchState;
  duplicate: boolean;
  outputLocale: SupportedLocale;
}

/**
 * Decision types. Server-authoritative — the client only sends
 * `{ decision, destination|reason, idempotencyKey }`, never any evidence,
 * confidence, priority, source list, or action prose. The server derives
 * every non-idempotency response field from the immutable signal.
 */
export const AUDIENCE_RESEARCH_DECISION_KINDS = ['accepted', 'dismissed'] as const;
export type AudienceResearchDecisionKind =
  (typeof AUDIENCE_RESEARCH_DECISION_KINDS)[number];

export const AUDIENCE_RESEARCH_DESTINATIONS = [
  'content',
  'comparison_page',
  'product',
  'seo',
] as const;
export type AudienceResearchDestination =
  (typeof AUDIENCE_RESEARCH_DESTINATIONS)[number];

export const AUDIENCE_RESEARCH_DISMISS_REASONS = [
  'not_relevant',
  'already_addressed',
  'low_confidence',
  'duplicate',
  'other',
] as const;
export type AudienceResearchDismissReason =
  (typeof AUDIENCE_RESEARCH_DISMISS_REASONS)[number];

export interface SignalDecisionResult {
  signalId: string;
  terminalDecision: AudienceResearchDecisionKind;
  destination: AudienceResearchDestination | null;
  downstreamId: string | null;
  deepLinkPath: string | null;
  decidedAt: string;
  decidedBy: { userId: string };
  duplicate: boolean;
}

export interface DecideSignalRequestBase {
  siteId: string;
  runId: string;
  signalId: string;
  idempotencyKey: string;
}

export type DecideSignalRequest =
  | (DecideSignalRequestBase & {
      decision: 'accepted';
      destination: AudienceResearchDestination;
    })
  | (DecideSignalRequestBase & {
      decision: 'dismissed';
      reason?: AudienceResearchDismissReason;
    });

export function destinationRoutesToContentIntelligence(
  destination: AudienceResearchDestination,
): boolean {
  return destination === 'content' || destination === 'comparison_page';
}
