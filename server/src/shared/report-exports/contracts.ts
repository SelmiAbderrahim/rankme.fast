import { z } from 'zod';
import { REPORT_FORMATS, REPORT_GLOBAL_BOUNDS, REPORT_KIND_IDS, REPORT_SOURCE_TARGET_SCOPES, type ReportFormat, type ReportKindId, } from './catalog.js';
import { JSON_LD_MEDIA_TYPE } from '../security/json-ld.js';
export const REPORT_DOCUMENT_SCHEMA = 'rankme.report' as const;
export const REPORT_DOCUMENT_SCHEMA_VERSION = 1 as const;
export const REPORT_SNAPSHOT_TTL_DAYS = 90;
export const REPORT_MAX_SELECTION_BYTES = 64 * 1024;
export const REPORT_MAX_SELECTION_DEPTH = 6;
export const REPORT_MAX_SELECTION_NODES = 1000;
export const REPORT_MAX_AFFECTED_URLS_PER_FINDING = 10000;
const REPORT_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u;
const REPORT_SOURCE_REF_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:@/-]{0,255}$/u;
const SITE_ID_PATTERN = /^[a-fA-F0-9]{24}$/u;
const UNSAFE_TEXT_CODE_POINTS = new Set([
    ...Array.from({ length: 9 }, (_, index) => index),
    11,
    12,
    ...Array.from({ length: 18 }, (_, index) => index + 14),
    127,
    0x061c,
    0x200e,
    0x200f,
    ...Array.from({ length: 5 }, (_, index) => index + 0x202a),
    ...Array.from({ length: 4 }, (_, index) => index + 0x2066),
]);
function hasUnpairedSurrogate(value: string): boolean {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (code >= 0xd800 && code <= 0xdbff) {
            const next = value.charCodeAt(index + 1);
            if (!(next >= 0xdc00 && next <= 0xdfff))
                return true;
            index += 1;
        }
        else if (code >= 0xdc00 && code <= 0xdfff) {
            return true;
        }
    }
    return false;
}
function isSafeReportText(value: string): boolean {
    if (hasUnpairedSurrogate(value))
        return false;
    for (let index = 0; index < value.length; index += 1) {
        if (UNSAFE_TEXT_CODE_POINTS.has(value.charCodeAt(index)))
            return false;
    }
    return true;
}
export const reportTextSchema = z
    .string()
    .max(100000)
    .refine(isSafeReportText, 'reportExports.errors.invalidText');
export const reportShortTextSchema = z
    .string()
    .max(1000)
    .refine(isSafeReportText, 'reportExports.errors.invalidText');
export const reportLabelSchema = z
    .string()
    .min(1)
    .max(300)
    .refine(isSafeReportText, 'reportExports.errors.invalidText');
export const reportStableIdSchema = z.string().regex(REPORT_ID_PATTERN);
export const reportSourceReferenceSchema = z.string().regex(REPORT_SOURCE_REF_PATTERN);
export const reportKindIdSchema = z.enum(REPORT_KIND_IDS as [
    ReportKindId,
    ...ReportKindId[]
]);
export const reportFormatSchema = z.enum(REPORT_FORMATS);
export const reportSourceTargetScopeSchema = z.enum(REPORT_SOURCE_TARGET_SCOPES);
export const reportLocaleSchema = z.enum(['en', 'ar', 'fr', 'de', 'es', 'ru', 'zh']);
export const REPORT_LOCALES = reportLocaleSchema.options;
export const reportIsoDateTimeSchema = z.string().datetime({ offset: true });
export const reportSiteIdSchema = z.string().regex(SITE_ID_PATTERN);
export const reportHttpUrlSchema = z
    .string()
    .max(2048)
    .url()
    .refine((value) => {
    if (!URL.canParse(value))
        return false;
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
}, 'reportExports.errors.invalidUrl');
const reportSourceDateBaseSchema = z
    .object({
    id: reportStableIdSchema,
    label: reportLabelSchema,
    kind: z.enum([
        'provider_observation',
        'first_party_observation',
        'derived',
        'estimate',
        'generated',
    ]),
    observedAt: reportIsoDateTimeSchema.optional(),
    from: reportIsoDateTimeSchema.optional(),
    to: reportIsoDateTimeSchema.optional(),
    sourceNoteKey: reportStableIdSchema,
    lagDays: z.number().int().min(0).max(3650).optional(),
    freshness: z.enum(['fresh', 'cached', 'stale', 'unknown']).optional(),
    cachedAt: reportIsoDateTimeSchema.optional(),
})
    .strict();
