import { afterEach, expect, it, vi } from 'vitest';
import { authClient } from './authClient';
import { sessionMutation } from './sessionMutation';

vi.mock('./authClient', () => ({
  authClient: { $store: { atoms: { session: undefined } } },
}));
afterEach(() => vi.useRealTimers());

it('returns a rejected credential mutation without waiting for a refresh', async () => {
  const result = { error: { status: 401 } };
  expect(await sessionMutation(async () => result)).toBe(result);
});

it('reports a missing native session store after a successful mutation', async () => {
  await expect(sessionMutation(async () => ({ error: null }))).rejects.toThrow('Session store unavailable');
});

it('stops waiting when Better Auth cannot finish its session refresh', async () => {
  vi.useFakeTimers();
  const unlisten = vi.fn();
  const session = { get: () => ({ isRefetching: true }), listen: () => unlisten };
  (authClient.$store.atoms as { session?: unknown }).session = session;
  const pending = sessionMutation(async () => ({ error: null }));
  const assertion = expect(pending).rejects.toThrow('Session refresh unavailable');
  await vi.runAllTimersAsync();
  await assertion;
  expect(unlisten).toHaveBeenCalledTimes(1);
});
