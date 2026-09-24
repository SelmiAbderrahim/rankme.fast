import { apiClient } from '@shared/api/client';
import type { SupportedLocale } from './locales';

export interface LanguagePreferenceResponse {
  language: SupportedLocale | null;
}

export interface StoredLanguagePreferenceResponse {
  language: SupportedLocale;
}

export function getLanguagePreference(
  signal?: AbortSignal,
): Promise<LanguagePreferenceResponse> {
  return apiClient<LanguagePreferenceResponse>('/users/preferences/language', {
    ...(signal ? { signal } : {}),
  });
}

export function patchLanguagePreference(
  language: SupportedLocale,
  options: { ifUnset?: boolean; signal?: AbortSignal } = {},
): Promise<StoredLanguagePreferenceResponse> {
  return apiClient<StoredLanguagePreferenceResponse>('/users/preferences/language', {
    method: 'PATCH',
    body: {
      language,
      ...(options.ifUnset === undefined ? {} : { ifUnset: options.ifUnset }),
    },
    locale: language,
    ...(options.signal ? { signal: options.signal } : {}),
  });
}
