/**
 * Request + evidence schemas for the alert rules surface.
 *
 * Every customer-supplied field is bounded here BEFORE it reaches a service:
 * URLs are length-capped and scheme-checked (the SSRF authority does the
 * resolve-then-pin work), recipient lists are cardinality-capped, and the
 * threshold range mirrors the DB CHECK so a bad value is refused twice.
 *
 * `alertEvidenceSchema` is the honesty invariant in code form: `before` and
 * `after` are REQUIRED, so an alert without its stored observation pair cannot
 * parse and therefore cannot be delivered on any channel.
 */
import { z } from 'zod';
import { ALERT_CHANNELS, ALERT_MAX_EMAIL_RECIPIENTS, ALERT_RULE_TYPES, ALERT_THRESHOLD_MAX, ALERT_THRESHOLD_MIN, ALERT_WEBHOOK_URL_MAX_CHARS, } from '../../db/schema/index.js';
import { SUPPORTED_LOCALES } from '../../shared/i18n/index.js';
/** Bounded sample of changed domains carried on a link transition. */
export const ALERT_EVIDENCE_DOMAIN_CAP = 50;
/** Wall-clock ceiling for one outbound Slack/webhook POST. */
export const ALERT_DELIVERY_DEADLINE_MS = 5000;
/** Response ceiling — we only need the status code. */
export const ALERT_DELIVERY_MAX_RESPONSE_BYTES = 64 * 1024;
/** Versioned generic-webhook envelope. Bump on any breaking payload change. */
export const ALERT_PAYLOAD_VERSION = 'rankmefast.alert.v1' as const;
export const ALERT_EMAIL_REQUEST_VERSION = 'rankmefast.alert-email.v1' as const;
export const ALERT_SLACK_REQUEST_VERSION = 'rankmefast.alert-slack.v1' as const;
export const ALERT_WEBHOOK_REQUEST_VERSION = 'rankmefast.alert-webhook.v1' as const;
const encryptedSecretSchema = z.object({
    ciphertext: z.string().min(1).max(8192),
    iv: z.string().min(1).max(128),
    authTag: z.string().min(1).max(128),
    keyVersion: z.number().int().nonnegative(),
    aadBound: z.boolean().optional(),
}).strict();
/** Exact durable request used after an ambiguous provider submission. */
export const alertEmailRequestSchema = z.object({
    version: z.literal(ALERT_EMAIL_REQUEST_VERSION),
    senderIdentity: z.string().max(320).nullable(),
    to: z.string().email().max(320),
    subject: z.string().min(1).max(2000),
    text: z.string().min(1).max(50000),
    /** Absent only on already-rendered legacy requests. */
    html: z.string().min(1).max(100000).optional(),
    locale: z.enum(SUPPORTED_LOCALES),
}).strict();
export type AlertEmailRequest = z.infer<typeof alertEmailRequestSchema>;
export const alertSlackRequestSchema = z.object({
    version: z.literal(ALERT_SLACK_REQUEST_VERSION),
    encryptedUrl: encryptedSecretSchema,
    body: z.string().min(1).max(64 * 1024),
    /** Absent only on legacy v1 rows whose localized body is already frozen. */
    locale: z.enum(SUPPORTED_LOCALES).optional(),
}).strict();
export type AlertSlackRequest = z.infer<typeof alertSlackRequestSchema>;
export const alertWebhookRequestSchema = z.object({
    version: z.literal(ALERT_WEBHOOK_REQUEST_VERSION),
    encryptedUrl: encryptedSecretSchema,
    rawBody: z.string().min(1).max(64 * 1024),
    timestampSeconds: z.number().int().nonnegative(),
    signature: z.string().regex(/^t=\d+,v1=[0-9a-f]{64}$/u),
}).strict();
export type AlertWebhookRequest = z.infer<typeof alertWebhookRequestSchema>;
export const alertRequestSchema = z.discriminatedUnion('version', [
    alertEmailRequestSchema,
    alertSlackRequestSchema,
    alertWebhookRequestSchema,
]);
export type AlertRequest = z.infer<typeof alertRequestSchema>;
const objectIdLike = z
    .string()
    .trim()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_-]+$/u, 'validation.issue.invalidString');
/**
 * A customer-supplied https URL. Only shape is checked here — reachability,
 * DNS, and private-range rejection belong to `assertPublicUrlSafe`.
 */