export const reportSourceDateSchema = reportSourceDateBaseSchema.superRefine((value, context) => {
    const hasObservedAt = value.observedAt !== undefined;
    const hasFrom = value.from !== undefined;
    const hasTo = value.to !== undefined;
    if (hasObservedAt === (hasFrom && hasTo)) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'reportExports.errors.invalidSourceDate',
        });
        return;
    }
    if (hasFrom !== hasTo) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'reportExports.errors.invalidSourceDate',
        });
        return;
    }
    if (value.from && value.to && Date.parse(value.from) > Date.parse(value.to)) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'reportExports.errors.invalidSourceDate',
        });
    }
});
const reportLogoSnapshotSchema = z
    .object({
    mediaType: z.literal('image/png'),
    bytesBase64: z.string().min(4).max(700000),
    width: z.number().int().min(1).max(512),
    height: z.number().int().min(1).max(512),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
})
    .strict();
export const reportBrandingSnapshotSchema = z
    .object({
    mode: z.enum(['rankmefast', 'white_label']),
    companyName: reportLabelSchema,
    accentColor: z.string().regex(/^#[a-f0-9]{6}$/u),
    logo: reportLogoSnapshotSchema.nullable(),
})
    .strict();
export const REPORT_NATIVE_MEDIA_TYPES = Object.freeze({
    md: 'text/markdown; charset=utf-8',
    jsonld: `${JSON_LD_MEDIA_TYPE}; charset=utf-8`,
    txt: 'text/plain; charset=utf-8',
});
export const REPORT_FORMAT_MEDIA_TYPES: Readonly<Record<ReportFormat, string>> = Object.freeze({
    pdf: 'application/pdf',
    csv: 'text/csv; charset=utf-8',
    json: 'application/json; charset=utf-8',
    ...REPORT_NATIVE_MEDIA_TYPES,
});
export const REPORT_FORMAT_EXTENSIONS: Readonly<Record<ReportFormat, string>> = Object.freeze({
    pdf: 'pdf',
    csv: 'csv',
    json: 'json',
    md: 'md',
    jsonld: 'jsonld',
    txt: 'txt',
});
export const reportNativeArtifactDescriptorSchema = z
    .object({
    id: reportStableIdSchema,
    label: reportLabelSchema,
    format: z.enum(['md', 'jsonld', 'txt']),
    mediaType: z.enum([
        'text/markdown; charset=utf-8',
        REPORT_NATIVE_MEDIA_TYPES.jsonld,
        'text/plain; charset=utf-8',
    ]),
    extension: z.enum(['md', 'jsonld', 'txt']),
    byteLength: z.number().int().min(0).max(REPORT_GLOBAL_BOUNDS.outputBytes),
    sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    validation: z.literal('valid'),
})
    .strict()
    .superRefine((value, context) => {
    if (value.mediaType !== REPORT_NATIVE_MEDIA_TYPES[value.format] ||
        value.extension !== REPORT_FORMAT_EXTENSIONS[value.format]) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'reportExports.errors.invalidArtifact',
        });
    }
});
export const reportScalarValueSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('string'), value: reportTextSchema }).strict(),
    z.object({ type: z.literal('number'), value: z.number().finite() }).strict(),
    z.object({ type: z.literal('date'), value: reportIsoDateTimeSchema }).strict(),
    z.object({ type: z.literal('url'), value: reportHttpUrlSchema }).strict(),
    z.object({ type: z.literal('boolean'), value: z.boolean() }).strict(),
    z.object({ type: z.literal('null'), value: z.null() }).strict(),
    z
        .object({
        type: z.literal('unavailable'),
        value: z.null(),
        reason: reportShortTextSchema,
    })
        .strict(),
]);
const reportSubjectValueSchema = z
    .object({ label: reportLabelSchema, value: reportShortTextSchema })
    .strict();
const headingBlockSchema = z
    .object({
    type: z.literal('heading'),
    id: reportStableIdSchema,
    level: z.number().int().min(1).max(6),
    text: reportLabelSchema,
})
    .strict();
const proseBlockSchema = z
    .object({
    type: z.literal('prose'),
    id: reportStableIdSchema,
    tone: z.enum(['body', 'summary', 'warning', 'method']),
    text: reportTextSchema,
})
    .strict();
const kpiBlockSchema = z
    .object({
    type: z.literal('kpi_group'),
    id: reportStableIdSchema,
    items: z
        .array(z
        .object({
        id: reportStableIdSchema,
        label: reportLabelSchema,
        value: reportScalarValueSchema,
        unit: reportShortTextSchema.optional(),
        delta: z.number().finite().optional(),
        sourceDateId: reportStableIdSchema.optional(),
    })
        .strict())
        .min(1)
        .max(1000),
})
    .strict();
