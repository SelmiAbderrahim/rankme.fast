import { describe, expect, it } from 'vitest';
import {
  REPORT_CATALOG,
  REPORT_FORMAT_EXTENSIONS,
  REPORT_FORMAT_MEDIA_TYPES,
  REPORT_GLOBAL_BOUNDS,
  REPORT_KIND_IDS,
  REPORT_MAX_SELECTION_BYTES,
  getReportCatalogDescriptor,
  reportBrandingSnapshotSchema,
  reportDocumentV1Schema,
  reportHttpUrlSchema,
  reportNativeArtifactDescriptorSchema,
  reportRenderedResultSchema,
  reportSelectionSchema,
  reportSourceDateSchema,
  reportSourceTargetSchema,
  reportTextSchema,
  type ReportDocumentV1,
  type ReportFormat,
} from './index.js';

const observedAt = '2026-08-08T10:00:00.000Z';
const sha = 'a'.repeat(64);
const EXPECTED_KIND_IDS = [
  'actions.plan',
  'ai.visibility',
  'app.keyword_tracking',
  'app.research_result',
  'audience.research_run',
  'audit.run',
  'backlinks.deep_run',
  'backlinks.disavow',
  'backlinks.gap_run',
  'backlinks.inventory',
  'backlinks.summary',
  'backlinks.toxicity_run',
  'brand.radar_scan',
  'client.composite',
  'competitors.content_run',
  'competitors.landscape_run',
  'competitors.organic',
  'competitors.tech_stack',
  'competitors.traffic_comparison',
  'competitors.traffic_snapshot',
  'content.analysis',
  'content.brief',
  'content.inventory_run',
  'content.monitor_feed',
  'content.recommendation_outcome',
  'google.ga4',
  'google.gsc_generative_appearance',
  'google.gsc_search',
  'google.gsc_sitemaps',
  'internal_links.run',
  'keyword.ai_cluster_run',
  'keyword.cannibalization',
  'keyword.research_result',
  'keyword.serp_cluster_run',
  'keyword.trends_run',
  'local.geogrid_scan',
  'local.reviews',
  'local.seo_snapshot',
  'pages.performance',
  'ranks.current',
  'ranks.history',
  'ranks.serp_features',
  'schema.generation',
  'weekly_pulse.run',
] as const;

