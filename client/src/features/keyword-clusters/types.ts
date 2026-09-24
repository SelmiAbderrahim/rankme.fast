/** Wire contracts for stored SERP-overlap clustering runs. */
export type KeywordClusterRunStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'failed';

export type KeywordClusterAiStatus =
  | 'pending'
  | 'applied'
  | 'output_rejected'
  | 'provider_failed'
  | 'skipped';

/** Why a tracked keyword could not take part. Never silently dropped. */
export type KeywordClusterBlockReason = 'missing' | 'stale' | 'empty';

export interface KeywordClusterSelectableKeyword {
  id: string;
  phrase: string;
}

export interface KeywordClusterBlocked {
  keywordId: string;
  phrase: string;
  reason: KeywordClusterBlockReason;
  observedAt: string | null;
}

export interface KeywordClusterPreview {
  ready: boolean;
  reason: 'notEnoughKeywords' | null;
  readyCount: number;
  blocked: KeywordClusterBlocked[];
  blockedTotal: number;
  minSharedUrls: number;
  topUrlWindow: number;
  freshnessDays: number;
  minKeywords: number;
}

export interface KeywordClusterMember {
  keywordId: string;
  phrase: string;
  observedAt: string;
  isPivot: boolean;
  sharedUrls: string[];
  sharedUrlCount: number;
}

export interface KeywordCluster {
  id: string;
  size: number;
  pivotKeywordId: string;
  sharedUrls: string[];
  members: KeywordClusterMember[];
  label: string | null;
  labelSource: 'ai' | null;
}

export interface KeywordClusterRunError {
  category: 'queue_failed' | 'processing_failed';
  messageKey: string;
}

export interface KeywordClusterRunSummary {
  id: string;
  siteId: string;
  status: KeywordClusterRunStatus;
  aiStatus: KeywordClusterAiStatus;
  rulesVersion: string;
  minSharedUrls: number;
  topUrlWindow: number;
  keywordCount: number;
  blockedCount: number;
  clusterCount: number;
  groupedClusterCount: number;
  requestedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  error: KeywordClusterRunError | null;
}

export interface KeywordClusterRunDetail extends KeywordClusterRunSummary {
  clusters: KeywordCluster[];
  blocked: KeywordClusterBlocked[];
}

export type KeywordClusterUiState =
  | 'disabled'
  | 'rateLimited'
  | 'notFound'
  | 'notEnoughKeywords'
  | 'failed';
