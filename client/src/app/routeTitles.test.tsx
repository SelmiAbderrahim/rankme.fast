import type { RouteObject } from 'react-router-dom';
import { expect, it } from 'vitest';
import { appShellRoutes } from './routes';
import { LEGACY_APP_REDIRECTS } from './legacyRedirects';
import { SUPPORTED_LOCALES } from '@shared/i18n';
import { RESOURCES } from '@shared/i18n/resources';
import { resolveAppTitleTarget } from '@shared/navigation/appTitle';
import { SITE_TABS } from '@features/sites';

const LEGACY_REDIRECT_PATHS = new Set(LEGACY_APP_REDIRECTS.map((entry) => entry.from));
function paths(routes: RouteObject[], prefix = ''): string[] {
  return routes.flatMap((route) => {
    const path = `${prefix}/${route.path ?? ''}`.replace(/\/{2,}/g, '/');
    if (route.children) return paths(route.children, path);
    // A moved path only redirects; the destination page carries the title.
    if (LEGACY_REDIRECT_PATHS.has(route.path ?? '')) return [];
    return route.path === '*' ? [] : [path.replace(/:[^/]+/g, 'fixture')];
  });
}
function value(locale: (typeof SUPPORTED_LOCALES)[number], key: string): unknown {
  const [namespace, path] = key.includes(':') ? key.split(':') : ['common', key];
  let tree: unknown = RESOURCES[locale][namespace as keyof typeof RESOURCES.en];
  for (const segment of path!.split('.')) tree = tree && typeof tree === 'object' ? (tree as Record<string, unknown>)[segment] : undefined;
  return tree;
}
it.each(SUPPORTED_LOCALES)('%s names every declared app/auth route and site panel without locale fallback', (locale) => {
  for (const path of paths(appShellRoutes)) {
    const target = resolveAppTitleTarget(path, '');
    expect(target.pageKey, `Title missing for ${path}`).not.toBeNull();
    expect(value(locale, target.pageKey!), `${locale}: ${path}`).toBeTypeOf('string');
    expect(value(locale, target.pageKey!)).not.toBe(target.pageKey);
  }
  for (const tab of SITE_TABS) {
    const target = resolveAppTitleTarget('/sites/fixture', `?tab=${tab}`);
    expect(value(locale, target.pageKey!), `${locale}: ${tab}`).toBeTypeOf('string');
  }
});
