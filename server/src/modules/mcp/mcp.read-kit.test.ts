/**
 * The shared stored-read harness: parse → allowed-site intersection →
 * lease/ownership (404) → bounded plain JSON.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

const mocks = vi.hoisted(() => ({
  loadOwnedSite: vi.fn(),
  tryRunWithSiteWorkLease: vi.fn(),
  getApiKeysDb: vi.fn(() => ({ kind: 'db' })),
}));

vi.mock('../sites/index.js', () => ({
  Site: { find: vi.fn(), findOne: vi.fn() },
  loadOwnedSite: mocks.loadOwnedSite,
  tryRunWithSiteWorkLease: mocks.tryRunWithSiteWorkLease,
}));
vi.mock('../audits/index.js', () => ({}));
vi.mock('../ranks/index.js', () => ({}));
vi.mock('../content-intelligence/index.js', () => ({}));
vi.mock('../api-keys/index.js', () => ({ getApiKeysDb: mocks.getApiKeysDb }));
import { DICTIONARIES } from '../../shared/i18n/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import {
  STORED_READ_MAX_BYTES,
  STORED_READ_REASONS,
  STORED_READ_ROW_LIMIT,
  boundPayload,
  clampRows,
  runAccountStoredRead,
  runSiteStoredRead,
  toPlainJson,
} from './mcp.read-kit.js';
import type { McpToolContext } from './mcp.tools.js';

const SITE_ID = '507f1f77bcf86cd799439011';
const ACCOUNT_ID = 'a'.repeat(24);
const schema = z.object({ siteId: z.string().regex(/^[0-9a-f]{24}$/), n: z.number().optional() }).strict();

function context(overrides: Partial<McpToolContext['permissions']> = {}): McpToolContext {
  return {
    accountId: ACCOUNT_ID,
    locale: 'en',
    permissions: { tools: {}, allowedSiteIds: null, allowSpend: true, ...overrides },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tryRunWithSiteWorkLease.mockImplementation(
    async (_scope, _prefix, work: () => Promise<unknown>) => ({
      acquired: true,
      value: await work(),
    }),
  );
  mocks.loadOwnedSite.mockResolvedValue({ _id: SITE_ID, domain: 'example.com' });
});

describe('pure helpers', () => {
  it('clamps rows to the shared ceiling and reports truncation', () => {
    const rows = Array.from({ length: 150 }, (_, i) => i);
    expect(clampRows(rows)).toEqual({ rows: rows.slice(0, STORED_READ_ROW_LIMIT), truncated: true });
    expect(clampRows(rows, 5)).toEqual({ rows: [0, 1, 2, 3, 4], truncated: true });
    expect(clampRows(rows, 1_000).rows).toHaveLength(STORED_READ_ROW_LIMIT);
    expect(clampRows([1, 2], 0)).toEqual({ rows: [1], truncated: true });
    expect(clampRows([1])).toEqual({ rows: [1], truncated: false });
  });

  it('turns Dates, ObjectId-likes and markup into inert plain JSON', () => {
    const plain = toPlainJson({
      at: new Date('2026-01-02T03:04:05.000Z'),
      id: { toJSON: () => 'abc' },
      title: '<script>alert(1)</script> & <b>x',
      gone: undefined,
    });
    expect(plain).toEqual({
      at: '2026-01-02T03:04:05.000Z',
      id: 'abc',
      title: '‹script>alert(1)‹/script> & ‹b>x',
    });
    expect(toPlainJson(undefined)).toBeNull();
  });

  it('halves the longest array until the payload fits and flags truncation', () => {
    const payload = { rows: Array.from({ length: 64 }, () => 'x'.repeat(100)), tiny: [1] };
    const bounded = boundPayload(payload, 1_500);
    expect(bounded?.truncated).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(bounded?.payload))).toBeLessThanOrEqual(1_500);
    expect((bounded?.payload.rows as unknown[]).length).toBeLessThan(64);
    expect(bounded?.payload.tiny).toEqual([1]);
    expect(boundPayload({ a: 1 })).toEqual({ payload: { a: 1 }, truncated: false });
  });

  it('gives up when no array is left to shrink', () => {
    expect(boundPayload({ blob: 'x'.repeat(500) }, 100)).toBeNull();
    expect(boundPayload({ rows: [], blob: 'x'.repeat(500) }, 100)).toBeNull();
    // An array shrinks to empty but the remainder is still too large.
    expect(boundPayload({ rows: ['x'.repeat(10)], blob: 'x'.repeat(500) }, 100)).toBeNull();
    // A single-row array shrinks to empty and then fits.
    expect(boundPayload({ rows: ['x'.repeat(200)] }, 100)).toEqual({
      payload: { rows: [] },
      truncated: true,
    });
  });

  it('declares a localized sentence for every reason code in every locale', () => {
    for (const locale of Object.keys(DICTIONARIES) as Array<keyof typeof DICTIONARIES>) {
      const reasons = DICTIONARIES[locale].mcp.reasons as Record<string, string>;
      for (const reason of STORED_READ_REASONS) {
        expect(reasons[reason], `${locale}.${reason}`).toBeTruthy();
      }
    }
  });
});

describe('runSiteStoredRead', () => {
  const run = (
    read: Parameters<typeof runSiteStoredRead<typeof schema>>[0]['read'],
    input: unknown = { siteId: SITE_ID },
    ctx: McpToolContext = context(),
  ) => runSiteStoredRead({ name: 'demo_tool', schema, read }, input, ctx);

  it('returns plain bounded JSON with status ok and a localized summary line', async () => {
    const result = await run(async (_input, env) => ({
      status: 'ok',
      count: 2,
      data: { rows: [{ at: new Date('2026-01-01T00:00:00.000Z') }, { at: null }], domain: env.site.domain },
    }));
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({
      rows: [{ at: '2026-01-01T00:00:00.000Z' }, { at: null }],
      domain: 'example.com',
      status: 'ok',
      truncated: false,
      locale: 'en',
    });
    expect(result.content[0]?.text).toBe(
      'demo_tool returned stored data (2 rows). Nothing was spent.',
    );
    expect(mocks.tryRunWithSiteWorkLease).toHaveBeenCalledWith(
      { accountId: ACCOUNT_ID, siteId: SITE_ID },
      'mcp:read:demo_tool',
      expect.any(Function),
    );
    expect(mocks.loadOwnedSite).toHaveBeenCalledWith(ACCOUNT_ID, SITE_ID, { allowPaused: true });
  });

  it('defaults the summary count to zero and keeps a tool-reported truncation flag', async () => {
    const result = await run(async () => ({ status: 'ok', data: { rows: [] }, truncated: true }));
    expect(result.structuredContent.truncated).toBe(true);
    expect(result.content[0]?.text).toContain('(0 rows)');
  });

  it('clips oversized arrays under the byte ceiling and says so', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ i, text: 'y'.repeat(2_000) }));
    const result = await run(async () => ({ status: 'ok', count: rows.length, data: { rows } }));
    const out = result.structuredContent as { rows: unknown[]; truncated: boolean };
    expect(out.truncated).toBe(true);
    expect(out.rows.length).toBeLessThan(100);
    expect(Buffer.byteLength(JSON.stringify(out))).toBeLessThanOrEqual(STORED_READ_MAX_BYTES);
  });

  it('degrades to payloadTooLarge when nothing can be clipped', async () => {
    const result = await run(async () => ({
      status: 'ok',
      data: { blob: 'z'.repeat(STORED_READ_MAX_BYTES + 10) },
    }));
    expect(result.structuredContent).toMatchObject({
      status: 'unavailable',
      reason: 'payloadTooLarge',
      message: DICTIONARIES.en.mcp.reasons.payloadTooLarge,
    });
  });

  it.each(['empty', 'unavailable'] as const)('returns an explicit %s marker, never zeros', async (status) => {
    const result = await run(async () => ({
      status,
      reason: 'snapshotMissing',
      data: { range: '28d' },
    }));
    expect(result.structuredContent).toEqual({
      range: '28d',
      status,
      reason: 'snapshotMissing',
      message: DICTIONARIES.en.mcp.reasons.snapshotMissing,
      locale: 'en',
    });
    expect(result.content[0]?.text).toBe(
      `demo_tool: ${status === 'empty' ? 'nothing is stored yet.' : 'stored data is unavailable.'} ${DICTIONARIES.en.mcp.reasons.snapshotMissing}`,
    );
  });

  it('handles an empty marker without extra data', async () => {
    const result = await run(async () => ({ status: 'empty', reason: 'noData' }));
    expect(result.structuredContent).toMatchObject({ status: 'empty', reason: 'noData' });
  });

  it('hides a site outside the allowed-site intersection before any lookup', async () => {
    const read = vi.fn();
    const result = await run(read, undefined, context({ allowedSiteIds: ['b'.repeat(24)] }));
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code: 'sites.errors.notFound' } });
    expect(mocks.tryRunWithSiteWorkLease).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it('treats a site that cannot be leased (deleting) as not found', async () => {
    mocks.tryRunWithSiteWorkLease.mockResolvedValueOnce({ acquired: false });
    const result = await run(vi.fn());
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code: 'sites.errors.notFound' } });
  });

  it('rejects malformed input before touching anything', async () => {
    const result = await run(vi.fn(), { siteId: 'nope' });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({ error: { code: 'mcp.errors.invalidInput' } });
    expect(mocks.tryRunWithSiteWorkLease).not.toHaveBeenCalled();
    const missing = await run(vi.fn(), null);
    expect(missing.isError).toBe(true);
  });
});

describe('runAccountStoredRead', () => {
  const accountSchema = z.object({ limit: z.number().optional() }).strict();
  const run = (
    read: Parameters<typeof runAccountStoredRead<typeof accountSchema>>[0]['read'],
    input: unknown = {},
  ) =>
    runAccountStoredRead(
      { name: 'account_tool', schema: accountSchema, read },
      input,
      context({ allowedSiteIds: [SITE_ID] }),
    );

  it('hands the effective permissions to the reader and returns ok data', async () => {
    const read = vi.fn(async () => ({ status: 'ok' as const, data: { rows: [1] }, count: 1 }));
    const result = await run(read, { limit: 3 });
    expect(read).toHaveBeenCalledWith(
      { limit: 3 },
      expect.objectContaining({
        accountId: ACCOUNT_ID,
        locale: 'en',
        permissions: expect.objectContaining({ allowedSiteIds: [SITE_ID] }),
      }),
    );
    expect(result.structuredContent).toMatchObject({ status: 'ok', rows: [1] });
    expect(mocks.tryRunWithSiteWorkLease).not.toHaveBeenCalled();
  });

  it('defaults a missing input object', async () => {
    const result = await run(async () => ({ status: 'empty', reason: 'noData' }), null);
    expect(result.structuredContent).toMatchObject({ status: 'empty' });
  });
});
