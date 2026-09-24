/**
 * Review Intelligence `review_themes` pass tests.
 *
 * Covers the profile cost ceiling short-circuit, citation-or-drop at BOTH
 * boundaries (write and read), the 300-character excerpt clamp, every terminal
 * state, and the guarantee that an AI failure leaves reviews queryable.
 */
import mongoose from 'mongoose';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAiProfileRunner, type AiProfileRunner } from '../../shared/ai-profiles/index.js';
import {
  AiBudgetRefusalError,
  type AiGenerationProvider,
  type GenerateStructuredInput,
} from '../../shared/providers/ai-generation.js';
import { createFakeAiGenerationProvider } from '../../shared/providers/ai-generation-fake.js';
import {
  clearCollections,
  startMemoryMongo,
  stopMemoryMongo,
} from '../../shared/testing/mongo.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { SUPPORTED_LOCALES, type SupportedLocale } from '../../shared/i18n/locales.js';
import { Site } from '../sites/index.js';
import {
  LocalSeoReviewRow,
  LocalSeoReviewSyncRun,
  REVIEW_THEME_EXCERPT_MAX_CHARS,
} from './review-sync.model.js';
import {
  buildCitationExcerpt,
  enforceThemeCitations,
  getReviewThemes,
  runReviewThemesPass,
} from './review-themes.service.js';

const ACCOUNT_ID = new mongoose.Types.ObjectId().toString();
const OTHER_ACCOUNT_ID = new mongoose.Types.ObjectId().toString();
const FAKE_ORDER = ['fake'] as const;

interface CannedTheme {
  label: string;
  summary: string;
  citedReviewIds: string[];
}

/** Deterministic runner stub — the shape the real runner returns. */
function runnerReturning(
  object: { complaintThemes: CannedTheme[]; praiseThemes: CannedTheme[] },
  costMicros = 4_200n,
): AiProfileRunner {
  return {
    preflight: () => undefined,
    run: vi.fn(async () => ({
      trust: 'untrusted' as const,
      status: 'complete' as const,
      object: { ...object, citations: [] },
      warnings: [],
      qualityFlags: ['complete' as const],
      provenance: {
        task: 'review_themes' as const,
        profileVersion: '1.0.0',
        outputSchemaVersion: '1',
        promptTemplateId: 'review-themes',
        promptTemplateVersion: '1',
        provider: 'fake' as const,
        model: 'stub',
        finishReason: 'stop',
        attempts: 1,
        fallbackUsed: false,
        latencyMs: 1,
        actualOrEstimatedCostMicros: costMicros,
      },
      classification: { generatedFields: 'untrusted' as const, renderAs: 'text_only' as const },
    })) as AiProfileRunner['run'],
  };
}

function throwingRunner(error: Error): AiProfileRunner {
  return {
    preflight: () => undefined,
    run: vi.fn(async () => {
      throw error;
    }) as unknown as AiProfileRunner['run'],
  };
}

async function seedProfile(accountId = ACCOUNT_ID): Promise<string> {
  const site = await Site.create({
    accountId: new mongoose.Types.ObjectId(accountId),
    url: 'https://example.com',
    domain: 'example.com',
  });
  return String(site._id);
}

async function seedRun(
  profileId: string,
  overrides: Partial<{
    status: string;
    retainedCount: number;
    accountId: string;
    outputLocale: SupportedLocale;
  }> = {},
): Promise<string> {
  const run = await LocalSeoReviewSyncRun.create({
    accountId: overrides.accountId ?? ACCOUNT_ID,
    profileId,
    outputLocale: overrides.outputLocale ?? 'en',
    sources: ['google'],
    depth: 100,
    status: overrides.status ?? 'succeeded',
    retainedCount: overrides.retainedCount ?? 2,
    completedAt: new Date('2026-03-01T00:00:00.000Z'),
  });
  return String(run._id);
}

