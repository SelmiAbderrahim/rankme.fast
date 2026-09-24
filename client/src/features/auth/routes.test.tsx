import { describe, expect, it } from 'vitest';
import { matchRoutes } from 'react-router-dom';
import { routes } from '@app/routes';
import { SUPPORTED_LOCALES } from '@shared/i18n';
import { authEntryHref } from './intent';
import { authRoutes } from './routes';
import { teamActionRoutes } from '@features/team/routes';

describe('authRoutes', () => {
  it('registers exactly one `reset-password` route (the duplicate bare registration was removed)', () => {
    const resetRoutes = authRoutes.filter((route) => route.path === 'reset-password');
    expect(resetRoutes).toHaveLength(1);
  });

  it('every registered auth path is unique', () => {
    const paths = authRoutes
      .map((route) => route.path)
      .filter((path): path is string => path !== undefined);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it.each(SUPPORTED_LOCALES)(
    'matches locale-aware %s auth CTAs to the actual unprefixed auth routes',
    (locale) => {
      for (const path of ['/login', '/register'] as const) {
        const href = authEntryHref(path, locale);
        const matches = matchRoutes(routes, href);
        expect(matches?.at(-1)?.route.path).toBe(path.slice(1));
        expect(new URL(href, 'https://rankme.test').pathname).toBe(path);
        if (locale === 'en') expect(href).toBe(path);
        else expect(href).toBe(`${path}?lng=${locale}`);
      }
    },
  );
});

describe('team invitation routes', () => {
  it('registers public preview decisions and a recoverable provisional inbox', () => {
    expect(teamActionRoutes.map((route) => route.path)).toEqual([
      'team/invitations',
      'team/accept/:token',
      'team/reject/:token',
      'team/change-password',
    ]);
  });
});
