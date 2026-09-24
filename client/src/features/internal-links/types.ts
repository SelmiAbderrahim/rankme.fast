/** Wire contracts for stored internal-link suggestion runs. */
export type InternalLinkRunStatus = 'queued' | 'processing' | 'completed' | 'failed';
export type InternalLinkAiStatus =
  | 'pending'
  | 'applied'
  | 'output_rejected'
  | 'provider_failed';
export type InternalLinkTargetFlag = 'orphan' | 'weakly_linked';
export type InternalLinkConfidence = 'high' | 'medium' | 'low';

export interface InternalLinkPreview {
  ready: boolean;
  reason: 'missing' | 'stale' | null;
  inventoryDate: string | null;
  freshnessDays: number;
}

export interface InternalLinkSuggestion {
  id: string;
  sourceUrl: string;
  sourceSection: string;
  sourceWordCount: number;
  targetUrl: string;
  targetFlag: InternalLinkTargetFlag;
  targetInboundCount: number;
  confidence: InternalLinkConfidence;
  sharedQueries: string[];
  headingMatches: string[];
  anchorText: string;
  inventoryDate: string;
  rank: number | null;
  rankingSource: 'deterministic' | 'ai';
}

export interface InternalLinkRunError {
  category: 'queue_failed' | 'processing_failed';
  messageKey: string;
}

export interface InternalLinkRunSummary {
  id: string;
  siteId: string;
  status: InternalLinkRunStatus;
  aiStatus: InternalLinkAiStatus;
  inventoryDate: string;
  gscSnapshotDate: string | null;
  candidateRulesVersion: string;
  suggestionCount: number;
  refunded: boolean;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: InternalLinkRunError | null;
}

export interface InternalLinkRunDetail extends InternalLinkRunSummary {
  suggestions: InternalLinkSuggestion[];
}

export type InternalLinkUiState =
  | 'disabled'
  | 'rateLimited'
  | 'notFound'
  | 'failed';