async function seedRows(
  profileId: string,
  runId: string,
  rows: Array<{
    id: string;
    text?: string;
    rating?: number | null;
    title?: string | null;
    dated?: boolean;
    source?: 'google' | 'trustpilot' | 'tripadvisor';
  }>,
): Promise<void> {
  for (const [index, row] of rows.entries()) {
    await LocalSeoReviewRow.create({
      accountId: ACCOUNT_ID,
      profileId,
      source: row.source ?? 'google',
      sourceReviewId: row.id,
      rating: row.rating === undefined ? 4 : row.rating,
      title: row.title ?? null,
      text: row.text ?? `Review body ${row.id}`,
      authorDisplayName: null,
      language: 'en',
      reviewedAt: row.dated === false ? null : new Date(Date.UTC(2026, 0, index + 1)),
      firstSeenRunId: new mongoose.Types.ObjectId(runId),
      fetchedAt: new Date('2026-03-01T00:00:00.000Z'),
    });
  }
}

beforeAll(async () => {
  await startMemoryMongo();
});

afterAll(async () => {
  await stopMemoryMongo();
});

beforeEach(async () => {
  await clearCollections();
});

describe('enforceThemeCitations', () => {
  const known = new Map([
    ['rev-001', 'g-1'],
    ['rev-002', 'g-2'],
  ]);

  it('drops a theme with zero citations', () => {
    expect(
      enforceThemeCitations([{ label: 'L', summary: 'S', citedReviewIds: [] }], known, 'complaint'),
    ).toEqual([]);
  });

  it('drops a theme with a single citation', () => {
    expect(
      enforceThemeCitations(
        [{ label: 'L', summary: 'S', citedReviewIds: ['rev-001'] }],
        known,
        'complaint',
      ),
    ).toEqual([]);
  });

  it('drops a theme whose repeated citation collapses below the two-row bar', () => {
    expect(
      enforceThemeCitations(
        [{ label: 'L', summary: 'S', citedReviewIds: ['rev-001', 'rev-001', 'unknown'] }],
        known,
        'praise',
      ),
    ).toEqual([]);
  });

  it('keeps a theme with two resolvable citations and clamps its bounded fields', () => {
    const kept = enforceThemeCitations(
      [
        {
          label: 'L'.repeat(200),
          summary: 'S'.repeat(900),
          citedReviewIds: ['rev-001', 'rev-002'],
        },
      ],
      known,
      'praise',
    );
    expect(kept).toHaveLength(1);
    expect(kept[0]!.kind).toBe('praise');
    expect(kept[0]!.label).toHaveLength(120);
    expect(kept[0]!.summary).toHaveLength(500);
    expect(kept[0]!.citedReviewIds).toEqual(['g-1', 'g-2']);
  });

  it('bounds themes to ten per kind even when a stub bypasses the profile schema', () => {
    const generated = Array.from({ length: 14 }, (_unused, index) => ({
      label: `Theme ${index}`,
      summary: 'Bounded.',
      citedReviewIds: ['rev-001', 'rev-002'],
    }));
    expect(enforceThemeCitations(generated, known, 'complaint')).toHaveLength(10);
  });
});

describe('buildCitationExcerpt', () => {
  it('clamps an over-long body to the 300-character read bound', () => {
    const excerpt = buildCitationExcerpt('x'.repeat(800));
    expect(excerpt).toHaveLength(REVIEW_THEME_EXCERPT_MAX_CHARS);
  });

  it('collapses whitespace and neutralizes a spreadsheet formula prefix', () => {
    expect(buildCitationExcerpt('  =SUM(A1)\n\n  bad  ')).toBe("'=SUM(A1) bad");
  });

  it('counts the neutralizing quote inside the 300-character hard bound', () => {
    const excerpt = buildCitationExcerpt(`=${'x'.repeat(500)}`);
    expect(excerpt.startsWith("'=")).toBe(true);
    expect(excerpt).toHaveLength(REVIEW_THEME_EXCERPT_MAX_CHARS);
  });
});