function validDocument(): ReportDocumentV1 {
  return {
    schema: 'rankme.report',
    schemaVersion: 1,
    kind: 'audit.run',
    kindVersion: 1,
    locale: 'en',
    title: '<script>alert(1)</script> =SUM(A1:A2)',
    subject: [{ label: 'Site', value: 'example.test' }],
    selection: [{ label: 'Scope', value: 'All stored findings' }],
    sourceDates: [
      {
        id: 'crawl-date',
        label: 'Crawl date',
        kind: 'provider_observation',
        observedAt,
        sourceNoteKey: 'audit.crawl',
        freshness: 'cached',
        cachedAt: observedAt,
      },
      {
        id: 'window-date',
        label: 'Window',
        kind: 'first_party_observation',
        from: '2026-08-01T00:00:00.000Z',
        to: '2026-08-08T00:00:00.000Z',
        sourceNoteKey: 'gsc.window',
        lagDays: 3,
      },
    ],
    completeness: {
      state: 'complete',
      selectedItems: 2,
      representedItems: 2,
      bound: 'Two fixture rows',
    },
    branding: {
      mode: 'rankmefast',
      companyName: 'RankMeFast',
      accentColor: '#b5321e',
      logo: null,
    },
    blocks: [
      { type: 'heading', id: 'heading', level: 1, text: 'Audit' },
      { type: 'prose', id: 'prose', tone: 'summary', text: 'Summary\nline two 😀' },
      {
        type: 'kpi_group',
        id: 'kpis',
        items: [
          {
            id: 'score',
            label: 'Score',
            value: { type: 'number', value: 91 },
            unit: 'points',
            delta: 2,
            sourceDateId: 'crawl-date',
          },
          { id: 'known', label: 'Known', value: { type: 'boolean', value: true } },
          { id: 'missing', label: 'Missing', value: { type: 'null', value: null } },
        ],
      },
      {
        type: 'findings',
        id: 'findings',
        items: [
          {
            id: 'finding-one',
            ruleKey: 'missing-title',
            bucket: 'fix_now',
            severity: 'high',
            title: 'Add a title',
            why: 'Search engines need a title.',
            fix: 'Add one title element.',
            affectedUrls: ['https://example.test/page'],
            evidence: ['<b>not markup</b>'],
            sourceDateId: 'crawl-date',
          },
        ],
      },
      {
        type: 'key_value',
        id: 'details',
        items: [
          {
            id: 'url',
            label: 'URL',
            value: { type: 'url', value: 'https://example.test/' },
          },
          {
            id: 'date',
            label: 'Date',
            value: { type: 'date', value: observedAt },
          },
          {
            id: 'unavailable',
            label: 'Field data',
            value: { type: 'unavailable', value: null, reason: 'No observation' },
          },
          {
            id: 'text',
            label: 'Text',
            value: { type: 'string', value: '@formula stays inert' },
          },
        ],
      },
      {
        type: 'table',
        id: 'table',
        columns: [
          { key: 'name', label: 'Name', valueType: 'string' },
          { key: 'value', label: 'Value', valueType: 'number', unit: 'ms' },
        ],
        rows: [
          {
            id: 'row-one',
            cells: [
              { columnKey: 'name', value: { type: 'string', value: 'LCP' } },
              {
                columnKey: 'value',
                value: { type: 'number', value: 1_234 },
                sourceDateId: 'crawl-date',
              },
            ],
          },
        ],
      },
      {
        type: 'time_series',
        id: 'series',
        series: [
          {
            id: 'positions',
            label: 'Position',
            unit: 'rank',
            sourceDateId: 'window-date',
            points: [
              { timestamp: '2026-08-07T00:00:00.000Z', value: 4 },
              { timestamp: '2026-08-08T00:00:00.000Z', value: null },
            ],
          },
        ],
        tableFallback: {
          columns: [
            { key: 'date', label: 'Date', valueType: 'date' },
            { key: 'position', label: 'Position', valueType: 'number' },
          ],
          rows: [
            {
              cells: [
                {
                  columnKey: 'date',
                  value: { type: 'date', value: '2026-08-07T00:00:00.000Z' },
                },
                { columnKey: 'position', value: { type: 'number', value: 4 } },
              ],
            },
          ],
        },
      },
      {
        type: 'source_note',
        id: 'source-note',
        sourceDateId: 'crawl-date',
        methodology: 'Stored provider observation.',
        coverageWarning: 'The provider may not observe every page.',
      },
      {
        type: 'state',
        id: 'state',
        state: 'unavailable',
        reason: 'Field data was not available.',
        sourceDateId: 'crawl-date',
      },
      { type: 'native_artifact', id: 'artifact-block', artifactId: 'artifact' },
    ],
    artifacts: [
      {
        id: 'artifact',
        label: 'Draft',
        format: 'md',
        mediaType: 'text/markdown; charset=utf-8',
        extension: 'md',
        byteLength: 12,
        sha256: sha,
        validation: 'valid',
      },
    ],
  };
}

function cloneDocument(): ReportDocumentV1 {
  return structuredClone(validDocument());
}

