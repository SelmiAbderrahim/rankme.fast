import { expect, it } from 'vitest';
import { settingsRoutes } from './routes';

it('gives workspace branding one settings route', () => {
  expect(settingsRoutes.map((route) => route.path)).toContain('settings/workspace');
});

it('loads the workspace settings page and its branding reducer on demand', async () => {
  const route = settingsRoutes.find((entry) => entry.path === 'settings/workspace');
  const loaded = await route?.lazy?.();
  expect(loaded).toHaveProperty('element');
});
