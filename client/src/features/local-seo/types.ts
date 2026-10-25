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

/** What stored data describes: the chosen business, or (older data) the site domain. */
export type LocalSeoProvenance =
  | { kind: 'business'; name: string; ref: string }
  | { kind: 'domain'; domain: string };

export interface LocalSeoSnapshot {
  /** Null until something has been refreshed. */
  provenance: LocalSeoProvenance | null;
  listings: LocalListing[];
  fetchedAt: string | null;
  reviews: LocalReviews | null;
  reviewsFetchedAt: string | null;
  localPack: LocalPackRow[];
}

export interface LocalSeoRefreshResult {
  provenance: LocalSeoProvenance;
  fetchedAt: string;
  listings: LocalListing[];
  reviews: { averageRating: number | null; reviewCount: number };
  qa: { unansweredCount: number };
}

/** One search result the owner can pick. */
export interface LocalBusinessCandidate {
  candidateId: string;
  placeId: string | null;
  cid: string | null;
  name: string;
  address: string | null;
  phone: string | null;
  domain: string | null;
  category: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface SelectedLocalBusiness extends Omit<LocalBusinessCandidate, 'candidateId'> {
  locationCode: number;
  languageCode: string;
  selectedAt: string;
}

export interface LocalBusinessSetup {
  selected: SelectedLocalBusiness | null;
  candidates: LocalBusinessCandidate[];
  /** The search the candidates answer; null when there are none to pick. */
  query: string | null;
  candidatesExpireAt: string | null;
}

/** A place found to centre a geogrid on; only places with a map location are returned. */
export interface LocalPlace {
  placeId: string | null;
  cid: string | null;
  name: string;
  address: string | null;
  phone: string | null;
  domain: string | null;
  category: string | null;
  latitude: number;
  longitude: number;
}

export interface LocalPlaceSearchResult {
  query: string;
  places: LocalPlace[];
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
  /** Business setup, keyed by the same `siteId`. */
  setup: LocalBusinessSetup | null;
  setupLoaded: boolean;
  setupError: string;
  searching: boolean;
  searchError: string;
  /** True once a search has answered, so "no results" can be told apart from "not searched". */
  searched: boolean;
  selecting: boolean;
  selectError: string;
}
