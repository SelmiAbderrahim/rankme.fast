import { afterEach, describe, expect, it } from 'vitest';
import { createAppRouter, waitForAppRouterInitialization } from './router';

const ORIGINAL_PATH = `${window.location.pathname}${window.location.search}${window.location.hash}`;

afterEach(() => {
  window.history.replaceState(null, '', ORIGINAL_PATH);
});

describe('SSR browser-router initialization', () => {
  it('waits for an initial lazy route before hydration', async () => {
    window.history.replaceState(null, '', '/settings/notifications');
    const router = createAppRouter();

    expect(router.state.initialized).toBe(false);
    await waitForAppRouterInitialization(router);
    expect(router.state.initialized).toBe(true);
    expect(router.state.matches.at(-1)?.route.path).toBe('settings/notifications');

    router.dispose();
  });

  it('returns immediately when the initial route is already initialized', async () => {
    window.history.replaceState(null, '', '/');
    const router = createAppRouter();

    expect(router.state.initialized).toBe(true);
    await waitForAppRouterInitialization(router);
    expect(router.state.initialized).toBe(true);

    router.dispose();
  });
});
