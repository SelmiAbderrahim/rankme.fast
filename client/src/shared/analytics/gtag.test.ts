import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetAnalyticsChoiceMemory, writeAnalyticsChoice } from './consent';
import {
  analyticsMeasurementId,
  isAnalyticsConfigured,
  resetAnalyticsForTests,
  startAnalyticsPageTracking,
  syncAnalyticsConsent,
  trackAnalyticsPageView,
} from './gtag';

type Call = unknown[];
const calls = (): Call[] =>
  ((window as unknown as { dataLayer?: ArrayLike<unknown>[] }).dataLayer ?? []).map((entry) =>
    Array.from(entry),
  );
const events = (name: string): Call[] => calls().filter((c) => c[0] === 'event' && c[1] === name);
const loaders = (): HTMLScriptElement[] =>
  Array.from(document.head.querySelectorAll('script')).filter((s) =>
    s.src.includes('googletagmanager.com'),
  );

const visit = (path: string) => window.history.pushState({}, '', path);

beforeEach(() => {
  vi.stubEnv('VITE_GA_ID', 'G-TEST123');
  resetAnalyticsForTests();
  delete (window as unknown as { dataLayer?: unknown }).dataLayer;
  delete (window as unknown as { gtag?: unknown }).gtag;
  document.head.querySelectorAll('script').forEach((s) => s.remove());
  window.localStorage.clear();
  resetAnalyticsChoiceMemory();
  visit('/');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('analytics configuration', () => {
  it('is disabled for a blank or malformed measurement id', () => {
    for (const value of ['', '   ', 'UA-1234', 'G-bad id', 'G-']) {
      vi.stubEnv('VITE_GA_ID', value);
      expect(analyticsMeasurementId()).toBeNull();
      expect(isAnalyticsConfigured()).toBe(false);
    }
    vi.stubEnv('VITE_GA_ID', ' G-ABC123 ');
    expect(analyticsMeasurementId()).toBe('G-ABC123');
  });

  it('does nothing at all without a measurement id', () => {
    vi.stubEnv('VITE_GA_ID', '');
    writeAnalyticsChoice('granted');
    syncAnalyticsConsent();
    trackAnalyticsPageView();
    const stop = startAnalyticsPageTracking({ subscribe: vi.fn() });
    stop();
    expect(loaders()).toHaveLength(0);
    expect(calls()).toHaveLength(0);
  });
});

describe('consent gating', () => {
  it('loads no script and sends no page view before consent', () => {
    visit('/sites/6aba2d0c494c7d1f4ccde3a1?tab=keywords');
    syncAnalyticsConsent();
    trackAnalyticsPageView();
    expect(loaders()).toHaveLength(0);
    expect(calls()).toHaveLength(0);
  });

  it('stays off after an explicit decline', () => {
    writeAnalyticsChoice('denied');
    syncAnalyticsConsent();
    trackAnalyticsPageView();
    expect(loaders()).toHaveLength(0);
    expect(events('page_view')).toHaveLength(0);
  });

  it('on grant: default-denied consent first, then update, one loader, one scrubbed page view', () => {
    visit('/sites/6aba2d0c494c7d1f4ccde3a1?tab=keywords#x');
    writeAnalyticsChoice('granted');
    syncAnalyticsConsent();
    syncAnalyticsConsent();

    const all = calls();
    expect(all[0]).toEqual([
      'consent',
      'default',
      {
        analytics_storage: 'denied',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
      },
    ]);
    expect(all.find((c) => c[0] === 'config')).toEqual([
      'config',
      'G-TEST123',
      {
        send_page_view: false,
        allow_google_signals: false,
        allow_ad_personalization_signals: false,
      },
    ]);
    expect(all.filter((c) => c[0] === 'consent' && c[1] === 'update')[0]?.[2]).toEqual({
      analytics_storage: 'granted',
    });
    expect(loaders()).toHaveLength(1);
    expect(loaders()[0]?.src).toBe('https://www.googletagmanager.com/gtag/js?id=G-TEST123');

    const views = events('page_view');
    expect(views).toHaveLength(1);
    const params = views[0]?.[2] as Record<string, string>;
    expect(params.page_path).toBe('/sites/:id');
    expect(params.page_location).toBe(`${window.location.origin}/sites/:id`);
    expect(params.page_title).toBe('/sites/:id');
    expect(JSON.stringify(calls())).not.toMatch(/6aba2d0c494c7d1f4ccde3a1|tab=keywords/);
  });

  it('scrubs capability urls and drops the query on every reported field', () => {
    visit('/team/accept/inv-secret-token?returnTo=%2Fteam%2Faccept%2Finv-secret-token');
    writeAnalyticsChoice('granted');
    syncAnalyticsConsent();
    expect(JSON.stringify(calls())).not.toMatch(/inv-secret-token|returnTo/);
    expect((events('page_view')[0]?.[2] as Record<string, string>).page_path).toBe(
      '/team/accept/:id',
    );
  });

  it('reports each pathname once; tab (query-only) changes are not page views', () => {
    writeAnalyticsChoice('granted');
    syncAnalyticsConsent();
    visit('/sites/6aba2d0c494c7d1f4ccde3a1?tab=keywords');
    trackAnalyticsPageView();
    visit('/sites/6aba2d0c494c7d1f4ccde3a1?tab=audits');
    trackAnalyticsPageView();
    visit('/exports');
    trackAnalyticsPageView();
    const views = events('page_view').map((c) => (c[2] as Record<string, string>).page_path);
    expect(views).toEqual(['/', '/sites/:id', '/exports']);
  });

  it('uses the previous scrubbed page, then an external referrer origin, as the referrer', () => {
    vi.spyOn(document, 'referrer', 'get').mockReturnValue('https://search.example/q?x=1');
    writeAnalyticsChoice('granted');
    syncAnalyticsConsent();
    visit('/exports');
    trackAnalyticsPageView();
    const [first, second] = events('page_view').map((c) => c[2] as Record<string, string>);
    expect(first?.page_referrer).toBe('https://search.example');
    expect(second?.page_referrer).toBe(`${window.location.origin}/`);
  });

  it('drops a same-origin or unparsable document referrer', () => {
    const spy = vi.spyOn(document, 'referrer', 'get');
    spy.mockReturnValue(`${window.location.origin}/prev?x=1`);
    writeAnalyticsChoice('granted');
    syncAnalyticsConsent();
    expect((events('page_view')[0]?.[2] as Record<string, string>).page_referrer).toBe('');
    resetAnalyticsForTests();
    spy.mockReturnValue('not a url');
    visit('/other');
    syncAnalyticsConsent();
    const last = events('page_view').at(-1)?.[2] as Record<string, string>;
    expect(last.page_referrer).not.toContain('not a url');
  });

  it('withdrawing consent updates GA to denied and stops page views; re-granting resumes', () => {
    writeAnalyticsChoice('granted');
    syncAnalyticsConsent();
    writeAnalyticsChoice('denied');
    syncAnalyticsConsent();
    expect(calls().filter((c) => c[0] === 'consent' && c[1] === 'update').at(-1)?.[2]).toEqual({
      analytics_storage: 'denied',
    });
    visit('/exports');
    trackAnalyticsPageView();
    expect(events('page_view')).toHaveLength(1);

    writeAnalyticsChoice('granted');
    syncAnalyticsConsent();
    expect(loaders()).toHaveLength(1);
    expect(events('page_view')).toHaveLength(2);
  });

  it('a decline without prior grant sends no consent update', () => {
    writeAnalyticsChoice('denied');
    syncAnalyticsConsent();
    expect(calls()).toHaveLength(0);
  });
});

describe('startAnalyticsPageTracking', () => {
  it('follows consent and router changes, and stops cleanly', () => {
    let routerListener: () => void = () => undefined;
    const unsubscribeRouter = vi.fn();
    const router = {
      subscribe: vi.fn((listener: () => void) => {
        routerListener = listener;
        return unsubscribeRouter;
      }),
    };
    const stop = startAnalyticsPageTracking(router);
    expect(loaders()).toHaveLength(0);

    writeAnalyticsChoice('granted');
    expect(loaders()).toHaveLength(1);
    expect(events('page_view')).toHaveLength(1);

    visit('/exports');
    routerListener();
    expect(events('page_view')).toHaveLength(2);

    stop();
    expect(unsubscribeRouter).toHaveBeenCalledTimes(1);
    writeAnalyticsChoice('denied');
    expect(calls().filter((c) => c[0] === 'consent' && c[1] === 'update')).toHaveLength(1);
  });
});
