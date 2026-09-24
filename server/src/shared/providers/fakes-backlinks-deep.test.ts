/**
 * Fake BacklinkProvider deep-op scenario suite.
 *
 * Covers full/partial/empty/malformed/quota/timeout for each of the five
 * additive operations, plus the sentinel resolver (`__scenario:<name>`).
 */
import { describe, expect, it } from 'vitest';
import {
  VendorMalformedError,
  VendorQuotaError,
  VendorTimeoutError,
} from './errors.js';
import {
  BACKLINK_DEEP_DNS_SCENARIO_SUFFIX,
  BACKLINK_DEEP_SCENARIO_PREFIX,
  FAKE_BACKLINK_ANCHORS,
  FAKE_BACKLINK_BULK_RANKS,
  FAKE_BACKLINK_COMPETITORS,
  FAKE_BACKLINK_HISTORY,
  FAKE_BACKLINK_SPAM_SCORES,
  FAKE_REFERRING_DOMAINS,
  createFakeBacklinkProvider,
  resolveBacklinkDeepScenarioFromInput,
} from './fakes.js';

describe('resolveBacklinkDeepScenarioFromInput', () => {
  it('parses the sentinel prefix on the first token', () => {
    expect(
      resolveBacklinkDeepScenarioFromInput(`${BACKLINK_DEEP_SCENARIO_PREFIX}empty`),
    ).toBe('empty');
    expect(
      resolveBacklinkDeepScenarioFromInput(`${BACKLINK_DEEP_SCENARIO_PREFIX}QUOTA`),
    ).toBe('quota');
    expect(
      resolveBacklinkDeepScenarioFromInput(`scenario-timeout${BACKLINK_DEEP_DNS_SCENARIO_SUFFIX}`),
    ).toBe('timeout');
  });
  it('returns undefined for unknown/missing sentinel', () => {
    expect(resolveBacklinkDeepScenarioFromInput('regular-domain.example')).toBeUndefined();
    expect(
      resolveBacklinkDeepScenarioFromInput(`${BACKLINK_DEEP_SCENARIO_PREFIX}nonsense`),
    ).toBeUndefined();
    expect(resolveBacklinkDeepScenarioFromInput(undefined)).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(resolveBacklinkDeepScenarioFromInput(42 as any)).toBeUndefined();
  });
});

describe('createFakeBacklinkProvider — getReferringDomains scenarios', () => {
  it('full → all deterministic rows, respect limit', async () => {
    const p = createFakeBacklinkProvider();
    const rows = await p.getReferringDomains('example.com', { limit: 500 });
    expect(rows).toEqual(FAKE_REFERRING_DOMAINS);
    const trimmed = await p.getReferringDomains('example.com', { limit: 2 });
    expect(trimmed).toHaveLength(2);
  });
  it('partial → first two rows', async () => {
    const p = createFakeBacklinkProvider({
      scenarios: { 'referring-domains': 'partial' },
    });
    const rows = await p.getReferringDomains('example.com', { limit: 500 });
    expect(rows).toEqual(FAKE_REFERRING_DOMAINS.slice(0, 2));
  });
  it('empty → []', async () => {
    const p = createFakeBacklinkProvider();
    expect(
      await p.getReferringDomains(`${BACKLINK_DEEP_SCENARIO_PREFIX}empty`, { limit: 500 }),
    ).toEqual([]);
  });
  it('malformed → VendorMalformedError', async () => {
    const p = createFakeBacklinkProvider();
    await expect(
      p.getReferringDomains(`${BACKLINK_DEEP_SCENARIO_PREFIX}malformed`, { limit: 10 }),
    ).rejects.toBeInstanceOf(VendorMalformedError);
  });
  it('quota → VendorQuotaError', async () => {
    const p = createFakeBacklinkProvider({ scenarios: { 'referring-domains': 'quota' } });
    await expect(p.getReferringDomains('any', { limit: 10 })).rejects.toBeInstanceOf(
      VendorQuotaError,
    );
  });
  it('timeout → VendorTimeoutError', async () => {
    const p = createFakeBacklinkProvider({
      scenarios: { 'referring-domains': 'timeout' },
    });
    await expect(p.getReferringDomains('any', { limit: 10 })).rejects.toBeInstanceOf(
      VendorTimeoutError,
    );
  });
});

