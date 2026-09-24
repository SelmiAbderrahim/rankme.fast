/**
 * Fake scenario tests for the Google Trends capability seam.
 * Every documented scenario key is exercised so downstream feature modules can
 * rely on deterministic fake behaviour.
 */
import { describe, expect, it } from 'vitest';
import {
  VendorMalformedError,
  VendorQuotaError,
  VendorTimeoutError,
} from './errors.js';
import {
  createFakeTrendsProvider,
  resolveTrendsScenarioFromInput,
  TRENDS_SCENARIO_PREFIX,
  type FakeTrendsScenario,
} from './fakes.js';
import type { TrendsProvider, TrendsExploreResult } from './types.js';

const _typeCheck: TrendsProvider = createFakeTrendsProvider();

const INPUT = { keywords: ['rankmefast'] };

describe('createFakeTrendsProvider — scenarios', () => {
  it('rich (default) returns five full years per keyword + related queries', async () => {
    const p = createFakeTrendsProvider();
    const result = await p.explore({ keywords: ['rankmefast', 'ahrefs'] });
    expect(result.series).toHaveLength(2);
    expect(result.series[0]!.points).toHaveLength(60);
    expect(result.series[0]!.points[0]).toEqual({ year: 2021, month: 1, value: 20 });
    expect(result.series[0]!.points.at(-1)).toEqual({
      year: 2025,
      month: 12,
      value: 72,
    });
    expect(result.relatedQueries.length).toBe(5);
    expect(result.observedAt).toBe('2026-01-01T00:00:00.000Z');
    // Language + location default null when not requested.
    expect(result.locationCode).toBeNull();
    expect(result.languageCode).toBeNull();
  });

  it('flat scenario returns all-50 values', async () => {
    const p = createFakeTrendsProvider({ scenario: 'flat' });
    const result = await p.explore(INPUT);
    expect(result.series[0]!.points.every((pt) => pt.value === 50)).toBe(true);
  });

  it('sparse scenario returns 3 points and empty related queries', async () => {
    const p = createFakeTrendsProvider({ scenario: 'sparse' });
    const result = await p.explore({ keywords: ['a', 'b'] });
    expect(result.series[0]!.points.length).toBe(3);
    expect(result.relatedQueries).toEqual([]);
  });

  it('empty scenario returns zero series and zero related queries', async () => {
    const p = createFakeTrendsProvider({ scenario: 'empty' });
    const result = await p.explore(INPUT);
    expect(result.series).toEqual([]);
    expect(result.relatedQueries).toEqual([]);
  });

  it('malformed scenario rejects with VendorMalformedError', async () => {
    const p = createFakeTrendsProvider({ scenario: 'malformed' });
    await expect(p.explore(INPUT)).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('quota scenario rejects with VendorQuotaError', async () => {
    const p = createFakeTrendsProvider({ scenario: 'quota' });
    await expect(p.explore(INPUT)).rejects.toBeInstanceOf(VendorQuotaError);
  });

  it('timeout scenario rejects with VendorTimeoutError', async () => {
    const p = createFakeTrendsProvider({ scenario: 'timeout' });
    await expect(p.explore(INPUT)).rejects.toBeInstanceOf(VendorTimeoutError);
  });

  it('input-sentinel selects the scenario when no explicit override is set', async () => {
    const p = createFakeTrendsProvider();
    await expect(
      p.explore({ keywords: [`${TRENDS_SCENARIO_PREFIX}malformed`, 'rankme'] }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });

  it('unknown sentinel falls back to rich (helper returns undefined)', async () => {
    const p = createFakeTrendsProvider();
    const result = await p.explore({
      keywords: [`${TRENDS_SCENARIO_PREFIX}mystery`, 'rankme'],
    });
    // Rich scenario emits five full years.
    expect(result.series[0]!.points.length).toBe(60);
  });

  it('sentinel keywords are stripped from the requested series', async () => {
    const p = createFakeTrendsProvider();
    const result = await p.explore({
      keywords: [`${TRENDS_SCENARIO_PREFIX}rich`, 'rankmefast', 'RANKMEFAST'],
    });
    // sentinel dropped; case-insensitive dedupe keeps the first.
    expect(result.series.map((s) => s.keyword)).toEqual(['rankmefast']);
  });

  it('emits a single fake-keyword series when the input keywords are empty', async () => {
    const p = createFakeTrendsProvider();
    const result = await p.explore({ keywords: [] });
    expect(result.series.map((s) => s.keyword)).toEqual(['fake-keyword']);
  });

  it('injectable clock stamps observedAt', async () => {
    const stamp = new Date('2030-05-05T00:00:00.000Z');
    const p = createFakeTrendsProvider({ now: () => stamp });
    const result = await p.explore(INPUT);
    expect(result.observedAt).toBe('2030-05-05T00:00:00.000Z');
  });

  it('failure override wins over scenario-derived error taxonomy', async () => {
    const p = createFakeTrendsProvider({
      scenario: 'quota',
      failure: new VendorTimeoutError('override', { provider: 'fake', operation: 'trends-explore' }),
    });
    await expect(p.explore(INPUT)).rejects.toBeInstanceOf(VendorTimeoutError);
  });

  it('result override wins over scenario shaping', async () => {
    const canned: TrendsExploreResult = {
      series: [],
      relatedQueries: [],
      window: { startDate: null, endDate: null },
      observedAt: '2026-06-06T00:00:00.000Z',
      locationCode: null,
      languageCode: null,
    };
    const p = createFakeTrendsProvider({ result: canned });
    await expect(p.explore(INPUT)).resolves.toEqual(canned);
  });

  it('emits requested locationCode + lowercased languageCode + startDate/endDate window', async () => {
    const p = createFakeTrendsProvider();
    const result = await p.explore({
      keywords: ['rankme'],
      locationCode: 2276,
      languageCode: 'DE',
      startDate: '2025-01-01',
      endDate: '2025-06-30',
    });
    expect(result.locationCode).toBe(2276);
    expect(result.languageCode).toBe('de');
    expect(result.window).toEqual({ startDate: '2025-01-01', endDate: '2025-06-30' });
  });

  it('non-array keywords input is treated as empty (defensive path)', async () => {
    const p = createFakeTrendsProvider();
    const result = await p.explore({ keywords: null as unknown as string[] });
    expect(result.series.map((s) => s.keyword)).toEqual(['fake-keyword']);
  });

  it('non-string keyword entries are dropped', async () => {
    const p = createFakeTrendsProvider();
    const result = await p.explore({
      keywords: ['rankme', 42 as unknown as string],
    });
    expect(result.series.map((s) => s.keyword)).toEqual(['rankme']);
  });
});

describe('resolveTrendsScenarioFromInput', () => {
  it('returns undefined when no sentinel is present', () => {
    expect(resolveTrendsScenarioFromInput(['rankme'])).toBeUndefined();
    expect(resolveTrendsScenarioFromInput([])).toBeUndefined();
    expect(resolveTrendsScenarioFromInput([42 as unknown as string])).toBeUndefined();
  });

  it.each([
    ['rich'],
    ['flat'],
    ['sparse'],
    ['empty'],
    ['malformed'],
    ['quota'],
    ['timeout'],
  ] as ReadonlyArray<[FakeTrendsScenario]>)(
    'resolves sentinel :%s',
    (label) => {
      expect(
        resolveTrendsScenarioFromInput([`${TRENDS_SCENARIO_PREFIX}${label}`]),
      ).toBe(label);
    },
  );

  it('returns undefined when the sentinel label is not on the allow-list', () => {
    expect(
      resolveTrendsScenarioFromInput([`${TRENDS_SCENARIO_PREFIX}bogus`]),
    ).toBeUndefined();
  });
});
