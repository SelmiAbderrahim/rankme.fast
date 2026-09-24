/**
 * GSC generative-AI appearance repository + read DTO tests.
 *
 * Real generated migrations against PGlite via the drizzle-postgres-scope
 * harness. No live Google traffic — the raw appearance labels used here are
 * fixture-derived. Truth-table cases each get a dedicated assertion.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../../db/client.js';
import type { ObservationMeta } from '../../shared/observations/types.js';
import {
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  buildGenerativeAppearanceRead,
  readSearchAppearance,
  upsertSearchAppearance,
  type GscSearchAppearanceRow,
} from './gsc-snapshots.service.js';

let db: Db;

beforeAll(async () => {
  db = (await startTestPostgres()) as unknown as Db;
});

afterAll(async () => {
  await stopTestPostgres();
});

beforeEach(async () => {
  await truncateAllTables();
});

const SITE_A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const SITE_B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const ACCOUNT_A = '111111111111111111111111';
const PROPERTY = 'sc-domain:example.com';

function row(
  raw: string,
  overrides: Partial<GscSearchAppearanceRow> = {},
): GscSearchAppearanceRow {
  return {
    rawAppearance: raw,
    clicks: 10,
    impressions: 400,
    ctr: 0.025,
    position: 5.5,
    ...overrides,
  };
}

function meta(overrides: Partial<ObservationMeta> = {}): ObservationMeta {
  return {
    sourceKind: 'first_party',
    sourceLabel: 'gsc.search-appearance',
    observedAt: '2026-07-16T00:00:00.000Z',
    freshUntil: null,
    freshness: 'fresh',
    market: null,
    sampleCount: 3,
    coverageNoteKey: null,
    ...overrides,
  };
}

describe('upsertSearchAppearance', () => {
  it('persists raw + classified rows for a property/day', async () => {
    await upsertSearchAppearance(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      property: PROPERTY,
      snapshotDate: '2026-07-16',
      rows: [
        row('AI_OVERVIEWS', { clicks: 42, impressions: 1580 }),
        row('AI_MODE', { clicks: 7, impressions: 214 }),
        row('FAQ_RICH_RESULTS', { clicks: 91 }),
      ],
      observationMeta: meta(),
    });
    const rows = await readSearchAppearance(db, SITE_A, PROPERTY);
    expect(rows).toHaveLength(3);
    // Ordering: generative first, then by clicks desc.
    expect(rows.map((r) => r.rawAppearance)).toEqual([
      'AI_OVERVIEWS',
      'AI_MODE',
      'FAQ_RICH_RESULTS',
    ]);
    expect(rows[0]!.classificationSlug).toBe('ai_overviews');
    expect(rows[0]!.classifiedGenerative).toBe(true);
    expect(rows[1]!.classificationSlug).toBe('ai_mode');
    expect(rows[1]!.classifiedGenerative).toBe(true);
    expect(rows[2]!.classificationSlug).toBe('faq_rich_results');
    expect(rows[2]!.classifiedGenerative).toBe(false);
  });

  it('preserves unknown raw values verbatim as other_unknown, never generative', async () => {
    await upsertSearchAppearance(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      property: PROPERTY,
      snapshotDate: '2026-07-16',
      rows: [row('FUTURE_GENERATIVE_SURFACE_V2', { clicks: 3, impressions: 118 })],
      observationMeta: meta(),
    });
    const rows = await readSearchAppearance(db, SITE_A, PROPERTY);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.rawAppearance).toBe('FUTURE_GENERATIVE_SURFACE_V2');
    expect(rows[0]!.classificationSlug).toBe('other_unknown');
    expect(rows[0]!.classifiedGenerative).toBe(false);
  });

  it('replace-on-conflict at (site, property, day, window) — retry replaces the day', async () => {
    await upsertSearchAppearance(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      property: PROPERTY,
      snapshotDate: '2026-07-16',
      rows: [row('AI_OVERVIEWS', { clicks: 5 })],
      observationMeta: meta(),
    });
    await upsertSearchAppearance(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      property: PROPERTY,
      snapshotDate: '2026-07-16',
      rows: [row('AI_OVERVIEWS', { clicks: 42 }), row('VIDEO', { clicks: 8 })],
      observationMeta: meta(),
    });
    const rows = await readSearchAppearance(db, SITE_A, PROPERTY);
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.rawAppearance === 'AI_OVERVIEWS')!.clicks).toBe(42);
  });

  it('empty input deletes any prior rows for the day (idempotent no-op afterwards)', async () => {
    await upsertSearchAppearance(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      property: PROPERTY,
      snapshotDate: '2026-07-16',
      rows: [row('AI_OVERVIEWS')],
      observationMeta: meta(),
    });
    await upsertSearchAppearance(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      property: PROPERTY,
      snapshotDate: '2026-07-16',
      rows: [],
      observationMeta: meta(),
    });
    expect(await readSearchAppearance(db, SITE_A, PROPERTY)).toEqual([]);
  });

  it('sites are isolated — reading site B never sees site A rows', async () => {
    await upsertSearchAppearance(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      property: PROPERTY,
      snapshotDate: '2026-07-16',
      rows: [row('AI_OVERVIEWS')],
      observationMeta: meta(),
    });
    expect(await readSearchAppearance(db, SITE_B, PROPERTY)).toEqual([]);
  });

  it('preserves observationMeta on every persisted row', async () => {
    const observationMeta = meta({ sampleCount: 12, coverageNoteKey: 'gsc.window' });
    await upsertSearchAppearance(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      property: PROPERTY,
      snapshotDate: '2026-07-16',
      rows: [row('AI_OVERVIEWS')],
      observationMeta,
    });
    const rows = await readSearchAppearance(db, SITE_A, PROPERTY);
    expect(rows[0]!.observationMeta).toEqual(observationMeta);
  });

  it('normalizes duplicate raw values inside one call to a single row', async () => {
    await upsertSearchAppearance(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      property: PROPERTY,
      snapshotDate: '2026-07-16',
      rows: [
        row('AI_OVERVIEWS', { clicks: 1 }),
        row('AI_OVERVIEWS', { clicks: 99 }),
      ],
      observationMeta: meta(),
    });
    const rows = await readSearchAppearance(db, SITE_A, PROPERTY);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.clicks).toBe(99);
  });
});

describe('readSearchAppearance', () => {
  it('returns [] when nothing stored', async () => {
    expect(await readSearchAppearance(db, SITE_A, PROPERTY)).toEqual([]);
  });

  it('returns the LATEST snapshot day for a property when day is omitted', async () => {
    await upsertSearchAppearance(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      property: PROPERTY,
      snapshotDate: '2026-07-09',
      rows: [row('AI_OVERVIEWS', { clicks: 1 })],
      observationMeta: meta(),
    });
    await upsertSearchAppearance(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      property: PROPERTY,
      snapshotDate: '2026-07-16',
      rows: [row('AI_OVERVIEWS', { clicks: 99 })],
      observationMeta: meta(),
    });
    const rows = await readSearchAppearance(db, SITE_A, PROPERTY);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.snapshotDate).toBe('2026-07-16');
    expect(rows[0]!.clicks).toBe(99);
  });

  it('reads an explicit historical day when requested', async () => {
    await upsertSearchAppearance(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      property: PROPERTY,
      snapshotDate: '2026-07-09',
      rows: [row('AI_OVERVIEWS', { clicks: 1 })],
      observationMeta: meta(),
    });
    await upsertSearchAppearance(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      property: PROPERTY,
      snapshotDate: '2026-07-16',
      rows: [row('AI_OVERVIEWS', { clicks: 99 })],
      observationMeta: meta(),
    });
    const rows = await readSearchAppearance(db, SITE_A, PROPERTY, {
      snapshotDate: '2026-07-09',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.clicks).toBe(1);
  });
});

describe('buildGenerativeAppearanceRead', () => {
  it('returns unavailable + no window when the row set is empty', () => {
    const dto = buildGenerativeAppearanceRead([]);
    expect(dto.status).toBe('unavailable');
    expect(dto.rows).toEqual([]);
    expect(dto.window).toBeNull();
    expect(dto.observationMeta).toBeNull();
  });

  it('marks status=available when any row is classifier-recognized as generative', async () => {
    await upsertSearchAppearance(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      property: PROPERTY,
      snapshotDate: '2026-07-16',
      rows: [
        row('AI_OVERVIEWS', { clicks: 42, impressions: 1580 }),
        row('FAQ_RICH_RESULTS', { clicks: 91 }),
      ],
      observationMeta: meta(),
    });
    const rows = await readSearchAppearance(db, SITE_A, PROPERTY);
    const dto = buildGenerativeAppearanceRead(rows);
    expect(dto.status).toBe('available');
    expect(dto.rows.map((r) => r.rawAppearance)).toEqual([
      'AI_OVERVIEWS',
      'FAQ_RICH_RESULTS',
    ]);
    expect(dto.rows[0]).toMatchObject({
      classificationSlug: 'ai_overviews',
      isGenerative: true,
      clicks: 42,
      impressions: 1580,
    });
    expect(dto.window).toEqual({
      start: '2026-06-19',
      end: '2026-07-16',
      windowDays: 28,
    });
  });

  it('classified-generative row with zero clicks + positive impressions stays available', async () => {
    await upsertSearchAppearance(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      property: PROPERTY,
      snapshotDate: '2026-07-16',
      rows: [row('AI_OVERVIEWS', { clicks: 0, impressions: 500, ctr: 0 })],
      observationMeta: meta(),
    });
    const rows = await readSearchAppearance(db, SITE_A, PROPERTY);
    const dto = buildGenerativeAppearanceRead(rows);
    expect(dto.status).toBe('available');
    expect(dto.rows[0]!.clicks).toBe(0);
    expect(dto.rows[0]!.impressions).toBe(500);
  });

  it('unavailable when only non-generative rows are present — no synthetic generative row', async () => {
    await upsertSearchAppearance(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      property: PROPERTY,
      snapshotDate: '2026-07-16',
      rows: [row('VIDEO'), row('FAQ_RICH_RESULTS')],
      observationMeta: meta(),
    });
    const rows = await readSearchAppearance(db, SITE_A, PROPERTY);
    const dto = buildGenerativeAppearanceRead(rows);
    expect(dto.status).toBe('unavailable');
    // non-generative rows still surface for observability
    expect(dto.rows.map((r) => r.classificationSlug)).toContain('video');
    expect(dto.rows.every((r) => r.isGenerative === false)).toBe(true);
  });

  it('unknown raw values stay other_unknown, never generative', async () => {
    await upsertSearchAppearance(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      property: PROPERTY,
      snapshotDate: '2026-07-16',
      rows: [row('FUTURE_GENERATIVE_SURFACE_V2', { clicks: 3 })],
      observationMeta: meta(),
    });
    const rows = await readSearchAppearance(db, SITE_A, PROPERTY);
    const dto = buildGenerativeAppearanceRead(rows);
    expect(dto.status).toBe('unavailable');
    expect(dto.rows[0]!.classificationSlug).toBe('other_unknown');
    expect(dto.rows[0]!.isGenerative).toBe(false);
    expect(dto.rows[0]!.rawAppearance).toBe('FUTURE_GENERATIVE_SURFACE_V2');
  });

  it('explicit status override wins — partial/reconnect/failed emit no rows', () => {
    for (const status of ['partial', 'reconnect_required', 'failed'] as const) {
      const dto = buildGenerativeAppearanceRead([], { status });
      expect(dto.status).toBe(status);
      expect(dto.rows).toEqual([]);
      expect(dto.window).toBeNull();
      expect(dto.observationMeta).toBeNull();
    }
  });

  it('carries observationMeta from the first row through to the DTO', async () => {
    const observationMeta = meta({
      sampleCount: 9,
      coverageNoteKey: 'gsc.appearance.window',
    });
    await upsertSearchAppearance(db, {
      siteId: SITE_A,
      accountId: ACCOUNT_A,
      property: PROPERTY,
      snapshotDate: '2026-07-16',
      rows: [row('AI_OVERVIEWS')],
      observationMeta,
    });
    const rows = await readSearchAppearance(db, SITE_A, PROPERTY);
    const dto = buildGenerativeAppearanceRead(rows);
    expect(dto.observationMeta).toEqual(observationMeta);
  });
});
