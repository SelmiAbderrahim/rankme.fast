import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import {
  REPORT_DOCUMENT_SCHEMA,
  REPORT_DOCUMENT_SCHEMA_VERSION,
  REPORT_FORMAT_EXTENSIONS,
  REPORT_FORMAT_MEDIA_TYPES,
  reportShortTextSchema,
  type ReportBrandingSnapshot,
  type ReportDocumentV1,
  type ReportFormat,
  type ReportLocale,
  type ReportSelection,
} from '../../shared/report-exports/index.js';
import { HttpError } from '../../shared/utils/http-error.js';
import {
  ReportExportAdapterRegistry,
  createReportExportAdapterRegistry,
} from './report-exports.registry.js';
import type {
  ReportExportAccessContext,
  ReportExportAdapter,
  ReportExportComposeContext,
  ReportExportRenderContext,
} from './report-exports.types.js';
import {
  defineReportExportAdapterContract,
  type ReportExportAdapterContractFixture,
} from './testing/adapter-contract.js';

const ACCOUNT_ID = '64b64c1e5f2a4a0012e7f001';
const FOREIGN_ACCOUNT_ID = '64b64c1e5f2a4a0012e7f002';
const SITE_ID = '64b64c1e5f2a4a0012e7f003';
const RESOURCE_ID = 'stored-audit-1';
const SOURCE_VERSION = 'audit-version-1';

const selectionSchema = z
  .object({
    title: reportShortTextSchema.default('Stored audit'),
    rows: z.number().int().min(0).max(200).default(2),
    refuseIncomplete: z.boolean().default(false),
  })
  .strict();

type TestSelection = z.infer<typeof selectionSchema>;

const branding: ReportBrandingSnapshot = {
  mode: 'rankmefast',
  companyName: 'RankMeFast',
  accentColor: '#b5321e',
  logo: null,
};

function documentFor(
  context: Omit<ReportExportComposeContext, 'selection'> & {
    selection: TestSelection;
  },
): ReportDocumentV1 {
  const rows = Array.from({ length: context.selection.rows }, (_, index) => ({
    id: `row-${index + 1}`,
    cells: [
      {
        columnKey: 'finding',
        value: { type: 'string' as const, value: `Stored finding ${index + 1}` },
        sourceDateId: 'observed',
      },
    ],
  }));
  return {
    schema: REPORT_DOCUMENT_SCHEMA,
    schemaVersion: REPORT_DOCUMENT_SCHEMA_VERSION,
    kind: 'audit.run',
    kindVersion: 1,
    locale: context.locale,
    title: context.selection.title,
    subject: [{ label: 'Report', value: 'Stored audit result' }],
    selection: [{ label: 'Rows', value: String(context.selection.rows) }],
    sourceDates: [
      {
        id: 'observed',
        label: 'Audit observation',
        kind: 'provider_observation',
        observedAt: '2026-08-08T12:00:00.000Z',
        sourceNoteKey: 'source.audit',
        freshness: 'cached',
      },
    ],
    completeness: {
      state: 'complete',
      selectedItems: rows.length,
      representedItems: rows.length,
      bound: 'All selected stored findings',
    },
    branding: context.branding,
    blocks: [
      {
        type: 'table',
        id: 'findings-table',
        columns: [
          { key: 'finding', label: 'Finding', valueType: 'string' },
        ],
        rows,
      },
    ],
    artifacts: [],
  };
}

