export interface Site {
  id: string;
  url: string;
  domain: string;
  displayName: string;
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
  error: string;
  adding: boolean;
  addError: string;
  deletingId: string | null;
  deleteError: string;
  renamingId: string | null;
  renameError: string;
  /** Site id with a pause OR resume in flight (one per row at a time). */
  pausingId: string | null;
  pauseError: string;
  message: string;
}
