import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useCredentialAccount } from './useCredentialAccount';

const mocks = vi.hoisted(() => ({
  listAccounts: vi.fn(),
  session: { data: { user: { id: 'owner', email: 'owner@example.test' } } as { user: { id: string; email?: string } } | null },
}));
vi.mock('./authClient', () => ({
  authClient: { useSession: () => mocks.session, listAccounts: mocks.listAccounts },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.session = { data: { user: { id: 'owner', email: 'owner@example.test' } } };
});

it('reports a password when a credential account is linked', async () => {
  mocks.listAccounts.mockResolvedValue({ data: [{ providerId: 'google' }, { providerId: 'credential' }] });
  const { result } = renderHook(() => useCredentialAccount());
  expect(result.current.state).toEqual({ status: 'loading' });
  await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', hasPassword: true }));
  expect(result.current.email).toBe('owner@example.test');
});

it('reports no password for social-only accounts', async () => {
  mocks.listAccounts.mockResolvedValue({ data: [{ providerId: 'google' }] });
  const { result } = renderHook(() => useCredentialAccount());
  await waitFor(() => expect(result.current.state).toEqual({ status: 'ready', hasPassword: false }));
});

it('surfaces an error response, an unexpected payload and a thrown read, and retries', async () => {
  mocks.listAccounts.mockResolvedValueOnce({ error: { status: 503 } });
  const { result } = renderHook(() => useCredentialAccount());
  await waitFor(() => expect(result.current.state).toEqual({ status: 'error', error: { status: 503 } }));

  mocks.listAccounts.mockResolvedValueOnce({ data: null });
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.state).toEqual({ status: 'error', error: {} }));

  mocks.listAccounts.mockResolvedValueOnce({ data: [{ providerId: 7 }] });
  act(() => result.current.retry());
  await waitFor(() => expect(mocks.listAccounts).toHaveBeenCalledTimes(3));
  await waitFor(() => expect(result.current.state).toEqual({ status: 'error', error: {} }));

  mocks.listAccounts.mockRejectedValueOnce(new Error('offline'));
  act(() => result.current.retry());
  await waitFor(() => expect(mocks.listAccounts).toHaveBeenCalledTimes(4));
  await waitFor(() => expect(result.current.state).toEqual({ status: 'error', error: {} }));
});

it('ignores a read that finishes after the session owner changed', async () => {
  const releases: Array<(value: unknown) => void> = [];
  mocks.listAccounts.mockImplementation(() => new Promise((resolve) => { releases.push(resolve); }));
  const { result, rerender } = renderHook(() => useCredentialAccount());
  mocks.session = { data: { user: { id: 'other' } } };
  rerender();
  await act(async () => { releases[0]!({ data: [{ providerId: 'credential' }] }); });
  expect(result.current.state).toEqual({ status: 'loading' });
});

it('ignores a failing read that was aborted and stays idle without a session', async () => {
  let fail: (reason: unknown) => void = () => undefined;
  mocks.listAccounts.mockImplementation(() => new Promise((_, reject) => { fail = reject; }));
  const { result, rerender } = renderHook(() => useCredentialAccount());
  mocks.session = { data: null };
  rerender();
  await act(async () => { fail(new Error('aborted')); });
  expect(result.current.state).toEqual({ status: 'loading' });
  expect(result.current.email).toBeUndefined();
});
