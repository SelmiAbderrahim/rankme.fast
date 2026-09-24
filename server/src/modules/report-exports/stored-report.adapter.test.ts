import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  reportSourceVersion,
  reportTable,
  type ReportBrandingSnapshot,
  type ReportDocumentV1,
  type ReportFormat,
  type ReportKindId,
  type ReportSourceTarget,
} from '../../shared/report-exports/index.js';
import {
  assertSiteResourceTarget,
  assertSiteTarget,
  createStoredReportAdapter,
  storedRecord,
  storedReportAdapterTestables as internals,
  type LoadedStoredReport,
  type StoredReportRecord,
} from './stored-report.adapter.js';

const accountId = 'stored-export-account';
const actorUserId = 'stored-export-user';
const siteId = '507f1f77bcf86cd799439011';
const resourceId = '507f1f77bcf86cd799439012';
const observedAt = '2026-08-10T12:00:00.000Z';
const branding: ReportBrandingSnapshot = {
  mode: 'rankmefast', companyName: 'RankMeFast', accentColor: '#b5321e', logo: null,
};
const selectionSchema = z.object({
  alpha: z.number().optional(),
  beta: z.string().optional(),
}).strict();
type Selection = z.infer<typeof selectionSchema>;

function records(): StoredReportRecord[] {
  return [
    storedRecord('observation', 'alpha', 'plain details', 'observation', {
      id: 'record-alpha', label: 'Alpha', value: 0, state: 'ready', observedAt,
    }),
    storedRecord('derived', 'beta', { safe: true }, 'derived', { value: false }),
    storedRecord('generated', 'gamma', null, 'generated'),
  ];
}

function loaded(input: Partial<LoadedStoredReport> = {}): LoadedStoredReport {
  return {
    siteLabel: 'Example Site',
    observedAt,
    sourceVersionValue: { revision: 1 },
    records: records(),
    ...input,
  };
}

function accessContext(input: {
  purpose?: 'create' | 'persist' | 'read';
  sourceVersion?: string;
  format?: ReportFormat;
} = {}) {
  return {
    accountId,
    actorUserId,
    purpose: input.purpose ?? 'create',
    target: { scope: 'site_resource' as const, siteId, resourceId },
    format: input.format ?? 'json',
    locale: 'en' as const,
    ...(input.sourceVersion === undefined ? {} : { sourceVersion: input.sourceVersion }),
  };
}

function composeContext(input: {
  format?: ReportFormat;
  selection?: Selection;
} = {}) {
  const { purpose: _purpose, ...access } = accessContext({ format: input.format });
  return {
    ...access,
    selection: input.selection ?? {},
    branding,
  };
}

function makeAdapter(input: {
  kind?: ReportKindId;
  localizationStem?: string;
  formats?: readonly ReportFormat[];
  report?: LoadedStoredReport;
} = {}) {
  const access = vi.fn().mockResolvedValue({ revision: 1 });
  const load = vi.fn().mockResolvedValue(input.report ?? loaded());
  const adapter = createStoredReportAdapter<Selection>({
    kind: input.kind ?? 'content.brief',
    localizationStem: input.localizationStem ?? 'contentBrief',
    formats: input.formats ?? ['pdf', 'json', 'md'],
    selectionSchema,
    access,
    load,
  });
  return { access, adapter, load };
}

