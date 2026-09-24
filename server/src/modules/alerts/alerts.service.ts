/**
 * Alert-rule CRUD.
 *
 * Order of operations on every mutation — the order is load-bearing:
 *   1. Resource ownership → 404 (never 403), even while the flag is off.
 *   2. Kill switch (`ALERTS_ENABLED`) — owned mutations 503; reads survive.
 *   3. SSRF authority on every customer URL — resolve-then-pin, private
 *      ranges and credentials refused, at SAVE time (again at send time).
 *   4. Seal secrets into AAD-bound envelopes, then a single INSERT/UPDATE.
 *
 * Reads never decrypt: the masked display columns carry everything the UI
 * needs, so a compromised read path cannot leak a channel credential.
 */
import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import type { Db } from '../../db/client.js';
import type { AlertDeliveryRow, AlertRuleRow, AlertRuleType } from '../../db/schema/index.js';
import { assertPublicUrlSafe, type AssertPublicUrlSafeOptions, } from '../../shared/security/url-safety.js';
import { HttpError } from '../../shared/utils/http-error.js';
import { Site } from '../sites/sites.model.js';
import { countRulesForAccount, deleteRule as deleteRuleRow, findRule, insertRule, listDeliveries, listRules, updateRule as updateRuleRow, type RuleUpdatePatch, } from './alerts.repo.js';
import { generateWebhookSecret, maskSlackWebhookUrl, newRuleId, sealAlertSecret, webhookSecretLast4, } from './alerts.secrets.js';
import type { CreateRuleBody, ListDeliveriesQuery, ListRulesQuery, UpdateRuleBody, } from './alerts.schema.js';
import { alertEvidenceSchema, type AlertEvidence } from './alerts.schema.js';
export const ALERTS_UNAVAILABLE_KEY = 'alerts.errors.unavailable';
const SELF_RECIPIENT_ALIAS = 'self';
export interface AlertsServiceDeps {
    db: Db;
    now?: () => Date;
    /** Test seam threaded into the SSRF authority (DNS resolver / clock). */
    urlSafety?: AssertPublicUrlSafeOptions;
}
export interface AlertRuleDto {
    id: string;
    siteId: string;
    type: AlertRuleType;
    threshold: number | null;
    enabled: boolean;
    emailRecipientIds: string[];
    /** Masked host + first path segment. The full URL never leaves the server. */
    slackHostMasked: string | null;
    slackConfigured: boolean;
    webhookUrl: string | null;
    webhookSecretSet: boolean;
    webhookSecretLast4: string | null;
    createdAt: string;
    updatedAt: string;
}
export interface AlertRuleMutationDto extends AlertRuleDto {
    /** Present ONLY on the response that minted it. Never persisted in clear. */
    webhookSecret?: string;
}
export interface AlertDeliveryDto {
    id: string;
    ruleId: string;
    channel: AlertDeliveryRow['channel'];
    recipientRef: string | null;
    transitionKind: AlertRuleType;
    status: AlertDeliveryRow['status'];
    attempt: number;
    errorCode: AlertDeliveryRow['errorCode'];
    suppressedReason: AlertDeliveryRow['suppressedReason'];
    evidence: AlertEvidence;
    createdAt: string;
    updatedAt: string;
}
export function toRuleDto(row: AlertRuleRow): AlertRuleDto {
    return {
        id: row.id,
        siteId: row.siteId,
        type: row.type,
        threshold: row.threshold,
        enabled: row.enabled,
        emailRecipientIds: row.emailRecipientIds,
        slackHostMasked: row.slackHostMasked,
        slackConfigured: row.slackWebhook !== null,
        webhookUrl: row.webhookUrl,
        webhookSecretSet: row.webhookSecret !== null,
        webhookSecretLast4: row.webhookSecretLast4,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}
export function toDeliveryDto(row: AlertDeliveryRow): AlertDeliveryDto {
    return {
        id: row.id,
        ruleId: row.ruleId,
        channel: row.channel,
        recipientRef: row.recipientRef,
        transitionKind: row.transitionKind,
        status: row.status,
        attempt: row.attempt,
        errorCode: row.errorCode,
        suppressedReason: row.suppressedReason,
        // Stored evidence is re-parsed on the way out: a row that somehow lost an
        // observation cannot be rendered as a complete alert (honesty invariant).
        evidence: alertEvidenceSchema.parse(row.evidence),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
    };
}
function assertMutationAvailable(): void {
    if (!env.ALERTS_ENABLED)
        throw new HttpError(503, { code: 'ALERTS_UNAVAILABLE', messageKey: ALERTS_UNAVAILABLE_KEY });
}
async function loadOwnedSite(accountId: string, siteId: string) {
    if (!Types.ObjectId.isValid(siteId)) {
        throw HttpError.notFound({ code: 'ALERTS_ERRORS_SITE_NOT_FOUND', messageKey: 'alerts.errors.siteNotFound' });
    }
    const site = await Site.findOne({ _id: siteId, accountId, deletionStartedAt: null });
    if (!site)
        throw HttpError.notFound({ code: 'ALERTS_ERRORS_SITE_NOT_FOUND', messageKey: 'alerts.errors.siteNotFound' });
    return site;
}
/**
 * Resolve-then-pin validation at SAVE time. A private range, a credentialed
 * URL, an encoded host, or a dead name all surface as the same localized 400 —
 * the raw resolver message never reaches the customer.
 */
async function assertChannelUrlSafe(url: string, opts: AssertPublicUrlSafeOptions | undefined): Promise<void> {
    try {
        await assertPublicUrlSafe(url, opts);
    }
    catch {
        throw HttpError.badRequest({ code: 'ALERTS_ERRORS_UNSAFE_URL', messageKey: 'alerts.errors.unsafeUrl' });
    }
}
function assertRuleRemoved(removed: boolean): void {
    if (!removed)
        throw HttpError.notFound({ code: 'ALERTS_ERRORS_RULE_NOT_FOUND', messageKey: 'alerts.errors.ruleNotFound' });
}
export const alertsServiceTestables = {
    assertRuleRemoved,
};
/**
 * Older clients used the semantic `self` recipient. Resolve it at the trusted
 * account boundary and collapse aliases so no delivery ever tries to look up
 * a literal user whose id is "self".
 */
function resolveEmailRecipientIds(accountId: string, recipientIds: readonly string[]): string[] {
    return [
        ...new Set(recipientIds.map((recipientId) => recipientId === SELF_RECIPIENT_ALIAS ? accountId : recipientId)),
    ];
}
export async function createRule(input: {
    accountId: string;
    body: CreateRuleBody;
}, deps: AlertsServiceDeps): Promise<AlertRuleMutationDto> {
    await loadOwnedSite(input.accountId, input.body.siteId);
    assertMutationAvailable();
    const now = (deps.now ?? (() => new Date()))();
    const ruleId = newRuleId();
    const slackUrl = input.body.slackWebhookUrl ?? null;
    const webhookUrl = input.body.webhookUrl ?? null;
    if (slackUrl !== null)
        await assertChannelUrlSafe(slackUrl, deps.urlSafety);
    if (webhookUrl !== null)
        await assertChannelUrlSafe(webhookUrl, deps.urlSafety);
    // Mint the id first: the AAD binds each envelope to this exact rule + field,
    // so it must be known before the secrets are sealed.
    const secret = webhookUrl === null ? null : generateWebhookSecret();
    const row = await insertRule(deps.db, {
        id: ruleId,
        accountId: input.accountId,
        siteId: input.body.siteId,
        type: input.body.type,
        threshold: input.body.threshold ?? null,
        enabled: input.body.enabled ?? true,
        emailRecipientIds: resolveEmailRecipientIds(input.accountId, input.body.emailRecipientIds ?? []),
        slackWebhook: slackUrl === null ? null : sealAlertSecret(slackUrl, ruleId, 'slack_webhook'),
        slackHostMasked: slackUrl === null ? null : maskSlackWebhookUrl(slackUrl),
        webhookUrl,
        webhookSecret: secret === null ? null : sealAlertSecret(secret, ruleId, 'webhook_secret'),
        webhookSecretLast4: secret === null ? null : webhookSecretLast4(secret),
        createdAt: now,
        updatedAt: now,
    });
    const dto: AlertRuleMutationDto = toRuleDto(row);
    // Show-once: the plaintext exists in exactly this response and nowhere else.
    if (secret !== null)
        dto.webhookSecret = secret;
    return dto;
}
export async function listRulesForAccount(input: {
    accountId: string;
    query: ListRulesQuery;
    allowedSiteIds?: readonly string[] | null;
}, deps: AlertsServiceDeps): Promise<{
    rules: AlertRuleDto[];
    cap: {
        used: number;
    };
}> {
    if (input.query.siteId !== undefined) {
        await loadOwnedSite(input.accountId, input.query.siteId);
    }
    const rows = await listRules(deps.db, {
        accountId: input.accountId,
        ...(input.query.siteId !== undefined ? { siteId: input.query.siteId } : {}),
        ...(input.query.type !== undefined ? { type: input.query.type } : {}),
        ...(input.query.enabled !== undefined ? { enabled: input.query.enabled } : {}),
    });
    const allowed = input.allowedSiteIds === undefined || input.allowedSiteIds === null
        ? null
        : new Set(input.allowedSiteIds);
    const scopedRows = allowed === null
        ? rows
        : rows.filter((row) => allowed.has(row.siteId));
    const linkedSiteIds = [...new Set(scopedRows.map((row) => row.siteId))];
    const liveSiteIds = new Set((await Site.find({
        _id: { $in: linkedSiteIds },
        accountId: input.accountId,
        deletionStartedAt: null,
    }).select({ _id: 1 })).map((site) => String(site._id)));
    const used = allowed === null
        ? await countRulesForAccount(deps.db, input.accountId)
        : (await listRules(deps.db, { accountId: input.accountId }))
            .filter((row) => allowed.has(row.siteId)).length;
    return {
        rules: scopedRows.filter((row) => liveSiteIds.has(row.siteId)).map(toRuleDto),
        cap: { used },
    };
}
export async function updateRule(input: {
    accountId: string;
    ruleId: string;
    body: UpdateRuleBody;
}, deps: AlertsServiceDeps): Promise<AlertRuleMutationDto> {
    const existing = await findRule(deps.db, input.accountId, input.ruleId);
    if (!existing)
        throw HttpError.notFound({ code: 'ALERTS_ERRORS_RULE_NOT_FOUND', messageKey: 'alerts.errors.ruleNotFound' });
    await loadOwnedSite(input.accountId, existing.siteId);
    assertMutationAvailable();
    const now = (deps.now ?? (() => new Date()))();
    const { body } = input;
    if (body.threshold !== undefined && existing.type !== 'rank_drop') {
        throw HttpError.badRequest({ code: 'ALERTS_ERRORS_THRESHOLD_NOT_ALLOWED', messageKey: 'alerts.errors.thresholdNotAllowed' });
    }
    const slackChanging = body.slackWebhookUrl !== undefined;
    const webhookChanging = body.webhookUrl !== undefined;
    const nextSlack = slackChanging ? (body.slackWebhookUrl ?? null) : undefined;
    const nextWebhook = webhookChanging ? (body.webhookUrl ?? null) : undefined;
    const patch: RuleUpdatePatch = {};
    if (body.threshold !== undefined)
        patch.threshold = body.threshold;
    if (body.enabled !== undefined)
        patch.enabled = body.enabled;
    if (body.emailRecipientIds !== undefined) {
        patch.emailRecipientIds = resolveEmailRecipientIds(input.accountId, body.emailRecipientIds);
    }
    if (nextSlack !== undefined) {
        if (nextSlack === null) {
            patch.slackWebhook = null;
            patch.slackHostMasked = null;
        }
        else {
            await assertChannelUrlSafe(nextSlack, deps.urlSafety);
            patch.slackWebhook = sealAlertSecret(nextSlack, existing.id, 'slack_webhook');
            patch.slackHostMasked = maskSlackWebhookUrl(nextSlack);
        }
    }
    let mintedSecret: string | null = null;
    if (nextWebhook !== undefined) {
        if (nextWebhook === null) {
            patch.webhookUrl = null;
            patch.webhookSecret = null;
            patch.webhookSecretLast4 = null;
        }
        else {
            await assertChannelUrlSafe(nextWebhook, deps.urlSafety);
            patch.webhookUrl = nextWebhook;
            // A new target always gets a new secret — reusing the old one would let
            // a rotated-away endpoint keep verifying signatures.
            mintedSecret = generateWebhookSecret();
        }
    }
    else if (body.rotateWebhookSecret === true) {
        if (existing.webhookUrl === null) {
            throw HttpError.badRequest({ code: 'ALERTS_ERRORS_NO_WEBHOOK_TO_ROTATE', messageKey: 'alerts.errors.noWebhookToRotate' });
        }
        mintedSecret = generateWebhookSecret();
    }
    if (mintedSecret !== null) {
        patch.webhookSecret = sealAlertSecret(mintedSecret, existing.id, 'webhook_secret');
        patch.webhookSecretLast4 = webhookSecretLast4(mintedSecret);
    }
    const row = await updateRuleRow(deps.db, input.accountId, input.ruleId, patch, now);
    if (!row)
        throw HttpError.notFound({ code: 'ALERTS_ERRORS_RULE_NOT_FOUND', messageKey: 'alerts.errors.ruleNotFound' });
    const dto: AlertRuleMutationDto = toRuleDto(row);
    if (mintedSecret !== null)
        dto.webhookSecret = mintedSecret;
    return dto;
}
export async function deleteRule(input: {
    accountId: string;
    ruleId: string;
}, deps: AlertsServiceDeps): Promise<void> {
    const existing = await findRule(deps.db, input.accountId, input.ruleId);
    if (!existing)
        throw HttpError.notFound({ code: 'ALERTS_ERRORS_RULE_NOT_FOUND', messageKey: 'alerts.errors.ruleNotFound' });
    await loadOwnedSite(input.accountId, existing.siteId);
    assertMutationAvailable();
    const removed = await deleteRuleRow(deps.db, input.accountId, input.ruleId, (deps.now ?? (() => new Date()))());
    assertRuleRemoved(removed);
}
export async function listDeliveriesForRule(input: {
    accountId: string;
    ruleId: string;
    query: ListDeliveriesQuery;
}, deps: AlertsServiceDeps): Promise<{
    deliveries: AlertDeliveryDto[];
}> {
    const rule = await findRule(deps.db, input.accountId, input.ruleId);
    if (!rule)
        throw HttpError.notFound({ code: 'ALERTS_ERRORS_RULE_NOT_FOUND', messageKey: 'alerts.errors.ruleNotFound' });
    await loadOwnedSite(input.accountId, rule.siteId);
    const rows = await listDeliveries(deps.db, {
        accountId: input.accountId,
        ruleId: input.ruleId,
        limit: input.query.limit,
        ...(input.query.status !== undefined ? { status: input.query.status } : {}),
        ...(input.query.channel !== undefined ? { channel: input.query.channel } : {}),
    });
    return { deliveries: rows.map(toDeliveryDto) };
}
