import mongoose, { type HydratedDocument, type InferSchemaType, } from 'mongoose';
export const BACKLINK_PULL_TYPES = [
    'refDomains',
    'anchors',
    'history',
    'bulkRanks',
] as const;
export type BacklinkPullType = (typeof BACKLINK_PULL_TYPES)[number];
export const LINK_INTELLIGENCE_RUN_STATUSES = [
    'queued',
    'running',
    'succeeded',
    'failed',
] as const;
export type LinkIntelligenceRunStatus = (typeof LINK_INTELLIGENCE_RUN_STATUSES)[number];
export const LINK_GAP_LEG_STATUSES = [
    'ok',
    'failed',
    'zeroRetained',
] as const;
export type LinkGapLegStatus = (typeof LINK_GAP_LEG_STATUSES)[number];
export const LINK_INTELLIGENCE_DOMAIN_MAX_LENGTH = 253;
export const BACKLINK_PULL_MAX_ROWS = 500;
export const BACKLINK_HISTORY_MAX_MONTHS = 24;
export const BACKLINK_BULK_RANK_MAX_DOMAINS = 100;
export const LINK_GAP_MAX_COMPETITORS = 3;
const normalizedDomainField = {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    minlength: 1,
    maxlength: LINK_INTELLIGENCE_DOMAIN_MAX_LENGTH,
} as const;
const backlinkPullInputsSchema = new mongoose.Schema({
    limit: {
        type: Number,
        default: null,
        min: 1,
        max: BACKLINK_PULL_MAX_ROWS,
    },
    domains: {
        type: [normalizedDomainField],
        required: true,
        default: [],
        validate: {
            validator: (domains: string[]) => domains.length <= BACKLINK_BULK_RANK_MAX_DOMAINS,
            message: `domains must contain at most ${BACKLINK_BULK_RANK_MAX_DOMAINS} entries`,
        },
    },
}, { _id: false, strict: 'throw' });
const backlinkPullRunSchema = new mongoose.Schema({
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
    type: {
        type: String,
        enum: BACKLINK_PULL_TYPES,
        required: true,
    },
    domain: normalizedDomainField,
    inputs: {
        type: backlinkPullInputsSchema,
        required: true,
    },
    status: {
        type: String,
        enum: LINK_INTELLIGENCE_RUN_STATUSES,
        required: true,
        default: 'queued',
    },
    retainedCount: {
        type: Number,
        required: true,
        default: 0,
        min: 0,
        max: BACKLINK_PULL_MAX_ROWS,
    },
    completedAt: {
        type: Date,
        default: null,
    },
}, {
    timestamps: { createdAt: true, updatedAt: false },
    strict: 'throw',
});
backlinkPullRunSchema.pre('validate', function validateOperationInputBounds() {
    if (this.type === 'history' &&
        (this.inputs?.limit === null ||
            this.inputs?.limit === undefined ||
            this.inputs.limit > BACKLINK_HISTORY_MAX_MONTHS)) {
        this.invalidate('inputs.limit', `history limit must be 1..${BACKLINK_HISTORY_MAX_MONTHS}`);
    }
    if (this.type === 'bulkRanks' && this.inputs?.domains.length === 0) {
        this.invalidate('inputs.domains', 'bulkRanks requires at least one domain');
    }
});
backlinkPullRunSchema.index({ accountId: 1, _id: 1 });
backlinkPullRunSchema.index({
    accountId: 1,
    siteId: 1,
    type: 1,
    createdAt: -1,
    _id: -1,
});
backlinkPullRunSchema.index({ accountId: 1, status: 1, createdAt: -1 });
const linkGapLegOutcomeSchema = new mongoose.Schema({
    competitor: normalizedDomainField,
    status: {
        type: String,
        enum: LINK_GAP_LEG_STATUSES,
        required: true,
    },
    retainedCount: {
        type: Number,
        required: true,
        default: 0,
        min: 0,
        max: BACKLINK_PULL_MAX_ROWS,
    },
}, { _id: false, strict: 'throw' });
const boundedCompetitorArray = {
    type: [normalizedDomainField],
    required: true,
    validate: [
        {
            validator: (competitors: string[]) => competitors.length >= 1 &&
                competitors.length <= LINK_GAP_MAX_COMPETITORS,
            message: `competitors must contain 1..${LINK_GAP_MAX_COMPETITORS} entries`,
        },
        {
            validator: (competitors: string[]) => new Set(competitors).size === competitors.length,
            message: 'competitors must be unique',
        },
    ],
} as const;
const linkGapRunSchema = new mongoose.Schema({
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
    ownDomain: normalizedDomainField,
    competitors: boundedCompetitorArray,
    status: {
        type: String,
        enum: LINK_INTELLIGENCE_RUN_STATUSES,
        required: true,
        default: 'queued',
    },
    perLegOutcomes: {
        type: [linkGapLegOutcomeSchema],
        required: true,
        default: [],
        validate: {
            validator: (outcomes: unknown[]) => outcomes.length <= LINK_GAP_MAX_COMPETITORS,
            message: `perLegOutcomes must contain at most ${LINK_GAP_MAX_COMPETITORS} entries`,
        },
    },
    completedAt: {
        type: Date,
        default: null,
    },
}, {
    timestamps: { createdAt: true, updatedAt: false },
    strict: 'throw',
});
linkGapRunSchema.index({ accountId: 1, _id: 1 });
linkGapRunSchema.index({
    accountId: 1,
    siteId: 1,
    createdAt: -1,
    _id: -1,
});
linkGapRunSchema.index({ accountId: 1, status: 1, createdAt: -1 });
export type BacklinkPullRunDocument = InferSchemaType<typeof backlinkPullRunSchema> & {
    createdAt: Date;
};
export type BacklinkPullRunHydrated = HydratedDocument<BacklinkPullRunDocument>;
export type LinkGapRunDocument = InferSchemaType<typeof linkGapRunSchema> & {
    createdAt: Date;
};
export type LinkGapRunHydrated = HydratedDocument<LinkGapRunDocument>;
export const BacklinkPullRun = mongoose.model('BacklinkPullRun', backlinkPullRunSchema);
export const LinkGapRun = mongoose.model('LinkGapRun', linkGapRunSchema);
