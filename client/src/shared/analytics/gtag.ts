import { sanitizeAnalyticsPath } from './pagePath';
import { readAnalyticsChoice, subscribeAnalyticsChoice } from './consent';

const MEASUREMENT_ID = /^G-[A-Z0-9]+$/u;
const LOADER_ORIGIN = 'https://www.googletagmanager.com';

interface AnalyticsWindow extends Window {
  dataLayer?: unknown[];
  gtag?: (...args: unknown[]) => void;
}

/**
 * GA4 measurement ID baked at build time from `VITE_GA_ID`. Blank or malformed
 * values resolve to `null`: nothing renders and nothing loads.
 */
export function analyticsMeasurementId(): string | null {
  const configured = (import.meta.env.VITE_GA_ID as string | undefined)?.trim() ?? '';
  return MEASUREMENT_ID.test(configured) ? configured : null;
}

export const isAnalyticsConfigured = (): boolean => analyticsMeasurementId() !== null;

let initialized = false;
let loaderRequested = false;
let enabled = false;
let lastRawPath: string | null = null;
let lastSafeLocation = '';

const win = (): AnalyticsWindow => window as AnalyticsWindow;

/** Consent Mode v2 bootstrap: queue defaults as denied before anything else. */
function initialize(id: string): void {
  if (initialized) return;
  initialized = true;
  const w = win();
  w.dataLayer = w.dataLayer ?? [];
  w.gtag = function gtag() {
    // gtag.js reads `arguments` objects from the data layer, not arrays.
    // eslint-disable-next-line prefer-rest-params
    w.dataLayer?.push(arguments);
  };
  w.gtag('consent', 'default', {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  });
  w.gtag('js', new Date());
  w.gtag('config', id, {
    // Page views are sent by hand with a scrubbed path (see trackPageView).
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  });
}

function loadScript(id: string): void {
  if (loaderRequested) return;
  loaderRequested = true;
  const script = document.createElement('script');
  script.async = true;
  script.src = `${LOADER_ORIGIN}/gtag/js?id=${encodeURIComponent(id)}`;
  document.head.appendChild(script);
}

function referrerOrigin(): string {
  try {
    const origin = new URL(document.referrer).origin;
    return origin === window.location.origin ? '' : origin;
  } catch {
    return '';
  }
}

/** Send one scrubbed page view for the current location, if consent is on. */
export function trackAnalyticsPageView(): void {
  const id = analyticsMeasurementId();
  if (!id || !enabled) return;
  const rawPath = window.location.pathname;
  if (rawPath === lastRawPath) return;
  lastRawPath = rawPath;
  const safePath = sanitizeAnalyticsPath(rawPath);
  const safeLocation = `${window.location.origin}${safePath}`;
  const params = {
    page_location: safeLocation,
    page_path: safePath,
    // The document title carries site labels in the signed-in app.
    page_title: safePath,
    page_referrer: lastSafeLocation || referrerOrigin(),
  };
  // `set` also scrubs the location GA reads for any automatic event.
  win().gtag?.('set', { page_location: safeLocation, page_path: safePath });
  win().gtag?.('event', 'page_view', params);
  lastSafeLocation = safeLocation;
}

/** Reconcile GA with the stored choice. Safe to call repeatedly. */
export function syncAnalyticsConsent(): void {
  const id = analyticsMeasurementId();
  if (!id) return;
  const granted = readAnalyticsChoice() === 'granted';
  if (granted) {
    initialize(id);
    win().gtag?.('consent', 'update', { analytics_storage: 'granted' });
    enabled = true;
    loadScript(id);
    trackAnalyticsPageView();
    return;
  }
  if (enabled) win().gtag?.('consent', 'update', { analytics_storage: 'denied' });
  enabled = false;
  lastRawPath = null;
}

/** Router hook: report each pathname change once; query-only changes (tabs) never. */
export function startAnalyticsPageTracking(router: {
  subscribe: (listener: () => void) => () => void;
}): () => void {
  if (!isAnalyticsConfigured()) return () => undefined;
  syncAnalyticsConsent();
  const stopConsent = subscribeAnalyticsChoice(syncAnalyticsConsent);
  const stopRouter = router.subscribe(() => trackAnalyticsPageView());
  return () => {
    stopConsent();
    stopRouter();
  };
}

/** Test seam: drop module state between tests. */
export function resetAnalyticsForTests(): void {
  initialized = false;
  loaderRequested = false;
  enabled = false;
  lastRawPath = null;
  lastSafeLocation = '';
}
