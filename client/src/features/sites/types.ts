import type { SiteGoogleReadiness } from '@features/google/types';

export interface SiteDefaultMarket {
  locationCode: number;
  languageCode: string;
  device: 'desktop' | 'mobile';
  source: 'inferred' | 'owner';
  basis?: 'cctld' | 'page' | 'locale' | 'fallback' | null;
}

export interface Site {
  id: string;
  url: string;
  domain: string;
  displayName: string;
  /** Stored per-product connection and property status. */
  google?: SiteGoogleReadiness;
  /** Absent in a legacy API response; null until a stored choice exists. */
  defaultMarket?: SiteDefaultMarket | null;
  /** True while the site is paused — no audits, checks, or background work. */
  paused: boolean;
  /** ISO 8601 timestamp of the pause, null when not paused. */
  pausedAt: string | null;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 */
  updatedAt: string;
}

export interface SiteListPage {
  sites: Site[];
  nextCursor: string | null;
}

export interface GetSiteResponse {
  site: Site;
}

export interface CreateSiteResponse {
  site: Site;
  message: string;
}

export interface DeleteSiteResponse {
  message: string;
}

export interface UpdateSiteResponse {
  site: Site;
  message: string;
}

export interface PauseSiteResponse {
  site: Site;
  message: string;
}

export type LoadDirection = 'initial' | 'next' | 'prev';

export interface LoadSitesArgs {
  force?: boolean;
  maxAgeMs?: number;
  cursor?: string | null;
  direction?: LoadDirection;
}

export interface SitesState {
  /** Current page of sites (newest first). */
  items: Site[];
  /** Cursor for the page after the current one, null on the last page. */
  nextCursor: string | null;
  /** Cursor used to fetch the CURRENT page (null = first page). */
  currentCursor: string | null;
  /** Cursors of the pages before the current one — powers "Previous". */
  cursorStack: (string | null)[];
  loading: boolean;
  loaded: boolean;
  /** Missing older preloaded state is treated as stale. */
  loadedAt?: number | null;
  error: string;
  adding: boolean;
  addError: string;
  deletingId: string | null;
  deleteError: string;
  renamingId: string | null;
  renameError: string;
  marketSavingId: string | null;
  marketError: string;
  /** Site id with a pause OR resume in flight (one per row at a time). */
  pausingId: string | null;
  pauseError: string;
  message: string;
}
