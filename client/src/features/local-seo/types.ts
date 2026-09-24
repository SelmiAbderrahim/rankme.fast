export interface LocalListing {
  source: string;
  name: string;
  address: string | null;
  phone: string | null;
  consistent: boolean;
}

export interface LocalReviews {
  averageRating: number | null;
  reviewCount: number;
  unansweredQuestionCount: number;
}

export interface LocalPackRow {
  keywordId: string;
  phrase: string;
  position: number | null;
  totalPackSize: number;
  checkedAt: string;
}

export interface LocalSeoSnapshot {
  listings: LocalListing[];
  fetchedAt: string | null;
  reviews: LocalReviews | null;
  reviewsFetchedAt: string | null;
  localPack: LocalPackRow[];
}

export interface LocalSeoRefreshResult {
  fetchedAt: string;
  listings: LocalListing[];
  reviews: { averageRating: number | null; reviewCount: number };
  qa: { unansweredCount: number };
}

export interface LocalSeoState {
  /** Site the loaded/loading data belongs to; null before any load. */
  siteId: string | null;
  snapshot: LocalSeoSnapshot | null;
  loading: boolean;
  loaded: boolean;
  error: string;
  isRefreshing: boolean;
  /** Epoch ms until which the refresh button stays disabled; null → enabled. */
  cooldownUntil: number | null;
  refreshError: string;
}
