/**
 * Fake CompetitorProvider traffic-op scenario suite.
 *
 * Covers full/empty/malformed/quota/timeout for each of the three additive
 * operations, plus the sentinel resolver (`__scenario:<name>`).
 */
import { describe, expect, it } from 'vitest';
import {
  VendorMalformedError,
  VendorQuotaError,
  VendorTimeoutError,
} from './errors.js';
import {
  COMPETITOR_TRAFFIC_SCENARIO_PREFIX,
  FAKE_DOMAIN_RANK_OVERVIEW,
  FAKE_HISTORICAL_RANK_OVERVIEW,
  FAKE_TRAFFIC_ESTIMATION,
  createFakeCompetitorProvider,
  resolveCompetitorTrafficScenarioFromInput,
} from './fakes.js';

describe('resolveCompetitorTrafficScenarioFromInput', () => {
  it('parses the sentinel prefix on the first token', () => {
    expect(
      resolveCompetitorTrafficScenarioFromInput(
        `${COMPETITOR_TRAFFIC_SCENARIO_PREFIX}empty`,
      ),
    ).toBe('empty');
    expect(
      resolveCompetitorTrafficScenarioFromInput(
        `${COMPETITOR_TRAFFIC_SCENARIO_PREFIX}QUOTA`,
      ),
    ).toBe('quota');
    expect(resolveCompetitorTrafficScenarioFromInput('error.example')).toBe('malformed');
    expect(resolveCompetitorTrafficScenarioFromInput('timeout.example')).toBe('timeout');
  });
  it('returns undefined for unknown/missing sentinel', () => {
    expect(resolveCompetitorTrafficScenarioFromInput('regular-domain.example')).toBeUndefined();
    expect(
      resolveCompetitorTrafficScenarioFromInput(
        `${COMPETITOR_TRAFFIC_SCENARIO_PREFIX}nonsense`,
      ),
    ).toBeUndefined();
    expect(resolveCompetitorTrafficScenarioFromInput(undefined)).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(resolveCompetitorTrafficScenarioFromInput(42 as any)).toBeUndefined();
  });
});