describe('createFakeBacklinkProvider — getAnchors scenarios', () => {
  it('full/partial/empty return deterministic bank slices', async () => {
    const full = createFakeBacklinkProvider();
    expect(await full.getAnchors('any', { limit: 500 })).toEqual(FAKE_BACKLINK_ANCHORS);
    const partial = createFakeBacklinkProvider({ scenarios: { anchors: 'partial' } });
    expect(await partial.getAnchors('any', { limit: 500 })).toEqual(
      FAKE_BACKLINK_ANCHORS.slice(0, 2),
    );
    const empty = createFakeBacklinkProvider();
    expect(
      await empty.getAnchors(`${BACKLINK_DEEP_SCENARIO_PREFIX}empty`, { limit: 500 }),
    ).toEqual([]);
  });
  it('error scenarios raise the correct taxonomy', async () => {
    for (const [scenario, ctor] of [
      ['malformed', VendorMalformedError],
      ['quota', VendorQuotaError],
      ['timeout', VendorTimeoutError],
    ] as const) {
      const p = createFakeBacklinkProvider({ scenarios: { anchors: scenario } });
      await expect(p.getAnchors('any', { limit: 5 })).rejects.toBeInstanceOf(ctor);
    }
  });
});

describe('createFakeBacklinkProvider — getHistory scenarios', () => {
  it('full → all points; limit trims from the head (newest wins)', async () => {
    const p = createFakeBacklinkProvider();
    expect(await p.getHistory('any', { limit: 24 })).toEqual(FAKE_BACKLINK_HISTORY);
    const tail = await p.getHistory('any', { limit: 2 });
    expect(tail).toEqual(FAKE_BACKLINK_HISTORY.slice(-2));
  });
  it('partial + empty', async () => {
    const partial = createFakeBacklinkProvider({ scenarios: { history: 'partial' } });
    expect(await partial.getHistory('any', { limit: 24 })).toEqual(
      FAKE_BACKLINK_HISTORY.slice(0, 2).slice(-24),
    );
    const empty = createFakeBacklinkProvider();
    expect(
      await empty.getHistory(`${BACKLINK_DEEP_SCENARIO_PREFIX}empty`, { limit: 24 }),
    ).toEqual([]);
  });
  it('error scenarios raise the correct taxonomy', async () => {
    for (const [scenario, ctor] of [
      ['malformed', VendorMalformedError],
      ['quota', VendorQuotaError],
      ['timeout', VendorTimeoutError],
    ] as const) {
      const p = createFakeBacklinkProvider({ scenarios: { history: scenario } });
      await expect(p.getHistory('any', { limit: 5 })).rejects.toBeInstanceOf(ctor);
    }
  });
});

describe('createFakeBacklinkProvider — getBulkRanks scenarios', () => {
  it('full/partial/empty', async () => {
    const full = createFakeBacklinkProvider();
    expect(await full.getBulkRanks(['example.com'])).toEqual(FAKE_BACKLINK_BULK_RANKS);
    const partial = createFakeBacklinkProvider({ scenarios: { 'bulk-ranks': 'partial' } });
    expect(await partial.getBulkRanks(['example.com'])).toEqual(
      FAKE_BACKLINK_BULK_RANKS.slice(0, 2),
    );
    const empty = createFakeBacklinkProvider();
    expect(
      await empty.getBulkRanks([`${BACKLINK_DEEP_SCENARIO_PREFIX}empty`]),
    ).toEqual([]);
  });
  it('error scenarios raise the correct taxonomy', async () => {
    for (const [scenario, ctor] of [
      ['malformed', VendorMalformedError],
      ['quota', VendorQuotaError],
      ['timeout', VendorTimeoutError],
    ] as const) {
      const p = createFakeBacklinkProvider({ scenarios: { 'bulk-ranks': scenario } });
      await expect(p.getBulkRanks(['any.example'])).rejects.toBeInstanceOf(ctor);
    }
  });
});

