import type { GoogleConnection } from '../types';

/** Search Console read-only scope — every connection is created with it. */
export const GSC_SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';

/** GA4 read-only scope — granted only after the user enables Analytics. */
export const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';

/**
 * A legacy connection row without a `scopes` array was created by the
 * GSC-only flow, so Search Console access is assumed granted there.
 */
export const hasGscScope = (
  connection: Pick<GoogleConnection, 'scopes'> | null | undefined,
): boolean => !connection?.scopes || connection.scopes.includes(GSC_SCOPE);

export const hasGa4Scope = (
  connection: Pick<GoogleConnection, 'scopes'> | null | undefined,
): boolean => Boolean(connection?.scopes?.includes(GA4_SCOPE));
