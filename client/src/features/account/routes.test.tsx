import { describe, expect, it } from 'vitest';
import { accountRoutes } from './routes';
import * as barrel from './index';
import { ACCOUNT_TABS } from './types';

describe('accountRoutes', () => {
  it('registers a single /profile lazy route with an element', async () => {
    const paths = accountRoutes.map((route) => route.path);
    expect(paths).toEqual(['profile']);
    expect(accountRoutes[0]?.lazy).toBeTruthy();
    const routeModule = await accountRoutes[0]!.lazy!();
    expect(routeModule.element).toBeTruthy();
  });

  it('re-exports the public API from the barrel', () => {
    expect(barrel.AccountPage).toBeDefined();
    expect(barrel.accountRoutes).toBe(accountRoutes);
    expect(barrel.ACCOUNT_TABS).toBe(ACCOUNT_TABS);
  });
});
