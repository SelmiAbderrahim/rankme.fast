import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ANALYTICS_CONSENT_STORAGE_KEY,
  readAnalyticsChoice,
  resetAnalyticsChoiceMemory,
  subscribeAnalyticsChoice,
  useAnalyticsChoice,
  writeAnalyticsChoice,
} from './consent';

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  resetAnalyticsChoiceMemory();
});

describe('analytics consent storage', () => {
  it('reads nothing until a choice is stored and ignores junk values', () => {
    expect(readAnalyticsChoice()).toBeNull();
    window.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, 'maybe');
    expect(readAnalyticsChoice()).toBeNull();
  });

  it('persists, reads back, and clears a choice', () => {
    writeAnalyticsChoice('granted');
    expect(window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY)).toBe('granted');
    expect(readAnalyticsChoice()).toBe('granted');
    writeAnalyticsChoice('denied');
    expect(readAnalyticsChoice()).toBe('denied');
    writeAnalyticsChoice(null);
    expect(window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY)).toBeNull();
    expect(readAnalyticsChoice()).toBeNull();
  });

  it('keeps the choice for the page view when storage is blocked, never assuming a grant', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readAnalyticsChoice()).toBeNull();
    writeAnalyticsChoice('denied');
    expect(readAnalyticsChoice()).toBe('denied');
    writeAnalyticsChoice(null);
    expect(readAnalyticsChoice()).toBeNull();
  });

  it('notifies subscribers on writes and on cross-tab storage events, until unsubscribed', () => {
    const listener = vi.fn();
    const stop = subscribeAnalyticsChoice(listener);
    writeAnalyticsChoice('granted');
    expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent('storage', { key: ANALYTICS_CONSENT_STORAGE_KEY }));
    expect(listener).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new StorageEvent('storage', { key: null }));
    expect(listener).toHaveBeenCalledTimes(3);
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }));
    expect(listener).toHaveBeenCalledTimes(3);
    stop();
    writeAnalyticsChoice('denied');
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('exposes the choice through the hook and re-renders on change', () => {
    const { result } = renderHook(() => useAnalyticsChoice());
    expect(result.current).toBe('unset');
    act(() => writeAnalyticsChoice('granted'));
    expect(result.current).toBe('granted');
  });
});
