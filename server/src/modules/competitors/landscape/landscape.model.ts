import mongoose, { type HydratedDocument, type InferSchemaType } from 'mongoose';
import { SUPPORTED_LOCALES } from '../../../shared/i18n/locales.js';
import { canonicalLandscapeJson } from './landscape.canonical.js';
import { LANDSCAPE_CLASSES, LANDSCAPE_LEGS, LANDSCAPE_MAX_DOCUMENT_BYTES, LANDSCAPE_MAX_REPORT_PAGES, LANDSCAPE_MAX_ROWS, LANDSCAPE_STATES, LANDSCAPE_TERMINAL_STATES, landscapeCheckpointSchema, landscapeReportManifestSchema, landscapeReportPageSchema, } from './landscape.schemas.js';
export const LANDSCAPE_SCHEMA_VERSION = 'competitor-landscape/1' as const;
export const LANDSCAPE_TAXONOMY_VERSION = '2026-08-08.1' as const;
export const LANDSCAPE_RUBRIC_VERSION = '2026-08-08.1' as const;
const rawHtmlPattern = /(?:<\s*\/?\s*[a-z][^>]*>|<![^>]*>|<\?[^>]*>)/i;
const terminalStateSet = new Set<string>(LANDSCAPE_TERMINAL_STATES);
function assertNoRawHtml(value: unknown, path = 'document'): void {
    if (typeof value === 'string' && rawHtmlPattern.test(value)) {
        throw new Error(`${path} must not contain raw HTML`);
    }
    if (Array.isArray(value)) {
        value.forEach((entry, index) => assertNoRawHtml(entry, `${path}.${index}`));
        return;
    }
    if (value && typeof value === 'object') {
        for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
            assertNoRawHtml(entry, `${path}.${key}`);
        }
    }
}
function assertDocumentBytes(value: unknown, label: string): void {
    const bytes = Buffer.byteLength(canonicalLandscapeJson(value), 'utf8');
    if (bytes > LANDSCAPE_MAX_DOCUMENT_BYTES) {
        throw new Error(`${label} exceeds the 2 MiB canonical JSON ceiling`);
    }
}
function changedTopLevelPaths(update: Record<string, unknown> | null): Set<string> {
    const changedPaths = new Set<string>();
    if (!update)
        return changedPaths;
    for (const [operator, value] of Object.entries(update)) {
        if (operator.startsWith('$') && value && typeof value === 'object') {
            for (const path of Object.keys(value as Record<string, unknown>)) {
                changedPaths.add(path.split('.')[0]!);
            }
        }
        else if (!operator.startsWith('$')) {
            changedPaths.add(operator.split('.')[0]!);
        }
    }
    return changedPaths;
}
function reportPageValidationErrors(rowCount: number, isNew: boolean, isModified: boolean): string[] {
    const errors: string[] = [];
    if (rowCount > LANDSCAPE_MAX_ROWS)
        errors.push('report row ceiling exceeded');
    if (!isNew && isModified)
        errors.push('published report pages are immutable');
    return errors;
}
function applyReportPageValidation(rowCount: number, isNew: boolean, isModified: boolean, invalidate: (path: string, error: string) => void): void {
    for (const error of reportPageValidationErrors(rowCount, isNew, isModified)) {
        invalidate('rows', error);
    }
}
const marketSchema = new mongoose.Schema({
    locationCode: { type: Number, required: true, min: 1 },
    languageCode: { type: String, required: true, minlength: 2, maxlength: 10 },
    source: {
        type: String,
        enum: ['tracked_keyword_mode', 'default'] as const,
        required: true,
    },
    eligibleTrackedKeywords: { type: Number, required: true, min: 0 },
}, { _id: false });
const frozenCompetitorSchema = new mongoose.Schema({
    profileId: { type: String, required: true },
    domain: { type: String, required: true, maxlength: 253 },
}, { _id: false });
const progressSchema = new mongoose.Schema({
    completedLegs: { type: Number, required: true, min: 0, max: 30 },
    totalLegs: { type: Number, required: true, min: 3, max: 30 },
    stage: { type: String, enum: LANDSCAPE_STATES, required: true },
}, { _id: false });
const stageSummarySchema = new mongoose.Schema({
    competitorProfileId: { type: String, required: true },
    leg: { type: String, enum: LANDSCAPE_LEGS, required: true },
    state: {
        type: String,
        enum: ['pending', 'dispatched', 'succeeded', 'failed'] as const,
        required: true,
    },
    returnedRows: { type: Number, required: true, min: 0, max: 100 },
}, { _id: false });
const competitorLandscapeRunSchema = new mongoose.Schema({
    accountId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    siteId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Site',
        required: true,
    },
    requestedByUserId: { type: String, required: true, maxlength: 128 },
    ownedDomain: { type: String, required: true, maxlength: 253 },
    locale: { type: String, enum: SUPPORTED_LOCALES, required: true },
    state: { type: String, enum: LANDSCAPE_STATES, required: true, default: 'queued' },
    progress: { type: progressSchema, required: true },
    market: { type: marketSchema, required: true },
    competitors: {
        type: [frozenCompetitorSchema],
        required: true,
        validate: {
            validator: (value: unknown[]) => value.length >= 1 && value.length <= 10,
            message: 'competitors must contain 1..10 frozen profiles',
        },
    },
    idempotencyKey: { type: String, required: true, minlength: 1, maxlength: 128 },
    requestFingerprint: { type: String, required: true, match: /^[0-9a-f]{64}$/ },
    queueJobId: { type: String, required: true, maxlength: 96 },
    cancelRequestedAt: { type: Date, default: null },
    firstProviderDispatchAt: { type: Date, default: null },
    stageSummary: {
        type: [stageSummarySchema],
        required: true,
        validate: {
            validator: (value: unknown[]) => value.length >= 3 && value.length <= 30,
            message: 'stage summary must contain 3..30 legs',
        },
    },
    reportManifest: { type: mongoose.Schema.Types.Mixed, default: null },
    contentHash: { type: String, default: null, match: /^[0-9a-f]{64}$/ },
    safeFailureCode: { type: String, default: null, maxlength: 64 },
    reportVersion: { type: Number, required: true, default: 1, enum: [1] },
    schemaVersion: {
        type: String,
        required: true,
        default: LANDSCAPE_SCHEMA_VERSION,
        enum: [LANDSCAPE_SCHEMA_VERSION] as const,
    },
    taxonomyVersion: {
        type: String,
        required: true,
        default: LANDSCAPE_TAXONOMY_VERSION,
        enum: [LANDSCAPE_TAXONOMY_VERSION] as const,
    },
    suggestionRubricVersion: {
        type: String,
        required: true,
        default: LANDSCAPE_RUBRIC_VERSION,
        enum: [LANDSCAPE_RUBRIC_VERSION] as const,
    },
    opportunityRubricVersion: {
        type: String,
        required: true,
        default: LANDSCAPE_RUBRIC_VERSION,
        enum: [LANDSCAPE_RUBRIC_VERSION] as const,
    },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null },
}, { timestamps: true });
competitorLandscapeRunSchema.index({ accountId: 1, siteId: 1, idempotencyKey: 1 }, { unique: true, name: 'landscape_account_site_idempotency_uq' });
competitorLandscapeRunSchema.index({ accountId: 1, siteId: 1, requestFingerprint: 1 }, {
    unique: true,
    name: 'landscape_active_fingerprint_uq',
    partialFilterExpression: {
        state: { $in: ['queued', 'collecting', 'aggregating'] },
    },
});
competitorLandscapeRunSchema.index({ accountId: 1, siteId: 1, createdAt: -1, _id: -1 }, { name: 'landscape_history_idx' });
competitorLandscapeRunSchema.index({ accountId: 1, siteId: 1, state: 1, createdAt: -1 }, { name: 'landscape_state_history_idx' });
competitorLandscapeRunSchema.index({ state: 1, createdAt: 1 }, { name: 'landscape_reconciliation_idx' });
const terminalSnapshotPaths = new Set([
    'ownedDomain',
    'locale',
    'market',
    'competitors',
    'reportManifest',
    'contentHash',
    'reportVersion',
    'schemaVersion',
    'taxonomyVersion',
    'suggestionRubricVersion',
    'opportunityRubricVersion',
]);
competitorLandscapeRunSchema.post('init', function rememberPersistedState(doc) {
    doc.$locals.persistedLandscapeState = doc.state;
});
competitorLandscapeRunSchema.post('save', function rememberSavedState(doc) {
    doc.$locals.persistedLandscapeState = doc.state;
});
competitorLandscapeRunSchema.pre('validate', function validateLandscapeRun() {
    assertNoRawHtml(this.toObject({ depopulate: true, versionKey: false }), 'landscape run');
    assertDocumentBytes(this.toObject({ depopulate: true, versionKey: false }), 'landscape run');
    if (this.reportManifest !== null) {
        landscapeReportManifestSchema.parse(this.reportManifest);
    }
    const persisted = this.$locals.persistedLandscapeState as string | undefined;
    if (persisted && terminalStateSet.has(persisted)) {
        for (const path of terminalSnapshotPaths) {
            if (this.isModified(path)) {
                this.invalidate(path, 'terminal landscape snapshots are immutable');
            }
        }
    }
});
competitorLandscapeRunSchema.pre(['updateOne', 'findOneAndUpdate', 'replaceOne'], async function rejectTerminalSnapshotMutation() {
    const existing = (await this.model
        .findOne(this.getQuery())
        .select({ state: 1 })
        .lean()) as {
        state?: unknown;
    } | null;
    if (!existing || !terminalStateSet.has(String(existing.state)))
        return;
    const changedPaths = changedTopLevelPaths(this.getUpdate() as Record<string, unknown> | null);
    if ([...changedPaths].some((path) => terminalSnapshotPaths.has(path))) {
        throw new Error('terminal landscape snapshots are immutable');
    }
});
export type CompetitorLandscapeRunDocument = InferSchemaType<typeof competitorLandscapeRunSchema> & {
    createdAt: Date;
    updatedAt: Date;
};
export type CompetitorLandscapeRunHydrated = HydratedDocument<CompetitorLandscapeRunDocument>;
export const CompetitorLandscapeRun = mongoose.model('CompetitorLandscapeRun', competitorLandscapeRunSchema);
const competitorLandscapeLegCheckpointSchema = new mongoose.Schema({
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
    runId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CompetitorLandscapeRun',
        required: true,
    },
    competitorProfileId: { type: String, required: true },
    leg: { type: String, enum: LANDSCAPE_LEGS, required: true },
    state: {
        type: String,
        enum: ['pending', 'dispatched', 'succeeded', 'failed'] as const,
        required: true,
    },
    attempt: { type: Number, enum: [0, 1] as const, required: true, default: 0 },
    cache: { type: String, enum: ['hit', 'miss'] as const, required: true },
    dispatchMarkedAt: { type: Date, default: null },
    safeErrorCode: { type: String, default: null, maxlength: 64 },
    provenance: { type: mongoose.Schema.Types.Mixed, default: null },
    rows: {
        type: [mongoose.Schema.Types.Mixed],
        required: true,
        default: [],
        validate: {
            validator: (value: unknown[]) => value.length <= 100,
            message: 'checkpoint rows exceed 100',
        },
    },
    expiresAt: { type: Date, default: null },
}, { timestamps: true });
competitorLandscapeLegCheckpointSchema.index({ accountId: 1, runId: 1, competitorProfileId: 1, leg: 1 }, { unique: true, name: 'landscape_checkpoint_uq' });
competitorLandscapeLegCheckpointSchema.index({ accountId: 1, siteId: 1, runId: 1 }, { name: 'landscape_checkpoint_purge_idx' });
competitorLandscapeLegCheckpointSchema.pre('validate', function validateCheckpoint() {
    const plain = this.toObject({ depopulate: true, versionKey: false });
    assertNoRawHtml(plain, 'landscape checkpoint');
    assertDocumentBytes(plain, 'landscape checkpoint');
    landscapeCheckpointSchema.parse({
        accountId: String(this.accountId),
        siteId: String(this.siteId),
        runId: String(this.runId),
        competitorProfileId: this.competitorProfileId,
        leg: this.leg,
        state: this.state,
        attempt: this.attempt,
        cache: this.cache,
        dispatchMarkedAt: this.dispatchMarkedAt,
        safeErrorCode: this.safeErrorCode,
        provenance: this.provenance,
        rows: this.rows,
    });
});
export type CompetitorLandscapeLegCheckpointDocument = InferSchemaType<typeof competitorLandscapeLegCheckpointSchema> & {
    createdAt: Date;
    updatedAt: Date;
};
export const CompetitorLandscapeLegCheckpoint = mongoose.model('CompetitorLandscapeLegCheckpoint', competitorLandscapeLegCheckpointSchema);
const competitorLandscapeReportPageSchema = new mongoose.Schema({
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    siteId: { type: mongoose.Schema.Types.ObjectId, ref: 'Site', required: true },
    runId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'CompetitorLandscapeRun',
        required: true,
    },
    pageIndex: {
        type: Number,
        required: true,
        min: 0,
        max: LANDSCAPE_MAX_REPORT_PAGES - 1,
    },
    rows: {
        type: [mongoose.Schema.Types.Mixed],
        required: true,
        validate: {
            validator: (value: unknown[]) => value.length >= 1 && value.length <= 100,
            message: 'report page rows must contain 1..100 rows',
        },
    },
    rowCount: { type: Number, required: true, min: 1, max: 100 },
    pageHash: { type: String, required: true, match: /^[0-9a-f]{64}$/ },
    expiresAt: { type: Date, default: null },
}, { timestamps: { createdAt: true, updatedAt: false } });
competitorLandscapeReportPageSchema.index({ accountId: 1, runId: 1, pageIndex: 1 }, { unique: true, name: 'landscape_report_page_uq' });
competitorLandscapeReportPageSchema.index({ accountId: 1, siteId: 1, runId: 1, pageIndex: 1 }, { name: 'landscape_report_page_purge_stream_idx' });
competitorLandscapeReportPageSchema.pre('validate', function validateReportPage() {
    const plain = this.toObject({ depopulate: true, versionKey: false });
    assertNoRawHtml(plain, 'landscape report page');
    assertDocumentBytes(plain, 'landscape report page');
    landscapeReportPageSchema.parse({
        accountId: String(this.accountId),
        siteId: String(this.siteId),
        runId: String(this.runId),
        pageIndex: this.pageIndex,
        rows: this.rows,
        rowCount: this.rowCount,
        pageHash: this.pageHash,
    });
    applyReportPageValidation(this.rows.length, this.isNew, this.isModified(), this.invalidate.bind(this));
});
competitorLandscapeReportPageSchema.pre(['updateOne', 'findOneAndUpdate', 'replaceOne'], function rejectReportPageMutation() {
    throw new Error('published report pages are immutable');
});
export type CompetitorLandscapeReportPageDocument = InferSchemaType<typeof competitorLandscapeReportPageSchema> & {
    createdAt: Date;
};
export const CompetitorLandscapeReportPage = mongoose.model('CompetitorLandscapeReportPage', competitorLandscapeReportPageSchema);
export const LANDSCAPE_MODEL_CLASSES = LANDSCAPE_CLASSES;
export const landscapeModelTestables = Object.freeze({
    assertDocumentBytes,
    assertNoRawHtml,
    applyReportPageValidation,
    changedTopLevelPaths,
    reportPageValidationErrors,
});