describe('stored report canonicalization helpers', () => {
  it('canonicalizes source ids, bounded values, sorted selections, and every record value shape', () => {
    expect(internals.sourceDateId('observation')).toBe('stored-observation');
    expect(internals.sourceDateId('derived')).toBe('stored-derived');
    expect(internals.sourceDateId('generated')).toBe('stored-generated');
    expect(internals.boundedValue('short')).toBe('short');
    expect(internals.boundedValue({ z: 1, a: true })).toBe('{"a":true,"z":1}\n');
    const long = 'é'.repeat(901);
    expect(internals.boundedValue(long)).toMatch(/^selection:[a-f0-9]+ \(1802 bytes\)$/u);

    const selection = internals.selectionItems('en', { beta: 'second', alpha: 1 });
    expect(selection.map((item) => item.value)).toEqual(['{"alpha":1}\n', '{"beta":"second"}\n']);
    expect(selection[0]?.label).toContain('1');
    expect(internals.selectionItems('en', {})).toEqual([]);

    const rows = internals.recordRows(records());
    expect(rows).toEqual([
      expect.objectContaining({
        id: 'stored-row-1',
        values: ['observation', 'alpha', 'Alpha', 0, 'plain details', 'ready', observedAt, 'observation'],
        sourceDateId: 'stored-observation',
      }),
      expect.objectContaining({
        values: ['derived', 'beta', null, false, '{"safe":true}\n', null, null, 'derived'],
      }),
      expect.objectContaining({
        values: ['generated', 'gamma', null, null, '', null, null, 'generated'],
      }),
    ]);
    expect(internals.table('en', records())).toMatchObject({
      type: 'table', id: 'stored-records', rows: expect.any(Array),
    });
  });

  it('builds safe Markdown and JSON-LD native artifacts with deterministic integrity metadata', () => {
    const markdown = internals.nativeBlocks('en', {
      format: 'md', label: 'brief.md', value: '# Safe brief\n',
    });
    expect(markdown.artifacts[0]).toEqual(expect.objectContaining({
      format: 'md', extension: 'md', byteLength: 13,
      sha256: createHash('sha256').update('# Safe brief\n').digest('hex'),
      validation: 'valid',
    }));
    expect(markdown.blocks.map((block) => block.type)).toEqual(['table', 'native_artifact']);

    const jsonLd = internals.nativeText({
      format: 'jsonld',
      label: 'schema.jsonld',
      value: { '@context': 'https://schema.org', '@type': 'Article', name: '</script>' },
    });
    expect(jsonLd).toContain('\\u003c/script\\u003e');
    expect(() => internals.nativeText({
      format: 'md', label: 'bad.md', value: { markdown: false },
    })).toThrow('markdown artifact must be text');
    expect(() => internals.nativeText({
      format: 'jsonld', label: 'bad.jsonld', value: 'not an object',
    })).toThrow('JSON-LD artifact must be an object');
  });

  it('requires a registered descriptor and enforces selected, PDF, CSV, null, and unbounded limits', () => {
    const brief = internals.requireStoredReportDescriptor('content.brief');
    const inventory = internals.requireStoredReportDescriptor('backlinks.inventory');
    expect(brief.kind).toBe('content.brief');
    expect(() => internals.requireStoredReportDescriptor('missing.kind')).toThrow('missing report descriptor');

    expect(() => internals.assertStoredReportBounds(brief, 'pdf', 1_001, 1)).toThrow();
    expect(() => internals.assertStoredReportBounds(brief, 'pdf', 1_000, 1_001)).toThrow();
    expect(() => internals.assertStoredReportBounds(brief, 'pdf', 1_000, 1_000)).not.toThrow();
    expect(() => internals.assertStoredReportBounds(inventory, 'pdf', 999_999, 1)).not.toThrow();
    expect(() => internals.assertStoredReportBounds(inventory, 'csv', 1, 100_001)).toThrow();
    expect(() => internals.assertStoredReportBounds(brief, 'json', 1, 100_001)).not.toThrow();
  });
});

