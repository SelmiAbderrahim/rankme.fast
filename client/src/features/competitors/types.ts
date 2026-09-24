export type TechStackCategory = 'cms' | 'analytics' | 'hosting' | 'ecommerce' | 'other';

export interface TechStackEntry {
  category: TechStackCategory;
  /** Vendor-reported technology name, e.g. 'WordPress'. */
  name: string;
}

/**
 * Lazily-loaded tech-stack cell attached to a competitor row on demand.
 * `entries` is `[]` while loading, on error, or when the vendor returned
 * nothing — the empty state is distinguished from "not yet fetched" by the
 * whole `techStack` field being `undefined` until the first fetch.
 */
export interface CompetitorTechStack {
  loading: boolean;
  error: string;
  entries: TechStackEntry[];
}

export interface TechStackResult {
  target: string;
  competitor: string;
  techStack: TechStackEntry[];
  fetchedAt: string;
}

export interface Competitor {
  domain: string;
  avgPosition: number | null;
  intersections: number;
  /** Decimal string ($) or null. */
  estimatedTraffic: string | null;
  fetchedAt: string;
  /** Populated on demand (row expand); `undefined` until first triggered. */
  techStack?: CompetitorTechStack;
}

export interface CompetitorsList {
  competitors: Competitor[];
  fetchedAt: string;
  target: string;
  source: CompetitorsSource;
}

/**
 * Which vendor signal produced the list: 'domain' = the site's own
 * ranked-keyword footprint; 'tracked_keywords' = SERP analysis of the
 * site's tracked keywords (fallback for low-visibility domains).
 */
export type CompetitorsSource = 'domain' | 'tracked_keywords';

export interface IntersectionKeyword {
  keyword: string;
  target1Position: number | null;
  target2Position: number | null;
  searchVolume: number | null;
}

export interface IntersectionResult {
  target: string;
  competitor: string;
  keywords: IntersectionKeyword[];
  fetchedAt: string;
}

export interface CompetitorsState {
  /** Site the loaded/loading data belongs to; null before any load. */
  siteId: string | null;
  list: CompetitorsList | null;
  intersection: IntersectionResult | null;
  selectedCompetitor: string | null;
  loading: boolean;
  loaded: boolean;
  intersectionLoading: boolean;
  error: string;
  intersectionError: string;
  isRefreshing: boolean;
  /** Epoch ms until which the refresh button stays disabled; null → enabled. */
  cooldownUntil: number | null;
  refreshError: string;
  intelligence: CompetitorIntelligenceState;
}

export type CompetitorWorkspaceView =
  | 'overview'
  | 'keywords'
  | 'content'
  | 'monitoring'
  | 'traffic'
  | 'reports';

export type CompetitorProfileStatus = 'active' | 'archived';

export interface CompetitorProfile {
  id: string;
  origin: string;
  registrableDomain: string;
  source: 'suggested' | 'manual';
  status: CompetitorProfileStatus;
  createdAt: string | null;
}

export interface LandscapeMarket {
  locationCode: number;
  languageCode: string;
  source: 'tracked_keyword_mode' | 'default';
  eligibleTrackedKeywords: number;
}

export interface DiscoverySpendPreview {
  market: LandscapeMarket;
  unitsRequired: 1;
  enabled: boolean;
  createsProfiles: false;
}

export interface CompetitorDiscovery {
  id: string;
  state: 'completed' | 'partial' | 'failed';
  market: LandscapeMarket;
  suggestions: Array<{
    registrableDomain: string;
    origin: string;
    source: 'dataforseo';
    capturedAt: string;
    alreadyConfirmed: boolean;
  }>;
  cache: 'hit' | 'miss';
  provenance: Array<{
    provider: 'dataforseo';
    operation: 'domain_candidates' | 'serp_candidates';
    status: 'success' | 'timeout' | 'malformed' | 'quota' | 'failed';
    capturedAt: string | null;
  }>;
  coverage: { returned: number; retained: number; truncated: boolean };
  warnings: Array<{
    code: string;
    operation: string;
    count: number;
    messageKey: string;
    messageVars?: Record<string, string | number>;
    message: string;
  }>;
  lastAttempt: { state: string; attemptedAt: string; safeErrorCode: string | null };
  createdAt: string;
}

export type LandscapeState =
  | 'queued'
  | 'collecting'
  | 'aggregating'
  | 'completed'
  | 'partial'
  | 'failed'
  | 'cancelled';

export type LandscapeClass =
  | 'missing'
  | 'owned_only'
  | 'shared_behind'
  | 'shared_ahead'
  | 'shared_even';

