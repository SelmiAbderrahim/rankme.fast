/**
 * Weekly Pulse — digest renderer tests.
 *
 * Pure-builder tests validate: fixed section ordering, top-3 cap, coverage
 * shape, sort stability, honest empty state, safe deep-link derivation from
 * `CLIENT_URL`, and no-raw-content field allow-list.
 *
 * DB-side tests validate the UPSERT idempotency + read + missing-run
 * behaviour against PGlite.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getTestDb,
  startTestPostgres,
  stopTestPostgres,
  truncateAllTables,
} from '../../shared/testing/postgres.js';
import {
  weeklyPulseCitationChanges,
  weeklyPulseCitations,
  weeklyPulseRuns,
} from '../../db/schema/weekly-pulse.js';
import {
  buildDeepLinks,
  buildPayload,
  MissingPulseRunError,
  localizeDigestActionEntry,
  localizeDigestProjection,
  readDigestProjection,
  renderDigestProjection,
  type BuildDigestPayloadInput,
  type DigestRendererDeps,
} from './digest.renderer.js';

function baseInput(): BuildDigestPayloadInput {
  return {
    run: {
      id: '00000000-0000-0000-0000-000000000001',
      siteId: 'site-1',
      isoWeek: '2026-W01',
      status: 'completed',
      marketSnapshot: { country: 'US', language: 'en' },
      engineSurfaceSet: [
        { engine: 'chatgpt', surface: 'mentions', supported: true, reason: null },
        { engine: 'perplexity', surface: 'mentions', supported: true, reason: null },
        { engine: 'gemini', surface: 'mentions', supported: false, reason: 'unsupported' },
      ],
    },
    citations: [],
    changes: [],
    confirmedRankDrops: [],
    actionTransitions: [],
    topOpenActions: [],
    gscAppearance: null,
    brandDeltas: [],
    siteLabel: 'Example Inc',
    renderedAt: new Date('2026-01-05T09:00:00.000Z'),
  };
}

function semanticAction(
  actionId: string,
  state: 'completed' | 'regressed' | 'open',
  targetUrl: string | null = null,
): BuildDigestPayloadInput['actionTransitions'][number] {
  return {
    actionId,
    messageKey: state === 'completed'
      ? 'weeklyPulse.actions.completed'
      : state === 'regressed'
        ? 'weeklyPulse.actions.regressed'
        : 'weeklyPulse.actions.open',
    targetUrl,
    ...(targetUrl === null
      ? { targetMessageKey: 'weeklyPulse.actions.targetUnavailable' as const }
      : {}),
    state,
  };
}

describe('buildPayload — pure digest projection', () => {
  it('localizes semantic Action copy and preserves legacy projections verbatim', () => {
    const semantic = localizeDigestActionEntry('ar', {
      actionId: 'a'.repeat(250),
      messageKey: 'weeklyPulse.actions.completed',
      messageVars: { count: 1 },
      targetUrl: `https://example.com/${'x'.repeat(600)}`,
      targetMessageKey: 'weeklyPulse.actions.targetUnavailable',
      targetMessageVars: { count: 1 },
      state: 'completed',
    });
    if (!('targetUrl' in semantic)) throw new Error('expected semantic action');
    expect(semantic.actionId).toHaveLength(200);
    expect(semantic.targetUrl).toHaveLength(500);
    expect(semantic.messageVars).toEqual({ count: 1 });
    expect(semantic.targetMessageVars).toEqual({ count: 1 });
    expect(semantic.verb).toMatch(/[\u0600-\u06ff]/u);
    expect(semantic.target).toBe(semantic.targetUrl);

    const regressed = localizeDigestActionEntry('fr', {
      actionId: 42,
      verb: 'Frozen verb',
      target: 'http://example.com/regressed',
      state: 'regressed',
    } as never);
    expect(regressed).toEqual({
      actionId: 42,
      verb: 'Frozen verb',
      target: 'http://example.com/regressed',
      state: 'regressed',
    });

    const open = localizeDigestActionEntry('de', {
      actionId: 'open',
      messageKey: 'operator.invalid',
      target: 'Frozen non-URL target',
      targetUrl: 42,
      targetMessageKey: 'operator.invalid',
      state: 'unexpected',
    } as never);
    expect(open).toMatchObject({
      messageKey: 'weeklyPulse.actions.open',
      targetUrl: null,
      targetMessageKey: 'weeklyPulse.actions.targetUnavailable',
      state: 'open',
    });

    const completedFallback = localizeDigestActionEntry('en', {
      actionId: 42,
      messageKey: 'operator.invalid',
      target: 'http://example.com/completed-fallback',
      state: 'completed',
    } as never);
    expect(completedFallback).toMatchObject({
      actionId: '',
      messageKey: 'weeklyPulse.actions.completed',
      targetUrl: 'http://example.com/completed-fallback',
      state: 'completed',
    });

    const regressedFallback = localizeDigestActionEntry('en', {
      actionId: 'regressed-fallback',
      messageKey: 'operator.invalid',
      target: 'https://example.com/regressed-fallback',
      state: 'regressed',
    } as never);
    expect(regressedFallback).toMatchObject({
      messageKey: 'weeklyPulse.actions.regressed',
      targetUrl: 'https://example.com/regressed-fallback',
      state: 'regressed',
    });

    expect(() => localizeDigestActionEntry('en', {
      actionId: 'raw-copy',
      verb: 'Rendered verb',
      target: 'Rendered target',
      messageKey: 42,
      state: 'open',
    } as never)).toThrow('new weekly pulse projections require semantic action copy');

    const completedLegacy = localizeDigestActionEntry('es', {
      actionId: 'completed',
      verb: 'Frozen verb',
      target: 'https://example.com/completed',
      state: 'completed',
    } as never);
    expect(completedLegacy).toEqual({
      actionId: 'completed',
      verb: 'Frozen verb',
      target: 'https://example.com/completed',
      state: 'completed',
    });

    const projection = buildPayload(baseInput());
    projection.actions_completed = [semantic];
    projection.actions_regressed = [regressed];
    projection.next_actions_top3 = [open, completedLegacy];
    const localized = localizeDigestProjection('zh', projection);
    expect(localized.actions_completed).toHaveLength(1);
    expect(localized.actions_regressed).toHaveLength(1);
    expect(localized.next_actions_top3).toHaveLength(2);
    expect(localized.actions_completed[0]?.verb).not.toContain('weeklyPulse.actions.');
    expect(localized.actions_regressed[0]).toEqual(regressed);
    expect(localized.next_actions_top3[1]).toEqual(completedLegacy);

    const empty = localizeDigestProjection('en', {
      ...projection,
      actions_completed: undefined,
      actions_regressed: undefined,
      next_actions_top3: undefined,
    } as never);
    expect(empty.actions_completed).toEqual([]);
    expect(empty.actions_regressed).toEqual([]);
    expect(empty.next_actions_top3).toEqual([]);
  });

  it('produces the fixed section order and safe header fields', () => {
    const out = buildPayload(baseInput());
    // Keys in fixed insertion order.
    expect(Object.keys(out)).toEqual([
      'header',
      'coverage',
      'citations_new',
      'citations_lost',
      'citations_unknown_partial',
      'confirmed_rank_drops',
      'actions_completed',
      'actions_regressed',
      'next_actions_top3',
      'gsc_appearance',
      'brand_deltas',
      'deep_links',
    ]);
    expect(out.header).toMatchObject({
      siteId: 'site-1',
      siteLabel: 'Example Inc',
      isoWeek: '2026-W01',
      renderedAt: '2026-01-05T09:00:00.000Z',
    });
    expect(out.coverage).toEqual({
      supported: 2,
      total: 3,
      supportedCells: [
        { engine: 'chatgpt', surface: 'mentions' },
        { engine: 'perplexity', surface: 'mentions' },
      ],
      partial: true,
    });
  });

  it('classifies + stable-sorts citation changes and links titles from citations', () => {
    const input = baseInput();
    input.citations = [
      {
        id: 'c1',
        pulseRunId: input.run.id,
        engine: 'chatgpt',
        surface: 'mentions',
        promptCohortId: 'cohort',
        promptCohortVersion: 1,
        canonicalUrl: 'https://a.example/a',
        titleSafe: 'Doc A',
        host: 'a.example',
        mentionCount: 1,
        firstSeenAt: null,
        createdAt: new Date(),
      } as (typeof input.citations)[number],
      {
        id: 'c2',
        pulseRunId: input.run.id,
        engine: 'chatgpt',
        surface: 'mentions',
        promptCohortId: 'cohort',
        promptCohortVersion: 1,
        canonicalUrl: 'https://b.example/b',
        titleSafe: null,
        host: 'b.example',
        mentionCount: 1,
        firstSeenAt: null,
        createdAt: new Date(),
      } as (typeof input.citations)[number],
    ];
    input.changes = [
      {
        id: 'ch2',
        pulseRunId: input.run.id,
        priorPulseRunId: null,
        change: 'new',
        engine: 'chatgpt',
        surface: 'mentions',
        promptCohortId: 'cohort',
        promptCohortVersion: 1,
        canonicalUrl: 'https://b.example/b',
        host: 'b.example',
        citationId: 'c2',
        createdAt: new Date(),
      } as (typeof input.changes)[number],
      {
        id: 'ch1',
        pulseRunId: input.run.id,
        priorPulseRunId: null,
        change: 'new',
        engine: 'chatgpt',
        surface: 'mentions',
        promptCohortId: 'cohort',
        promptCohortVersion: 1,
        canonicalUrl: 'https://a.example/a',
        host: 'a.example',
        citationId: 'c1',
        createdAt: new Date(),
      } as (typeof input.changes)[number],
      {
        id: 'ch3',
        pulseRunId: input.run.id,
        priorPulseRunId: null,
        change: 'lost',
        engine: 'chatgpt',
        surface: 'mentions',
        promptCohortId: 'cohort',
        promptCohortVersion: 1,
        canonicalUrl: 'https://gone.example/x',
        host: 'gone.example',
        citationId: null,
        createdAt: new Date(),
      } as (typeof input.changes)[number],
      {
        id: 'ch4',
        pulseRunId: input.run.id,
        priorPulseRunId: null,
        change: 'unknown_partial',
        engine: 'chatgpt',
        surface: 'mentions',
        promptCohortId: 'cohort',
        promptCohortVersion: 1,
        canonicalUrl: 'https://unknown.example/x',
        host: 'unknown.example',
        citationId: null,
        createdAt: new Date(),
      } as (typeof input.changes)[number],
    ];
    const out = buildPayload(input);
    expect(out.citations_new.map((c) => c.host)).toEqual(['a.example', 'b.example']);
    expect(out.citations_new[0]!.titleSafe).toBe('Doc A');
    // Citation with no title stays null — never a raw AI answer.
    expect(out.citations_new[1]!.titleSafe).toBeNull();
    expect(out.citations_lost.map((c) => c.host)).toEqual(['gone.example']);
    expect(out.citations_unknown_partial.map((c) => c.host)).toEqual(['unknown.example']);
  });

  it('sorts confirmed rank drops confirmedAt DESC', () => {
    const input = baseInput();
    input.confirmedRankDrops = [
      { keyword: 'foo', priorRank: 3, currentRank: 8, confirmedAt: '2026-01-01T00:00:00Z' },
      { keyword: 'bar', priorRank: 5, currentRank: 12, confirmedAt: '2026-01-04T00:00:00Z' },
      { keyword: 'baz', priorRank: null, currentRank: null, confirmedAt: '2026-01-03T00:00:00Z' },
    ];
    const out = buildPayload(input);
    expect(out.confirmed_rank_drops.map((r) => r.keyword)).toEqual(['bar', 'baz', 'foo']);
  });

  it('keeps rank drops with an identical confirmedAt in a stable order', () => {
    // The comparator must return 0 (not a sign) for equal timestamps so the
    // caller's ordering survives — an unstable tie-break would make two
    // renders of the same run disagree, breaking projection idempotency.
    const input = baseInput();
    input.confirmedRankDrops = [
      { keyword: 'alpha', priorRank: 1, currentRank: 9, confirmedAt: '2026-01-02T00:00:00Z' },
      { keyword: 'bravo', priorRank: 2, currentRank: 9, confirmedAt: '2026-01-02T00:00:00Z' },
      { keyword: 'charlie', priorRank: 3, currentRank: 9, confirmedAt: '2026-01-05T00:00:00Z' },
    ];
    const first = buildPayload(input).confirmed_rank_drops.map((r) => r.keyword);
    const second = buildPayload(input).confirmed_rank_drops.map((r) => r.keyword);
    expect(first).toEqual(['charlie', 'alpha', 'bravo']);
    expect(second).toEqual(first);
  });

  it('sorts completed and regressed actions by actionId independently', () => {
    // Both lists are sorted so the digest is byte-identical across renders
    // regardless of the order the caller happened to return.
    const input = baseInput();
    input.actionTransitions = [
      semanticAction('act-c9', 'completed', 'https://example.test/sitemap'),
      semanticAction('act-r9', 'regressed', 'https://example.test/canonical'),
      semanticAction('act-c1', 'completed', 'https://example.test/robots'),
      semanticAction('act-r1', 'regressed', 'https://example.test/title'),
    ];
    const out = buildPayload(input);
    expect(out.actions_completed.map((a) => a.actionId)).toEqual(['act-c1', 'act-c9']);
    expect(out.actions_regressed.map((a) => a.actionId)).toEqual(['act-r1', 'act-r9']);
  });

  it('orders citation entries by engine, then surface, then host', () => {
    const change = (
      id: string,
      engine: string,
      surface: 'mentions' | 'citations',
      host: string,
    ) =>
      ({
        id,
        pulseRunId: baseInput().run.id,
        priorPulseRunId: null,
        change: 'new',
        engine,
        surface,
        promptCohortId: 'cohort',
        promptCohortVersion: 1,
        canonicalUrl: `https://${host}/p`,
        host,
        citationId: null,
        createdAt: new Date(),
      }) as unknown as BuildDigestPayloadInput['changes'][number];

    const input = baseInput();
    input.changes = [
      change('4', 'perplexity', 'mentions', 'b.example'),
      change('3', 'chatgpt', 'mentions', 'z.example'),
      change('2', 'chatgpt', 'mentions', 'a.example'),
      change('1', 'chatgpt', 'citations', 'z.example'),
    ];
    const out = buildPayload(input);
    expect(
      out.citations_new.map((c) => `${c.engine}/${c.surface}/${c.host}`),
    ).toEqual([
      // engine wins first…
      'chatgpt/citations/z.example',
      // …then surface within an engine…
      'chatgpt/mentions/a.example',
      // …then host within a cell.
      'chatgpt/mentions/z.example',
      'perplexity/mentions/b.example',
    ]);
  });

  it('splits action transitions into completed/regressed and caps top-3', () => {
    const input = baseInput();
    input.actionTransitions = [
      semanticAction('act-c1', 'completed', 'https://example.test/sitemap.xml'),
      semanticAction('act-r1', 'regressed', 'https://example.test/canonical'),
      // 'open' in the transitions list is a bug fence: never surfaces in
      // the transitions sections but still tolerated silently.
      semanticAction('act-open', 'open'),
    ];
    input.topOpenActions = [
      semanticAction('top1', 'open', 'https://example.test/meta'),
      semanticAction('top2', 'open', 'https://example.test/title'),
      semanticAction('top3', 'open', 'https://example.test/h1'),
      semanticAction('top4', 'open', 'https://example.test/og'),
    ];
    const out = buildPayload(input);
    expect(out.actions_completed.map((a) => a.actionId)).toEqual(['act-c1']);
    expect(out.actions_regressed.map((a) => a.actionId)).toEqual(['act-r1']);
    expect(out.next_actions_top3).toHaveLength(3);
    expect(out.next_actions_top3.map((a) => a.actionId)).toEqual(['top1', 'top2', 'top3']);
  });

  it('surfaces honest empty state when there are no open actions', () => {
    const out = buildPayload(baseInput());
    expect(out.next_actions_top3).toEqual([]);
    expect(out.actions_completed).toEqual([]);
    expect(out.actions_regressed).toEqual([]);
    expect(out.citations_new).toEqual([]);
    expect(out.citations_lost).toEqual([]);
    expect(out.citations_unknown_partial).toEqual([]);
    expect(out.confirmed_rank_drops).toEqual([]);
  });

  it('preserves GSC generative appearance verbatim in a separate section', () => {
    const input = baseInput();
    input.gscAppearance = {
      status: 'available',
      window: { start: '2025-12-08', end: '2026-01-04' },
      rows: [
        {
          rawAppearance: 'AI_OVERVIEW',
          classificationSlug: 'ai_overviews',
          isGenerative: true,
          clicks: 5,
          impressions: 120,
          ctr: 0.041,
          position: 4.2,
        },
      ],
    };
    const out = buildPayload(input);
    expect(out.gsc_appearance.status).toBe('available');
    expect(out.gsc_appearance.rows[0]?.classificationSlug).toBe('ai_overviews');
    expect(out.gsc_appearance.rows[0]?.clicks).toBe(5);
  });

  it('defaults GSC section to unavailable when appearance is null', () => {
    const out = buildPayload(baseInput());
    expect(out.gsc_appearance).toEqual({ status: 'unavailable', window: null, rows: [] });
  });

  it('derives every deep link from CLIENT_URL (no hardcoded origin)', () => {
    const links = buildDeepLinks('run-1', 'site-1');
    expect(links.digest).toMatch(/\?tab=ai-visibility&pulse=run-1$/);
    for (const url of Object.values(links)) {
      // Every URL is either absolute or path — reject accidental fragment/js:.
      expect(url).not.toMatch(/^javascript:/i);
      expect(url).not.toMatch(/^data:/i);
    }
  });

  it('skips malformed engine_surface_set entries safely', () => {
    const input = baseInput();
    input.run.engineSurfaceSet = [
      { engine: 'chatgpt', surface: 'mentions', supported: true, reason: null },
      null,
      'nonsense',
      { engine: 42, surface: 'mentions', supported: true }, // bad type
      { engine: 'perplexity', supported: true }, // missing surface
    ] as unknown as typeof input.run.engineSurfaceSet;
    const out = buildPayload(input);
    // Only the well-formed row survives.
    expect(out.coverage.total).toBe(1);
    expect(out.coverage.supported).toBe(1);
  });

  it('marks coverage.partial=true when run.status is partial', () => {
    const input = baseInput();
    input.run.status = 'partial';
    input.run.engineSurfaceSet = [
      { engine: 'chatgpt', surface: 'mentions', supported: true, reason: null },
    ];
    const out = buildPayload(input);
    expect(out.coverage.partial).toBe(true);
  });

  it('rejects non-array engine_surface_set input', () => {
    const input = baseInput();
    input.run.engineSurfaceSet = 'not an array' as unknown as typeof input.run.engineSurfaceSet;
    const out = buildPayload(input);
    expect(out.coverage.total).toBe(0);
    expect(out.coverage.supported).toBe(0);
  });

  it('falls back to citationCellKey when change.citationId is null but current citation exists', () => {
    const input = baseInput();
    input.citations = [
      {
        id: 'c-linked',
        pulseRunId: input.run.id,
        engine: 'chatgpt',
        surface: 'mentions',
        promptCohortId: 'cohort',
        promptCohortVersion: 1,
        canonicalUrl: 'https://linked.example/x',
        titleSafe: 'Linked title',
        host: 'linked.example',
        mentionCount: 1,
        firstSeenAt: null,
        createdAt: new Date(),
      } as (typeof input.citations)[number],
    ];
    input.changes = [
      {
        id: 'ch',
        pulseRunId: input.run.id,
        priorPulseRunId: null,
        change: 'unknown_partial',
        engine: 'chatgpt',
        surface: 'mentions',
        promptCohortId: 'cohort',
        promptCohortVersion: 1,
        canonicalUrl: 'https://linked.example/x',
        host: 'linked.example',
        citationId: null,
        createdAt: new Date(),
      } as (typeof input.changes)[number],
    ];
    const out = buildPayload(input);
    expect(out.citations_unknown_partial[0]!.titleSafe).toBe('Linked title');
  });

  it('breaks ties on canonicalUrl when engine/surface/host match', () => {
    const input = baseInput();
    input.changes = [
      {
        id: 'z',
        pulseRunId: input.run.id,
        priorPulseRunId: null,
        change: 'new',
        engine: 'chatgpt',
        surface: 'mentions',
        promptCohortId: 'cohort',
        promptCohortVersion: 1,
        canonicalUrl: 'https://same.example/zzz',
        host: 'same.example',
        citationId: null,
        createdAt: new Date(),
      } as (typeof input.changes)[number],
      {
        id: 'a',
        pulseRunId: input.run.id,
        priorPulseRunId: null,
        change: 'new',
        engine: 'chatgpt',
        surface: 'mentions',
        promptCohortId: 'cohort',
        promptCohortVersion: 1,
        canonicalUrl: 'https://same.example/aaa',
        host: 'same.example',
        citationId: null,
        createdAt: new Date(),
      } as (typeof input.changes)[number],
    ];
    const out = buildPayload(input);
    expect(out.citations_new.map((c) => c.canonicalUrl)).toEqual([
      'https://same.example/aaa',
      'https://same.example/zzz',
    ]);
  });

  it('citationId that does not resolve leaves titleSafe null', () => {
    const input = baseInput();
    input.changes = [
      {
        id: 'ch',
        pulseRunId: input.run.id,
        priorPulseRunId: null,
        change: 'new',
        engine: 'chatgpt',
        surface: 'mentions',
        promptCohortId: 'cohort',
        promptCohortVersion: 1,
        canonicalUrl: 'https://x.example/x',
        host: 'x.example',
        citationId: 'ghost',
        createdAt: new Date(),
      } as (typeof input.changes)[number],
    ];
    const out = buildPayload(input);
    expect(out.citations_new[0]!.titleSafe).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// DB-backed idempotency + missing-run
// ---------------------------------------------------------------------------

describe('renderDigestProjection — DB-backed UPSERT idempotency', () => {
  beforeAll(async () => {
    await startTestPostgres();
  });

  afterAll(async () => {
    await stopTestPostgres();
  });

  beforeEach(async () => {
    await truncateAllTables();
  });

  const now = () => new Date('2026-01-05T09:00:00.000Z');

  function deps(): DigestRendererDeps {
    return {
      db: getTestDb() as unknown as DigestRendererDeps['db'],
      loadConfirmedRankDrops: async () => [],
      loadActionTransitions: async () => [],
      loadTopOpenActions: async () => [],
      loadGscAppearance: async () => null,
      loadSiteLabel: async () => 'Example Inc',
      loadBrandRadarScans: async () => ({ inWindow: [], baselines: [] }),
      now,
    };
  }

  async function seedRun(accountId = 'acct-1', siteId = 'site-1', isoWeek = '2026-W01') {
    const inserted = await getTestDb()
      .insert(weeklyPulseRuns)
      .values({
        accountId,
        siteId,
        isoWeek,
        status: 'completed',
        marketSnapshot: { country: 'US' },
        promptCohortId: 'cohort',
        promptCohortVersion: 1,
        engineSurfaceSet: [
          { engine: 'chatgpt', surface: 'mentions', supported: true, reason: null },
        ],
        observationMeta: { window: { end: '2026-01-05T00:00:00Z' } },
        usageReference: {},
        counts: {},
      })
      .returning({ id: weeklyPulseRuns.id });
    return inserted[0]!.id;
  }

  it('throws MissingPulseRunError on unknown run', async () => {
    await expect(
      renderDigestProjection('11111111-1111-1111-1111-111111111111', deps()),
    ).rejects.toBeInstanceOf(MissingPulseRunError);
  });

  it('UPSERTs a projection and stays idempotent across replays', async () => {
    const runId = await seedRun();
    await renderDigestProjection(runId, deps());
    const first = await readDigestProjection(
      getTestDb() as unknown as DigestRendererDeps['db'],
      runId,
    );
    expect(first).not.toBeNull();
    expect(first!.header.isoWeek).toBe('2026-W01');

    // Re-render — must UPSERT the same row.
    await renderDigestProjection(runId, deps());
    const second = await readDigestProjection(
      getTestDb() as unknown as DigestRendererDeps['db'],
      runId,
    );
    expect(second).toEqual(first);
  });

  it('stamps renderedAt from the wall clock when no clock is injected', async () => {
    // Production wires no `now`, so the default clock is the shipped path —
    // the frozen projection must still carry a real render timestamp.
    const runId = await seedRun();
    const { now: _injected, ...withoutClock } = deps();
    const before = Date.now();
    const rendered = await renderDigestProjection(
      runId,
      withoutClock as DigestRendererDeps,
    );
    const after = Date.now();
    const stamped = Date.parse(rendered.payload.header.renderedAt);
    expect(stamped).toBeGreaterThanOrEqual(before);
    expect(stamped).toBeLessThanOrEqual(after);

    const persisted = await readDigestProjection(
      getTestDb() as unknown as DigestRendererDeps['db'],
      runId,
    );
    expect(persisted!.header.renderedAt).toBe(rendered.payload.header.renderedAt);
  });

  it('readDigestProjection returns null when no projection exists', async () => {
    const projection = await readDigestProjection(
      getTestDb() as unknown as DigestRendererDeps['db'],
      '11111111-1111-1111-1111-111111111111',
    );
    expect(projection).toBeNull();
  });

  it('renders citations + changes from persisted rows deterministically', async () => {
    const runId = await seedRun();
    // Persist a citation and a matching `new` change.
    const inserted = await getTestDb()
      .insert(weeklyPulseCitations)
      .values({
        pulseRunId: runId,
        engine: 'chatgpt',
        surface: 'mentions',
        promptCohortId: 'cohort',
        promptCohortVersion: 1,
        canonicalUrl: 'https://z.example/z',
        titleSafe: 'Z',
        host: 'z.example',
        mentionCount: 1,
        firstSeenAt: null,
      })
      .returning({ id: weeklyPulseCitations.id });
    const citationId = inserted[0]!.id;
    await getTestDb().insert(weeklyPulseCitationChanges).values({
      pulseRunId: runId,
      priorPulseRunId: null,
      change: 'new',
      engine: 'chatgpt',
      surface: 'mentions',
      promptCohortId: 'cohort',
      promptCohortVersion: 1,
      canonicalUrl: 'https://z.example/z',
      host: 'z.example',
      citationId,
    });
    await renderDigestProjection(runId, deps());
    const projection = await readDigestProjection(
      getTestDb() as unknown as DigestRendererDeps['db'],
      runId,
    );
    expect(projection!.citations_new).toHaveLength(1);
    expect(projection!.citations_new[0]!.host).toBe('z.example');
  });

  it('propagates confirmed rank drops / actions / GSC through the ports', async () => {
    const runId = await seedRun();
    const customDeps: DigestRendererDeps = {
      db: getTestDb() as unknown as DigestRendererDeps['db'],
      loadConfirmedRankDrops: async () => [
        {
          keyword: 'foo',
          priorRank: 4,
          currentRank: 12,
          confirmedAt: '2026-01-03T00:00:00Z',
        },
      ],
      loadActionTransitions: async () => [
        semanticAction('act-c', 'completed', 'https://example.test/sitemap'),
      ],
      loadTopOpenActions: async () => [
        semanticAction('t1', 'open', 'https://example.test/meta'),
      ],
      loadGscAppearance: async () => ({
        status: 'available',
        window: { start: '2025-12-01', end: '2026-01-05' },
        rows: [
          {
            rawAppearance: 'AI_OVERVIEW',
            classificationSlug: 'ai_overviews',
            isGenerative: true,
            clicks: 3,
            impressions: 100,
            ctr: 0.03,
            position: 5,
          },
        ],
      }),
      loadSiteLabel: async () => 'Example Inc',
      loadBrandRadarScans: async () => ({ inWindow: [], baselines: [] }),
      now,
    };
    await renderDigestProjection(runId, customDeps);
    const projection = await readDigestProjection(
      getTestDb() as unknown as DigestRendererDeps['db'],
      runId,
    );
    expect(projection!.confirmed_rank_drops[0]!.keyword).toBe('foo');
    expect(projection!.actions_completed[0]!.actionId).toBe('act-c');
    expect(projection!.next_actions_top3[0]!.actionId).toBe('t1');
    expect(projection!.gsc_appearance.status).toBe('available');
  });
});

describe('digest projection — Brand Radar deltas', () => {
  it('projects only bounded safe fields for a hostile brand query', () => {
    const hostile = '<script>alert(1)</script> acme';
    const out = buildPayload({
      ...baseInput(),
      brandDeltas: [
        {
          queryHash: 'a'.repeat(64),
          brandQuerySafe: hostile,
          currentScanId: 'scan-2',
          previousScanId: 'scan-1',
          hasNewScan: true,
          newMentionCount: 3,
          sentimentShift: { positive: 2, neutral: -1, negative: -1, unknown: 0 },
        },
      ],
    });
    expect(Object.keys(out.brand_deltas![0]!).sort()).toEqual([
      'brandQuerySafe',
      'currentScanId',
      'hasNewScan',
      'newMentionCount',
      'previousScanId',
      'queryHash',
      'sentimentShift',
    ]);
    // The query travels as inert data — no snippet, URL, or digest sentence.
    expect(out.brand_deltas![0]!.brandQuerySafe).toBe(hostile);
    expect(JSON.stringify(out.brand_deltas)).not.toMatch(/snippet|citedUrl|digestSentence/);
  });

  it('emits an empty brand section when nothing has been scanned', () => {
    expect(buildPayload(baseInput()).brand_deltas).toEqual([]);
  });
});

describe('renderDigestProjection — brand-delta window', () => {
  beforeAll(async () => {
    await startTestPostgres();
  });
  afterAll(async () => {
    await stopTestPostgres();
  });
  beforeEach(async () => {
    await truncateAllTables();
  });

  const renderNow = () => new Date('2026-01-05T09:00:00.000Z');

  async function seedRunRow(startedAt: Date | null) {
    const inserted = await getTestDb()
      .insert(weeklyPulseRuns)
      .values({
        accountId: 'acct-brand',
        siteId: 'site-1',
        isoWeek: '2026-W02',
        status: 'completed',
        marketSnapshot: { country: 'US' },
        promptCohortId: 'cohort',
        promptCohortVersion: 1,
        engineSurfaceSet: [],
        observationMeta: {},
        usageReference: {},
        counts: {},
        startedAt,
      })
      .returning({ id: weeklyPulseRuns.id });
    return inserted[0]!.id;
  }

  function brandDeps(
    loadBrandRadarScans: DigestRendererDeps['loadBrandRadarScans'],
  ): DigestRendererDeps {
    return {
      db: getTestDb() as unknown as DigestRendererDeps['db'],
      loadConfirmedRankDrops: async () => [],
      loadActionTransitions: async () => [],
      loadTopOpenActions: async () => [],
      loadGscAppearance: async () => null,
      loadSiteLabel: async () => 'Example Inc',
      loadBrandRadarScans,
      now: renderNow,
    };
  }

  it('reads the seven days before the run start and freezes the deltas', async () => {
    const runId = await seedRunRow(new Date('2026-01-04T00:00:00.000Z'));
    const load = vi.fn(async () => ({
      inWindow: [
        {
          scanId: 'scan-2',
          queryHash: 'a'.repeat(64),
          brandQuery: 'acme crm',
          mentionCount: 12,
          sentimentDistribution: { positive: 50, neutral: 30, negative: 15, unknown: 5 },
          terminalAt: new Date('2026-01-03T00:00:00.000Z'),
        },
      ],
      baselines: [
        {
          scanId: 'scan-1',
          queryHash: 'a'.repeat(64),
          brandQuery: 'acme crm',
          mentionCount: 10,
          sentimentDistribution: { positive: 45, neutral: 35, negative: 15, unknown: 5 },
          terminalAt: new Date('2025-12-20T00:00:00.000Z'),
        },
      ],
    }));
    const rendered = await renderDigestProjection(runId, brandDeps(load));
    expect(load).toHaveBeenCalledWith({
      accountId: 'acct-brand',
      siteId: 'site-1',
      windowStart: new Date('2025-12-28T00:00:00.000Z'),
      windowEnd: new Date('2026-01-04T00:00:00.000Z'),
    });
    expect(rendered.payload.brand_deltas).toEqual([
      {
        queryHash: 'a'.repeat(64),
        brandQuerySafe: 'acme crm',
        currentScanId: 'scan-2',
        previousScanId: 'scan-1',
        hasNewScan: true,
        newMentionCount: 2,
        sentimentShift: { positive: 5, neutral: -5, negative: 0, unknown: 0 },
      },
    ]);
  });

  it('falls back to the render clock when the run never recorded a start', async () => {
    const runId = await seedRunRow(null);
    const load = vi.fn(async () => ({ inWindow: [], baselines: [] }));
    await renderDigestProjection(runId, brandDeps(load));
    expect(load).toHaveBeenCalledWith({
      accountId: 'acct-brand',
      siteId: 'site-1',
      windowStart: new Date('2025-12-29T09:00:00.000Z'),
      windowEnd: new Date('2026-01-05T09:00:00.000Z'),
    });
  });
});
