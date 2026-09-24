/**
 * Resolve the Vite API base without pinning a deployment origin.
 *
 * A production web image can be exercised behind the composed loopback proxy
 * while still carrying the production VITE_* values. When the configured API
 * and site share an origin, use the API pathname on that alternate browser
 * origin; this preserves same-origin cookies/CSP in Docker and is equivalent
 * to the absolute URL at the configured production origin.
 */
export function normalizeApiBaseUrl(
  configuredApi: string | undefined,
  configuredSite: string | undefined,
  browserOrigin: string | undefined,
): string {
  const base = (configuredApi ?? '/api').replace(/\/+$/, '');
  if (!configuredSite || !browserOrigin || !/^https?:\/\//i.test(base)) return base;

  try {
    const apiUrl = new URL(base);
    const siteUrl = new URL(configuredSite);
    const currentOrigin = new URL(browserOrigin).origin;
    if (apiUrl.origin === siteUrl.origin && apiUrl.origin !== currentOrigin) {
      return `${apiUrl.pathname}${apiUrl.search}`.replace(/\/+$/, '');
    }
  } catch {
    return base;
  }
  return base;
}
