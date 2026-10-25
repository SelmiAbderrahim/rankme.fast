import { act, renderHook, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { dismissTwoFactorRecommendation, fetchTwoFactorRecommendation } from './api';
import { resetTwoFactorRecommendation, useTwoFactorRecommendation } from './useTwoFactorRecommendation';

const state = vi.hoisted(() => ({
  session: { authenticated: true, emailVerified: true, mustChangePassword: false, user: { id: 'owner', twoFactorEnabled: false } as { id: string; twoFactorEnabled?: boolean } | null },
  role: 'owner' as string | null,
  client: { twoFactor: { enable: () => undefined } } as { twoFactor?: { enable?: unknown } },
}));

vi.mock('./api', () => ({
  fetchTwoFactorRecommendation: vi.fn(),
  dismissTwoFactorRecommendation: vi.fn(),
}));
vi.mock('./useAuthSession', () => ({ useAuthSession: () => state.session }));
vi.mock('@shared/hooks/redux', () => ({ useAppSelector: () => state.role }));
vi.mock('./authClient', () => ({ authClient: state.client }));

beforeEach(() => {
  vi.clearAllMocks();
  resetTwoFactorRecommendation();
  state.session = { authenticated: true, emailVerified: true, mustChangePassword: false, user: { id: 'owner', twoFactorEnabled: false } };
  state.role = 'owner';
  state.client.twoFactor = { enable: () => undefined };
  vi.mocked(fetchTwoFactorRecommendation).mockResolvedValue({ dismissedAt: null });
  vi.mocked(dismissTwoFactorRecommendation).mockResolvedValue({ dismissedAt: '2026-10-24T00:00:00Z' });
});

it('hides the recommendation when the saved preference cannot be read', async () => {
  vi.mocked(fetchTwoFactorRecommendation).mockRejectedValue(new Error('offline'));
  const { result } = renderHook(() => useTwoFactorRecommendation());
  await waitFor(() => expect(fetchTwoFactorRecommendation).toHaveBeenCalledTimes(1));
  expect(result.current.visible).toBe(false);
});

it('hides the recommendation once the owner dismissed it before', async () => {
  vi.mocked(fetchTwoFactorRecommendation).mockResolvedValue({ dismissedAt: '2026-10-01T00:00:00Z' });
  const { result } = renderHook(() => useTwoFactorRecommendation());
  await waitFor(() => expect(fetchTwoFactorRecommendation).toHaveBeenCalledTimes(1));
  expect(result.current.visible).toBe(false);
});

it('reads the preference once and shows it to an eligible owner', async () => {
  const { result, rerender } = renderHook(() => useTwoFactorRecommendation());
  await waitFor(() => expect(result.current.visible).toBe(true));
  rerender();
  expect(fetchTwoFactorRecommendation).toHaveBeenCalledTimes(1);
});

it('keeps the reminder hidden when saving the dismissal fails', async () => {
  vi.mocked(dismissTwoFactorRecommendation).mockRejectedValue(new Error('offline'));
  const { result } = renderHook(() => useTwoFactorRecommendation());
  await waitFor(() => expect(result.current.visible).toBe(true));
  await act(async () => { await result.current.dismiss(); });
  expect(result.current.visible).toBe(false);
});

it('does nothing when dismissing without a signed-in user', async () => {
  state.session = { authenticated: false, emailVerified: false, mustChangePassword: false, user: null };
  const { result } = renderHook(() => useTwoFactorRecommendation());
  await act(async () => { await result.current.dismiss(); });
  expect(dismissTwoFactorRecommendation).not.toHaveBeenCalled();
  expect(fetchTwoFactorRecommendation).not.toHaveBeenCalled();
  expect(result.current.visible).toBe(false);
});

it('is not shown to non-owners, enrolled users or clients without two-factor support', async () => {
  state.role = 'member';
  expect(renderHook(() => useTwoFactorRecommendation()).result.current.visible).toBe(false);
  state.role = 'owner';
  state.session = { ...state.session, user: { id: 'owner', twoFactorEnabled: true } };
  expect(renderHook(() => useTwoFactorRecommendation()).result.current.visible).toBe(false);
  state.session = { ...state.session, user: { id: 'owner' } };
  delete state.client.twoFactor;
  expect(renderHook(() => useTwoFactorRecommendation()).result.current.visible).toBe(false);
  expect(fetchTwoFactorRecommendation).not.toHaveBeenCalled();
});

it('renders on the server without reading the preference', () => {
  function Probe() {
    return <p>{String(useTwoFactorRecommendation().visible)}</p>;
  }
  expect(renderToString(<Probe />)).toContain('false');
  state.session = { authenticated: false, emailVerified: false, mustChangePassword: false, user: null };
  expect(renderToString(<Probe />)).toContain('false');
});

it('shares one saved-preference read between hooks that mount together or later', async () => {
  const first = renderHook(() => useTwoFactorRecommendation());
  const second = renderHook(() => useTwoFactorRecommendation());
  await waitFor(() => expect(first.result.current.visible).toBe(true));
  expect(second.result.current.visible).toBe(true);
  const third = renderHook(() => useTwoFactorRecommendation());
  expect(third.result.current.visible).toBe(true);
  expect(fetchTwoFactorRecommendation).toHaveBeenCalledTimes(1);
});
