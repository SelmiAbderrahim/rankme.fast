import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GSC_SCOPE } from './googleScopes';
import { useGscConnected } from './useGscConnected';
import { getConnectionConfiguration } from '../api';
import type { GoogleConnection } from '../types';

vi.mock('../api', () => ({ getConnectionConfiguration: vi.fn() }));

const mocked = vi.mocked(getConnectionConfiguration);

const connection = (overrides: Partial<GoogleConnection> = {}): GoogleConnection => ({
  status: 'connected',
  googleAccountEmail: 'owner@example.test',
  propertyUrl: 'sc-domain:example.test',
  connectedAt: '2026-07-01T00:00:00.000Z',
  lastUsedAt: null,
  scopes: [GSC_SCOPE],
  ...overrides,
});

describe('useGscConnected', () => {
  beforeEach(() => mocked.mockReset());

  it('reports connected for a healthy connection with a bound property', async () => {
    mocked.mockResolvedValue(connection());
    const { result } = renderHook(() => useGscConnected('site-1'));
    expect(result.current).toBe('loading');
    await waitFor(() => expect(result.current).toBe('connected'));
  });

  it.each([
    ['no connection', null],
    ['a connection that needs reconnecting', connection({ status: 'needs_reconnect' })],
    ['a connection without a property', connection({ propertyUrl: null })],
    ['a connection without the Search Console scope', connection({ scopes: ['other'] })],
  ])('reports disconnected for %s', async (_label, value) => {
    mocked.mockResolvedValue(value);
    const { result } = renderHook(() => useGscConnected('site-1'));
    await waitFor(() => expect(result.current).toBe('disconnected'));
  });

  it('reports unknown when the lookup fails instead of claiming it is disconnected', async () => {
    mocked.mockRejectedValueOnce(new Error('nope'));
    const { result } = renderHook(() => useGscConnected('site-1'));
    await waitFor(() => expect(result.current).toBe('unknown'));
  });

  it('goes back to loading for a different site and ignores a stale answer', async () => {
    let resolveFirst!: (value: GoogleConnection | null) => void;
    mocked.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveFirst = resolve;
      }),
    );
    const { result, rerender } = renderHook(({ id }) => useGscConnected(id), {
      initialProps: { id: 'site-1' },
    });
    mocked.mockResolvedValueOnce(null);
    rerender({ id: 'site-2' });
    expect(result.current).toBe('loading');
    await waitFor(() => expect(result.current).toBe('disconnected'));
    resolveFirst(connection());
    await Promise.resolve();
    expect(result.current).toBe('disconnected');
  });

  it('ignores a late failure after unmount', async () => {
    let rejectLookup!: (error: unknown) => void;
    mocked.mockImplementationOnce(
      () => new Promise((_resolve, reject) => {
        rejectLookup = reject;
      }),
    );
    const { unmount } = renderHook(() => useGscConnected('site-1'));
    unmount();
    rejectLookup(new Error('late'));
    await Promise.resolve();
  });
});
