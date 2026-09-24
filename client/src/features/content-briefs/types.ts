export const CONTENT_BRIEF_STATUSES = [
  'queued',
  'running',
  'completed',
  'completed_empty',
  'completed_partial',
  'failed',
] as const;

export type ContentBriefStatus = (typeof CONTENT_BRIEF_STATUSES)[number];
export type ContentBriefStatusFilter = ContentBriefStatus | 'all';
export type ContentBriefHaltStage = 'serp_fetch' | 'scrape' | 'brief_ai' | 'editor_ai';
export type ContentBriefHaltReason =
  | 'cost_ceiling'
  | 'provider_error'
  | 'unsafe_url'
  | 'malformed_output'
  | 'processing_failure';

export interface ContentBriefHalt {
  stage: ContentBriefHaltStage;
  reason: ContentBriefHaltReason;
}

/**
 * The server's advisory preview. The form only needs to know one arrived (the
 * confirm button waits for it); it renders none of its fields.
 */
export type ContentBriefPreview = Record<string, unknown>;

export interface ContentBriefListItem {
  id: string;
  siteId: string;
  keyword: string;
  status: ContentBriefStatus;
  serpSource: 'pending' | 'stored' | 'fetched';
  retainedDocumentCount: number;
  halt: ContentBriefHalt | null;
  requestedAt: string;
  terminalAt: string | null;
  latestDraftVersion: number;
}

export interface ContentBriefListResponse {
  creationEnabled: boolean;
  items: ContentBriefListItem[];
  nextCursor: string | null;
}

export interface ContentBriefCorpusStats {
  wordCount: {
    min: number | null;
    max: number | null;
    average: number | null;
    documentCount: number;
  };
  headingHistogram: Record<'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6', number>;
  entities: Array<{ label: string; documentCount: number }>;
  scrapeDates: string[];
}

export interface ContentBriefDraftComparison {
  wordCount: number;
  corpusMin: number | null;
  corpusMax: number | null;
  corpusAverage: number | null;
  wordDeltaFromAverage: number | null;
  headingCount: number;
  corpusAverageHeadings: number | null;
  matchedEntities: number;
  totalEntities: number;
  deterministicScore: number;
}

export interface ContentBriefScoreVersion {
  version: number;
  draft: string;
  comparison: ContentBriefDraftComparison;
  aiScore: number | null;
  aiRationale: string | null;
  aiCitations: string[];
  aiCostMicros: number;
  aiDisclosure: 'scored' | 'cost_ceiling' | 'provider_error' | 'malformed_output';
  createdAt: string;
  trust: 'untrusted';
}

export interface ContentBriefDetail extends ContentBriefListItem {
  creationEnabled: boolean;
  locale: string;
  serp: {
    source: 'pending' | 'stored' | 'fetched';
    checkedAt: string | null;
    fetchedInsideUnit: boolean;
    paaRows: Array<{
      id: string;
      question: string;
      answerDomain: string | null;
      answerUrl: string | null;
      trust: 'untrusted';
    }>;
  };
  documents: Array<{
    id: string;
    sourceUrl: string | null;
    title: string;
    headings: Array<{ level: number; text: string }>;
    capturedAt: string;
    wordCount: number;
    entityLabels: string[];
    trust: 'untrusted';
  }>;
  corpusStats: ContentBriefCorpusStats | null;
  outline: Array<{
    id: string;
    heading: string;
    purpose: string;
    citations: string[];
    trust: 'untrusted';
  }>;
  questions: Array<{ question: string; citations: string[]; trust: 'untrusted' }>;
  secondaryTerms: Array<{ id: string; term: string }>;
  abstentions: string[];
  cost: {
    ceilingMicros: number;
    initialMicros: number;
    editorAiMicros: number;
    residueMicros: number;
    stages: Array<{
      stage: ContentBriefHaltStage;
      costMicros: number;
      source: 'captured' | 'estimated';
    }>;
  };
  scoreHistory: ContentBriefScoreVersion[];
}

export interface ContentBriefCreated {
  briefId: string;
  status: 'queued';
  reservedUnits: number;
  duplicate: boolean;
}

export function contentBriefStatusFilter(value: string | null): ContentBriefStatusFilter {
  return (CONTENT_BRIEF_STATUSES as readonly string[]).includes(value ?? '')
    ? (value as ContentBriefStatus)
    : 'all';
}

export function isContentBriefTerminal(status: ContentBriefStatus): boolean {
  return status !== 'queued' && status !== 'running';
}