describe('createFakeBacklinkProvider — getBulkSpamScores scenarios', () => {
  it('full/partial/empty return deterministic scores for supplied targets', async () => {
    const targets = FAKE_BACKLINK_SPAM_SCORES.map((row) => row.target);
    const full = createFakeBacklinkProvider();
    expect(await full.getBulkSpamScores(targets)).toEqual(
      FAKE_BACKLINK_SPAM_SCORES,
    );
    expect(await full.getBulkSpamScores([...targets].reverse())).toEqual(
      [...FAKE_BACKLINK_SPAM_SCORES].reverse(),
    );
    await expect(full.getBulkSpamScores(['unknown.example'])).resolves.toEqual([
      { target: 'unknown.example', spamScore: 70 },
    ]);
    const partial = createFakeBacklinkProvider({
      scenarios: { 'bulk-spam-scores': 'partial' },
    });
    expect(await partial.getBulkSpamScores(targets)).toEqual(
      FAKE_BACKLINK_SPAM_SCORES.slice(0, 2),
    );
    const empty = createFakeBacklinkProvider({
      scenarios: { 'bulk-spam-scores': 'empty' },
    });
    expect(await empty.getBulkSpamScores(targets)).toEqual([]);
  });

  it('malformed/quota/timeout use the shared provider taxonomy', async () => {
    for (const [scenario, ctor] of [
      ['malformed', VendorMalformedError],
      ['quota', VendorQuotaError],
      ['timeout', VendorTimeoutError],
    ] as const) {
      const provider = createFakeBacklinkProvider({
        scenarios: { 'bulk-spam-scores': scenario },
      });
      await expect(
        provider.getBulkSpamScores(['one.example']),
      ).rejects.toBeInstanceOf(ctor);
    }
  });
});

describe('createFakeBacklinkProvider — listBacklinks DNS-safe failure scenarios', () => {
  it('returns one normalized unscored row so a fake worker can inject a later-stage failure', async () => {
    const page = await createFakeBacklinkProvider().listBacklinks('scenario-timeout.test', {
      limit: 100,
    });
    expect(page).toEqual({
      rows: [
        expect.objectContaining({
          domainFrom: 'scenario-timeout.test',
          urlFrom: 'https://scenario-timeout.test/source',
          backlinkSpamScore: null,
          urlToSpamScore: 0,
        }),
      ],
    });
  });
});

describe('createFakeBacklinkProvider — getBacklinkCompetitors scenarios', () => {
  it('full/partial/empty', async () => {
    const full = createFakeBacklinkProvider();
    expect(await full.getBacklinkCompetitors('any', { limit: 500 })).toEqual(
      FAKE_BACKLINK_COMPETITORS,
    );
    const partial = createFakeBacklinkProvider({
      scenarios: { competitors: 'partial' },
    });
    expect(await partial.getBacklinkCompetitors('any', { limit: 500 })).toEqual(
      FAKE_BACKLINK_COMPETITORS.slice(0, 2),
    );
    const empty = createFakeBacklinkProvider();
    expect(
      await empty.getBacklinkCompetitors(`${BACKLINK_DEEP_SCENARIO_PREFIX}empty`, {
        limit: 500,
      }),
    ).toEqual([]);
  });
  it('error scenarios raise the correct taxonomy', async () => {
    for (const [scenario, ctor] of [
      ['malformed', VendorMalformedError],
      ['quota', VendorQuotaError],
      ['timeout', VendorTimeoutError],
    ] as const) {
      const p = createFakeBacklinkProvider({ scenarios: { competitors: scenario } });
      await expect(
        p.getBacklinkCompetitors('any', { limit: 5 }),
      ).rejects.toBeInstanceOf(ctor);
    }
  });
});

describe('createFakeBacklinkProvider — provider-wide failure still preempts scenario', () => {
  it('opts.failure wins over scenario resolution', async () => {
    const p = createFakeBacklinkProvider({
      failure: new VendorQuotaError('injected', { provider: 'fake', operation: 'test' }),
    });
    await expect(p.getAnchors('any', { limit: 1 })).rejects.toBeInstanceOf(VendorQuotaError);
    await expect(p.getBulkRanks(['a.example'])).rejects.toBeInstanceOf(VendorQuotaError);
    await expect(p.getBulkSpamScores(['a.example'])).rejects.toBeInstanceOf(
      VendorQuotaError,
    );
    await expect(p.getHistory('any', { limit: 1 })).rejects.toBeInstanceOf(VendorQuotaError);
    await expect(p.getReferringDomains('any', { limit: 1 })).rejects.toBeInstanceOf(
      VendorQuotaError,
    );
    await expect(
      p.getBacklinkCompetitors('any', { limit: 1 }),
    ).rejects.toBeInstanceOf(VendorQuotaError);
  });
});
