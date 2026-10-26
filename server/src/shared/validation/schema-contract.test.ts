import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { memberIdParamsSchema } from '../../modules/team/team.schema.js';
import { geogridScanIdParamSchema } from '../../modules/geogrid/geogrid.schema.js';
import { pulseIdParamsSchema } from '../../modules/weekly-pulse/weekly-pulse.schema.js';
import { generateReportBodySchema } from '../../modules/cannibalization/cannibalization.schema.js';
import { internalLinkStartBodySchema } from '../../modules/internal-links/internal-links.schemas.js';
import { keywordClusterStartBodySchema } from '../../modules/keyword-clusters/keyword-clusters.schemas.js';
import { landscapeCoverageSchema } from '../../modules/competitors/landscape/landscape.schemas.js';

describe('request schema defaults and bounds', () => {
  it('rejects oversized collections before evaluating their elements', () => {
    const oversized = ['first', 'second', 'third'];
    Object.defineProperty(oversized, '0', { get: () => { throw new Error('element validation must be bounded'); } });
    const parsed = z.array(z.string()).max(2).safeParse(oversized);
    expect(parsed.success).toBe(false);
    if (parsed.success) throw new Error('expected collection bound failure');
    expect(parsed.error.issues).toMatchObject([{ code: 'too_big', maximum: 2 }]);
  });

  it('keeps accepted hex identifiers without requiring an RFC UUID version', () => {
    const id = '11111111-1111-1111-1111-111111111111';
    expect(memberIdParamsSchema.parse({ id })).toEqual({ id });
    expect(geogridScanIdParamSchema.parse({ siteId: 'site', scanId: id })).toEqual({ siteId: 'site', scanId: id });
    expect(pulseIdParamsSchema.parse({ siteId: 'a'.repeat(24), pulseId: id }).pulseId).toBe(id);
    for (const invalid of ['11111111-1111-1111-1111-11111111111x', id + '0', 'invalid']) {
      expect(memberIdParamsSchema.safeParse({ id: invalid }).success).toBe(false);
    }
  });

  it('parses nested defaults for absent request bodies', () => {
    expect(generateReportBodySchema.parse(undefined)).toEqual({ windowDays: 28 });
    expect(internalLinkStartBodySchema.parse(undefined)).toEqual({ locale: 'en' });
    expect(keywordClusterStartBodySchema.parse(undefined)).toEqual({ locale: 'en' });
    expect(generateReportBodySchema.safeParse({ windowDays: 29 }).success).toBe(false);
    expect(internalLinkStartBodySchema.safeParse({ locale: 'unknown' }).success).toBe(false);
    expect(keywordClusterStartBodySchema.safeParse({ keywordIds: ['invalid'] }).success).toBe(false);
  });

  it('accepts sparse row counts while enforcing enum keys and actual bounds', () => {
    const coverage = {
      requestedCompetitors: 1, usableCompetitors: 1, requestedLegs: 3,
      succeededLegs: 3, failedLegs: 0, truncatedLegs: 0, unclassifiedSharedRows: 0,
      rowsByClass: { shared_behind: 1 },
    };
    expect(landscapeCoverageSchema.parse(coverage)).toEqual(coverage);
    expect(landscapeCoverageSchema.safeParse({ ...coverage, rowsByClass: { unknown: 1 } }).success).toBe(false);
    expect(landscapeCoverageSchema.safeParse({ ...coverage, rowsByClass: { shared_behind: -1 } }).success).toBe(false);
    expect(landscapeCoverageSchema.safeParse({ ...coverage, rowsByClass: { shared_behind: Number.MAX_SAFE_INTEGER } }).success).toBe(false);
  });
});