describe('createFakeCompetitorProvider — getTrafficEstimation scenarios', () => {
  it('full → deterministic bank', async () => {
    const p = createFakeCompetitorProvider();
    const rows = await p.getTrafficEstimation(['example.com'], {
      locationCode: 2840,
      languageCode: 'en',
    });
    expect(rows).toEqual(FAKE_TRAFFIC_ESTIMATION);
  });
  it('defensively ignores a non-array domain argument', async () => {
    const p = createFakeCompetitorProvider();
    const unsafe = p.getTrafficEstimation as unknown as (
      domains: string,
      input: { locationCode: number; languageCode: string },
    ) => ReturnType<typeof p.getTrafficEstimation>;
    await expect(
      unsafe('example.com', { locationCode: 2840, languageCode: 'en' }),
    ).resolves.toEqual(FAKE_TRAFFIC_ESTIMATION);
  });
  it('per-op scenario override wins over sentinel', async () => {
    const p = createFakeCompetitorProvider({
      trafficScenarios: { 'traffic-estimation': 'empty' },
    });
    const rows = await p.getTrafficEstimation(['anything'], {
      locationCode: 2840,
      languageCode: 'en',
    });
    expect(rows).toEqual([]);
  });
  it('sentinel-driven empty → []', async () => {
    const p = createFakeCompetitorProvider();
    expect(
      await p.getTrafficEstimation([`${COMPETITOR_TRAFFIC_SCENARIO_PREFIX}empty`], {
        locationCode: 2840,
        languageCode: 'en',
      }),
    ).toEqual([]);
  });
  it('malformed → VendorMalformedError', async () => {
    const p = createFakeCompetitorProvider();
    await expect(
      p.getTrafficEstimation([`${COMPETITOR_TRAFFIC_SCENARIO_PREFIX}malformed`], {
        locationCode: 2840,
        languageCode: 'en',
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });
  it('quota → VendorQuotaError', async () => {
    const p = createFakeCompetitorProvider({
      trafficScenarios: { 'traffic-estimation': 'quota' },
    });
    await expect(
      p.getTrafficEstimation(['any.example'], {
        locationCode: 2840,
        languageCode: 'en',
      }),
    ).rejects.toBeInstanceOf(VendorQuotaError);
  });
  it('timeout → VendorTimeoutError', async () => {
    const p = createFakeCompetitorProvider({
      trafficScenarios: { 'traffic-estimation': 'timeout' },
    });
    await expect(
      p.getTrafficEstimation(['any.example'], {
        locationCode: 2840,
        languageCode: 'en',
      }),
    ).rejects.toBeInstanceOf(VendorTimeoutError);
  });
});

describe('createFakeCompetitorProvider — getDomainRankOverview scenarios', () => {
  it('full → deterministic row', async () => {
    const p = createFakeCompetitorProvider();
    const row = await p.getDomainRankOverview('example.com', {
      locationCode: 2840,
      languageCode: 'en',
    });
    expect(row).toEqual(FAKE_DOMAIN_RANK_OVERVIEW);
  });
  it('sentinel-driven empty → zero-shape row', async () => {
    const p = createFakeCompetitorProvider();
    const row = await p.getDomainRankOverview(
      `${COMPETITOR_TRAFFIC_SCENARIO_PREFIX}empty`,
      { locationCode: 2840, languageCode: 'en' },
    );
    expect(row.rank).toBeNull();
    expect(row.keywordsCount).toBe(0);
    expect(row.estimatedMonthlyOrganicVisits).toBe(0);
  });
  it('error scenarios raise the correct taxonomy', async () => {
    const malformed = createFakeCompetitorProvider({
      trafficScenarios: { 'domain-rank-overview': 'malformed' },
    });
    await expect(
      malformed.getDomainRankOverview('any', {
        locationCode: 2840,
        languageCode: 'en',
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
    const quota = createFakeCompetitorProvider({
      trafficScenarios: { 'domain-rank-overview': 'quota' },
    });
    await expect(
      quota.getDomainRankOverview('any', { locationCode: 2840, languageCode: 'en' }),
    ).rejects.toBeInstanceOf(VendorQuotaError);
    const timeout = createFakeCompetitorProvider({
      trafficScenarios: { 'domain-rank-overview': 'timeout' },
    });
    await expect(
      timeout.getDomainRankOverview('any', { locationCode: 2840, languageCode: 'en' }),
    ).rejects.toBeInstanceOf(VendorTimeoutError);
  });
});

describe('createFakeCompetitorProvider — getHistoricalRankOverview scenarios', () => {
  it('full → deterministic bank, trimmed to newest `limit`', async () => {
    const p = createFakeCompetitorProvider();
    const result = await p.getHistoricalRankOverview('example.com', {
      locationCode: 2840,
      languageCode: 'en',
      limit: 24,
    });
    expect(result).toEqual(FAKE_HISTORICAL_RANK_OVERVIEW);
    const trimmed = await p.getHistoricalRankOverview('example.com', {
      locationCode: 2840,
      languageCode: 'en',
      limit: 1,
    });
    expect(trimmed.points).toHaveLength(1);
    // Newest point survives — the sentinel bank is ascending.
    expect(trimmed.points[0]?.month).toBe(12);
  });
  it('sentinel-driven empty → { points: [] }', async () => {
    const p = createFakeCompetitorProvider();
    const result = await p.getHistoricalRankOverview(
      `${COMPETITOR_TRAFFIC_SCENARIO_PREFIX}empty`,
      { locationCode: 2840, languageCode: 'en', limit: 24 },
    );
    expect(result.points).toEqual([]);
  });
  it('error scenarios raise the correct taxonomy', async () => {
    const malformed = createFakeCompetitorProvider({
      trafficScenarios: { 'historical-rank-overview': 'malformed' },
    });
    await expect(
      malformed.getHistoricalRankOverview('any', {
        locationCode: 2840,
        languageCode: 'en',
        limit: 24,
      }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
    const quota = createFakeCompetitorProvider({
      trafficScenarios: { 'historical-rank-overview': 'quota' },
    });
    await expect(
      quota.getHistoricalRankOverview('any', {
        locationCode: 2840,
        languageCode: 'en',
        limit: 24,
      }),
    ).rejects.toBeInstanceOf(VendorQuotaError);
    const timeout = createFakeCompetitorProvider({
      trafficScenarios: { 'historical-rank-overview': 'timeout' },
    });
    await expect(
      timeout.getHistoricalRankOverview('any', {
        locationCode: 2840,
        languageCode: 'en',
        limit: 24,
      }),
    ).rejects.toBeInstanceOf(VendorTimeoutError);
  });
});

describe('createFakeCompetitorProvider — additive backward compatibility', () => {
  it('does not affect the shipped four operations', async () => {
    const p = createFakeCompetitorProvider();
    // The four shipped methods are unchanged — one smoke each.
    await expect(p.getCompetitors('example.com', 2840, 'en', 5)).resolves.toBeInstanceOf(
      Array,
    );
    await expect(
      p.getSerpCompetitors(['foo'], 2840, 'en', 5),
    ).resolves.toBeInstanceOf(Array);
    await expect(
      p.getDomainIntersection('a.example', 'b.example', {
        locationCode: 2840,
        languageCode: 'en',
      }),
    ).resolves.toBeInstanceOf(Array);
    await expect(p.getTechnologies('example.com')).resolves.toBeInstanceOf(Array);
  });
});
