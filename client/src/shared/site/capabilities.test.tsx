import { beforeAll, describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import { siteCapabilities, useWorkspaceSiteCapabilities, SiteLifecycleProvider } from './capabilities';
import i18n from 'i18next';
import { initI18n } from '@shared/i18n';
beforeAll(() => initI18n({ initialLocale: 'en' }));

describe('site lifecycle capabilities', () => {
  it('permits work for an unknown or active site and only resume for a paused site', () => {
    for (const site of [null, undefined, {}, { paused: false }]) {
      expect(siteCapabilities(site)).toEqual({ paused: false, canRun: true, canSchedule: true, canResume: false });
    }
    expect(siteCapabilities({ paused: true })).toEqual({ paused: true, canRun: false, canSchedule: false, canResume: true });
  });
  it('uses one optional context with a localized blocked reason', () => {
    const outside = renderHook(useWorkspaceSiteCapabilities);
    expect(outside.result.current.blockedReason).toBeNull();
    const inside = renderHook(useWorkspaceSiteCapabilities, { wrapper: ({ children }) => <SiteLifecycleProvider paused>{children}</SiteLifecycleProvider> });
    expect(inside.result.current.blockedReason).toBe(i18n.t('sites:paused.actionBlocked'));
    expect(inside.result.current.canRun).toBe(false);
    const active = renderHook(useWorkspaceSiteCapabilities, { wrapper: ({ children }) => <SiteLifecycleProvider paused={false}>{children}</SiteLifecycleProvider> });
    expect(active.result.current.blockedReason).toBeNull();
  });
});
