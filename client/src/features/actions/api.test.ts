import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shared/api/client', () => ({
  apiClient: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    data: unknown;
    code: string;
    constructor(status: number, data: unknown, code = 'http') {
      super('api');
      this.status = status;
      this.data = data;
      this.code = code;
    }
  },
}));

import { apiClient } from '@shared/api/client';
import {
  buildListActionsQuery,
  getActionHistory,
  listActions,
  mutateActionState,
  retestAction,
} from './api';

const mocked = vi.mocked(apiClient);

beforeEach(() => {
  mocked.mockReset();
  mocked.mockResolvedValue({} as never);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('actions api', () => {
  it('buildListActionsQuery encodes multi-value filters + limit + cursor', () => {
    const q = buildListActionsQuery({
      siteId: 's1',
      filters: {
        state: ['open', 'planned'],
        source: ['audit_finding', 'gsc_decline'],
        severity: ['critical'],
        confidence: ['high', 'low'],
        effort: ['low'],
      },
      limit: 20,
      cursor: 'c1',
    });
    // Order preserved as inserted.
    expect(q).toContain('state=open');
    expect(q).toContain('state=planned');
    expect(q).toContain('source=audit_finding');
    expect(q).toContain('source=gsc_decline');
    expect(q).toContain('severity=critical');
    expect(q).toContain('confidence=high');
    expect(q).toContain('confidence=low');
    expect(q).toContain('effort=low');
    expect(q).toContain('limit=20');
    expect(q).toContain('cursor=c1');
  });

  it('buildListActionsQuery drops invalid enum values', () => {
    const q = buildListActionsQuery({
      siteId: 's1',
      filters: {
        state: ['open', 'bogus' as never],
        severity: ['nope' as never],
      },
    });
    expect(q).toContain('state=open');
    expect(q).not.toContain('bogus');
    expect(q).not.toContain('nope');
  });

  it('buildListActionsQuery returns empty string when no filters supplied', () => {
    expect(buildListActionsQuery({ siteId: 's' })).toBe('');
  });

  it('buildListActionsQuery ignores zero/negative limit', () => {
    expect(buildListActionsQuery({ siteId: 's', limit: 0 })).toBe('');
    expect(buildListActionsQuery({ siteId: 's', limit: -3 })).toBe('');
  });

  it('listActions GETs /sites/:siteId/actions with the built query', async () => {
    await listActions({ siteId: 's1', filters: { state: ['open'] }, limit: 5 });
    const [path, opts] = mocked.mock.calls[0]!;
    expect(path).toContain('/sites/s1/actions?');
    expect(path).toContain('state=open');
    expect(path).toContain('limit=5');
    expect(opts).toMatchObject({ method: 'GET' });
  });

  it('listActions omits query when no filters/limit/cursor', async () => {
    await listActions({ siteId: 's2' });
    expect(mocked.mock.calls[0]![0]).toBe('/sites/s2/actions');
  });

  it('listActions threads AbortSignal', async () => {
    const controller = new AbortController();
    await listActions({ siteId: 's', cursor: 'c' }, { signal: controller.signal });
    expect(mocked.mock.calls[0]![1]).toMatchObject({ signal: controller.signal });
  });

  it('getActionHistory encodes ids and threads signal', async () => {
    const controller = new AbortController();
    await getActionHistory('s/1', 'a/1', { signal: controller.signal });
    const [path, opts] = mocked.mock.calls[0]!;
    expect(path).toBe('/sites/s%2F1/actions/a%2F1/history');
    expect(opts).toMatchObject({ method: 'GET', signal: controller.signal });
  });

  it('getActionHistory works without signal', async () => {
    await getActionHistory('s', 'a');
    expect(mocked.mock.calls[0]![0]).toBe('/sites/s/actions/a/history');
  });

  it('mutateActionState POSTs body without siteId/actionId', async () => {
    await mutateActionState({
      siteId: 's1',
      actionId: 'a1',
      state: 'dismissed',
      expectedVersion: 3,
      clientKey: 'k',
      note: 'why',
    });
    const [path, opts] = mocked.mock.calls[0]!;
    expect(path).toBe('/sites/s1/actions/a1/state');
    expect(opts).toMatchObject({
      method: 'POST',
      body: {
        state: 'dismissed',
        expectedVersion: 3,
        clientKey: 'k',
        note: 'why',
      },
    });
  });

  it('retestAction POSTs and echoes back optional clientKey', async () => {
    await retestAction({ siteId: 's', actionId: 'a', clientKey: 'ck' });
    const [path, opts] = mocked.mock.calls[0]!;
    expect(path).toBe('/sites/s/actions/a/retest');
    expect(opts).toMatchObject({
      method: 'POST',
      body: { clientKey: 'ck' },
    });
  });

  it('retestAction works without clientKey', async () => {
    await retestAction({ siteId: 's', actionId: 'a' });
    expect(mocked.mock.calls[0]![1]).toMatchObject({ body: {} });
  });
});