describe('stored report adapter access and composition', () => {
  it('preserves adapter metadata and rejects only changed persisted source versions', async () => {
    const { access, adapter } = makeAdapter();
    expect(adapter).toMatchObject({
      kind: 'content.brief', kindVersion: 1,
      supportedFormats: ['pdf', 'json', 'md'], selectionSchema,
    });
    await expect(adapter.assertAccess(accessContext())).resolves.toBeUndefined();
    await expect(adapter.assertAccess(accessContext({ purpose: 'read', sourceVersion: 'stale' })))
      .resolves.toBeUndefined();
    await expect(adapter.assertAccess(accessContext({ purpose: 'persist' }))).resolves.toBeUndefined();
    const current = reportSourceVersion('content.brief', { revision: 1 });
    await expect(adapter.assertAccess(accessContext({ purpose: 'persist', sourceVersion: current })))
      .resolves.toBeUndefined();
    await expect(adapter.assertAccess(accessContext({ purpose: 'persist', sourceVersion: 'stale' })))
      .rejects.toMatchObject({ status: 409, message: 'reportExports.errors.sourceChanged' });
    expect(access).toHaveBeenCalledTimes(5);
  });

  it('composes canonical records, optional subjects, explicit counts, and all provenance notes', async () => {
    const { adapter, load } = makeAdapter({
      report: loaded({ selectedItems: 2, subject: [{ label: 'Run', value: resourceId }] }),
    });
    const result = await adapter.compose(composeContext({
      selection: { beta: 'second', alpha: 1 },
    }));
    expect(result.sourceVersion).toBe(reportSourceVersion('content.brief', { revision: 1 }));
    expect(result.document).toMatchObject({
      kind: 'content.brief',
      locale: 'en',
      subject: [
        { label: expect.any(String), value: 'Example Site' },
        { label: 'Run', value: resourceId },
      ],
      completeness: { state: 'complete', selectedItems: 2, representedItems: 2 },
      branding,
      artifacts: [],
    });
    expect(result.document.selection.map((item) => item.value)).toEqual([
      '{"alpha":1}\n', '{"beta":"second"}\n',
    ]);
    expect(result.document.sourceDates.map((item) => item.kind)).toEqual([
      'provider_observation', 'derived', 'generated',
    ]);
    expect(result.document.blocks.map((block) => block.id)).toEqual([
      'stored-records',
      'stored-observation-note',
      'stored-derived-note',
      'stored-generated-note',
    ]);
    expect(load).toHaveBeenCalledWith(expect.objectContaining({ selection: { beta: 'second', alpha: 1 } }));

    const implicit = makeAdapter().adapter;
    const implicitResult = await implicit.compose(composeContext());
    expect(implicitResult.document.completeness.selectedItems).toBe(3);
    expect(implicitResult.document.subject).toHaveLength(1);
  });

  it('rejects every oversized representation and native format without its immutable artifact', async () => {
    const oversized = makeAdapter({ report: loaded({ selectedItems: 1_001 }) }).adapter;
    await expect(oversized.compose(composeContext({ format: 'pdf' })))
      .rejects.toMatchObject({ status: 400, message: 'reportExports.errors.selectionTooLarge' });

    const noArtifact = makeAdapter().adapter;
    await expect(noArtifact.compose(composeContext({ format: 'md' })))
      .rejects.toMatchObject({ status: 409, message: 'reportExports.errors.invalidArtifact' });
    await expect(noArtifact.compose(composeContext({ format: 'jsonld' })))
      .rejects.toMatchObject({ status: 409, message: 'reportExports.errors.invalidArtifact' });
  });
});

