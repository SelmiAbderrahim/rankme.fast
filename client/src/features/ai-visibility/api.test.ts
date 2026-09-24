import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '@shared/api/client';
import {
  addAiVisibilityPrompt,
  checkAiVisibility,
  fetchAiVisibility,
  fetchAiVisibilitySuggestions,
  fetchAiVisibilityTrend,
  generateAiVisibilitySuggestions,
  removeAiVisibilityPrompt,
} from './api';

vi.mock('@shared/api/client', () => ({ apiClient: vi.fn(), LANGUAGE_HEADER: 'x-lang' }));
const apiClient = vi.mocked(client.apiClient);

beforeEach(() => {
  vi.clearAllMocks();
  apiClient.mockResolvedValue({} as never);
});

describe('ai-visibility api wrappers', () => {
  it('fetchAiVisibility GETs the overview endpoint', async () => {
    await fetchAiVisibility('s-1');
    expect(apiClient).toHaveBeenCalledWith('/sites/s-1/ai-visibility', undefined);
  });

  it('fetchAiVisibility forwards an AbortSignal init', async () => {
    const signal = new AbortController().signal;
    await fetchAiVisibility('s-1', { signal });
    expect(apiClient).toHaveBeenCalledWith('/sites/s-1/ai-visibility', { signal });
  });

  it('addAiVisibilityPrompt POSTs the raw prompt object (apiClient stringifies)', async () => {
    await addAiVisibilityPrompt('s-1', 'best seo tool');
    expect(apiClient).toHaveBeenCalledWith('/sites/s-1/ai-visibility/prompts', {
      method: 'POST',
      body: { prompt: 'best seo tool' },
    });
  });

  it('addAiVisibilityPrompt does not pre-stringify the body (guards against double-encode → 400)', async () => {
    await addAiVisibilityPrompt('s-1', 'free uptime monitor website');
    const options = apiClient.mock.calls[0]?.[1];
    // A string body would get JSON.stringify'd again by apiClient into a
    // top-level JSON string, which express.json({ strict: true }) rejects.
    expect(typeof options?.body).toBe('object');
    expect(options?.body).toEqual({ prompt: 'free uptime monitor website' });
  });

  it('removeAiVisibilityPrompt DELETEs by promptId', async () => {
    await removeAiVisibilityPrompt('s-1', 'p-42');
    expect(apiClient).toHaveBeenCalledWith('/sites/s-1/ai-visibility/prompts/p-42', {
      method: 'DELETE',
    });
  });

  it('checkAiVisibility POSTs to the check endpoint', async () => {
    await checkAiVisibility('s-1');
    expect(apiClient).toHaveBeenCalledWith('/sites/s-1/ai-visibility/check', {
      method: 'POST',
    });
  });

  it('generateAiVisibilitySuggestions POSTs the suggestions endpoint', async () => {
    await generateAiVisibilitySuggestions('s-1', 'fr');
    expect(apiClient).toHaveBeenCalledWith('/sites/s-1/ai-visibility/suggestions', {
      method: 'POST',
      locale: 'fr',
      localeMode: 'artifact',
      // Must stay above the profile's 45s `deadlineMs`. At the 15s default the
      // browser aborted a generation the server went on to complete, so the
      // unit was spent and the run stored while the user saw a timeout.
      timeoutMs: 60_000,
    });
  });

  it('fetchAiVisibilitySuggestions GETs the suggestions endpoint', async () => {
    await fetchAiVisibilitySuggestions('s-1', 'de');
    expect(apiClient).toHaveBeenCalledWith('/sites/s-1/ai-visibility/suggestions', {
      locale: 'de',
      localeMode: 'artifact',
    });
  });

  it('fetchAiVisibilitySuggestions forwards an AbortSignal init', async () => {
    const signal = new AbortController().signal;
    await fetchAiVisibilitySuggestions('s-1', 'ar', { signal });
    expect(apiClient).toHaveBeenCalledWith('/sites/s-1/ai-visibility/suggestions', {
      signal,
      locale: 'ar',
      localeMode: 'artifact',
    });
  });

  it('fetchAiVisibilityTrend GETs the trend endpoint', async () => {
    await fetchAiVisibilityTrend('s-1');
    expect(apiClient).toHaveBeenCalledWith('/sites/s-1/ai-visibility/trend', undefined);
  });

  it('fetchAiVisibilityTrend forwards an AbortSignal init', async () => {
    const signal = new AbortController().signal;
    await fetchAiVisibilityTrend('s-1', { signal });
    expect(apiClient).toHaveBeenCalledWith('/sites/s-1/ai-visibility/trend', { signal });
  });
});
