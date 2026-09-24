import {
  combineSlices,
  configureStore,
  createAction,
  type Reducer,
  type UnknownAction,
} from '@reduxjs/toolkit';
import { googleReducer } from '@features/google/store/slice';
import { ranksReducer } from '@features/ranks/store/slice';
import { sitesReducer } from '@features/sites/store/slice';
import { trafficSnapshotsReducer } from '@features/competitors/traffic/store/slice';
import { workspaceReducer } from '@features/workspace/store/slice';
import { teamInboxReducer } from '@features/team/store/inboxSlice';
import type { ActionsState } from '@features/actions/store/slice';
import type { AiVisibilityState } from '@features/ai-visibility/types';
import type { AssistantState } from '@features/assistant/store/slice';
import type { AudienceResearchState } from '@features/audience-research/store/slice';
import type { BacklinksState } from '@features/backlinks/types';
import type { BrandRadarState } from '@features/brand-radar/types';
import type {
  AppSeoChartsState,
  AppSeoCompareState,
  AppSeoListingState,
  AppSeoResearchState,
  AppSeoReviewsState,
  AppSeoState,
  AppSeoTrackingState,
} from '@features/app-seo';
import type { CannibalizationState } from '@features/cannibalization/types';
import type { CompetitorsState } from '@features/competitors/types';
import type { ContentIntelligenceState } from '@features/content-intelligence/store/slice';
import type { KeywordResearchState } from '@features/keyword-research/types';
import type { LocalSeoState } from '@features/local-seo/types';
import type { PagesState } from '@features/pages/types';
import type { ReviewIntelligenceState } from '@features/local-seo/reviews/types';
import type { ReportState } from '@features/report/types';
import type { ReportExportState } from '@features/report-export';
import type { SchemaGeneratorState } from '@features/schema-generator/types';
import type {
  ApiKeysState,
  BrandingState,
  McpPermissionsState,
  NotificationState,
} from '@features/settings/types';
import type { TeamState } from '@features/team/types';
import type { WeeklyPulseState } from '@features/weekly-pulse/store/slice';

// Auth state is NOT mirrored here — the Better Auth session hook
// (`useAuthSession` from @features/auth) is the single source of truth.
export interface LazyLoadedSlices {
  actions: ActionsState;
  aiVisibility: AiVisibilityState;
  assistant: AssistantState;
  apiKeys: ApiKeysState;
  audienceResearch: AudienceResearchState;
  backlinks: BacklinksState;
  brandRadar: BrandRadarState;
  appSeo: AppSeoState;
  appSeoTracking: AppSeoTrackingState;
  appSeoListing: AppSeoListingState;
  appSeoCharts: AppSeoChartsState;
  appSeoResearch: AppSeoResearchState;
  appSeoReviews: AppSeoReviewsState;
  appSeoCompare: AppSeoCompareState;
  branding: BrandingState;
  cannibalization: CannibalizationState;
  competitors: CompetitorsState;
  contentIntelligence: ContentIntelligenceState;
  keywordResearch: KeywordResearchState;
  localSeo: LocalSeoState;
  localSeoReviews: ReviewIntelligenceState;
  mcpPermissions: McpPermissionsState;
  pages: PagesState;
  report: ReportState;
  reportExport: ReportExportState;
  schemaGenerator: SchemaGeneratorState;
  settings: NotificationState;
  team: TeamState;
  weeklyPulse: WeeklyPulseState;
}

export const rootReducer = combineSlices({
  google: googleReducer,
  ranks: ranksReducer,
  sites: sitesReducer,
  trafficSnapshots: trafficSnapshotsReducer,
  // Eager, not lazy: the switcher lives in the shared layout and the API
  // header provider reads this before any feature slice is injected
  //.
  workspace: workspaceReducer,
  // Eager: the actionable invitation badge lives in the shared application
  // shell, before the lazy Team settings route has injected its roster slice.
  teamInbox: teamInboxReducer,
}).withLazyLoadedSlices<LazyLoadedSlices>();

// Derived from the reducer (not the store) so there is no store→type cycle.
export type RootState = ReturnType<typeof rootReducer> & LazyLoadedSlices;

/**
 * Drop every account-scoped cache when the Better Auth principal changes.
 *
 * This intentionally resets lazy-injected reducers too: a shared browser tab
 * must never carry sites, Google, report, team, or other private
 * state from one signed-in account into the next one.
 */
export const resetAccountState = createAction('app/resetAccountState');

const clearTransientPresentationMessages = (state: unknown): RootState => {
  const source = state as Record<string, unknown>;
  const next = { ...source };
  for (const [sliceKey, sliceValue] of Object.entries(source)) {
    if (typeof sliceValue !== 'object' || sliceValue === null || Array.isArray(sliceValue)) {
      continue;
    }
    const currentSlice = sliceValue as Record<string, unknown>;
    const nextSlice = { ...currentSlice };
    let changed = false;
    for (const [key, value] of Object.entries(currentSlice)) {
      if (typeof value === 'string' && /(?:error|message)$/i.test(key)) {
        nextSlice[key] = '';
        changed = true;
      }
    }
    if (changed) next[sliceKey] = nextSlice;
  }
  return next as unknown as RootState;
};

const accountBoundReducer: Reducer<RootState, UnknownAction, Partial<RootState>> = (
  state,
  action,
) => {
  const reduced = rootReducer(
    resetAccountState.match(action) ? undefined : state,
    action,
  ) as RootState;
  return action.type === 'i18n/presentationLocaleChanged'
    ? clearTransientPresentationMessages(reduced)
    : reduced;
};

/**
 * Build a fresh store instance. Used on the server so every SSR request gets
 * an isolated store (a module-level singleton would leak state across
 * requests). The browser uses the shared `store` singleton below.
 */
export function makeStore(preloadedState?: Partial<RootState>) {
  return configureStore({
    reducer: accountBoundReducer,
    devTools: import.meta.env.DEV,
    ...(preloadedState ? { preloadedState } : {}),
  });
}

/** Shared browser singleton. */
export const store = makeStore();

export type AppStore = ReturnType<typeof makeStore>;
export type AppDispatch = AppStore['dispatch'];