describe('runReviewThemesPass — terminal states', () => {
  it('hands all seven frozen locales to the profile without changing review evidence', async () => {
    const profileId = await seedProfile();
    const seen: Array<{ locale: string; input: string }> = [];
    for (const outputLocale of SUPPORTED_LOCALES) {
      const runId = await seedRun(profileId, { outputLocale });
      await seedRows(profileId, runId, [
        { id: `review-${outputLocale}`, text: `SOURCE_REVIEW_${outputLocale}` },
      ]);
      const ai = runnerReturning({ complaintThemes: [], praiseThemes: [] });
      await runReviewThemesPass(
        { accountId: ACCOUNT_ID, runId },
        { ai, aiProviderOrder: FAKE_ORDER },
      );
      const profileInput = vi.mocked(ai.run).mock.calls[0]?.[0];
      seen.push({
        locale: typeof profileInput?.locale === 'string' ? profileInput.locale : '',
        input: JSON.stringify(profileInput?.input) ?? '',
      });
    }

    expect(seen.map((entry) => entry.locale)).toEqual(SUPPORTED_LOCALES);
    for (const outputLocale of SUPPORTED_LOCALES) {
      expect(seen.find((entry) => entry.locale === outputLocale)?.input).toContain(
        `SOURCE_REVIEW_${outputLocale}`,
      );
    }
  });

  it('writes themes-ok with the captured cost when a well-cited theme survives', async () => {
    const profileId = await seedProfile();
    const runId = await seedRun(profileId);
    await seedRows(profileId, runId, [{ id: 'g-1' }, { id: 'g-2' }]);

    const startedAt = new Date('2026-03-01T00:00:01.000Z');
    const completedAt = new Date('2026-03-01T00:00:02.000Z');
    const times = [startedAt, completedAt];
    const ai = runnerReturning({
      complaintThemes: [{ label: 'Slow service', summary: 'Waits are long.', citedReviewIds: ['rev-001', 'rev-002'] }],
      praiseThemes: [],
    });
    const result = await runReviewThemesPass(
      { accountId: ACCOUNT_ID, runId },
      {
        ai,
        aiProviderOrder: FAKE_ORDER,
        now: () => times.shift()!,
      },
    );

    expect(result).toEqual({ terminal: 'themes-ok', themeCount: 1, costMicros: 4_200 });
    const run = await LocalSeoReviewSyncRun.findById(runId);
    expect(run?.aiTerminalState).toBe('themes-ok');
    expect(run?.aiCostMicros).toBe(4_200);
    expect(run?.aiThemes).toHaveLength(1);
    expect(run?.aiThemes[0]?.citedReviewIds).toHaveLength(2);
    expect(run?.aiThemes[0]?.citedReviewIds.every((id) => /^[0-9a-f]{24}$/i.test(id))).toBe(true);
    expect(run?.aiPassStartedAt?.toISOString()).toBe(startedAt.toISOString());
    expect(run?.aiCompletedAt?.toISOString()).toBe(completedAt.toISOString());
    expect(run?.aiInputCount).toBe(2);
    expect(ai.run).toHaveBeenCalledWith(
      expect.objectContaining({ correlationId: `review-themes-${runId}` }),
    );
  });

  it('writes no-reliable-themes when every returned theme fails the citation bar', async () => {
    const profileId = await seedProfile();
    const runId = await seedRun(profileId);
    await seedRows(profileId, runId, [{ id: 'g-1' }, { id: 'g-2' }]);

    const result = await runReviewThemesPass(
      { accountId: ACCOUNT_ID, runId },
      {
        ai: runnerReturning({
          complaintThemes: [
            { label: 'A', summary: 'A.', citedReviewIds: [] },
            { label: 'B', summary: 'B.', citedReviewIds: ['rev-001'] },
          ],
          praiseThemes: [{ label: 'C', summary: 'C.', citedReviewIds: ['hallucinated', 'also-fake'] }],
        }),
        aiProviderOrder: FAKE_ORDER,
      },
    );

    expect(result.terminal).toBe('no-reliable-themes');
    expect(result.themeCount).toBe(0);
    const run = await LocalSeoReviewSyncRun.findById(runId);
    // Nothing invented to fill the gap.
    expect(run?.aiThemes).toEqual([]);
    expect(run?.aiCostMicros).toBe(4_200);
  });

  it('writes ai-failed-reviews-intact and leaves reviews queryable', async () => {
    const profileId = await seedProfile();
    const runId = await seedRun(profileId);
    await seedRows(profileId, runId, [{ id: 'g-1' }, { id: 'g-2' }]);

    const result = await runReviewThemesPass(
      { accountId: ACCOUNT_ID, runId },
      { ai: throwingRunner(new Error('provider exploded')), aiProviderOrder: FAKE_ORDER },
    );

    expect(result).toEqual({ terminal: 'ai-failed-reviews-intact', themeCount: 0, costMicros: null });
    const run = await LocalSeoReviewSyncRun.findById(runId);
    expect(run?.aiTerminalState).toBe('ai-failed-reviews-intact');
    expect(run?.aiCostMicros).toBeNull();
    expect(run?.aiPassStartedAt).toBeInstanceOf(Date);
    expect(run?.aiCompletedAt).toBeInstanceOf(Date);
    expect(run?.aiInputCount).toBe(2);
    expect(await LocalSeoReviewRow.countDocuments({ profileId })).toBe(2);
  });

  it('short-circuits a synthetic cost overrun through the real runner and stays reviews-intact', async () => {
    const profileId = await seedProfile();
    const runId = await seedRun(profileId);
    await seedRows(profileId, runId, [{ id: 'g-1' }, { id: 'g-2' }]);

    const seen: Array<GenerateStructuredInput<object>> = [];
    const provider: AiGenerationProvider = {
      async generateStructured(input) {
        seen.push(input as GenerateStructuredInput<object>);
        // The runtime refuses before completion once the profile ceiling
        // cannot cover the configured estimate.
        throw new AiBudgetRefusalError();
      },
    };

    const result = await runReviewThemesPass(
      { accountId: ACCOUNT_ID, runId },
      { ai: createAiProfileRunner({ provider }), aiProviderOrder: FAKE_ORDER },
    );

    expect(seen[0]?.maxCostMicros).toBe(15_000n);
    expect(result.terminal).toBe('ai-failed-reviews-intact');
    const run = await LocalSeoReviewSyncRun.findById(runId);
    expect(run?.aiTerminalState).toBe('ai-failed-reviews-intact');
  });

  it('terminates honestly when the run settled with no review material at all', async () => {
    const profileId = await seedProfile();
    const runId = await seedRun(profileId, { retainedCount: 0 });
    const ai = runnerReturning({ complaintThemes: [], praiseThemes: [] });

    const result = await runReviewThemesPass(
      { accountId: ACCOUNT_ID, runId },
      { ai, aiProviderOrder: FAKE_ORDER },
    );

    expect(result).toEqual({ terminal: 'no-reliable-themes', themeCount: 0, costMicros: null });
    expect(ai.run).not.toHaveBeenCalled();
    const run = await LocalSeoReviewSyncRun.findById(runId);
    expect(run?.aiPassStartedAt).toBeNull();
    expect(run?.aiCompletedAt).toBeInstanceOf(Date);
    expect(run?.aiInputCount).toBe(0);
  });

  it('mirrors the current state when an empty-input settle loses its pending claim', async () => {
    const profileId = await seedProfile();
    const runId = await seedRun(profileId, { retainedCount: 0 });
    const update = vi
      .spyOn(LocalSeoReviewSyncRun, 'findOneAndUpdate')
      .mockResolvedValueOnce(null);

    const result = await runReviewThemesPass(
      { accountId: ACCOUNT_ID, runId },
      {
        ai: runnerReturning({ complaintThemes: [], praiseThemes: [] }),
        aiProviderOrder: FAKE_ORDER,
      },
    );
    update.mockRestore();

    expect(result).toEqual({ terminal: 'pending', themeCount: 0, costMicros: null });
  });

  it('rejects a pending theme run without a valid frozen output locale', async () => {
    const profileId = await seedProfile();
    const runId = await seedRun(profileId);
    await LocalSeoReviewSyncRun.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(runId) },
      { $unset: { outputLocale: 1 } },
    );
    const ai = runnerReturning({ complaintThemes: [], praiseThemes: [] });

    await expect(
      runReviewThemesPass(
        { accountId: ACCOUNT_ID, runId },
        { ai, aiProviderOrder: FAKE_ORDER },
      ),
    ).rejects.toThrow('review themes run has no valid output locale');
    expect(ai.run).not.toHaveBeenCalled();
  });

  it('is a no-op for a run that already reached a terminal AI state', async () => {
    const profileId = await seedProfile();
    const runId = await seedRun(profileId);
    await LocalSeoReviewSyncRun.updateOne(
      { _id: runId },
      { $set: { aiTerminalState: 'themes-ok', aiCostMicros: 99 } },
    );
    const ai = runnerReturning({ complaintThemes: [], praiseThemes: [] });

    const result = await runReviewThemesPass(
      { accountId: ACCOUNT_ID, runId },
      { ai, aiProviderOrder: FAKE_ORDER },
    );

    expect(result).toEqual({ terminal: 'themes-ok', themeCount: 0, costMicros: 99 });
    expect(ai.run).not.toHaveBeenCalled();

    await LocalSeoReviewSyncRun.updateOne(
      { _id: runId },
      { $set: { aiCostMicros: null } },
    );
    await expect(
      runReviewThemesPass(
        { accountId: ACCOUNT_ID, runId },
        { ai, aiProviderOrder: FAKE_ORDER },
      ),
    ).resolves.toEqual({ terminal: 'themes-ok', themeCount: 0, costMicros: null });
  });

  it('returns the pending default when the run row is missing', async () => {
    const ai = runnerReturning({ complaintThemes: [], praiseThemes: [] });
    const result = await runReviewThemesPass(
      { accountId: ACCOUNT_ID, runId: new mongoose.Types.ObjectId().toString() },
      { ai, aiProviderOrder: FAKE_ORDER },
    );
    expect(result).toEqual({ terminal: 'pending', themeCount: 0, costMicros: null });
  });

  it('mirrors the current state when another worker wins the dispatch claim', async () => {
    const profileId = await seedProfile();
    const runId = await seedRun(profileId);
    await seedRows(profileId, runId, [{ id: 'g-1' }, { id: 'g-2' }]);
    const update = vi
      .spyOn(LocalSeoReviewSyncRun, 'findOneAndUpdate')
      .mockResolvedValueOnce(null);

    const result = await runReviewThemesPass(
      { accountId: ACCOUNT_ID, runId },
      {
        ai: runnerReturning({ complaintThemes: [], praiseThemes: [] }),
        aiProviderOrder: FAKE_ORDER,
      },
    );
    update.mockRestore();

    expect(result).toEqual({ terminal: 'pending', themeCount: 0, costMicros: null });
  });

  it('mirrors the winner when a concurrent settle takes the pending claim first', async () => {
    const profileId = await seedProfile();
    const runId = await seedRun(profileId);
    await seedRows(profileId, runId, [{ id: 'g-1' }, { id: 'g-2' }]);

    const racing: AiProfileRunner = {
      preflight: () => undefined,
      run: (async (...args: Parameters<AiProfileRunner['run']>) => {
        await LocalSeoReviewSyncRun.updateOne(
          { _id: runId },
          { $set: { aiTerminalState: 'no-reliable-themes', aiCostMicros: 7 } },
        );
        return runnerReturning({
          complaintThemes: [{ label: 'L', summary: 'S.', citedReviewIds: ['rev-001', 'rev-002'] }],
          praiseThemes: [],
        }).run(...args);
      }) as AiProfileRunner['run'],
    };

    const result = await runReviewThemesPass(
      { accountId: ACCOUNT_ID, runId },
      { ai: racing, aiProviderOrder: FAKE_ORDER },
    );

    expect(result).toEqual({ terminal: 'no-reliable-themes', themeCount: 0, costMicros: 7 });
    const run = await LocalSeoReviewSyncRun.findById(runId);
    expect(run?.aiThemes).toEqual([]);
  });

  it('mirrors a concurrent terminal when a failed AI pass loses its settle claim', async () => {
    const profileId = await seedProfile();
    const runId = await seedRun(profileId);
    await seedRows(profileId, runId, [{ id: 'g-1' }, { id: 'g-2' }]);
    const racing: AiProfileRunner = {
      preflight: () => undefined,
      run: vi.fn(async () => {
        await LocalSeoReviewSyncRun.updateOne(
          { _id: runId },
          { $set: { aiTerminalState: 'no-reliable-themes', aiCostMicros: 17 } },
        );
        throw new Error('losing worker');
      }) as unknown as AiProfileRunner['run'],
    };

    const result = await runReviewThemesPass(
      { accountId: ACCOUNT_ID, runId },
      { ai: racing, aiProviderOrder: FAKE_ORDER },
    );

    expect(result).toEqual({
      terminal: 'no-reliable-themes',
      themeCount: 0,
      costMicros: 17,
    });
  });

  it('falls back to the computed terminal when the losing run row also vanished', async () => {
    const profileId = await seedProfile();
    const runId = await seedRun(profileId);
    await seedRows(profileId, runId, [{ id: 'g-1' }, { id: 'g-2' }]);

    const racing: AiProfileRunner = {
      preflight: () => undefined,
      run: (async (...args: Parameters<AiProfileRunner['run']>) => {
        await LocalSeoReviewSyncRun.deleteOne({ _id: runId });
        return runnerReturning({
          complaintThemes: [{ label: 'L', summary: 'S.', citedReviewIds: ['rev-001', 'rev-002'] }],
          praiseThemes: [],
        }).run(...args);
      }) as AiProfileRunner['run'],
    };

    const result = await runReviewThemesPass(
      { accountId: ACCOUNT_ID, runId },
      { ai: racing, aiProviderOrder: FAKE_ORDER },
    );

    expect(result).toEqual({ terminal: 'themes-ok', themeCount: 0, costMicros: 4_200 });
  });

  it('atomically claims before dispatch so concurrent workers make exactly one AI call', async () => {
    const profileId = await seedProfile();
    const runId = await seedRun(profileId);
    await seedRows(profileId, runId, [{ id: 'g-1' }, { id: 'g-2' }]);

    let release!: () => void;
    let entered!: () => void;
    const enteredAi = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const holdAi = new Promise<void>((resolve) => {
      release = resolve;
    });
    const base = runnerReturning({
      complaintThemes: [{ label: 'L', summary: 'S.', citedReviewIds: ['rev-001', 'rev-002'] }],
      praiseThemes: [],
    });
    const ai: AiProfileRunner = {
      preflight: () => undefined,
      run: vi.fn(async (...args: Parameters<AiProfileRunner['run']>) => {
        entered();
        await holdAi;
        return base.run(...args);
      }) as AiProfileRunner['run'],
    };
    const deps = { ai, aiProviderOrder: FAKE_ORDER };

    const first = runReviewThemesPass({ accountId: ACCOUNT_ID, runId }, deps);
    await enteredAi;
    const replay = await runReviewThemesPass({ accountId: ACCOUNT_ID, runId }, deps);
    expect(replay).toEqual({ terminal: 'pending', themeCount: 0, costMicros: null });
    expect(ai.run).toHaveBeenCalledTimes(1);

    release();
    await expect(first).resolves.toMatchObject({ terminal: 'themes-ok', themeCount: 1 });
    expect(ai.run).toHaveBeenCalledTimes(1);
  });

  it('passes a legitimate half-star rating through the bounded structured profile input', async () => {
    const profileId = await seedProfile();
    const runId = await seedRun(profileId);
    await seedRows(profileId, runId, [
      { id: 'g-1', rating: 4.5 },
      { id: 'g-2', rating: 4 },
    ]);
    const ai = runnerReturning({
      complaintThemes: [],
      praiseThemes: [{ label: 'Consistent', summary: 'Consistent.', citedReviewIds: ['rev-001', 'rev-002'] }],
    });

    await runReviewThemesPass(
      { accountId: ACCOUNT_ID, runId },
      { ai, aiProviderOrder: FAKE_ORDER },
    );

    expect(ai.run).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          reviews: expect.arrayContaining([expect.objectContaining({ rating: 4.5 })]),
        }),
      }),
    );
  });

  it('drives the keyless fake provider end to end through the real runner', async () => {
    const profileId = await seedProfile();
    const runId = await seedRun(profileId);
    await seedRows(profileId, runId, [
      { id: 'g-1', rating: 1 },
      { id: 'g-2', rating: 2 },
      { id: 'g-3', rating: 5 },
      { id: 'g-4', rating: 5 },
    ]);

    const result = await runReviewThemesPass(
      { accountId: ACCOUNT_ID, runId },
      {
        ai: createAiProfileRunner({ provider: createFakeAiGenerationProvider() }),
        aiProviderOrder: FAKE_ORDER,
      },
    );

    expect(result.terminal).toBe('themes-ok');
    expect(result.themeCount).toBe(2);
  });
});

