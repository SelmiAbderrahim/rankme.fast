import { expect, it } from 'vitest';
import { settingsRoutes } from './routes';

it('gives workspace branding one settings route', () => {
  expect(settingsRoutes.map((route) => route.path)).toContain('settings/workspace');
});
