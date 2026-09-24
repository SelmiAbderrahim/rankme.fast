import { createAsyncThunk } from '@reduxjs/toolkit';
import {
  acceptLandscapeRecommendation,
  addCompetitorProfile,
  cancelLandscapeRun,
  changeCompetitorProfileStatus,
  fetchCompetitors,
  fetchCompetitorProfiles,
  fetchIntersection,
  fetchLandscapeDetail,
  fetchLandscapeRuns,
  fetchLatestDiscovery,
  fetchTechStack as fetchTechStackRequest,
  previewDiscoverySpend,
  previewLandscapeSpend,
  refreshDiscovery,
  refreshCompetitors as refreshCompetitorsRequest,
  startLandscapeRun,
} from '../api';
import {
  apiErrorRetryAfterMs,
  apiErrorStatus,
  competitorsErrorMessage,
} from '../errorMessage';
import type {
  CompetitorsList,
  IntersectionResult,
  TechStackEntry,
  CompetitorDiscovery,
  CompetitorProfile,
  DiscoverySpendPreview,
  LandscapeClass,
  LandscapeDetail,
  LandscapePreview,
  LandscapeState,
  LandscapeSummary,
} from '../types';

export interface RejectPayload {
  error: string;
}

export interface RefreshRejectPayload extends RejectPayload {
  /** Epoch ms until which the refresh button stays disabled (429 only). */
  cooldownUntil: number | null;
}

/** Fallback cooldown when a 429 arrives without a parsable retryAfterMs. */
export const DEFAULT_REFRESH_COOLDOWN_MS = 60_000;

export const loadCompetitors = createAsyncThunk<
  CompetitorsList,
  { siteId: string },
  { rejectValue: RejectPayload }
>('competitors/loadCompetitors', async ({ siteId }, { rejectWithValue, signal }) => {
  try {
    return await fetchCompetitors(siteId, { signal });
  } catch (err) {
    return rejectWithValue({
      error: competitorsErrorMessage(err, 'competitors:loadFailed'),
    });
  }
});

export const refreshCompetitors = createAsyncThunk<
  CompetitorsList,
  { siteId: string },
  { rejectValue: RefreshRejectPayload }
>('competitors/refreshCompetitors', async ({ siteId }, { rejectWithValue }) => {
  try {
    return await refreshCompetitorsRequest(siteId);
  } catch (err) {
    const status = apiErrorStatus(err);
    if (status === 429) {
      // Cooldown, not an error state — the button shows a countdown instead.
      return rejectWithValue({
        error: '',
        cooldownUntil:
          Date.now() + (apiErrorRetryAfterMs(err) ?? DEFAULT_REFRESH_COOLDOWN_MS),
      });
    }
    return rejectWithValue({
      error: competitorsErrorMessage(err, 'competitors:refresh.failed'),
      cooldownUntil: null,
    });
  }
});

export const loadIntersection = createAsyncThunk<
  IntersectionResult,
  { siteId: string; competitor: string },
  { rejectValue: string }
>(
  'competitors/loadIntersection',
  async ({ siteId, competitor }, { rejectWithValue, signal }) => {
    try {
      return await fetchIntersection(siteId, competitor, { signal });
    } catch (err) {
      return rejectWithValue(
        competitorsErrorMessage(err, 'competitors:intersectionFailed'),
      );
    }
  },
);

export interface TechStackFulfilled {
  domain: string;
  entries: TechStackEntry[];
}

export interface TechStackRejected {
  domain: string;
  error: string;
}

/**
 * On-demand: dispatched when a row's "See tech stack" is triggered — NOT on
 * panel load, so N competitors never fan out N tech-stack vendor calls on
 * every page view (each call bills a `competitor_lookups` unit). The `domain`
 * rides in the payload so the reducer can attach the result to its row.
 */
export const fetchTechStack = createAsyncThunk<
  TechStackFulfilled,
  { siteId: string; domain: string },
  { rejectValue: TechStackRejected }
>('competitors/fetchTechStack', async ({ siteId, domain }, { rejectWithValue }) => {
  try {
    const result = await fetchTechStackRequest(siteId, domain);
    return { domain, entries: result.techStack };
  } catch (err) {
    return rejectWithValue({
      domain,
      error: competitorsErrorMessage(err, 'competitors:techStack.failed'),
    });
  }
});

const intelligenceError = (error: unknown): string =>
  competitorsErrorMessage(error, 'competitors:intelligence.errors.generic');

export const loadCompetitorPortfolio = createAsyncThunk<
  CompetitorProfile[],
  { siteId: string },
  { rejectValue: string }
>('competitors/loadPortfolio', async ({ siteId }, { rejectWithValue, signal }) => {
  try {
    return (await fetchCompetitorProfiles(siteId, 'all', signal)).items;
  } catch (error) {
    return rejectWithValue(intelligenceError(error));
  }
});

export const addPortfolioCompetitor = createAsyncThunk<
  { profile: CompetitorProfile; duplicate: boolean },
  { siteId: string; url: string; source: 'suggested' | 'manual'; idempotencyKey: string },
  { rejectValue: string }
>('competitors/addPortfolioCompetitor', async (input, { rejectWithValue }) => {
  try {
    return await addCompetitorProfile(
      input.siteId,
      { url: input.url, source: input.source },
      input.idempotencyKey,
    );
  } catch (error) {
    return rejectWithValue(intelligenceError(error));
  }
});