const findingSchema = z
    .object({
    id: reportStableIdSchema,
    ruleKey: reportStableIdSchema,
    bucket: z.enum(['fix_now', 'watch', 'passed', 'advisory']),
    severity: z.enum(['critical', 'high', 'medium', 'low', 'info']),
    title: reportLabelSchema,
    why: reportTextSchema,
    fix: reportTextSchema.optional(),
    pass: reportTextSchema.optional(),
    affectedUrls: z
        .array(reportHttpUrlSchema)
        .max(REPORT_MAX_AFFECTED_URLS_PER_FINDING),
    evidence: z.array(reportShortTextSchema).max(100),
    sourceDateId: reportStableIdSchema.optional(),
})
    .strict();
const findingsBlockSchema = z
    .object({
    type: z.literal('findings'),
    id: reportStableIdSchema,
    items: z.array(findingSchema).max(100000),
})
    .strict();
const keyValueBlockSchema = z
    .object({
    type: z.literal('key_value'),
    id: reportStableIdSchema,
    items: z
        .array(z
        .object({
        id: reportStableIdSchema,
        label: reportLabelSchema,
        value: reportScalarValueSchema,
        unit: reportShortTextSchema.optional(),
        sourceDateId: reportStableIdSchema.optional(),
    })
        .strict())
        .max(10000),
})
    .strict();
const tableColumnSchema = z
    .object({
    key: reportStableIdSchema,
    label: reportLabelSchema,
    valueType: z.enum([
        'string',
        'number',
        'date',
        'url',
        'boolean',
        'null',
        'unavailable',
    ]),
    unit: reportShortTextSchema.optional(),
})
    .strict();
const tableRowSchema = z
    .object({
    id: reportStableIdSchema.optional(),
    cells: z
        .array(z
        .object({
        columnKey: reportStableIdSchema,
        value: reportScalarValueSchema,
        sourceDateId: reportStableIdSchema.optional(),
    })
        .strict())
        .max(1000),
})
    .strict();
const reportTableDataSchema = z
    .object({
    columns: z.array(tableColumnSchema).min(1).max(100),
    rows: z.array(tableRowSchema).max(100000),
})
    .strict();
const tableBlockSchema = reportTableDataSchema.extend({
    type: z.literal('table'),
    id: reportStableIdSchema,
}).strict();
const timeSeriesBlockSchema = z
    .object({
    type: z.literal('time_series'),
    id: reportStableIdSchema,
    series: z
        .array(z
        .object({
        id: reportStableIdSchema,
        label: reportLabelSchema,
        unit: reportShortTextSchema.optional(),
        sourceDateId: reportStableIdSchema,
        points: z
            .array(z
            .object({
            timestamp: reportIsoDateTimeSchema,
            value: z.number().finite().nullable(),
        })
            .strict())
            .max(100000),
    })
        .strict())
        .min(1)
        .max(100),
    tableFallback: reportTableDataSchema,
})
    .strict();
const sourceNoteBlockSchema = z
    .object({
    type: z.literal('source_note'),
    id: reportStableIdSchema,
    sourceDateId: reportStableIdSchema,
    methodology: reportTextSchema,
    coverageWarning: reportTextSchema.optional(),
})
    .strict();
const stateBlockSchema = z
    .object({
    type: z.literal('state'),
    id: reportStableIdSchema,
    state: z.enum(['empty', 'unavailable']),
    reason: reportTextSchema,
    sourceDateId: reportStableIdSchema.optional(),
})
    .strict();
const nativeArtifactBlockSchema = z
    .object({
    type: z.literal('native_artifact'),
    id: reportStableIdSchema,
    artifactId: reportStableIdSchema,
})
    .strict();
export const reportBlockV1Schema = z.discriminatedUnion('type', [
    headingBlockSchema,
    proseBlockSchema,
    kpiBlockSchema,
    findingsBlockSchema,
    keyValueBlockSchema,
    tableBlockSchema,
    timeSeriesBlockSchema,
    sourceNoteBlockSchema,
    stateBlockSchema,
    nativeArtifactBlockSchema,
]);
const reportCompletenessSchema = z
    .object({
    state: z.literal('complete'),
    selectedItems: z.number().int().min(0).max(100000),
    representedItems: z.number().int().min(0).max(100000),
    bound: reportShortTextSchema,
})
    .strict();