const httpsUrl = z
    .string()
    .trim()
    .min(1)
    .max(ALERT_WEBHOOK_URL_MAX_CHARS)
    .refine((value) => {
    try {
        return new URL(value).protocol === 'https:';
    }
    catch {
        return false;
    }
}, 'alerts.errors.invalidUrl');
export const emailRecipientsSchema = z
    .array(objectIdLike)
    .max(ALERT_MAX_EMAIL_RECIPIENTS)
    .superRefine((ids, ctx) => {
    if (new Set(ids).size !== ids.length) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'alerts.errors.duplicateRecipient' });
    }
});
const channelFields = {
    emailRecipientIds: emailRecipientsSchema.optional(),
    slackWebhookUrl: httpsUrl.nullish(),
    webhookUrl: httpsUrl.nullish(),
};
export const createRuleBodySchema = z
    .object({
    siteId: objectIdLike,
    type: z.enum(ALERT_RULE_TYPES),
    threshold: z
        .number()
        .int()
        .min(ALERT_THRESHOLD_MIN)
        .max(ALERT_THRESHOLD_MAX)
        .optional(),
    enabled: z.boolean().optional(),
    ...channelFields,
})
    .strict()
    .superRefine((body, ctx) => {
    if (body.type === 'rank_drop' && body.threshold === undefined) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['threshold'],
            message: 'alerts.errors.thresholdRequired',
        });
    }
    if (body.type !== 'rank_drop' && body.threshold !== undefined) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['threshold'],
            message: 'alerts.errors.thresholdNotAllowed',
        });
    }
    const hasEmail = (body.emailRecipientIds ?? []).length > 0;
    if (!hasEmail && !body.slackWebhookUrl && !body.webhookUrl) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: 'alerts.errors.noChannel',
        });
    }
});
export type CreateRuleBody = z.infer<typeof createRuleBodySchema>;
export const updateRuleBodySchema = z
    .object({
    threshold: z
        .number()
        .int()
        .min(ALERT_THRESHOLD_MIN)
        .max(ALERT_THRESHOLD_MAX)
        .optional(),
    enabled: z.boolean().optional(),
    /** `true` mints a fresh HMAC secret and returns it show-once. */
    rotateWebhookSecret: z.boolean().optional(),
    ...channelFields,
})
    .strict()
    .refine((body) => Object.keys(body).length > 0, { message: 'alerts.errors.emptyUpdate' });
export type UpdateRuleBody = z.infer<typeof updateRuleBodySchema>;
export const ruleIdParamsSchema = z.object({ ruleId: z.string().uuid() }).strict();
export const listRulesQuerySchema = z
    .object({
    siteId: objectIdLike.optional(),
    type: z.enum(ALERT_RULE_TYPES).optional(),
    enabled: z
        .union([z.literal('true'), z.literal('false')])
        .transform((value) => value === 'true')
        .optional(),
})
    .strict();
export type ListRulesQuery = z.infer<typeof listRulesQuerySchema>;
export const listDeliveriesQuerySchema = z
    .object({
    status: z.enum(['pending', 'sent', 'failed', 'suppressed']).optional(),
    channel: z.enum(ALERT_CHANNELS).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
})
    .strict();
export type ListDeliveriesQuery = z.infer<typeof listDeliveriesQuerySchema>;
// ---------------------------------------------------------------------------
// Evidence — the honesty invariant
// ---------------------------------------------------------------------------
const isoTimestamp = z.string().datetime({ offset: true });
const rankObservation = z.object({
    at: isoTimestamp,
    position: z.number().int().min(1).nullable(),
});
const linkObservation = z.object({
    at: isoTimestamp,
    reviewId: z.string().min(1).max(64),
    rowCount: z.number().int().min(0),
});
export const rankDropEvidenceSchema = z
    .object({
    kind: z.literal('rank_drop'),
    keyword: z.string().min(1).max(200),
    threshold: z.number().int().min(ALERT_THRESHOLD_MIN).max(ALERT_THRESHOLD_MAX),
    before: rankObservation,
    after: rankObservation,
})
    .strict();
export const linkEvidenceSchema = z
    .object({
    kind: z.enum(['new_backlink', 'lost_backlink']),
    before: linkObservation,
    after: linkObservation,
    changedDomains: z
        .array(z.string().min(1).max(253))
        .max(ALERT_EVIDENCE_DOMAIN_CAP),
    changedTotal: z.number().int().min(0),
})
    .strict();
export const alertEvidenceSchema = z.discriminatedUnion('kind', [
    rankDropEvidenceSchema,
    linkEvidenceSchema,
]);
export type AlertEvidence = z.infer<typeof alertEvidenceSchema>;
export type RankDropEvidence = z.infer<typeof rankDropEvidenceSchema>;
export type LinkEvidence = z.infer<typeof linkEvidenceSchema>;
