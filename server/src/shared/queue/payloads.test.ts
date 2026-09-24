import { UnrecoverableError } from 'bullmq';
import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  audienceResearchJobSchema,
  appSeoTrackingJobSchema,
  backlinkDeepJobSchema,
  brandRadarScanJobSchema,
  auditJobSchema,
  auditSummaryJobSchema,
  contentInventoryJobSchema,
  contentMonitorJobSchema,
  gscSyncJobSchema,
  parseConsumedPayload,
  parsePayload,
  rankJobSchema,
  reviewSyncJobSchema,
  trafficSnapshotJobSchema,
} from './index.js';

const hex = (n: number) => n.toString(16).padStart(24, '0');
const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString().padStart(12, '0')}`;

const validAudit = {
  accountId: hex(1),
  siteId: hex(2),
  runId: hex(3),
  pageCap: 100,
};

const validAuditSummary = {
  accountId: hex(1),
  runId: hex(3),
  generationId: hex(6),
  locale: 'fr',
};

const validRank = {
  accountId: hex(1),
  siteId: hex(2),
  keywordIds: [uuid(4), uuid(5)],
  schedulerKey: 'rank-schedule:000000000000000000000002',
};

const validGscSync = {
  accountId: hex(1),
  siteId: hex(2),
  domain: 'example.com',
};

describe('job payload schemas', () => {
  it('accepts a valid audit payload', () => {
    expect(auditJobSchema.parse(validAudit)).toEqual(validAudit);
  });

  it('accepts only strict, localized audit-summary payloads', () => {
    expect(auditSummaryJobSchema.parse(validAuditSummary)).toEqual(validAuditSummary);
    expect(() => auditSummaryJobSchema.parse({ ...validAuditSummary, locale: 'xx' })).toThrow(
      ZodError,
    );
    expect(() => auditSummaryJobSchema.parse({ ...validAuditSummary, secret: true })).toThrow(
      ZodError,
    );
  });

  it('accepts a valid rank payload (empty keyword list allowed); manual is absent on scheduled jobs', () => {
    expect(rankJobSchema.parse({ ...validRank, keywordIds: [] })).toEqual({
      ...validRank,
      keywordIds: [],
    });
  });

  it('carries the manual flag when set (on-demand checks)', () => {
    expect(rankJobSchema.parse({ ...validRank, manual: true })).toEqual({
      ...validRank,
      manual: true,
    });
  });

  it('accepts a bounded refunded-retry generation for App SEO checks', () => {
    const payload = {
      accountId: hex(1),
      siteId: hex(2),
      profileId: hex(3),
      keywordId: 'e800317f-2d8a-497c-8b50-432b12da2888',
      reservationStamp: '2026-W33-r000001',
      manual: true,
    };
    expect(appSeoTrackingJobSchema.parse(payload)).toEqual(payload);
    expect(() => appSeoTrackingJobSchema.parse({
      ...payload,
      reservationStamp: '2026-W33-r1',
    })).toThrow(ZodError);
  });

  it('accepts only a bounded manual alt-engine reservation descriptor', () => {
    const altEngineReservation = {
      batchKey: 'manual-1234',
      keywordIds: ['00000000-0000-4000-8000-000000000001'],
    };
    expect(
      rankJobSchema.parse({ ...validRank, manual: true, altEngineReservation }),
    ).toMatchObject({ manual: true, altEngineReservation });
    expect(() =>
      rankJobSchema.parse({ ...validRank, altEngineReservation }),
    ).toThrow(ZodError);
    expect(() =>
      rankJobSchema.parse({
        ...validRank,
        manual: true,
        altEngineReservation: { ...altEngineReservation, keywordIds: [] },
      }),
    ).toThrow(ZodError);
    expect(() =>
      rankJobSchema.parse({
        ...validRank,
        manual: true,
        altEngineReservation: {
          ...altEngineReservation,
          keywordIds: ['not-a-uuid'],
        },
      }),
    ).toThrow(ZodError);
  });

  it('accepts only a matching single-keyword SERP reservation', () => {
    const keywordId = uuid(4);
    const serpReservation = { batchKey: 'manual-1234', keywordId, units: 2 };
    expect(
      rankJobSchema.parse({
        ...validRank,
        keywordIds: [keywordId],
        manual: true,
        serpReservation,
      }),
    ).toMatchObject({ keywordIds: [keywordId], serpReservation });
    expect(() =>
      rankJobSchema.parse({ ...validRank, keywordIds: [keywordId], serpReservation }),
    ).toThrow(ZodError);
    expect(() =>
      rankJobSchema.parse({
        ...validRank,
        keywordIds: [uuid(5)],
        manual: true,
        serpReservation,
      }),
    ).toThrow(ZodError);
    expect(() =>
      rankJobSchema.parse({
        ...validRank,
        keywordIds: [keywordId],
        manual: true,
        serpReservation,
        altEngineReservation: { batchKey: 'manual-1234', keywordIds: [keywordId] },
      }),
    ).toThrow(/mutually exclusive/);
  });

  it('rejects non-hex ids', () => {
    expect(() => auditJobSchema.parse({ ...validAudit, accountId: 'not-an-id' })).toThrow(
      ZodError,
    );
    expect(() => rankJobSchema.parse({ ...validRank, keywordIds: ['nope'] })).toThrow(ZodError);
  });

  it('rejects out-of-range pageCap', () => {
    expect(() => auditJobSchema.parse({ ...validAudit, pageCap: 0 })).toThrow(ZodError);
    expect(() => auditJobSchema.parse({ ...validAudit, pageCap: 10_001 })).toThrow(ZodError);
    expect(() => auditJobSchema.parse({ ...validAudit, pageCap: 1.5 })).toThrow(ZodError);
  });

  it('rejects unknown keys (strict — the queue is a trust boundary)', () => {
    expect(() => auditJobSchema.parse({ ...validAudit, secret: 'hunter2' })).toThrow(ZodError);
    expect(() => rankJobSchema.parse({ ...validRank, vendorBlob: {} })).toThrow(ZodError);
  });

  it('rejects an empty schedulerKey', () => {
    expect(() => rankJobSchema.parse({ ...validRank, schedulerKey: '' })).toThrow(ZodError);
  });

  it('accepts only strict object-id Link Intelligence deep jobs', () => {
    const valid = {
      accountId: hex(1),
      siteId: hex(2),
      runId: hex(3),
      operation: 'deep_pull' as const,
    };
    expect(backlinkDeepJobSchema.parse(valid)).toEqual(valid);
    expect(() => backlinkDeepJobSchema.parse({ ...valid, runId: 'bad' })).toThrow(ZodError);
    expect(() =>
      backlinkDeepJobSchema.parse({ ...valid, operation: 'unknown' }),
    ).toThrow(ZodError);
    expect(() => backlinkDeepJobSchema.parse({ ...valid, vendorPayload: {} })).toThrow(ZodError);
  });

  it('accepts only strict object-id Traffic Insights snapshot jobs', () => {
    const valid = { accountId: hex(1), runId: hex(3) };
    expect(trafficSnapshotJobSchema.parse(valid)).toEqual(valid);
    expect(() => trafficSnapshotJobSchema.parse({ ...valid, runId: 'bad' })).toThrow(ZodError);
    expect(() => trafficSnapshotJobSchema.parse({ ...valid, vendorPayload: {} })).toThrow(
      ZodError,
    );
  });

  it('accepts only strict object-id Review Intelligence sync jobs', () => {
    // `siteId` is required: the processor takes the site work lease before it
    // touches the run, so the payload must name the site it operates on.
    const valid = {
      accountId: hex(1),
      siteId: hex(2),
      runId: hex(4),
      outputLocale: 'fr',
    };
    expect(reviewSyncJobSchema.parse(valid)).toEqual(valid);
    expect(() => reviewSyncJobSchema.parse({ ...valid, runId: 'bad' })).toThrow(ZodError);
    expect(() => reviewSyncJobSchema.parse({ ...valid, outputLocale: 'xx' })).toThrow(ZodError);
    const { outputLocale: _missingLocale, ...withoutLocale } = valid;
    expect(() => reviewSyncJobSchema.parse(withoutLocale)).toThrow(ZodError);
    // The payload carries identity only — sources/depth are reloaded from the
    // run document so a replay can never widen the paid fan-out.
    expect(() => reviewSyncJobSchema.parse({ ...valid, sources: ['google'] })).toThrow(ZodError);
  });
});

describe('gscSyncJobSchema', () => {
  it('accepts a valid payload', () => {
    expect(gscSyncJobSchema.parse(validGscSync)).toEqual(validGscSync);
  });

  it('rejects non-hex accountId/siteId', () => {
    expect(() => gscSyncJobSchema.parse({ ...validGscSync, accountId: 'nope' })).toThrow(
      ZodError,
    );
    expect(() => gscSyncJobSchema.parse({ ...validGscSync, siteId: 'nope' })).toThrow(
      ZodError,
    );
  });

  it('rejects an empty domain', () => {
    expect(() => gscSyncJobSchema.parse({ ...validGscSync, domain: '' })).toThrow(ZodError);
  });

  it('rejects unknown keys (strict — the queue is a trust boundary)', () => {
    expect(() => gscSyncJobSchema.parse({ ...validGscSync, secret: 'hunter2' })).toThrow(
      ZodError,
    );
  });

  it('parseConsumedPayload wraps a malformed gsc-sync payload in UnrecoverableError', () => {
    expect(() => parseConsumedPayload(gscSyncJobSchema, { crafted: true })).toThrow(
      UnrecoverableError,
    );
  });
});

describe('audienceResearchJobSchema', () => {
  const validAudienceResearch = {
    accountId: hex(1),
    siteId: hex(2),
    runId: hex(7),
    outputLocale: 'ar',
  };

  it('accepts a valid payload — ids only, no source text', () => {
    expect(audienceResearchJobSchema.parse(validAudienceResearch)).toEqual(validAudienceResearch);
  });

  it('rejects non-hex ids', () => {
    expect(() =>
      audienceResearchJobSchema.parse({ ...validAudienceResearch, runId: 'not-hex' }),
    ).toThrow(ZodError);
    expect(() =>
      audienceResearchJobSchema.parse({ ...validAudienceResearch, accountId: 'nope' }),
    ).toThrow(ZodError);
    expect(() =>
      audienceResearchJobSchema.parse({ ...validAudienceResearch, siteId: 'nope' }),
    ).toThrow(ZodError);
  });

  it('requires one of the seven frozen output locales', () => {
    const { outputLocale: _missingLocale, ...withoutLocale } = validAudienceResearch;
    expect(() => audienceResearchJobSchema.parse(withoutLocale)).toThrow(ZodError);
    expect(() =>
      audienceResearchJobSchema.parse({ ...validAudienceResearch, outputLocale: 'pt' }),
    ).toThrow(ZodError);
  });

  it('rejects unknown keys (strict — never carry topics, URLs, or excerpts)', () => {
    expect(() =>
      audienceResearchJobSchema.parse({ ...validAudienceResearch, seedTopics: ['leaked'] }),
    ).toThrow(ZodError);
    expect(() =>
      audienceResearchJobSchema.parse({ ...validAudienceResearch, excerpt: 'leaked' }),
    ).toThrow(ZodError);
  });

  it('parseConsumedPayload wraps a malformed payload in UnrecoverableError', () => {
    expect(() => parseConsumedPayload(audienceResearchJobSchema, { crafted: true })).toThrow(
      UnrecoverableError,
    );
  });
});

describe('brandRadarScanJobSchema', () => {
  const valid = {
    accountId: hex(1),
    siteId: hex(2),
    scanId: hex(8),
    outputLocale: 'zh',
  };

  it('accepts a strict identity plus frozen output locale', () => {
    expect(brandRadarScanJobSchema.parse(valid)).toEqual(valid);
    const { outputLocale: _missingLocale, ...withoutLocale } = valid;
    expect(() => brandRadarScanJobSchema.parse(withoutLocale)).toThrow(ZodError);
    expect(() => brandRadarScanJobSchema.parse({ ...valid, outputLocale: 'ja' })).toThrow(
      ZodError,
    );
  });
});

describe('contentInventoryJobSchema', () => {
  const validContentInventory = {
    accountId: hex(1),
    siteId: hex(2),
    runId: hex(9),
    reservationKey: 'inv_reservation-key_1',
  };

  it('accepts a valid payload — ids + url-safe reservation key only', () => {
    expect(contentInventoryJobSchema.parse(validContentInventory)).toEqual(
      validContentInventory,
    );
  });

  it('rejects non-hex ids', () => {
    expect(() =>
      contentInventoryJobSchema.parse({ ...validContentInventory, runId: 'not-hex' }),
    ).toThrow(ZodError);
  });

  it('rejects a reservation key with non-url-safe characters', () => {
    expect(() =>
      contentInventoryJobSchema.parse({
        ...validContentInventory,
        reservationKey: 'has spaces',
      }),
    ).toThrow(ZodError);
  });

  it('rejects unknown keys (strict — never carry seeds, URLs, or excerpts)', () => {
    expect(() =>
      contentInventoryJobSchema.parse({ ...validContentInventory, sitemapSeeds: ['leaked'] }),
    ).toThrow(ZodError);
  });

  it('parseConsumedPayload wraps a malformed payload in UnrecoverableError', () => {
    expect(() => parseConsumedPayload(contentInventoryJobSchema, { crafted: true })).toThrow(
      UnrecoverableError,
    );
  });
});

describe('contentMonitorJobSchema', () => {
  const validContentMonitor = {
    accountId: hex(1),
    siteId: hex(2),
    monitorId: hex(12),
    receiptId: hex(13),
  };

  it('accepts a valid payload — opaque Mongo ids only', () => {
    expect(contentMonitorJobSchema.parse(validContentMonitor)).toEqual(validContentMonitor);
  });

  it('rejects non-hex ids', () => {
    expect(() =>
      contentMonitorJobSchema.parse({ ...validContentMonitor, receiptId: 'not-hex' }),
    ).toThrow(ZodError);
  });

  it('rejects unknown keys (strict — never carry a signature, body, or excerpt)', () => {
    expect(() =>
      contentMonitorJobSchema.parse({ ...validContentMonitor, signature: 'sha256=deadbeef' }),
    ).toThrow(ZodError);
  });

  it('parseConsumedPayload wraps a malformed payload in UnrecoverableError', () => {
    expect(() => parseConsumedPayload(contentMonitorJobSchema, { crafted: true })).toThrow(
      UnrecoverableError,
    );
  });
});

describe('parsePayload (enqueue side)', () => {
  it('returns the parsed payload', () => {
    expect(parsePayload(auditJobSchema, validAudit)).toEqual(validAudit);
  });

  it('throws ZodError back at the producer', () => {
    expect(() => parsePayload(auditJobSchema, {})).toThrow(ZodError);
  });
});

describe('parseConsumedPayload (worker side)', () => {
  it('returns the parsed payload', () => {
    expect(parseConsumedPayload(rankJobSchema, validRank)).toEqual(validRank);
  });

  it('wraps validation failures in UnrecoverableError (no retries)', () => {
    expect(() => parseConsumedPayload(rankJobSchema, { crafted: true })).toThrow(
      UnrecoverableError,
    );
    expect(() => parseConsumedPayload(rankJobSchema, { crafted: true })).toThrow(
      /malformed job payload/,
    );
  });
});
