/**
 * Weekly Pulse — client wire types.
 *
 * Mirror of `server/src/modules/weekly-pulse/index.ts` — do NOT re-author
 * server DTO shapes here.
 */
/**
 * Non-reserving operation preview from `POST .../weekly-pulse/preview`. The
 * card only records that the user saw it before enabling the digest; it
 * reads no fields beyond the product-unit disclosure copy.
 */
export interface SpendPreview {
  productUnits?: number;
  estimatedAt?: string;
}

export type WeeklyPulseStatus =
  | 'queued'
  | 'collecting'
  | 'completed'
  | 'partial'
  | 'blocked_capacity'
  | 'unsupported'
  | 'failed';

export type GscGenerativeAppearanceStatus =
  | 'available'
  | 'unavailable'
  | 'partial'
  | 'reconnect_required'
  | 'failed';

export interface GscGenerativeAppearanceReadRow {
  rawAppearance: string;
  classificationSlug: string;
  isGenerative: boolean;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscGenerativeAppearanceReadWindow {
  start: string;
  end: string;
  windowDays: number;
}

export interface GscGenerativeAppearanceRead {
  status: GscGenerativeAppearanceStatus;
  window: GscGenerativeAppearanceReadWindow | null;
  rows: GscGenerativeAppearanceReadRow[];
  observationMeta: unknown | null;
}

export interface PulseSubscriptionView {
  enabled: boolean;
  locale: string;
  enabledAt: string | null;
  disabledAt: string | null;
}

export interface PulseSettingView {
  enabled: boolean;
  nextRunAt: string;
  lastRunAt: string | null;
  lastStatus: WeeklyPulseStatus | null;
}

export interface PulseRunSummary {
  runId: string;
  isoWeek: string;
  status: WeeklyPulseStatus;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

export interface PulseStateView {
  siteId: string;
  subscription: PulseSubscriptionView | null;
  setting: PulseSettingView | null;
  lastRun: PulseRunSummary | null;
  coverage: Array<{
    observationType: string;
    state: 'supported' | 'unsupported' | 'unknown';
    coverageNoteKey?: string;
  }>;
  gscAppearance: GscGenerativeAppearanceRead;
}

export interface PulseHistoryPage {
  siteId: string;
  runs: PulseRunSummary[];
  nextCursor: string | null;
}

export interface DigestCitationEntry {
  citationId: string | null;
  engine: string;
  surface: string;
  host: string;
  canonicalUrl: string;
  titleSafe: string | null;
}

export interface DigestRankDrop {
  keyword: string;
  priorRank: number | null;
  currentRank: number | null;
  confirmedAt: string;
}

export interface DigestActionEntry {
  actionId: string;
  messageKey: string;
  messageVars?: Record<string, string | number>;
  targetUrl: string | null;
  targetMessageKey?: string;
  targetMessageVars?: Record<string, string | number>;
  verb: string;
  target: string;
  state: 'completed' | 'regressed' | 'open';
}

/**
 * One tracked brand query's scan-over-scan movement. Account-scoped
 * and emitted per query — the weekly pulse itself is site-scoped. Bounded
 * safe fields only: ids, the stored query label, an integer count delta, and
 * four whole percentage-point sentiment deltas.
 */
export interface DigestBrandDelta {
  queryHash: string;
  brandQuerySafe: string;
  currentScanId: string;
  previousScanId: string | null;
  hasNewScan: boolean;
  newMentionCount: number | null;
  sentimentShift: {
    positive: number;
    neutral: number;
    negative: number;
    unknown: number;
  } | null;
}

export interface DigestProjectionPayload {
  header: {
    siteId: string;
    siteLabel: string;
    isoWeek: string;
    market: unknown;
    renderedAt: string;
  };
  coverage: {
    supported: number;
    total: number;
    supportedCells: Array<{ engine: string; surface: string }>;
    partial: boolean;
  };
  citations_new: DigestCitationEntry[];
  citations_lost: DigestCitationEntry[];
  citations_unknown_partial: DigestCitationEntry[];
  confirmed_rank_drops: DigestRankDrop[];
  actions_completed: DigestActionEntry[];
  actions_regressed: DigestActionEntry[];
  next_actions_top3: DigestActionEntry[];
  gsc_appearance: {
    status: GscGenerativeAppearanceStatus;
    window: { start: string; end: string } | null;
    rows: Array<{
      rawAppearance: string;
      classificationSlug: string;
      isGenerative: boolean;
      clicks: number;
      impressions: number;
      ctr: number;
      position: number;
    }>;
  };
  /** Absent on projections frozen before brand deltas shipped. */
  brand_deltas?: DigestBrandDelta[];
  deep_links: {
    digest: string;
    aiVisibility: string;
    google: string;
    contentIntelligence: string;
    audienceResearch: string;
    nextActions: string;
  };
}

export interface PulseHistoryDetail {
  siteId: string;
  runId: string;
  isoWeek: string;
  status: WeeklyPulseStatus;
  projection: DigestProjectionPayload | null;
  citationChanges: Array<{
    change: 'new' | 'lost' | 'unknown_partial';
    engine: string;
    surface: string;
    host: string;
    canonicalUrl: string;
    citationId: string | null;
  }>;
}

export interface SetSubscriptionRequest {
  enabled: boolean;
  acknowledgedPreviewAt?: string;
  locale?: string;
}