function addDuplicateIssue(context: z.RefinementCtx, path: Array<string | number>): void {
    context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'reportExports.errors.duplicateId',
        path,
    });
}
function validateUniqueIds(values: readonly {
    id: string;
}[], context: z.RefinementCtx, path: string): Set<string> {
    const ids = new Set<string>();
    values.forEach((value, index) => {
        if (ids.has(value.id))
            addDuplicateIssue(context, [path, index, 'id']);
        ids.add(value.id);
    });
    return ids;
}
function validateTable(table: z.infer<typeof reportTableDataSchema>, context: z.RefinementCtx, path: Array<string | number>): void {
    const columnKeys = table.columns.map((column) => column.key);
    if (new Set(columnKeys).size !== columnKeys.length) {
        addDuplicateIssue(context, [...path, 'columns']);
    }
    table.rows.forEach((row, rowIndex) => {
        const cellKeys = row.cells.map((cell) => cell.columnKey);
        if (cellKeys.length !== columnKeys.length ||
            cellKeys.some((key, cellIndex) => key !== columnKeys[cellIndex])) {
            context.addIssue({
                code: z.ZodIssueCode.custom,
                message: 'reportExports.errors.invalidTable',
                path: [...path, 'rows', rowIndex, 'cells'],
            });
        }
    });
}
export const reportDocumentV1Schema = z
    .object({
    schema: z.literal(REPORT_DOCUMENT_SCHEMA),
    schemaVersion: z.literal(REPORT_DOCUMENT_SCHEMA_VERSION),
    kind: reportKindIdSchema,
    kindVersion: z.number().int().min(1).max(1000),
    locale: reportLocaleSchema,
    title: reportLabelSchema,
    subject: z.array(reportSubjectValueSchema).min(1).max(100),
    selection: z.array(reportSubjectValueSchema).max(100),
    sourceDates: z.array(reportSourceDateSchema).min(1).max(100),
    completeness: reportCompletenessSchema,
    branding: reportBrandingSnapshotSchema,
    blocks: z.array(reportBlockV1Schema).max(100000),
    artifacts: z.array(reportNativeArtifactDescriptorSchema).max(100),
})
    .strict()
    .superRefine((document, context) => {
    if (document.completeness.selectedItems !==
        document.completeness.representedItems) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'reportExports.errors.incomplete',
            path: ['completeness'],
        });
    }
    const sourceDateIds = validateUniqueIds(document.sourceDates, context, 'sourceDates');
    validateUniqueIds(document.blocks, context, 'blocks');
    const artifactIds = validateUniqueIds(document.artifacts, context, 'artifacts');
    document.blocks.forEach((block, blockIndex) => {
        const validateSourceId = (sourceDateId: string | undefined, path: Array<string | number>): void => {
            if (sourceDateId && !sourceDateIds.has(sourceDateId)) {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: 'reportExports.errors.invalidSourceReference',
                    path,
                });
            }
        };
        if (block.type === 'table') {
            validateTable(block, context, ['blocks', blockIndex]);
            block.rows.forEach((row, rowIndex) => {
                row.cells.forEach((cell, cellIndex) => {
                    validateSourceId(cell.sourceDateId, [
                        'blocks',
                        blockIndex,
                        'rows',
                        rowIndex,
                        'cells',
                        cellIndex,
                        'sourceDateId',
                    ]);
                });
            });
        }
        else if (block.type === 'time_series') {
            validateTable(block.tableFallback, context, [
                'blocks',
                blockIndex,
                'tableFallback',
            ]);
            for (const series of block.series) {
                validateSourceId(series.sourceDateId, [
                    'blocks',
                    blockIndex,
                    'series',
                ]);
            }
            block.tableFallback.rows.forEach((row, rowIndex) => {
                row.cells.forEach((cell, cellIndex) => {
                    validateSourceId(cell.sourceDateId, [
                        'blocks',
                        blockIndex,
                        'tableFallback',
                        'rows',
                        rowIndex,
                        'cells',
                        cellIndex,
                        'sourceDateId',
                    ]);
                });
            });
        }
        else if (block.type === 'source_note') {
            validateSourceId(block.sourceDateId, [
                'blocks',
                blockIndex,
                'sourceDateId',
            ]);
        }
        else if (block.type === 'native_artifact') {
            if (!artifactIds.has(block.artifactId)) {
                context.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: 'reportExports.errors.invalidArtifact',
                    path: ['blocks', blockIndex, 'artifactId'],
                });
            }
        }
        else if (block.type === 'kpi_group' || block.type === 'key_value') {
            block.items.forEach((item, itemIndex) => {
                validateSourceId(item.sourceDateId, [
                    'blocks',
                    blockIndex,
                    'items',
                    itemIndex,
                    'sourceDateId',
                ]);
            });
        }
        else if (block.type === 'findings') {
            block.items.forEach((item, itemIndex) => {
                validateSourceId(item.sourceDateId, [
                    'blocks',
                    blockIndex,
                    'items',
                    itemIndex,
                    'sourceDateId',
                ]);
            });
        }
        else if (block.type === 'state') {
            validateSourceId(block.sourceDateId, [
                'blocks',
                blockIndex,
                'sourceDateId',
            ]);
        }
    });
});
export const reportSourceTargetSchema = z.discriminatedUnion('scope', [
    z.object({ scope: z.literal('site'), siteId: reportSiteIdSchema }).strict(),
    z
        .object({
        scope: z.literal('site_resource'),
        siteId: reportSiteIdSchema,
        resourceId: reportSourceReferenceSchema,
    })
        .strict(),
    z
        .object({
        scope: z.literal('account_resource'),
        resourceId: reportSourceReferenceSchema,
        siteId: reportSiteIdSchema.optional(),
    })
        .strict(),
]);
export type ReportJsonValue = null | boolean | number | string | ReportJsonValue[] | {
    [key: string]: ReportJsonValue;
};
const reportJsonValueSchema: z.ZodType<ReportJsonValue> = z.lazy(() => z.union([
    z.null(),
    z.boolean(),
    z.number().finite(),
    reportTextSchema,
    z.array(reportJsonValueSchema).max(1000),
    z.record(z.string().min(1).max(100), reportJsonValueSchema),
]));
function selectionWithinComplexity(value: Record<string, ReportJsonValue>): boolean {
    const stack: Array<{
        value: ReportJsonValue;
        depth: number;
    }> = [
        { value, depth: 0 },
    ];
    let nodes = 0;
    while (stack.length > 0) {
        const current = stack.pop() as {
            value: ReportJsonValue;
            depth: number;
        };
        nodes += 1;
        if (nodes > REPORT_MAX_SELECTION_NODES || current.depth > REPORT_MAX_SELECTION_DEPTH) {
            return false;
        }
        if (Array.isArray(current.value)) {
            for (const item of current.value) {
                stack.push({ value: item, depth: current.depth + 1 });
            }
        }
        else if (current.value !== null && typeof current.value === 'object') {
            for (const item of Object.values(current.value)) {
                stack.push({ value: item, depth: current.depth + 1 });
            }
        }
    }
    return true;
}
export const reportSelectionSchema = z
    .record(z.string().min(1).max(100), reportJsonValueSchema)
    .superRefine((value, context) => {
    if (Buffer.byteLength(JSON.stringify(value), 'utf8') > REPORT_MAX_SELECTION_BYTES) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'reportExports.errors.selectionTooLarge',
        });
    }
    if (!selectionWithinComplexity(value)) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'reportExports.errors.selectionTooComplex',
        });
    }
});
export const reportExportAdapterResultSchema = z
    .object({
    document: reportDocumentV1Schema,
    sourceVersion: reportSourceReferenceSchema,
})
    .strict();
