import mongoose from 'mongoose';
import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  BACKLINK_BULK_RANK_MAX_DOMAINS,
  BACKLINK_PULL_MAX_ROWS,
  BACKLINK_PULL_TYPES,
  LINK_GAP_LEG_STATUSES,
  LINK_GAP_MAX_COMPETITORS,
  LINK_INTELLIGENCE_DOMAIN_MAX_LENGTH,
  LINK_INTELLIGENCE_RUN_STATUSES,
  BacklinkPullRun,
  LinkGapRun,
  type BacklinkPullRunDocument,
  type BacklinkPullType,
  type LinkGapLegStatus,
  type LinkGapRunDocument,
  type LinkIntelligenceRunStatus,
} from './index.js';

const ACCOUNT_ID = new mongoose.Types.ObjectId();
const SITE_ID = new mongoose.Types.ObjectId();

function pullRun(overrides: Record<string, unknown> = {}) {
  return {
    accountId: ACCOUNT_ID,
    siteId: SITE_ID,
    type: 'refDomains',
    domain: 'Example.COM',
    inputs: { limit: 100, domains: [] },
    ...overrides,
  };
}

function gapRun(overrides: Record<string, unknown> = {}) {
  return {
    accountId: ACCOUNT_ID,
    siteId: SITE_ID,
    ownDomain: 'Example.COM',
    competitors: ['Competitor.TEST'],
    ...overrides,
  };
}

describe('BacklinkPullRun model', () => {
  it('exports inferred literal types, enums, defaults, and created-only timestamps', () => {
    expect(BACKLINK_PULL_TYPES).toEqual([
      'refDomains',
      'anchors',
      'history',
      'bulkRanks',
    ]);
    expect(LINK_INTELLIGENCE_RUN_STATUSES).toEqual([
      'queued',
      'running',
      'succeeded',
      'failed',
    ]);
    expectTypeOf<BacklinkPullRunDocument['type']>().toEqualTypeOf<BacklinkPullType>();
    expectTypeOf<BacklinkPullRunDocument['status']>().toEqualTypeOf<
      LinkIntelligenceRunStatus
    >();
    expectTypeOf<BacklinkPullRunDocument['createdAt']>().toEqualTypeOf<Date>();

    const doc = new BacklinkPullRun(pullRun());
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.domain).toBe('example.com');
    expect(doc.status).toBe('queued');
    expect(doc.retainedCount).toBe(0);
    expect(doc.completedAt).toBeNull();
    expect(BacklinkPullRun.schema.get('timestamps')).toEqual({
      createdAt: true,
      updatedAt: false,
    });
  });

  it('enforces enum, string, numeric, and bounded-input constraints', () => {
    expect(
      new BacklinkPullRun(pullRun({ type: 'unknown' })).validateSync()?.errors.type,
    ).toBeDefined();
    expect(
      new BacklinkPullRun(
        pullRun({ domain: 'x'.repeat(LINK_INTELLIGENCE_DOMAIN_MAX_LENGTH + 1) }),
      ).validateSync()?.errors.domain,
    ).toBeDefined();
    expect(
      new BacklinkPullRun(
        pullRun({ retainedCount: BACKLINK_PULL_MAX_ROWS + 1 }),
      ).validateSync()?.errors.retainedCount,
    ).toBeDefined();
    expect(
      new BacklinkPullRun(
        pullRun({
          inputs: {
            limit: 1,
            domains: Array.from(
              { length: BACKLINK_BULK_RANK_MAX_DOMAINS + 1 },
              (_, index) => `domain-${index}.test`,
            ),
          },
        }),
      ).validateSync()?.errors['inputs.domains'],
    ).toBeDefined();
  });

  it('applies operation-specific history and bulk-rank input bounds', async () => {
    await expect(
      new BacklinkPullRun(
        pullRun({ type: 'history', inputs: { limit: 25, domains: [] } }),
      ).validate(),
    ).rejects.toThrow(/history limit/);
    await expect(
      new BacklinkPullRun(
        pullRun({ type: 'history', inputs: { limit: 24, domains: [] } }),
      ).validate(),
    ).resolves.toBeUndefined();
    await expect(
      new BacklinkPullRun(
        pullRun({ type: 'bulkRanks', inputs: { limit: null, domains: [] } }),
      ).validate(),
    ).rejects.toThrow(/at least one domain/);
    await expect(
      new BacklinkPullRun(
        pullRun({
          type: 'bulkRanks',
          inputs: { limit: null, domains: ['ranked.test'] },
        }),
      ).validate(),
    ).resolves.toBeUndefined();
  });

  it('rejects unknown nested provider rows instead of persisting raw output', () => {
    const doc = new BacklinkPullRun(
      pullRun({
        inputs: { limit: 10, domains: [], providerRows: [{ raw: true }] },
      }),
    );
    expect(doc.validateSync()?.errors.inputs?.message).toMatch(/StrictModeError/);
  });

  it('declares tenant-first account isolation and list indexes', () => {
    const indexes = BacklinkPullRun.schema.indexes().map(([keys]) => keys);
    expect(indexes).toContainEqual({ accountId: 1, _id: 1 });
    expect(indexes).toContainEqual({
      accountId: 1,
      siteId: 1,
      type: 1,
      createdAt: -1,
      _id: -1,
    });
    expect(indexes).toContainEqual({ accountId: 1, status: 1, createdAt: -1 });
  });
});