describe('stored report rendering', () => {
  it('renders PDF, CSV, JSON, and Markdown from one canonical snapshot', async () => {
    const standardAdapter = makeAdapter().adapter;
    const standard = await standardAdapter.compose(composeContext());
    for (const format of ['pdf', 'csv', 'json'] as const) {
      const rendered = await standardAdapter.render({
        document: standard.document, format, snapshotCreatedAt: observedAt,
      });
      expect(rendered).toMatchObject({ format, bytes: expect.any(Uint8Array) });
      expect(rendered.bytes.byteLength).toBeGreaterThan(0);
    }

    const markdownAdapter = makeAdapter({
      report: loaded({
        artifact: { format: 'md', label: 'brief.md', value: '# Immutable brief\n' },
      }),
    }).adapter;
    const result = await markdownAdapter.compose(composeContext({ format: 'md' }));
    const rendered = await markdownAdapter.render({
      document: result.document, format: 'md', snapshotCreatedAt: observedAt,
    });
    expect(rendered).toMatchObject({ format: 'md', bytes: expect.any(Uint8Array) });
    const native = await internals.renderNative(result.document, 'md');
    expect(Buffer.from(native.bytes).toString('utf8')).toBe('# Immutable brief\n');
  });

  it('renders safe JSON-LD and rejects unsupported, missing, empty, and non-text canonical sources', async () => {
    const jsonLdAdapter = makeAdapter({
      kind: 'schema.generation',
      localizationStem: 'schemaGeneration',
      formats: ['json', 'jsonld'],
      report: loaded({
        artifact: {
          format: 'jsonld', label: 'schema.jsonld',
          value: { '@context': 'https://schema.org', '@type': 'Article', name: '<safe>' },
        },
      }),
    }).adapter;
    const result = await jsonLdAdapter.compose(composeContext({ format: 'jsonld' }));
    const rendered = await jsonLdAdapter.render({
      document: result.document, format: 'jsonld', snapshotCreatedAt: observedAt,
    });
    expect(Buffer.from(rendered.bytes).toString('utf8')).toContain('\\u003csafe\\u003e');
    expect(() => internals.renderNative(result.document, 'pdf')).toThrow('unsupported native format');

    const withoutSource: ReportDocumentV1 = {
      ...result.document,
      blocks: result.document.blocks.filter((block) => block.id !== 'native-artifact-source'),
    };
    expect(() => internals.renderNative(withoutSource, 'jsonld')).toThrow('canonical native artifact is missing');

    const emptySource: ReportDocumentV1 = {
      ...result.document,
      blocks: [reportTable({
        id: 'native-artifact-source',
        columns: [{ key: 'content', label: 'Content', valueType: 'string' }],
        rows: [],
      })],
    };
    expect(() => internals.renderNative(emptySource, 'jsonld')).toThrow('canonical native artifact is missing');

    const numericSource: ReportDocumentV1 = {
      ...result.document,
      blocks: [reportTable({
        id: 'native-artifact-source',
        columns: [{ key: 'content', label: 'Content', valueType: 'number' }],
        rows: [{ id: 'numeric', values: [7], sourceDateId: 'stored-generated' }],
      })],
    };
    expect(() => internals.renderNative(numericSource, 'jsonld')).toThrow('canonical native artifact is missing');
  });
});

describe('stored report target and record contracts', () => {
  it('builds stable record ids and accepts only the requested site target scope', () => {
    expect(storedRecord('kind', 'key', 'details', 'derived')).toMatchObject({
      id: 'kind:key', recordType: 'kind', key: 'key', details: 'details', provenance: 'derived',
    });
    expect(storedRecord('kind', 'key', 'details', 'derived', { id: 'explicit', label: 'Label' }))
      .toMatchObject({ id: 'explicit', label: 'Label' });

    const siteResource: ReportSourceTarget = { scope: 'site_resource', siteId, resourceId };
    const site: ReportSourceTarget = { scope: 'site', siteId };
    const accountResource: ReportSourceTarget = { scope: 'account_resource', resourceId };
    expect(() => assertSiteResourceTarget(siteResource)).not.toThrow();
    expect(() => assertSiteTarget(site)).not.toThrow();
    expect(() => assertSiteResourceTarget(site)).toThrow('reportExports.errors.notFound');
    expect(() => assertSiteResourceTarget(accountResource, 'errors.projectNotFound')).toThrow('errors.projectNotFound');
    expect(() => assertSiteTarget(siteResource)).toThrow('reportExports.errors.notFound');
    expect(() => assertSiteTarget(accountResource, 'errors.userNotFound')).toThrow('errors.userNotFound');
  });
});