export const reportRenderedResultSchema = z
    .object({
    format: reportFormatSchema,
    mediaType: z.string().min(1).max(100),
    extension: z.string().regex(/^[a-z0-9]{1,10}$/u),
    bytes: z.instanceof(Uint8Array).refine((value) => value.byteLength <= REPORT_GLOBAL_BOUNDS.outputBytes, 'reportExports.errors.outputTooLarge'),
})
    .strict()
    .superRefine((value, context) => {
    if (value.mediaType !== REPORT_FORMAT_MEDIA_TYPES[value.format] ||
        value.extension !== REPORT_FORMAT_EXTENSIONS[value.format]) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'reportExports.errors.invalidRenderedResult',
        });
    }
});
export type ReportLocale = z.infer<typeof reportLocaleSchema>;
export type ReportSourceDate = z.infer<typeof reportSourceDateSchema>;
export type ReportBrandingSnapshot = z.infer<typeof reportBrandingSnapshotSchema>;
export type ReportNativeArtifactDescriptorV1 = z.infer<typeof reportNativeArtifactDescriptorSchema>;
export type ReportScalarValue = z.infer<typeof reportScalarValueSchema>;
export type ReportBlockV1 = z.infer<typeof reportBlockV1Schema>;
export type ReportDocumentV1 = z.infer<typeof reportDocumentV1Schema>;
export type ReportSourceTarget = z.infer<typeof reportSourceTargetSchema>;
export type ReportSelection = z.infer<typeof reportSelectionSchema>;
export type ReportExportAdapterResult = z.infer<typeof reportExportAdapterResultSchema>;
export type ReportRenderedResult = z.infer<typeof reportRenderedResultSchema>;
