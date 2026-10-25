import mongoose, { type InferSchemaType } from 'mongoose';

/**
 * Why the user dismissed an audit finding. Recorded with
 * the dismissal so the report can say why it is hidden and so a false
 * positive claim can be tested later.
 */
export const DISMISSAL_REASONS = ['false_positive', 'wont_fix', 'fixed_elsewhere', 'other'] as const;
export type DismissalReason = (typeof DISMISSAL_REASONS)[number];

export const FINDING_RECHECK_OUTCOMES = ['still_failing', 'cleared', 'unverified'] as const;
export type FindingRecheckOutcome = (typeof FINDING_RECHECK_OUTCOMES)[number];

const recheckResultSchema = new mongoose.Schema(
  {
    url: { type: String, required: true },
    outcome: { type: String, enum: FINDING_RECHECK_OUTCOMES, required: true },
    status: { type: Number, default: null },
  },
  { _id: false },
);

const recheckSchema = new mongoose.Schema(
  {
    checkedAt: { type: Date, required: true },
    /** Distinct URLs the finding lists; `results` holds at most the re-check bound. */
    totalUrls: { type: Number, required: true },
    results: { type: [recheckResultSchema], default: [] },
  },
  { _id: false },
);

/**
 * Details of the latest dismissal of one audit rule on one site. The
 * decision itself lives in `action_events` (append-only, Postgres); this
 * document only adds what the event cannot carry: the reason, the number of
 * affected pages when it was dismissed (to resurface the finding when that
 * number grows), and the latest targeted re-check. One document per rule,
 * replaced on every new dismissal.
 */
const findingDismissalSchema = new mongoose.Schema(
  {
    accountId: { type: String, required: true },
    siteId: { type: String, required: true },
    ruleId: { type: String, required: true },
    reason: { type: String, enum: DISMISSAL_REASONS, default: null },
    /** Affected pages in the newest audit when dismissed; null = no audit reported it. */
    affectedCount: { type: Number, default: null },
    /** The newest audit when dismissed. */
    runId: { type: String, default: null },
    actorUserId: { type: String, required: true },
    dismissedAt: { type: Date, required: true },
    lastRecheck: { type: recheckSchema, default: null },
  },
  { timestamps: true },
);

findingDismissalSchema.index({ accountId: 1, siteId: 1, ruleId: 1 }, { unique: true });

export type FindingDismissalDocument = InferSchemaType<typeof findingDismissalSchema>;

export const FindingDismissal = mongoose.model('FindingDismissal', findingDismissalSchema);