describe('report-export primitive contracts', () => {
  it('accepts inert hostile text and valid surrogate pairs while rejecting controls and lone surrogates', () => {
    expect(reportTextSchema.parse('<script>\n=1+1 😀')).toContain('<script>');
    expect(reportTextSchema.safeParse('bad\u0000text').success).toBe(false);
    expect(reportTextSchema.safeParse('bad\u202etext').success).toBe(false);
    expect(reportTextSchema.safeParse('\ud800').success).toBe(false);
    expect(reportTextSchema.safeParse('\udc00').success).toBe(false);
  });

  it('allows only bounded absolute HTTP(S) URLs', () => {
    expect(reportHttpUrlSchema.parse('https://example.test/a')).toContain('https');
    expect(reportHttpUrlSchema.parse('http://example.test/a')).toContain('http');
    expect(reportHttpUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(reportHttpUrlSchema.safeParse('relative/path').success).toBe(false);
  });

  it('requires exactly one valid source instant or inclusive range', () => {
    expect(reportSourceDateSchema.safeParse(validDocument().sourceDates[0]).success).toBe(true);
    expect(reportSourceDateSchema.safeParse(validDocument().sourceDates[1]).success).toBe(true);
    expect(reportSourceDateSchema.safeParse({
      ...validDocument().sourceDates[0],
      from: '2026-08-01T00:00:00.000Z',
      to: '2026-08-08T00:00:00.000Z',
    }).success).toBe(false);
    expect(reportSourceDateSchema.safeParse({
      ...validDocument().sourceDates[0],
      observedAt: undefined,
    }).success).toBe(false);
    expect(reportSourceDateSchema.safeParse({
      ...validDocument().sourceDates[1],
      to: undefined,
    }).success).toBe(false);
    expect(reportSourceDateSchema.safeParse({
      ...validDocument().sourceDates[0],
      from: '2026-08-01T00:00:00.000Z',
    }).success).toBe(false);
    expect(reportSourceDateSchema.safeParse({
      ...validDocument().sourceDates[0],
      to: '2026-08-08T00:00:00.000Z',
    }).success).toBe(false);
    expect(reportSourceDateSchema.safeParse({
      ...validDocument().sourceDates[1],
      from: '2026-08-09T00:00:00.000Z',
      to: '2026-08-08T00:00:00.000Z',
    }).success).toBe(false);
  });

  it('validates branding and native artifact format metadata as closed allowlists', () => {
    expect(reportBrandingSnapshotSchema.parse(validDocument().branding).mode).toBe('rankmefast');
    expect(reportBrandingSnapshotSchema.safeParse({
      ...validDocument().branding,
      unexpected: 'secret',
    }).success).toBe(false);
    expect(reportNativeArtifactDescriptorSchema.parse(validDocument().artifacts[0]).format).toBe('md');
    expect(reportNativeArtifactDescriptorSchema.safeParse({
      ...validDocument().artifacts[0],
      mediaType: 'text/plain; charset=utf-8',
    }).success).toBe(false);
  });
});

describe('canonical document contract', () => {
  it('accepts every V1 block and scalar variant without executing hostile text', () => {
    const parsed = reportDocumentV1Schema.parse(validDocument());
    expect(parsed.blocks).toHaveLength(10);
    expect(parsed.title).toContain('<script>');
  });

  it('rejects incomplete metadata and duplicate source, block, or artifact ids', () => {
    const incomplete = cloneDocument();
    incomplete.completeness.representedItems = 1;
    expect(reportDocumentV1Schema.safeParse(incomplete).success).toBe(false);

    const duplicateDates = cloneDocument();
    duplicateDates.sourceDates[1]!.id = duplicateDates.sourceDates[0]!.id;
    expect(reportDocumentV1Schema.safeParse(duplicateDates).success).toBe(false);

    const duplicateBlocks = cloneDocument();
    duplicateBlocks.blocks[1]!.id = duplicateBlocks.blocks[0]!.id;
    expect(reportDocumentV1Schema.safeParse(duplicateBlocks).success).toBe(false);

    const duplicateArtifacts = cloneDocument();
    duplicateArtifacts.artifacts.push({ ...duplicateArtifacts.artifacts[0]! });
    expect(reportDocumentV1Schema.safeParse(duplicateArtifacts).success).toBe(false);
  });

  it('rejects table column drift and duplicate columns in tables and chart fallbacks', () => {
    const badTable = cloneDocument();
    const table = badTable.blocks.find((block) => block.type === 'table');
    if (!table || table.type !== 'table') throw new Error('fixture table missing');
    table.columns[1]!.key = 'name';
    table.rows[0]!.cells[1]!.columnKey = 'other';
    expect(reportDocumentV1Schema.safeParse(badTable).success).toBe(false);

    const badFallback = cloneDocument();
    const series = badFallback.blocks.find((block) => block.type === 'time_series');
    if (!series || series.type !== 'time_series') throw new Error('fixture series missing');
    series.tableFallback.rows[0]!.cells.pop();
    expect(reportDocumentV1Schema.safeParse(badFallback).success).toBe(false);
  });

  it('rejects missing source-date and artifact references', () => {
    const badSeries = cloneDocument();
    const series = badSeries.blocks.find((block) => block.type === 'time_series');
    if (!series || series.type !== 'time_series') throw new Error('fixture series missing');
    series.series[0]!.sourceDateId = 'missing';
    expect(reportDocumentV1Schema.safeParse(badSeries).success).toBe(false);

    const badNote = cloneDocument();
    const note = badNote.blocks.find((block) => block.type === 'source_note');
    if (!note || note.type !== 'source_note') throw new Error('fixture note missing');
    note.sourceDateId = 'missing';
    expect(reportDocumentV1Schema.safeParse(badNote).success).toBe(false);

    const badArtifact = cloneDocument();
    const artifact = badArtifact.blocks.find((block) => block.type === 'native_artifact');
    if (!artifact || artifact.type !== 'native_artifact') throw new Error('fixture artifact missing');
    artifact.artifactId = 'missing';
    expect(reportDocumentV1Schema.safeParse(badArtifact).success).toBe(false);
  });
});

describe('request and adapter boundaries', () => {
  it('accepts only the three closed source-target shapes', () => {
    const siteId = 'a'.repeat(24);
    expect(reportSourceTargetSchema.parse({ scope: 'site', siteId }).scope).toBe('site');
    expect(reportSourceTargetSchema.parse({
      scope: 'site_resource', siteId, resourceId: 'run:1',
    }).scope).toBe('site_resource');
    expect(reportSourceTargetSchema.parse({
      scope: 'account_resource', resourceId: 'result:1', siteId,
    }).scope).toBe('account_resource');
    expect(reportSourceTargetSchema.safeParse({ scope: 'site', siteId: 'bad' }).success).toBe(false);
  });

  it('bounds selection bytes, depth, node count, and value types', () => {
    expect(reportSelectionSchema.parse({
      strings: ['a', 'b'], nested: { enabled: true, count: 2, empty: null },
    })).toMatchObject({ nested: { enabled: true } });
    expect(reportSelectionSchema.safeParse({
      value: 'x'.repeat(REPORT_MAX_SELECTION_BYTES),
    }).success).toBe(false);
    expect(reportSelectionSchema.safeParse({
      value: [[[[[[['too-deep']]]]]]],
    }).success).toBe(false);
    expect(reportSelectionSchema.safeParse({
      values: Array.from({ length: 1_000 }, (_, index) => index),
    }).success).toBe(false);
    expect(reportSelectionSchema.safeParse({ unsupported: undefined }).success).toBe(false);
  });

  it.each(REPORT_KIND_IDS)('recognizes catalog kind %s', (kind) => {
    expect(getReportCatalogDescriptor(kind)?.kind).toBe(kind);
  });

  it('validates exact media metadata and output bounds for every rendered format', () => {
    for (const format of Object.keys(REPORT_FORMAT_MEDIA_TYPES) as ReportFormat[]) {
      const parsed = reportRenderedResultSchema.parse({
        format,
        mediaType: REPORT_FORMAT_MEDIA_TYPES[format],
        extension: REPORT_FORMAT_EXTENSIONS[format],
        bytes: new Uint8Array([1, 2, 3]),
      });
      expect(parsed.format).toBe(format);
    }
    expect(reportRenderedResultSchema.safeParse({
      format: 'json',
      mediaType: 'text/plain',
      extension: 'txt',
      bytes: new Uint8Array(),
    }).success).toBe(false);
    expect(reportRenderedResultSchema.safeParse({
      format: 'json',
      mediaType: REPORT_FORMAT_MEDIA_TYPES.json,
      extension: REPORT_FORMAT_EXTENSIONS.json,
      bytes: new Uint8Array(REPORT_GLOBAL_BOUNDS.outputBytes + 1),
    }).success).toBe(false);
  });
});

describe('catalog descriptor set', () => {
  it('contains exactly 44 unique immutable kinds with all policy fields', () => {
    expect(REPORT_CATALOG).toHaveLength(44);
    expect(new Set(REPORT_CATALOG.map((entry) => entry.kind)).size).toBe(44);
    expect([...REPORT_KIND_IDS].sort()).toEqual(EXPECTED_KIND_IDS);
    for (const entry of REPORT_CATALOG) {
      expect(entry.kindVersion).toBe(1);
      expect(entry.formats.length).toBeGreaterThan(0);
      expect(entry.bounds.canonicalBytes).toBe(REPORT_GLOBAL_BOUNDS.canonicalBytes);
      expect(entry.bounds.outputBytes).toBe(REPORT_GLOBAL_BOUNDS.outputBytes);
      expect(entry.localization.titleKey).toMatch(/^reportExports\.catalog\./u);
      expect(Object.isFrozen(entry)).toBe(true);
    }
    expect(getReportCatalogDescriptor('audit.run')?.bounds.pdfItems).toBe(
      REPORT_GLOBAL_BOUNDS.pdfItems,
    );
    expect(getReportCatalogDescriptor('backlinks.inventory')?.bounds.pdfItems).toBeNull();
    expect(getReportCatalogDescriptor('backlinks.summary')?.bounds.csvRows).toBeNull();
    expect(getReportCatalogDescriptor('not.real' as never)).toBeUndefined();
  });
});