describe('LinkGapRun model', () => {
  it('exports inferred leg/status types and terminal defaults', () => {
    expect(LINK_GAP_LEG_STATUSES).toEqual(['ok', 'failed', 'zeroRetained']);
    expectTypeOf<LinkGapRunDocument['status']>().toEqualTypeOf<
      LinkIntelligenceRunStatus
    >();
    expectTypeOf<
      LinkGapRunDocument['perLegOutcomes'][number]['status']
    >().toEqualTypeOf<LinkGapLegStatus>();
    expectTypeOf<LinkGapRunDocument['createdAt']>().toEqualTypeOf<Date>();

    const doc = new LinkGapRun(gapRun());
    expect(doc.validateSync()).toBeUndefined();
    expect(doc.ownDomain).toBe('example.com');
    expect(doc.competitors).toEqual(['competitor.test']);
    expect(doc.status).toBe('queued');
    expect(doc.perLegOutcomes).toEqual([]);
    expect(doc.completedAt).toBeNull();
    expect(LinkGapRun.schema.get('timestamps')).toEqual({
      createdAt: true,
      updatedAt: false,
    });
  });

  it('bounds and deduplicates competitors and per-leg outcomes', () => {
    expect(new LinkGapRun(gapRun({ competitors: [] })).validateSync()).toBeDefined();
    expect(
      new LinkGapRun(
        gapRun({
          competitors: Array.from(
            { length: LINK_GAP_MAX_COMPETITORS + 1 },
            (_, index) => `competitor-${index}.test`,
          ),
        }),
      ).validateSync(),
    ).toBeDefined();
    expect(
      new LinkGapRun(
        gapRun({ competitors: ['duplicate.test', 'duplicate.test'] }),
      ).validateSync(),
    ).toBeDefined();
    expect(
      new LinkGapRun(
        gapRun({
          perLegOutcomes: Array.from(
            { length: LINK_GAP_MAX_COMPETITORS + 1 },
            (_, index) => ({
              competitor: `competitor-${index}.test`,
              status: 'ok',
              retainedCount: 1,
            }),
          ),
        }),
      ).validateSync(),
    ).toBeDefined();
    expect(
      new LinkGapRun(
        gapRun({
          perLegOutcomes: [
            {
              competitor: 'competitor.test',
              status: 'unknown',
              retainedCount: 0,
            },
          ],
        }),
      ).validateSync(),
    ).toBeDefined();
  });

  it('declares tenant-first account isolation and list indexes', () => {
    const indexes = LinkGapRun.schema.indexes().map(([keys]) => keys);
    expect(indexes).toContainEqual({ accountId: 1, _id: 1 });
    expect(indexes).toContainEqual({
      accountId: 1,
      siteId: 1,
      createdAt: -1,
      _id: -1,
    });
    expect(indexes).toContainEqual({ accountId: 1, status: 1, createdAt: -1 });
  });
});