class DeterministicAuditTestAdapter
  implements ReportExportAdapter<TestSelection>
{
  readonly kind = 'audit.run' as const;
  readonly kindVersion = 1;
  readonly supportedFormats = ['pdf', 'csv', 'json'] as const;
  readonly selectionSchema = selectionSchema;

  async assertAccess(context: ReportExportAccessContext): Promise<void> {
    if (
      context.accountId !== ACCOUNT_ID ||
      context.target.scope !== 'site_resource' ||
      context.target.siteId !== SITE_ID ||
      context.target.resourceId !== RESOURCE_ID
    ) {
      throw HttpError.notFound({ code: 'AUDITS_ERRORS_NOT_FOUND', messageKey: 'audits.errors.notFound' });
    }
    if (
      context.purpose === 'persist' &&
      context.sourceVersion &&
      context.sourceVersion !== SOURCE_VERSION
    ) {
      throw HttpError.conflict({ code: 'REPORT_EXPORTS_ERRORS_SOURCE_CHANGED', messageKey: 'reportExports.errors.sourceChanged' });
    }
  }

  async compose(
    context: Omit<ReportExportComposeContext, 'selection'> & {
      selection: TestSelection;
    },
  ) {
    if (context.selection.refuseIncomplete) {
      throw new HttpError(422, { code: 'REPORT_EXPORTS_ERRORS_INCOMPLETE', messageKey: 'reportExports.errors.incomplete' });
    }
    return { document: documentFor(context), sourceVersion: SOURCE_VERSION };
  }

  async render(context: ReportExportRenderContext) {
    const payload: Record<ReportFormat, string> = {
      pdf: `%PDF-test\n${context.snapshotCreatedAt}\n${context.document.title}\n`,
      csv: `\uFEFFtitle\r\n"${context.document.title.replaceAll('"', '""')}"\r\n`,
      json: `${JSON.stringify(context.document)}\n`,
      md: '',
      jsonld: '',
      txt: '',
    };
    return {
      format: context.format,
      mediaType: REPORT_FORMAT_MEDIA_TYPES[context.format],
      extension: REPORT_FORMAT_EXTENSIONS[context.format],
      bytes: Buffer.from(payload[context.format], 'utf8'),
    };
  }
}

function composeContext(locale: ReportLocale): ReportExportComposeContext {
  return {
    accountId: ACCOUNT_ID,
    actorUserId: ACCOUNT_ID,
    target: {
      scope: 'site_resource',
      siteId: SITE_ID,
      resourceId: RESOURCE_ID,
    },
    format: 'json',
    locale,
    selection: selectionSchema.parse({}),
    branding,
  };
}

function fixture(): ReportExportAdapterContractFixture {
  const adapter = new DeterministicAuditTestAdapter();
  const allowedAccess: ReportExportAccessContext = {
    ...composeContext('en'),
    purpose: 'create',
  };
  return {
    adapter: adapter as ReportExportAdapter<ReportSelection>,
    allowedAccess,
    foreignAccess: { ...allowedAccess, accountId: FOREIGN_ACCOUNT_ID },
    branding,
    selection: selectionSchema.parse({}),
    composeContext,
    refuseIncomplete: async () => {
      await adapter.compose({
        ...composeContext('en'),
        selection: selectionSchema.parse({ refuseIncomplete: true }),
      });
    },
    spendCounters: () => ({ provider: 0, queue: 0 }),
  };
}

defineReportExportAdapterContract('deterministic audit fixture', fixture);

describe('ReportExportAdapterRegistry rejection contracts', () => {
  it('keeps the production registry empty', () => {
    expect(createReportExportAdapterRegistry().listAvailableKinds()).toEqual([]);
  });

  it('rejects unknown kinds, version drift, format omissions, and format order drift', () => {
    const base = new DeterministicAuditTestAdapter();
    const changed = (
      overrides: Partial<ReportExportAdapter>,
    ): ReportExportAdapter => Object.assign(
      new DeterministicAuditTestAdapter(),
      overrides,
    ) as ReportExportAdapter;
    const attempt = (adapter: ReportExportAdapter) => {
      const registry = new ReportExportAdapterRegistry();
      registry.register(adapter);
    };
    expect(() =>
      attempt(changed({ kind: 'not.real' as 'audit.run' })),
    ).toThrow(/unknown/u);
    expect(() => attempt(changed({ kindVersion: 2 }))).toThrow(/version/u);
    expect(() =>
      attempt(changed({ supportedFormats: ['pdf', 'csv'] })),
    ).toThrow(/format/u);
    expect(() =>
      attempt(changed({ supportedFormats: ['json', 'csv', 'pdf'] })),
    ).toThrow(/format/u);
    expect(base.kind).toBe('audit.run');
  });

  it('returns registered adapters by kind', () => {
    const adapter = new DeterministicAuditTestAdapter();
    const registry = new ReportExportAdapterRegistry();
    expect(registry.has('audit.run')).toBe(false);
    expect(registry.get('audit.run')).toBeUndefined();
    registry.register(adapter);
    expect(registry.has('audit.run')).toBe(true);
    expect(registry.get('audit.run')).toBe(adapter);
  });
});
