import { createAsyncThunk } from '@reduxjs/toolkit';
import {
  addAiVisibilityPrompt,
  checkAiVisibility,
  fetchAiVisibility,
  fetchAiVisibilitySuggestions,
  fetchAiVisibilityTrend,
  generateAiVisibilitySuggestions,
  removeAiVisibilityPrompt,
} from '../api';
import {
  aiVisibilityErrorMessage,
  apiErrorRetryAfterMs,
  apiErrorStatus,
} from '../errorMessage';
import type {
  AiTrackedPrompt,
  AiVisibilityOverview,
  AiVisibilityStoredSuggestions,
  AiVisibilityTrendPoint,
} from '../types';
import type { SupportedLocale } from '@shared/i18n';

export interface RefreshRejectPayload {
  error: string;
  cooldownUntil: number | null;
}

export const DEFAULT_REFRESH_COOLDOWN_MS = 60_000;

export const loadAiVisibility = createAsyncThunk<
  AiVisibilityOverview,
  { siteId: string },
  { rejectValue: string }
>('aiVisibility/load', async ({ siteId }, { rejectWithValue, signal }) => {
  try {
    return await fetchAiVisibility(siteId, { signal });
  } catch (err) {
    return rejectWithValue(aiVisibilityErrorMessage(err, 'aiVisibility:loadFailed'));
  }
});

export const addPrompt = createAsyncThunk<
  AiTrackedPrompt,
  { siteId: string; prompt: string },
  { rejectValue: string }
>('aiVisibility/addPrompt', async ({ siteId, prompt }, { rejectWithValue }) => {
  try {
    const result = await addAiVisibilityPrompt(siteId, prompt);
    return result.prompt;
  } catch (err) {
    return rejectWithValue(aiVisibilityErrorMessage(err, 'aiVisibility:add.failed'));
  }
});

export const removePrompt = createAsyncThunk<
  string,
  { siteId: string; promptId: string },
  { rejectValue: string }
>('aiVisibility/removePrompt', async ({ siteId, promptId }, { rejectWithValue }) => {
  try {
    await removeAiVisibilityPrompt(siteId, promptId);
    return promptId;
  } catch (err) {
    return rejectWithValue(aiVisibilityErrorMessage(err, 'aiVisibility:remove.failed'));
  }
});

export const runAiVisibilityCheck = createAsyncThunk<
  AiVisibilityOverview,
  { siteId: string },
  { rejectValue: RefreshRejectPayload }
>('aiVisibility/check', async ({ siteId }, { rejectWithValue }) => {
  try {
    return await checkAiVisibility(siteId);
  } catch (err) {
    if (apiErrorStatus(err) === 429) {
      return rejectWithValue({
        error: '',
        cooldownUntil:
          Date.now() + (apiErrorRetryAfterMs(err) ?? DEFAULT_REFRESH_COOLDOWN_MS),
      });
    }
    return rejectWithValue({
      error: aiVisibilityErrorMessage(err, 'aiVisibility:refresh.failed'),
      cooldownUntil: null,
    });
  }
});

/**
 * Free read of the stored set. Rejects with a plain message only: the read
 * never consults the debounce, so there is no 429 branch, and — critically —
 * nothing here may write the shared `cooldownUntil` that the mention-check
 * button reads.
 */
export const loadStoredSuggestions = createAsyncThunk<
  AiVisibilityStoredSuggestions,
  { siteId: string; outputLocale: SupportedLocale },
  { rejectValue: string }
>('aiVisibility/suggestions/read', async ({ siteId, outputLocale }, { rejectWithValue, signal }) => {
  try {
    return await fetchAiVisibilitySuggestions(siteId, outputLocale, { signal });
  } catch (err) {
    return rejectWithValue(
      aiVisibilityErrorMessage(err, 'aiVisibility:suggestions.failed'),
    );
  }
});

export interface GenerateSuggestionsRejectPayload {
  error: string;
  cooldownUntil: number | null;
}

/**
 * Suggestion generation. Its rejections land on the suggestion-specific state
 * fields, never the shared refresh ones.
 */
export const generateSuggestions = createAsyncThunk<
  AiVisibilityStoredSuggestions,
  { siteId: string; outputLocale: SupportedLocale },
  { rejectValue: GenerateSuggestionsRejectPayload }
>('aiVisibility/suggestions/generate', async ({ siteId, outputLocale }, { rejectWithValue }) => {
  try {
    return await generateAiVisibilitySuggestions(siteId, outputLocale);
  } catch (err) {
    if (apiErrorStatus(err) === 429) {
      return rejectWithValue({
        error: '',
        cooldownUntil:
          Date.now() + (apiErrorRetryAfterMs(err) ?? DEFAULT_REFRESH_COOLDOWN_MS),
      });
    }
    return rejectWithValue({
      error: aiVisibilityErrorMessage(err, 'aiVisibility:suggestions.generateFailed'),
      cooldownUntil: null,
    });
  }
});

export const addAllSuggestions = createAsyncThunk<
  AiTrackedPrompt[],
  { siteId: string; prompts: string[] },
  { rejectValue: string }
>('aiVisibility/addAllSuggestions', async ({ siteId, prompts }, { rejectWithValue }) => {
  // Serial on purpose: the server enforces the per-site prompt cap per
  // request, so a parallel burst could race past it. Stop at the first
  // failure and keep whatever landed.
  const added: AiTrackedPrompt[] = [];
  for (const prompt of prompts) {
    try {
      const result = await addAiVisibilityPrompt(siteId, prompt);
      added.push(result.prompt);
    } catch (err) {
      if (added.length === 0 && apiErrorStatus(err) !== 402) {
        return rejectWithValue(aiVisibilityErrorMessage(err, 'aiVisibility:add.failed'));
      }
      break;
    }
  }
  return added;
});

export const loadAiVisibilityTrend = createAsyncThunk<
  AiVisibilityTrendPoint[],
  { siteId: string },
  { rejectValue: string }
>('aiVisibility/trend', async ({ siteId }, { rejectWithValue, signal }) => {
  try {
    const result = await fetchAiVisibilityTrend(siteId, { signal });
    return result.points;
  } catch (err) {
    return rejectWithValue(aiVisibilityErrorMessage(err, 'aiVisibility:trend.failed'));
  }
});