describe('getReviewThemes — read boundary', () => {
  it('404s an unknown run and a run owned by another account', async () => {
    const profileId = await seedProfile();
    const foreignRunId = await seedRun(profileId, { accountId: OTHER_ACCOUNT_ID });
    await expect(
      getReviewThemes(ACCOUNT_ID, new mongoose.Types.ObjectId().toString()),
    ).rejects.toBeInstanceOf(HttpError);
    await expect(getReviewThemes(ACCOUNT_ID, foreignRunId)).rejects.toMatchObject({ status: 404 });
  });

  it('renders surviving themes with citations clamped to 300 characters', async () => {
    const profileId = await seedProfile();
    const runId = await seedRun(profileId);
    await seedRows(profileId, runId, [
      { id: 'g-1', text: 'a'.repeat(800), title: 'Titled review' },
      // Undated + unrated row: both nullable columns exercised on the way in
      // (profile input) and on the way out (rendered citation).
      { id: 'g-2', text: 'Short and sweet.', rating: null, dated: false },
    ]);
    await runReviewThemesPass(
      { accountId: ACCOUNT_ID, runId },
      {
        ai: runnerReturning({
          complaintThemes: [{ label: 'Waits', summary: 'Long waits.', citedReviewIds: ['rev-001', 'rev-002'] }],
          praiseThemes: [{ label: 'Staff', summary: 'Friendly staff.', citedReviewIds: ['rev-002', 'rev-001'] }],
        }),
        aiProviderOrder: FAKE_ORDER,
      },
    );

    const view = await getReviewThemes(ACCOUNT_ID, runId);
    expect(view.terminal).toBe('themes-ok');
    expect(view.complaintThemes).toHaveLength(1);
    expect(view.praiseThemes).toHaveLength(1);
    const longest = view.complaintThemes[0]!.citations.map((citation) => citation.excerpt.length);
    expect(Math.max(...longest)).toBeLessThanOrEqual(REVIEW_THEME_EXCERPT_MAX_CHARS);
    expect(view.complaintThemes[0]!.citations[0]).toMatchObject({
      reviewId: expect.stringMatching(/^[0-9a-f]{24}$/i),
      source: 'google',
      rating: 4,
      reviewedAt: '2026-01-01T00:00:00.000Z',
    });
    // Undated / unrated rows render honestly instead of being padded.
    expect(view.complaintThemes[0]!.citations[1]).toMatchObject({
      rating: null,
      reviewedAt: null,
    });
    // The pass feeds the model newest-first (undated rows last), so the
    // citation order mirrors the inventory order.
    expect(view.complaintThemes[0]!.citedReviewIds).toEqual(
      view.complaintThemes[0]!.citations.map((citation) => citation.reviewId),
    );
    expect(view.observation).toMatchObject({
      sourceKind: 'ai_interpretation',
      sourceLabel: 'rankme_ai',
      sampleCount: 2,
    });
  });

  it('drops a theme whose cited row was deleted after the pass ran', async () => {
    const profileId = await seedProfile();
    const runId = await seedRun(profileId);
    await seedRows(profileId, runId, [{ id: 'g-1' }, { id: 'g-2' }]);
    await runReviewThemesPass(
      { accountId: ACCOUNT_ID, runId },
      {
        ai: runnerReturning({
          complaintThemes: [{ label: 'Waits', summary: 'Long waits.', citedReviewIds: ['rev-001', 'rev-002'] }],
          praiseThemes: [],
        }),
        aiProviderOrder: FAKE_ORDER,
      },
    );
    expect((await getReviewThemes(ACCOUNT_ID, runId)).complaintThemes).toHaveLength(1);

    await LocalSeoReviewRow.deleteOne({ profileId, sourceReviewId: 'g-2' });

    const after = await getReviewThemes(ACCOUNT_ID, runId);
    // Stale citation cannot resurrect; the whole theme goes with it.
    expect(after.complaintThemes).toEqual([]);
    expect(after.terminal).toBe('no-reliable-themes');
  });

  it('keeps same vendor ids from two sources distinct by stored review row id', async () => {
    const profileId = await seedProfile();
    const runId = await seedRun(profileId);
    await seedRows(profileId, runId, [
      { id: 'shared-id', source: 'google', text: 'Google evidence.' },
      { id: 'shared-id', source: 'trustpilot', text: 'Trustpilot evidence.' },
    ]);
    await runReviewThemesPass(
      { accountId: ACCOUNT_ID, runId },
      {
        ai: runnerReturning({
          complaintThemes: [{ label: 'Shared', summary: 'Two sources.', citedReviewIds: ['rev-001', 'rev-002'] }],
          praiseThemes: [],
        }),
        aiProviderOrder: FAKE_ORDER,
      },
    );

    const theme = (await getReviewThemes(ACCOUNT_ID, runId)).complaintThemes[0]!;
    expect(new Set(theme.citedReviewIds).size).toBe(2);
    expect(theme.citations.map((citation) => citation.sourceReviewId)).toEqual([
      'shared-id',
      'shared-id',
    ]);
    expect(theme.citations.map((citation) => citation.source)).toEqual([
      'trustpilot',
      'google',
    ]);
  });

  it('returns empty theme lists for a run that never produced any', async () => {
    const profileId = await seedProfile();
    const runId = await seedRun(profileId);
    const view = await getReviewThemes(ACCOUNT_ID, runId);
    expect(view).toMatchObject({ terminal: 'pending', complaintThemes: [], praiseThemes: [] });
    expect(view.runId).toBe(runId);
    expect(view.observation).toBeNull();
  });

  it('marks AI-failure provenance failed while keeping the empty review-backed result readable', async () => {
    const profileId = await seedProfile();
    const runId = await seedRun(profileId);
    await LocalSeoReviewSyncRun.updateOne(
      { _id: runId },
      {
        $set: {
          aiTerminalState: 'ai-failed-reviews-intact',
          aiCompletedAt: new Date('2026-03-02T00:00:00.000Z'),
          aiInputCount: 2,
        },
      },
    );

    const view = await getReviewThemes(ACCOUNT_ID, runId);
    expect(view).toMatchObject({
      terminal: 'ai-failed-reviews-intact',
      complaintThemes: [],
      praiseThemes: [],
      observation: {
        sourceKind: 'ai_interpretation',
        freshness: 'failed',
        sampleCount: 2,
      },
    });
  });
});
