import type {
  BrandRadarMentionRow,
  BrandRadarPreview,
  BrandRadarScanDetail,
  BrandRadarScanSummary,
  BrandRadarStatus,
} from '../types';

export const scanFixture = (
  overrides: Partial<BrandRadarScanSummary> = {},
): BrandRadarScanSummary => ({
  id: '65f000000000000000000001',
  siteId: '65e000000000000000000001',
  brandQuery: 'RankMeFast',
  language: null,
  countryCode: null,
  locationCode: null,
  status: 'completed',
  digestState: 'digest_present',
  queryHash: 'a'.repeat(64),
  priorScanId: null,
  retainedRowCount: 42,
  refund: { state: 'none', unit: 1 },
  createdAt: '2026-07-20T10:00:00.000Z',
  updatedAt: '2026-07-20T10:05:00.000Z',
  terminalAt: '2026-07-20T10:05:00.000Z',
  ...overrides,
  outputLocale: overrides.outputLocale === undefined ? 'en' : overrides.outputLocale,
});

export const statusScanFixtures = (
  statuses: readonly BrandRadarStatus[],
): BrandRadarScanSummary[] =>
  statuses.map((status, index) =>
    scanFixture({
      id: `65f00000000000000000000${index + 1}`,
      status,
      brandQuery: `query-${status}`,
    }),
  );

export const scanDetailFixture = (
  overrides: Partial<BrandRadarScanDetail> = {},
): BrandRadarScanDetail => ({
  ...scanFixture(),
  mentionCount: 42,
  sentimentDistribution: { positive: 50, neutral: 30, negative: 15, unknown: 5 },
  topDomains: [
    { domain: 'news.example', count: 12 },
    { domain: 'blog.example', count: 7 },
  ],
  trend: { delta: 6, direction: 'up' },
  digestSentences: [
    { text: 'Coverage grew on independent blogs.', citedRowIds: ['mention-1'] },
  ],
  halt: null,
  ...overrides,
});

export const mentionFixture = (
  overrides: Partial<BrandRadarMentionRow> = {},
): BrandRadarMentionRow => ({
  id: 'mention-1',
  url: 'https://news.example/story',
  domain: 'news.example',
  title: 'RankMeFast ships brand radar',
  snippet: 'A short excerpt about the brand.',
  polarity: 'positive',
  confidence: 0.8,
  language: 'en',
  observedAt: '2026-07-19T08:00:00.000Z',
  ...overrides,
});

export const previewFixture = (
  overrides: Partial<BrandRadarPreview> = {},
): BrandRadarPreview => ({
  feature: 'brand_radar',
  operation: 'brand-scan',
  estimatedAt: '2026-07-26T09:00:00.000Z',
  ...overrides,
});
