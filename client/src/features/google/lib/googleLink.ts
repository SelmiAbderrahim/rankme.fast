import { authClient } from '@features/auth';
import { appHref } from '@shared/navigation/appHref';

/**
 * Marker query params for the Better Auth `linkSocial` round-trip. On return,
 * the completion effect in `GoogleConnectionCard` reads `?google_linked=1`,
 * POSTs `/google/connect/complete`, and strips the marker; `?google_error=1`
 * surfaces a link failure instead. Shared by the connect card and the GA4
 * enable CTA so both flows behave identically.
 */
export const GOOGLE_LINKED_QUERY_KEY = 'google_linked';
export const GOOGLE_ERROR_QUERY_KEY = 'google_error';

export interface StartGoogleLinkInput {
  scopes: string[];
  callbackURL: string;
  errorCallbackURL: string;
}

export interface StartGoogleLinkResult {
  error?: { message?: string } | null;
}

interface LinkSocialClient {
  linkSocial: (
    input: StartGoogleLinkInput & { provider: string },
  ) => Promise<StartGoogleLinkResult>;
}

/** Kick off the Google OAuth link flow with the requested scopes. */
export const startGoogleLink = (
  input: StartGoogleLinkInput,
): Promise<StartGoogleLinkResult> => {
  const client = authClient as unknown as LinkSocialClient;
  return client.linkSocial({ provider: 'google', ...input });
};

/**
 * The CURRENT page URL (path + query) with a marker param appended, so the
 * OAuth round-trip returns the user to the exact surface they left.
 */
export const markerCallbackUrl = (key: string): string => {
  const params = new URLSearchParams(window.location.search);
  params.set(key, '1');
  return appHref(`${window.location.pathname}?${params.toString()}`);
};