export interface LandscapeSummary {
  id: string;
  siteId: string;
  state: LandscapeState;
  ownedDomain: string;
  locale: string;
  market: Pick<LandscapeMarket, 'locationCode' | 'languageCode' | 'source'>;
  competitors: Array<{ profileId: string; domain: string }>;
  progress: { completedLegs: number; totalLegs: number; stage: LandscapeState };
  reportVersion: number;
  schemaVersion: string;
  taxonomyVersion: string;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface LandscapePreview {
  competitorCount: number;
  selected: Array<{ profileId: string; domain: string }>;
  competitorLimit: number;
  market: LandscapeMarket;
  unitsRequired: number;
  maxRows: number;
  enabled: boolean;
}

export interface LandscapeRow {
  id: string;
  class: LandscapeClass;
  competitorProfileId: string;
  competitorDomain: string;
  keyword: string;
  normalizedKeyword: string;
  ownedPosition: number | null;
  competitorPosition: number | null;
  ownedRankAbsolute: number | null;
  competitorRankAbsolute: number | null;
  ownedUrl: string | null;
  competitorUrl: string | null;
  searchVolume: number | null;
  keywordDifficulty: number | null;
  intent: 'informational' | 'navigational' | 'commercial' | 'transactional' | null;
  positionDelta: number | null;
  competitorCoverage: number;
  provenanceIndexes: number[];
}

export interface LandscapeOpportunity {
  id: string;
  kind: 'missing_keyword' | 'ranking_deficit';
  title: string;
  titleKey: string;
  titleVars?: Record<string, string | number>;
  recommendation: string;
  recommendationKey: string;
  recommendationVars?: Record<string, string | number>;
  competitorProfileIds: string[];
  keywordKeys: string[];
  evidenceRowIds: string[];
  confidence: 'high' | 'medium' | 'low';
  labels: { evidence: 'observed'; conclusion: 'derived'; prose: 'generated' };
  acceptedActionId?: string | null;
}

export interface LandscapeManifest {
  ownedDomain: string;
  locale: string;
  market: LandscapeMarket;
  competitors: Array<{ profileId: string; domain: string }>;
  coverage: {
    requestedCompetitors: number;
    usableCompetitors: number;
    requestedLegs: number;
    succeededLegs: number;
    failedLegs: number;
    truncatedLegs: number;
    unclassifiedSharedRows: number;
    rowsByClass: Record<LandscapeClass, number>;
  };
  provenance: Array<{
    provider: string;
    leg: string;
    cache: 'hit' | 'miss';
    status: string;
    capturedAt: string | null;
  }>;
  warnings: Array<{
    code: string;
    competitorProfileId: string | null;
    leg: string | null;
    count: number;
    messageKey: string;
    messageVars?: Record<string, string | number>;
    message: string;
  }>;
  errors: Array<{ code: string; competitorProfileId: string | null; retryable: boolean }>;
  pageSuggestions: Array<{
    id: string;
    competitorProfileId: string;
    ownedUrl: string;
    competitorUrl: string;
    keywordKeys: string[];
    reasonCode: string;
    confidence: 'high' | 'medium' | 'low';
    review: {
      state: 'unreviewed' | 'approved' | 'rejected';
      ownedUrl: string | null;
      competitorUrl: string | null;
      version: number;
      reviewedAt: string | null;
    };
  }>;
  opportunities: LandscapeOpportunity[];
  sourceDates: Array<{
    competitorProfileId: string;
    leg: string;
    capturedAt: string | null;
  }>;
  rowCount: number;
  completedAt: string;
}

export interface LandscapeDetail {
  run: LandscapeSummary;
  manifest: LandscapeManifest | null;
  items: LandscapeRow[];
  nextCursor: string | null;
}

export interface CompetitorIntelligenceState {
  siteId: string | null;
  profiles: CompetitorProfile[];
  profilesLoading: boolean;
  profilesLoaded: boolean;
  profilesError: string;
  mutationKey: string | null;
  mutationError: string;
  discovery: CompetitorDiscovery | null;
  discoveryLoading: boolean;
  discoveryError: string;
  discoveryPreview: DiscoverySpendPreview | null;
  discoveryPreviewLoading: boolean;
  discoveryPreviewError: string;
  selectedProfileIds: string[];
  landscapePreview: LandscapePreview | null;
  landscapePreviewLoading: boolean;
  landscapePreviewError: string;
  starting: boolean;
  startError: string;
  lastStartedRunId: string | null;
  lastStartDuplicate: boolean;
  runs: LandscapeSummary[];
  runsLoading: boolean;
  runsLoaded: boolean;
  runsError: string;
  runsNextCursor: string | null;
  detail: LandscapeDetail | null;
  detailLoading: boolean;
  detailError: string;
  cancellingRunId: string | null;
  acceptingOpportunityId: string | null;
  actionError: string;
}