export const mutatePortfolioCompetitor = createAsyncThunk<
  CompetitorProfile,
  {
    siteId: string;
    competitorId: string;
    action: 'archive' | 'restore';
    idempotencyKey: string;
  },
  { rejectValue: string }
>('competitors/mutatePortfolioCompetitor', async (input, { rejectWithValue }) => {
  try {
    return (
      await changeCompetitorProfileStatus(
        input.siteId,
        input.competitorId,
        input.action,
        input.idempotencyKey,
      )
    ).profile;
  } catch (error) {
    return rejectWithValue(intelligenceError(error));
  }
});

export const loadCompetitorDiscovery = createAsyncThunk<
  CompetitorDiscovery,
  { siteId: string },
  { rejectValue: string }
>('competitors/loadDiscovery', async ({ siteId }, { rejectWithValue, signal }) => {
  try {
    return (await fetchLatestDiscovery(siteId, signal)).discovery;
  } catch (error) {
    if (apiErrorStatus(error) === 404) return rejectWithValue('');
    return rejectWithValue(intelligenceError(error));
  }
});

export const previewCompetitorDiscovery = createAsyncThunk<
  DiscoverySpendPreview,
  { siteId: string },
  { rejectValue: string }
>('competitors/previewDiscovery', async ({ siteId }, { rejectWithValue }) => {
  try {
    return await previewDiscoverySpend(siteId);
  } catch (error) {
    return rejectWithValue(intelligenceError(error));
  }
});

export const confirmCompetitorDiscovery = createAsyncThunk<
  { discovery: CompetitorDiscovery; replayed: boolean },
  { siteId: string; idempotencyKey: string },
  { rejectValue: string }
>('competitors/confirmDiscovery', async (input, { rejectWithValue }) => {
  try {
    return await refreshDiscovery(input.siteId, input.idempotencyKey);
  } catch (error) {
    return rejectWithValue(intelligenceError(error));
  }
});

export const previewCompetitorLandscape = createAsyncThunk<
  LandscapePreview,
  { siteId: string; competitorProfileIds: string[] },
  { rejectValue: string }
>('competitors/previewLandscape', async (input, { rejectWithValue }) => {
  try {
    return await previewLandscapeSpend(input.siteId, input.competitorProfileIds);
  } catch (error) {
    return rejectWithValue(intelligenceError(error));
  }
});

export const startCompetitorLandscape = createAsyncThunk<
  { runId: string; state: LandscapeState; duplicate: boolean; reservedUnits: number },
  {
    siteId: string;
    competitorProfileIds: string[];
    locale: string;
    idempotencyKey: string;
  },
  { rejectValue: string }
>('competitors/startLandscape', async (input, { rejectWithValue }) => {
  try {
    return (
      await startLandscapeRun(
        input.siteId,
        { competitorProfileIds: input.competitorProfileIds, locale: input.locale },
        input.idempotencyKey,
      )
    ).run;
  } catch (error) {
    return rejectWithValue(intelligenceError(error));
  }
});

export const loadCompetitorLandscapeRuns = createAsyncThunk<
  { items: LandscapeSummary[]; nextCursor: string | null; append: boolean },
  { siteId: string; state?: LandscapeState; cursor?: string; append?: boolean },
  { rejectValue: string }
>('competitors/loadLandscapeRuns', async (input, { rejectWithValue, signal }) => {
  try {
    const page = await fetchLandscapeRuns(input.siteId, {
      state: input.state,
      cursor: input.cursor,
      signal,
    });
    return { ...page, append: input.append ?? false };
  } catch (error) {
    return rejectWithValue(intelligenceError(error));
  }
});

export interface LoadLandscapeDetailInput {
  siteId: string;
  runId: string;
  className?: LandscapeClass;
  competitor?: string;
  q?: string;
  cursor?: string;
}

export const loadCompetitorLandscapeDetail = createAsyncThunk<
  LandscapeDetail,
  LoadLandscapeDetailInput,
  { rejectValue: string }
>('competitors/loadLandscapeDetail', async (input, { rejectWithValue, signal }) => {
  try {
    return await fetchLandscapeDetail(input.siteId, input.runId, { ...input, signal });
  } catch (error) {
    return rejectWithValue(intelligenceError(error));
  }
});

export const cancelCompetitorLandscape = createAsyncThunk<
  LandscapeSummary,
  { siteId: string; runId: string; idempotencyKey: string },
  { rejectValue: string }
>('competitors/cancelLandscape', async (input, { rejectWithValue }) => {
  try {
    return (await cancelLandscapeRun(input.siteId, input.runId, input.idempotencyKey)).run;
  } catch (error) {
    return rejectWithValue(intelligenceError(error));
  }
});

export const acceptCompetitorOpportunity = createAsyncThunk<
  { acceptanceId: string; actionId: string; replayed: boolean; opportunityId: string },
  { siteId: string; runId: string; opportunityId: string; idempotencyKey: string },
  { rejectValue: string }
>('competitors/acceptOpportunity', async (input, { rejectWithValue }) => {
  try {
    const { acceptance } = await acceptLandscapeRecommendation(
      input.siteId,
      input.runId,
      input.opportunityId,
      input.idempotencyKey,
    );
    return { ...acceptance, opportunityId: input.opportunityId };
  } catch (error) {
    return rejectWithValue(intelligenceError(error));
  }
});
