import { describe, expect, it } from 'vitest';
import { APP_NAV_GROUPS, resolveActiveNavKey } from './appNav';

const candidates = [
  { key: 'dash', href: '/dashboard' },
  { key: 'alerts', href: '/dashboard/alerts' },
  { key: 'profile', href: '/profile' },
  { key: 'security', href: '/settings/security', aliases: ['/profile?tab=security'] },
  { key: 'docs', href: '/ar/docs' },
];

describe('resolveActiveNavKey', () => {
  it('prefers the longest path match', () => {
    expect(resolveActiveNavKey(candidates, '/dashboard', '')).toBe('dash');
    expect(resolveActiveNavKey(candidates, '/dashboard/alerts', '')).toBe('alerts');
    expect(resolveActiveNavKey(candidates, '/dashboard/other', '')).toBe('dash');
  });

  it('lets a query-pinned alias outrank a longer unrelated path', () => {
    expect(resolveActiveNavKey(candidates, '/profile', '?tab=security')).toBe('security');
    expect(resolveActiveNavKey(candidates, '/profile', '?tab=privacy')).toBe('profile');
    expect(resolveActiveNavKey(candidates, '/profile', '')).toBe('profile');
  });

  it('does not match a sibling that merely shares a prefix', () => {
    expect(resolveActiveNavKey(candidates, '/dashboards', '')).toBeNull();
  });

  it('matches localized hrefs and returns null when nothing matches', () => {
    expect(resolveActiveNavKey(candidates, '/ar/docs/getting-started', '')).toBe('docs');
    expect(resolveActiveNavKey(candidates, '/unknown', '')).toBeNull();
    expect(resolveActiveNavKey([], '/dashboard', '')).toBeNull();
  });
});

describe('APP_NAV_GROUPS', () => {
  it('has unique destinations and pins Notifications/Security to /settings/*', () => {
    const items = APP_NAV_GROUPS.flatMap((group) => group.items);
    expect(new Set(items.map((item) => item.to)).size).toBe(items.length);
    const byTo = Object.fromEntries(items.map((item) => [item.to, item]));
    expect(byTo['/settings/security']?.aliases).toContain('/profile?tab=security');
    expect(byTo['/settings/notifications']?.aliases).toContain('/profile?tab=notifications');
  });
});
